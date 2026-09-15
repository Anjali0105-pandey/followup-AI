import db from "@/lib/db";
import { toOpportunity } from "@/lib/repo/rows";
import type { Opportunity, Stage } from "@/lib/types";
import { scoreOpportunity, maxDaysOverdue } from "@/lib/priority";
import { daysBetween, today } from "@/lib/dates";

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

function decorate(r: Record<string, unknown>): OpportunityView {
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
    days_inactive: last ? daysBetween(last.slice(0, 10), today()) : null,
  };
}

export async function listOpportunities(): Promise<OpportunityView[]> {
  const rows = await db.all(`${VIEW_SQL} ORDER BY o.priority_score DESC, o.value DESC`);
  return rows.map(decorate);
}

export async function getOpportunity(id: number): Promise<OpportunityView | null> {
  const row = await db.get(`${VIEW_SQL} WHERE o.id = ?`, id);
  return row ? decorate(row) : null;
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
  await db.run(
    `UPDATE opportunities SET stage = ?, probability = ?, updated_at = now() WHERE id = ?`,
    stage,
    STAGE_PROBABILITY[stage],
    id,
  );
  await rescoreOpportunity(id);
}

/** Median open-deal value, the normaliser for the deal-size component. */
async function pipelineMedian(): Promise<number> {
  const rows = await db.all<{ value: number }>(
    "SELECT value FROM opportunities WHERE stage NOT IN ('won','lost') ORDER BY value",
  );
  if (rows.length === 0) return 10_000;
  return rows[Math.floor(rows.length / 2)].value;
}

/**
 * Recompute cached priority for one opportunity. Called on write (new
 * interaction, commitment change, stage move) — never on page load, so list
 * screens stay a pure read of cached columns.
 */
export async function rescoreOpportunity(id: number, median?: number) {
  const opp = await db.get("SELECT * FROM opportunities WHERE id = ?", id);
  if (!opp) return;
  const stage = opp.stage as Stage;

  const t = today();
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
    pipelineMedian: median ?? (await pipelineMedian()),
    stage,
    probability: opp.probability as number,
    daysOverdue: maxDaysOverdue(openMine.map((c) => c.due_date)),
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

export async function rescoreAll() {
  const median = await pipelineMedian();
  const ids = await db.all<{ id: number }>("SELECT id FROM opportunities");
  for (const { id } of ids) await rescoreOpportunity(id, median);
}

/** The opportunity a commitment or interaction should attach to by default. */
export async function primaryOpportunityFor(customerId: number): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    `SELECT id FROM opportunities WHERE customer_id = ? AND stage NOT IN ('won','lost')
     ORDER BY value DESC LIMIT 1`,
    customerId,
  );
  return row?.id ?? null;
}
