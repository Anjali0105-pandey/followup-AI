import db from "@/lib/db";
import { toOpportunity } from "@/lib/repo/rows";
import type { Opportunity, Stage } from "@/lib/types";
import { scoreOpportunity, maxDaysOverdue } from "@/lib/priority";
import { daysBetween, today } from "@/lib/dates";
import { currentDay, currentWorkspaceId } from "@/lib/repo/workspace";

export interface OpportunityView extends Opportunity {
  customer_name: string;
  company: string;
  contact_name: string | null;
  contact_role: string | null;
  days_inactive: number | null;
  next_action: string | null;
  health: string;
}

const VIEW_SQL = `
  SELECT o.*,
         c.name AS customer_name, c.company, c.health,
         ct.name AS contact_name, ct.role AS contact_role,
         (SELECT title FROM commitments cm
           WHERE cm.opportunity_id = o.id AND cm.owner = 'me' AND cm.status IN ('open','snoozed')
           ORDER BY cm.due_date LIMIT 1) AS next_action
  FROM opportunities o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN contacts ct ON ct.id = o.primary_contact_id
`;

function decorate(r: Record<string, unknown>, t: string): OpportunityView {
  const opp = toOpportunity(r);
  const last = (r.last_interaction_at as string | null) ?? null;
  return {
    ...opp,
    customer_name: r.customer_name as string,
    company: r.company as string,
    contact_name: (r.contact_name as string | null) ?? null,
    contact_role: (r.contact_role as string | null) ?? null,
    next_action: (r.next_action as string | null) ?? null,
    health: (r.health as string) ?? "healthy",
    days_inactive: last ? daysBetween(last.slice(0, 10), t) : null,
  };
}

export async function listOpportunities(): Promise<OpportunityView[]> {
  const [t, ws] = await Promise.all([currentDay(), currentWorkspaceId()]);
  const rows = await db.all(
    `${VIEW_SQL} WHERE c.workspace_id = ? ORDER BY o.priority_score DESC, o.value DESC`,
    ws,
  );
  return rows.map((r) => decorate(r, t));
}

export async function getOpportunity(id: number): Promise<OpportunityView | null> {
  const [t, ws] = await Promise.all([currentDay(), currentWorkspaceId()]);
  const row = await db.get(`${VIEW_SQL} WHERE o.id = ? AND c.workspace_id = ?`, id, ws);
  return row ? decorate(row, t) : null;
}

const STAGE_PROBABILITY: Record<Stage, number> = {
  new: 10,
  qualified: 20,
  discovery: 35,
  demo: 50,
  proposal: 65,
  negotiation: 80,
  won: 100,
  lost: 0,
};

export async function moveStage(id: number, stage: Stage) {
  if (!(await ownsOpportunity(id))) return;
  await db.run(
    `UPDATE opportunities SET stage = ?, probability = ?, updated_at = now() WHERE id = ?`,
    stage,
    STAGE_PROBABILITY[stage],
    id,
  );
  await rescoreOpportunity(id);
}

/** True when the opportunity belongs to the caller's workspace. */
async function ownsOpportunity(id: number): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    `SELECT o.id FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ? AND c.workspace_id = ?`,
    id,
    await currentWorkspaceId(),
  );
  return Boolean(row);
}

/** Median open-deal value, the normaliser for the deal-size component. */
async function pipelineMedian(workspaceId?: number): Promise<number> {
  const rows = await db.all<{ value: number }>(
    `SELECT o.value FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE c.workspace_id = ? AND o.stage NOT IN ('won','lost') ORDER BY o.value`,
    workspaceId ?? (await currentWorkspaceId()),
  );
  if (rows.length === 0) return 10_000;
  return rows[Math.floor(rows.length / 2)].value;
}

/**
 * Recompute cached priority for one opportunity. Called on write (new
 * interaction, commitment change, stage move) — never on page load, so list
 * screens stay a pure read of cached columns.
 */
