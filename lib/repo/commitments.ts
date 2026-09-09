import db from "@/lib/db";
import type { CommitmentKind, CommitmentOwner, CommitmentView, PriorityBand } from "@/lib/types";
import { addDays, today } from "@/lib/dates";
import { rescoreOpportunity } from "@/lib/repo/opportunities";

// A follow-up IS a commitment with owner='me'. Keeping them in one table is
// deliberate: two tables would let "I owe them a proposal" and "follow up about
// the proposal" drift into two rows describing one obligation.

const VIEW_SQL = `
  SELECT cm.*,
         c.name AS customer_name, c.company, c.ai_summary,
         ct.name AS contact_name, ct.role AS contact_role,
         o.value AS opportunity_value, o.stage AS opportunity_stage,
         COALESCE(o.priority_band, 'low')  AS priority_band,
         COALESCE(o.priority_score, 0)     AS priority_score,
         COALESCE(o.priority_reasons,'[]') AS priority_reasons,
         COALESCE(o.risk_reasons,'[]')     AS risk_reasons,
         o.last_interaction_at,
         (SELECT ai_summary FROM interactions i
           WHERE i.customer_id = cm.customer_id AND i.ai_summary IS NOT NULL
           ORDER BY i.occurred_at DESC LIMIT 1) AS ai_insight
  FROM commitments cm
  JOIN customers c ON c.id = cm.customer_id
  LEFT JOIN contacts ct ON ct.id = cm.contact_id
  LEFT JOIN opportunities o ON o.id = cm.opportunity_id
`;

const BAND_RANK = `CASE COALESCE(o.priority_band,'low')
  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

function decorate(r: Record<string, unknown>): CommitmentView {
  return {
    ...(r as unknown as CommitmentView),
    priority_reasons: JSON.parse((r.priority_reasons as string) || "[]"),
    risk_reasons: JSON.parse((r.risk_reasons as string) || "[]"),
    priority_band: (r.priority_band as PriorityBand) ?? "low",
    ai_recommendation: recommend(r),
  };
}

/**
 * The "what should I actually do" line. Derived from the commitment kind plus
 * the account's risk state — a chase email into 11 days of silence is the
 * wrong move, so the recommendation escalates to a call.
 */
function recommend(r: Record<string, unknown>): string {
  const kind = r.kind as CommitmentKind;
  const risks = JSON.parse((r.risk_reasons as string) || "[]") as string[];
  const contact = ((r.contact_name as string | null) ?? "them").split(" ")[0];
  const silent = risks.find((x) => x.startsWith("No contact for"));

  if (r.owner === "customer") {
    return `Nudge ${contact} — it has been sitting with them. Keep it short and give them an easy out.`;
  }
  if (silent && (kind === "email" || kind === "answer_question")) {
    return `Email is not landing (${silent.toLowerCase()}). Call ${contact} instead, then send a one-line recap.`;
  }
  switch (kind) {
    case "send_proposal":
      return `Send the proposal and propose a specific review slot — don't leave the next step open.`;
    case "send_pricing":
      return `Send pricing with the discount rationale attached, and ask who else needs to see it.`;
    case "send_document":
      return `Send the document and ask one closing question so the thread has a reason to continue.`;
    case "answer_question":
      return `Answer directly, then confirm it unblocks them. Unanswered questions stall deals quietly.`;
    case "schedule_meeting":
      return `Offer two concrete times rather than asking for availability.`;
    case "call":
      return `Call ${contact} and confirm the next step on the phone before you hang up.`;
    case "whatsapp":
      return `Short WhatsApp message — one line of context, one clear ask.`;
    case "escalate":
      return `Loop in the decision maker; the current thread has no authority to close.`;
    case "wait":
      return `Nothing to send yet. Check back on the due date.`;
    default:
      return `Follow up and lock in a concrete next step.`;
  }
}

export interface CommitmentFilter {
  owner?: CommitmentOwner;
  tab?: string;
  priority?: PriorityBand;
  stage?: string;
  customerId?: number;
  kind?: string;
  minValue?: number;
  search?: string;
}

export function listCommitments(f: CommitmentFilter = {}): CommitmentView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const t = today();

  if (f.owner) {
    where.push("cm.owner = ?");
    params.push(f.owner);
  }

  switch (f.tab) {
    case "today":
      where.push("cm.status IN ('open','snoozed') AND cm.due_date <= ?");
      params.push(t);
      break;
    case "overdue":
      where.push("cm.status IN ('open','snoozed') AND cm.due_date < ?");
      params.push(t);
      break;
    case "upcoming":
      where.push("cm.status IN ('open','snoozed') AND cm.due_date > ?");
      params.push(t);
      break;
    case "waiting":
      where.push("cm.owner = 'customer' AND cm.status IN ('open','snoozed')");
      break;
    case "completed":
    case "done":
      where.push("cm.status = 'done'");
      break;
    case "all":
    case undefined:
      break;
    default:
      where.push("cm.status IN ('open','snoozed')");
  }

  if (f.priority) {
    where.push("COALESCE(o.priority_band,'low') = ?");
    params.push(f.priority);
  }
  if (f.stage) {
    where.push("o.stage = ?");
    params.push(f.stage);
  }
  if (f.customerId) {
    where.push("cm.customer_id = ?");
    params.push(f.customerId);
  }
  if (f.kind) {
    where.push("cm.kind = ?");
    params.push(f.kind);
  }
  if (f.minValue) {
    where.push("COALESCE(o.value,0) >= ?");
    params.push(f.minValue);
  }
  if (f.search) {
    where.push("(cm.title LIKE ? OR c.name LIKE ? OR c.company LIKE ?)");
    const like = `%${f.search}%`;
    params.push(like, like, like);
  }

  const sql = `${VIEW_SQL} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY cm.status = 'done', cm.due_date ASC, ${BAND_RANK}, COALESCE(o.value,0) DESC`;
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(decorate);
}

