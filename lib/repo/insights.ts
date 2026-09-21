import db from "@/lib/db";
import type { InsightCategory, InsightItem } from "@/lib/types";
import { daysBetween, today } from "@/lib/dates";
import { moneyShort } from "@/lib/format";
import { currentWorkspaceId } from "@/lib/repo/workspace";

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
  return db.all<Base & Record<string, unknown>>(sql, ...params);
}

function inactiveDays(r: Record<string, unknown>): number | null {
  const last = r.last_interaction_at as string | null;
  return last ? daysBetween(last.slice(0, 10), today()) : null;
}

/** jsonb columns arrive decoded; older text rows are still parsed defensively. */
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function computeInsights(): Promise<Record<InsightCategory, InsightItem[]>> {
  const t = today();
  const ws = await currentWorkspaceId();
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

  /* created_at is a timestamptz now, so the driver hands back a Date object.
     Formatting it to a day string in SQL keeps the callers' .slice(0, 10)
     working and avoids a timezone round-trip in JS. */
  const SIGNAL_COLS = `s.label, s.detail, to_char(s.created_at, 'YYYY-MM-DD') AS created_at,
                       c.id AS customer_id, c.name AS customer_name, c.company,
                       o.id AS opportunity_id, o.value`;

  /* All eight lenses are independent queries. Run as one wave rather than
     eight sequential awaits: against a remote database each round-trip is a
     fixed network toll, so serialising them multiplied the page cost by 8. */
  const [hotRows, atRiskRows, goingColdRows, buyingRows, questionRows, missedRows, noNextStepRows, waitingRows] = await Promise.all([
    rows(
      `SELECT * FROM (
       SELECT ${BASE_COLS},
              (SELECT COUNT(*)::int FROM signals s
                WHERE s.opportunity_id=o.id AND s.kind='buying' AND s.resolved_at IS NULL) AS buying
       FROM opportunities o JOIN customers c ON c.id=o.customer_id
       WHERE c.workspace_id = ? AND ${open} AND o.probability >= 35
     ) q
     WHERE q.buying > 0
     ORDER BY q.priority_score DESC`,
    ws,
    ),
    rows(
      `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE c.workspace_id = ? AND ${open} AND jsonb_array_length(o.risk_reasons) >= 2
     ORDER BY o.value DESC`,
    ws,
    ),
    rows(
      `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE c.workspace_id = ? AND ${open} AND o.last_interaction_at IS NOT NULL
       AND (?::date - LEFT(o.last_interaction_at, 10)::date) >= 10
     ORDER BY o.value DESC`,
    ws,
    t,
    ),
    db.all(
      `SELECT ${SIGNAL_COLS}
     FROM signals s JOIN customers c ON c.id=s.customer_id
     LEFT JOIN opportunities o ON o.id=s.opportunity_id
     WHERE c.workspace_id = ? AND s.kind='buying' AND s.resolved_at IS NULL
     ORDER BY s.created_at DESC LIMIT 12`,
    ws,
    ),
    db.all(
      `SELECT ${SIGNAL_COLS}
     FROM signals s JOIN customers c ON c.id=s.customer_id
     LEFT JOIN opportunities o ON o.id=s.opportunity_id
     WHERE c.workspace_id = ? AND s.kind='question' AND s.resolved_at IS NULL
     ORDER BY s.created_at ASC`,
    ws,
    ),
    db.all(
      `SELECT cm.id, cm.title, cm.due_date, c.id AS customer_id, c.name AS customer_name, c.company,
            o.id AS opportunity_id, o.value
     FROM commitments cm JOIN customers c ON c.id=cm.customer_id
     LEFT JOIN opportunities o ON o.id=cm.opportunity_id
     WHERE c.workspace_id = ? AND cm.owner='me' AND cm.status IN ('open','snoozed') AND cm.due_date < ?
     ORDER BY cm.due_date ASC`,
    ws,
    t,
    ),
    rows(
      `SELECT ${BASE_COLS} FROM opportunities o JOIN customers c ON c.id=o.customer_id
     WHERE c.workspace_id = ? AND ${open} AND o.next_action_at IS NULL ORDER BY o.value DESC`,
    ws,
    ),
    db.all(
      `SELECT c.id AS customer_id, c.name AS customer_name, c.company,
            o.id AS opportunity_id, o.value, i.occurred_at, i.subject
     FROM customers c
     JOIN interactions i ON i.id = (
       SELECT id FROM interactions x WHERE x.customer_id=c.id ORDER BY x.occurred_at DESC, x.id DESC LIMIT 1
     )
     LEFT JOIN opportunities o ON o.customer_id=c.id AND o.stage NOT IN ('won','lost')
     WHERE c.workspace_id = ? AND i.direction='inbound'
       AND (?::date - LEFT(i.occurred_at, 10)::date) >= 2
     ORDER BY i.occurred_at ASC`,
    ws,
    t,
    ),
  ]);

  // HOT — buying signals plus recent engagement. The buying count lives in a
  // subselect rather than a SELECT alias: Postgres cannot reference an output
  // alias from WHERE the way SQLite could.
  for (const r of hotRows) {
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
  for (const r of atRiskRows) {
    const reasons = strings(r.risk_reasons);
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
  // `julianday()` has no Postgres equivalent; subtracting two dates yields the
  // integer day gap directly.
  for (const r of goingColdRows) {
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
  for (const r of buyingRows) {
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
  for (const r of questionRows) {
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
  for (const r of missedRows) {
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
  for (const r of noNextStepRows) {
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
  for (const r of waitingRows) {
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