export async function rescoreOpportunity(id: number, median?: number, workspaceId?: number, day?: string) {
  const opp = await db.get(
    `SELECT o.* FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ? AND c.workspace_id = ?`,
    id,
    workspaceId ?? (await currentWorkspaceId()),
  );
  if (!opp) return;
  const stage = opp.stage as Stage;

  /* The seed runs from the CLI with no session, so it passes the day in; every
     other caller gets the signed-in rep's own day. */
  const t = day ?? (workspaceId ? today() : await currentDay());
  const openMine = await db.all<{ due_date: string }>(
    `SELECT due_date FROM commitments
     WHERE opportunity_id = ? AND owner = 'me' AND status IN ('open','snoozed')`,
    id,
  );

  // COUNT and SUM come back as bigint, which the driver stringifies — cast so
  // the scoring maths gets numbers rather than "3".
  const counts = await db.all<{ kind: string; n: number; strength: number }>(
    `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(strength),0)::int AS strength FROM signals
     WHERE opportunity_id = ? AND resolved_at IS NULL GROUP BY kind`,
    id,
  );
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c.n])) as Record<string, number>;
  const strengthOf = Object.fromEntries(counts.map((c) => [c.kind, c.strength])) as Record<string, number>;

  const lastInteraction =
    (await db.get<{ m: string | null }>("SELECT MAX(occurred_at) AS m FROM interactions WHERE opportunity_id = ?", id))
      ?.m ?? null;

  const nextAction =
    (
      await db.get<{ d: string | null }>(
        `SELECT MIN(due_date) AS d FROM commitments
         WHERE opportunity_id = ? AND owner = 'me' AND status IN ('open','snoozed')`,
        id,
      )
    )?.d ?? null;

  const result = scoreOpportunity({
    value: opp.value as number,
    pipelineMedian: median ?? (await pipelineMedian(workspaceId)),
    stage,
    probability: opp.probability as number,
    daysOverdue: maxDaysOverdue(openMine.map((c) => c.due_date), t),
    dueToday: openMine.some((c) => c.due_date === t),
    daysSinceInteraction: lastInteraction ? daysBetween(lastInteraction.slice(0, 10), t) : null,
    buyingSignals: byKind.buying ?? 0,
    buyingStrength: strengthOf.buying ?? 0,
    riskSignals: byKind.risk ?? 0,
    competitorMentions: byKind.competitor ?? 0,
    openQuestions: byKind.question ?? 0,
    hasNextStep: openMine.length > 0,
  });

  // The ::jsonb casts matter: passing a JS array as a parameter would be
  // encoded as a Postgres array literal, not as JSON.
  await db.run(
    `UPDATE opportunities
     SET priority_score = ?, priority_band = ?, priority_reasons = ?::jsonb, risk_reasons = ?::jsonb,
         last_interaction_at = ?, next_action_at = ?, updated_at = now()
     WHERE id = ?`,
    result.score,
    result.band,
    JSON.stringify(result.reasons),
    JSON.stringify(result.riskReasons),
    lastInteraction,
    nextAction,
    id,
  );

  // Health is a projection of the score's risk half, so the two can never
  // disagree on screen.
  const health = result.riskReasons.length >= 2 ? "at_risk" : result.riskReasons.length === 1 ? "watch" : "healthy";
  await db.run("UPDATE customers SET health = ? WHERE id = ?", health, opp.customer_id as number);
}

/**
 * `workspaceId` is passed explicitly by the seed script, which runs from the
 * CLI where there is no Clerk session to derive a tenant from.
 */
export async function rescoreAll(workspaceId?: number) {
  const ws = workspaceId ?? (await currentWorkspaceId());
  const median = await pipelineMedian(ws);
  const ids = await db.all<{ id: number }>(
    `SELECT o.id FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE c.workspace_id = ?`,
    ws,
  );
  const day = workspaceId ? today() : await currentDay();
  for (const { id } of ids) await rescoreOpportunity(id, median, ws, day);
}