export function getCommitment(id: number): CommitmentView | null {
  const row = db.prepare(`${VIEW_SQL} WHERE cm.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? decorate(row) : null;
}

export function listCommitmentsForCustomer(customerId: number): CommitmentView[] {
  return (
    db.prepare(`${VIEW_SQL} WHERE cm.customer_id = ? ORDER BY cm.status = 'done', cm.due_date`).all(customerId) as Record<
      string,
      unknown
    >[]
  ).map(decorate);
}

/**
 * The Command Center feed, grouped by account. A rep thinks "ABC needs two
 * things today", not "here are two unrelated tasks that happen to share a
 * logo" — so one card per account carries the lead action plus the rest,
 * instead of repeating the same company header and AI insight twice.
 */
export interface FeedItem {
  lead: CommitmentView;
  also: CommitmentView[];
}

export function priorityFeed(limit = 8): FeedItem[] {
  const t = today();
  const rows = db
    .prepare(
      `${VIEW_SQL}
       WHERE cm.owner = 'me' AND cm.status = 'open'
         AND (cm.snoozed_until IS NULL OR cm.snoozed_until <= ?)
       ORDER BY (cm.due_date <= ?) DESC, COALESCE(o.priority_score,0) DESC, cm.due_date ASC`,
    )
    .all(t, t) as Record<string, unknown>[];

  const byCustomer = new Map<number, CommitmentView[]>();
  for (const row of rows) {
    const view = decorate(row);
    const list = byCustomer.get(view.customer_id);
    if (list) list.push(view);
    else byCustomer.set(view.customer_id, [view]);
  }

  return [...byCustomer.values()].slice(0, limit).map((group) => ({ lead: group[0], also: group.slice(1) }));
}

export interface Counts {
  todayActions: number;
  overdue: number;
  atRisk: number;
  hot: number;
  waitingOnYou: number;
}

export function headlineCounts(): Counts {
  const t = today();
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    todayActions: n(
      "SELECT COUNT(*) n FROM commitments WHERE owner='me' AND status='open' AND due_date <= ?",
      t,
    ),
    overdue: n("SELECT COUNT(*) n FROM commitments WHERE owner='me' AND status='open' AND due_date < ?", t),
    atRisk: n("SELECT COUNT(*) n FROM opportunities WHERE stage NOT IN ('won','lost') AND json_array_length(risk_reasons) >= 2"),
    hot: n(
      `SELECT COUNT(DISTINCT o.id) n FROM opportunities o
       JOIN signals s ON s.opportunity_id = o.id AND s.kind='buying' AND s.resolved_at IS NULL
       WHERE o.stage NOT IN ('won','lost')`,
    ),
    waitingOnYou: n(
      `SELECT COUNT(DISTINCT customer_id) n FROM signals WHERE kind='question' AND resolved_at IS NULL`,
    ),
  };
}

export function createCommitment(input: {
  customerId: number;
  opportunityId?: number | null;
  contactId?: number | null;
  interactionId?: number | null;
  owner: CommitmentOwner;
  kind: CommitmentKind;
  title: string;
  detail?: string | null;
  dueDate: string;
  source?: "ai_extracted" | "manual";
}): number {
  const info = db
    .prepare(
      `INSERT INTO commitments
         (customer_id, opportunity_id, contact_id, interaction_id, owner, kind, title, detail, due_date, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.customerId,
      input.opportunityId ?? null,
      input.contactId ?? null,
      input.interactionId ?? null,
      input.owner,
      input.kind,
      input.title,
      input.detail ?? null,
      input.dueDate,
      input.source ?? "manual",
    );
  if (input.opportunityId) rescoreOpportunity(input.opportunityId);
  return Number(info.lastInsertRowid);
}

function opportunityOf(id: number): number | null {
  const row = db.prepare("SELECT opportunity_id FROM commitments WHERE id = ?").get(id) as
    | { opportunity_id: number | null }
    | undefined;
  return row?.opportunity_id ?? null;
}

export function completeCommitment(id: number) {
  db.prepare("UPDATE commitments SET status='done', completed_at=datetime('now') WHERE id = ?").run(id);
  const opp = opportunityOf(id);
  if (opp) rescoreOpportunity(opp);
}

export function reopenCommitment(id: number) {
  db.prepare("UPDATE commitments SET status='open', completed_at=NULL WHERE id = ?").run(id);
  const opp = opportunityOf(id);
  if (opp) rescoreOpportunity(opp);
}

export function snoozeCommitment(id: number, days: number) {
  const next = addDays(today(), days);
  db.prepare("UPDATE commitments SET due_date=?, snoozed_until=?, status='open' WHERE id = ?").run(next, next, id);
  const opp = opportunityOf(id);
  if (opp) rescoreOpportunity(opp);
}

export function rescheduleCommitment(id: number, date: string) {
  db.prepare("UPDATE commitments SET due_date=?, snoozed_until=NULL WHERE id = ?").run(date, id);
  const opp = opportunityOf(id);
  if (opp) rescoreOpportunity(opp);
}

export function deleteCommitment(id: number) {
  const opp = opportunityOf(id);
  db.prepare("DELETE FROM commitments WHERE id = ?").run(id);
  if (opp) rescoreOpportunity(opp);
}
