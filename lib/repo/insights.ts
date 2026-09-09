import db from "@/lib/db";
import type { InsightCategory, InsightItem } from "@/lib/types";
import { daysBetween, today } from "@/lib/dates";
import { moneyShort } from "@/lib/format";

// Insights are a *lens*, not a table: every category is a query over data that
// already exists, computed in one pass on read. Nothing here calls the AI —
// list pages must never pay for a model round-trip.

interface Base {
  customer_id: number;
  customer_name: string;
  company: string;
  opportunity_id: number | null;
  value: number | null;
}

const BASE_COLS = `
  o.id AS opportunity_id, o.value, o.stage, o.probability, o.last_interaction_at,
  o.risk_reasons, o.priority_score,
  c.id AS customer_id, c.name AS customer_name, c.company
`;

function rows(sql: string, ...params: unknown[]) {
  return db.prepare(sql).all(...params) as (Base & Record<string, unknown>)[];
}

function inactiveDays(r: Record<string, unknown>): number | null {
  const last = r.last_interaction_at as string | null;
  return last ? daysBetween(last.slice(0, 10), today()) : null;
}

export function computeInsights(): Record<InsightCategory, InsightItem[]> {
  const t = today();
  const out: Record<InsightCategory, InsightItem[]> = {
    hot: [],
    at_risk: [],
    going_cold: [],
    buying_signal: [],
    unanswered_question: [],
    missed_followup: [],
    no_next_step: [],
    waiting_on_us: [],
  };

  const open = `o.stage NOT IN ('won','lost')`;

  // HOT — buying signals plus recent engagement.
  for (const r of rows(
    `SELECT ${BASE_COLS},
            (SELECT COUNT(*) FROM signals s WHERE s.opportunity_id=o.id AND s.kind='buying' AND s.resolved_at IS NULL) AS buying
     FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE ${open} AND buying > 0 AND o.probability >= 35
     ORDER BY o.priority_score DESC`,
  )) {
    out.hot.push({
      category: "hot",
      ...pick(r),
      title: `${r.company} — ${moneyShort(r.value as number)} in ${r.stage}`,
      why: [
        `${r.buying} active buying signal${(r.buying as number) === 1 ? "" : "s"}`,
        `${r.probability}% probability at ${r.stage} stage`,
        inactiveDays(r) != null ? `Last touch ${inactiveDays(r)} days ago` : "No interactions logged",
      ],
      recommendation: "Push for a decision date while intent is high.",
      severity: "info",
    });
  }

  // AT RISK — two or more risk reasons on the cached score.
  for (const r of rows(
    `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE ${open} AND json_array_length(o.risk_reasons) >= 2
     ORDER BY o.value DESC`,
  )) {
    const reasons = JSON.parse((r.risk_reasons as string) || "[]") as string[];
    out.at_risk.push({
      category: "at_risk",
      ...pick(r),
      title: `${r.company} — ${moneyShort(r.value as number)} at risk`,
      why: reasons,
      recommendation: reasons.some((x) => x.startsWith("No contact"))
        ? "Stop emailing. Call the champion directly and re-establish a next step."
        : "Address the blocker head-on and put a decision meeting on the calendar.",
      severity: "risk",
    });
  }

  // GOING COLD — silence past the stage norm, but not yet flagged at risk.
  for (const r of rows(
    `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE ${open} AND o.last_interaction_at IS NOT NULL
       AND julianday(?) - julianday(o.last_interaction_at) >= 10
     ORDER BY o.value DESC`,
    t,
  )) {
    const d = inactiveDays(r)!;
    out.going_cold.push({
      category: "going_cold",
      ...pick(r),
      title: `${r.company} — quiet for ${d} days`,
      why: [`No interaction in ${d} days`, `Still open at ${r.stage} stage`, `${moneyShort(r.value as number)} exposed`],
      recommendation: "Send a value-add nudge (case study or a relevant update), not another 'checking in'.",
      severity: "attention",
    });
  }

  // BUYING SIGNALS — the raw signal rows, most recent first.
  for (const r of db
    .prepare(
      `SELECT s.label, s.detail, s.created_at, c.id AS customer_id, c.name AS customer_name, c.company,
              o.id AS opportunity_id, o.value
       FROM signals s JOIN customers c ON c.id=s.customer_id
       LEFT JOIN opportunities o ON o.id=s.opportunity_id
       WHERE s.kind='buying' AND s.resolved_at IS NULL
       ORDER BY s.created_at DESC LIMIT 12`,
    )
    .all() as Record<string, unknown>[]) {
    out.buying_signal.push({
      category: "buying_signal",
      customer_id: r.customer_id as number,
      customer_name: r.customer_name as string,
      company: r.company as string,
      opportunity_id: (r.opportunity_id as number) ?? null,
      value: (r.value as number) ?? null,
      title: r.label as string,
      why: [r.detail as string].filter(Boolean) as string[],
      recommendation: "Respond today — buying signals decay fast.",
      severity: "info",
    });
  }

  // UNANSWERED QUESTIONS.
  for (const r of db
    .prepare(
      `SELECT s.label, s.detail, s.created_at, c.id AS customer_id, c.name AS customer_name, c.company,
              o.id AS opportunity_id, o.value
       FROM signals s JOIN customers c ON c.id=s.customer_id
       LEFT JOIN opportunities o ON o.id=s.opportunity_id
       WHERE s.kind='question' AND s.resolved_at IS NULL
       ORDER BY s.created_at ASC`,
    )
    .all() as Record<string, unknown>[]) {
    const age = daysBetween((r.created_at as string).slice(0, 10), t);
    out.unanswered_question.push({
      category: "unanswered_question",
      customer_id: r.customer_id as number,
      customer_name: r.customer_name as string,
      company: r.company as string,
      opportunity_id: (r.opportunity_id as number) ?? null,
      value: (r.value as number) ?? null,
      title: r.label as string,
      why: [`Asked ${age} day${age === 1 ? "" : "s"} ago`, (r.detail as string) ?? ""].filter(Boolean),
      recommendation: "Answer it directly today, even if the answer is 'not yet'.",
      severity: age > 3 ? "risk" : "attention",
    });
  }

  // MISSED FOLLOW-UPS — overdue commitments we owe.
  for (const r of db
    .prepare(
      `SELECT cm.id, cm.title, cm.due_date, c.id AS customer_id, c.name AS customer_name, c.company,
              o.id AS opportunity_id, o.value
       FROM commitments cm JOIN customers c ON c.id=cm.customer_id
       LEFT JOIN opportunities o ON o.id=cm.opportunity_id
       WHERE cm.owner='me' AND cm.status IN ('open','snoozed') AND cm.due_date < ?
       ORDER BY cm.due_date ASC`,
    )
    .all(t) as Record<string, unknown>[]) {
    const late = daysBetween(r.due_date as string, t);
    out.missed_followup.push({
      category: "missed_followup",
      customer_id: r.customer_id as number,
      customer_name: r.customer_name as string,
      company: r.company as string,
      opportunity_id: (r.opportunity_id as number) ?? null,
      value: (r.value as number) ?? null,
      title: r.title as string,
      why: [`${late} day${late === 1 ? "" : "s"} past the date you promised`],
      recommendation: "Deliver it now and acknowledge the delay in one line — don't over-apologise.",
      severity: late > 3 ? "risk" : "attention",
    });
  }

  // NO NEXT STEP — open opportunities with nothing on the calendar.
  for (const r of rows(
    `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE ${open} AND o.next_action_at IS NULL ORDER BY o.value DESC`,
  )) {
    out.no_next_step.push({
      category: "no_next_step",
      ...pick(r),
      title: `${r.company} — ${moneyShort(r.value as number)} with nothing scheduled`,
      why: [`Open at ${r.stage} stage`, "No follow-up or meeting booked"],
      recommendation: "Book the next step before you close this tab. A deal with no next step is a deal drifting.",
      severity: (r.value as number) > 20000 ? "risk" : "attention",
    });
  }

  // WAITING ON US — the customer's last word, and we haven't replied.
  for (const r of db
    .prepare(
      `SELECT c.id AS customer_id, c.name AS customer_name, c.company,
              o.id AS opportunity_id, o.value, i.occurred_at, i.subject
       FROM customers c
       JOIN interactions i ON i.id = (
         SELECT id FROM interactions x WHERE x.customer_id=c.id ORDER BY x.occurred_at DESC, x.id DESC LIMIT 1
       )
       LEFT JOIN opportunities o ON o.customer_id=c.id AND o.stage NOT IN ('won','lost')
       WHERE i.direction='inbound' AND julianday(?) - julianday(i.occurred_at) >= 2
       ORDER BY i.occurred_at ASC`,
    )
    .all(t) as Record<string, unknown>[]) {
    const waiting = daysBetween((r.occurred_at as string).slice(0, 10), t);
    out.waiting_on_us.push({
      category: "waiting_on_us",
      customer_id: r.customer_id as number,
      customer_name: r.customer_name as string,
      company: r.company as string,
      opportunity_id: (r.opportunity_id as number) ?? null,
      value: (r.value as number) ?? null,
      title: `${r.company} sent "${r.subject}" and got no reply`,
      why: [`Waiting ${waiting} day${waiting === 1 ? "" : "s"} for a response from you`],
      recommendation: "Reply today. Silence from you reads as disinterest.",
      severity: waiting > 4 ? "risk" : "attention",
    });
  }

  return out;
}

function pick(r: Base & Record<string, unknown>) {
  return {
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    company: r.company,
    opportunity_id: r.opportunity_id,
    value: r.value,
  };
}