/** The opportunity a commitment or interaction should attach to by default. */
export async function primaryOpportunityFor(customerId: number): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    `SELECT o.id FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.customer_id = ? AND c.workspace_id = ? AND o.stage NOT IN ('won','lost')
     ORDER BY o.value DESC LIMIT 1`,
    customerId,
    await currentWorkspaceId(),
  );
  return row?.id ?? null;
}

/* ---------- Mutations ----------
   Opportunities were previously created by the seed script alone. Without one,
   an account has no value, no stage and no priority score, its commitments link
   to nothing, and it is invisible to every Insight lens — all of which join
   opportunities. So this is what makes a self-created account real. */

export interface OpportunityFields {
  name: string;
  value: number;
  stage: Stage;
  expectedCloseDate?: string | null;
  primaryContactId?: number | null;
}

/** True when the contact belongs to this customer — a contact from another
    account must not become its primary. */
async function contactBelongsTo(customerId: number, contactId: number): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    `SELECT ct.id FROM contacts ct JOIN customers c ON c.id = ct.customer_id
     WHERE ct.id = ? AND ct.customer_id = ? AND c.workspace_id = ?`,
    contactId,
    customerId,
    await currentWorkspaceId(),
  );
  return Boolean(row);
}

export async function createOpportunity(
  customerId: number,
  fields: OpportunityFields,
): Promise<number | null> {
  const owner = await db.get<{ id: number }>(
    "SELECT id FROM customers WHERE id = ? AND workspace_id = ?",
    customerId,
    await currentWorkspaceId(),
  );
  if (!owner) return null;

  const contactId =
    fields.primaryContactId && (await contactBelongsTo(customerId, fields.primaryContactId))
      ? fields.primaryContactId
      : null;

  const id = await db.insert(
    `INSERT INTO opportunities
       (customer_id, name, value, stage, probability, expected_close_date, primary_contact_id)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    customerId,
    fields.name,
    fields.value,
    fields.stage,
    // Probability is derived from the stage, exactly as a drag across the
    // kanban does it, so the two paths can never disagree.
    STAGE_PROBABILITY[fields.stage],
    fields.expectedCloseDate ?? null,
    contactId,
  );

  // A new opportunity changes the account's priority and health immediately.
  await rescoreOpportunity(id);
  return id;
}

export async function updateOpportunity(id: number, fields: OpportunityFields): Promise<boolean> {
  const existing = await db.get<{ customer_id: number }>(
    `SELECT o.customer_id FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ? AND c.workspace_id = ?`,
    id,
    await currentWorkspaceId(),
  );
  if (!existing) return false;

  const contactId =
    fields.primaryContactId && (await contactBelongsTo(existing.customer_id, fields.primaryContactId))
      ? fields.primaryContactId
      : null;

  await db.run(
    `UPDATE opportunities
     SET name = ?, value = ?, stage = ?, probability = ?, expected_close_date = ?,
         primary_contact_id = ?, updated_at = now()
     WHERE id = ?`,
    fields.name,
    fields.value,
    fields.stage,
    STAGE_PROBABILITY[fields.stage],
    fields.expectedCloseDate ?? null,
    contactId,
    id,
  );

  await rescoreOpportunity(id);
  return true;
}

export async function deleteOpportunity(id: number): Promise<boolean> {
  const existing = await db.get<{ customer_id: number }>(
    `SELECT o.customer_id FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ? AND c.workspace_id = ?`,
    id,
    await currentWorkspaceId(),
  );
  if (!existing) return false;

  await db.run("DELETE FROM opportunities WHERE id = ?", id);

  /* Health is a projection of an opportunity's risk half, so with this one gone
     the account has to be re-derived from whatever remains — otherwise it keeps
     the "at risk" pill of a deal that no longer exists. */
  const remaining = await db.get<{ id: number }>(
    "SELECT id FROM opportunities WHERE customer_id = ? ORDER BY value DESC LIMIT 1",
    existing.customer_id,
  );
  if (remaining) await rescoreOpportunity(remaining.id);
  else await db.run("UPDATE customers SET health = 'healthy' WHERE id = ?", existing.customer_id);

  return true;
}
