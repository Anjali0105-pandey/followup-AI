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

export function listOpportunities(): OpportunityView[] {
  const rows = db
    .prepare(`${VIEW_SQL} ORDER BY o.priority_score DESC, o.value DESC`)
    .all() as Record<string, unknown>[];
  return rows.map(decorate);
}

export function getOpportunity(id: number): OpportunityView | null {
  const row = db.prepare(`${VIEW_SQL} WHERE o.id = ?`).get(id) as Record<string, unknown> | undefined;
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

export function moveStage(id: number, stage: Stage) {
  db.prepare(
    `UPDATE opportunities SET stage = ?, probability = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(stage, STAGE_PROBABILITY[stage], id);
  rescoreOpportunity(id);
}

/** Median open-deal value, the normaliser for the deal-size component. */
function pipelineMedian(): number {
  const values = (
    db
      .prepare("SELECT value FROM opportunities WHERE stage NOT IN ('won','lost') ORDER BY value")
      .all() as { value: number }[]
  ).map((r) => r.value);
  if (values.length === 0) return 10_000;
  return values[Math.floor(values.length / 2)];
}

/**
 * Recompute cached priority for one opportunity. Called on write (new
 * interaction, commitment change, stage move) — never on page load, so list
 * screens stay a pure read of cached columns.
 */
export function rescoreOpportunity(id: number, median?: number) {
  const opp = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!opp) return;
  const stage = opp.stage as Stage;

  const t = today();
  const openMine = db
    .prepare(
      `SELECT due_date FROM commitments
       WHERE opportunity_id = ? AND owner = 'me' AND status IN ('open','snoozed')`,
    )
    .all(id) as { due_date: string }[];

  const counts = db
    .prepare(
      `SELECT kind, COUNT(*) AS n, SUM(strength) AS strength FROM signals
       WHERE opportunity_id = ? AND resolved_at IS NULL GROUP BY kind`,
    )
    .all(id) as { kind: string; n: number; strength: number }[];
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c.n])) as Record<string, number>;
  const strengthOf = Object.fromEntries(counts.map((c) => [c.kind, c.strength])) as Record<string, number>;

  const lastInteraction = (
    db
      .prepare("SELECT MAX(occurred_at) AS m FROM interactions WHERE opportunity_id = ?")
      .get(id) as { m: string | null }
  ).m;

  const nextAction = (
    db
      .prepare(
        `SELECT MIN(due_date) AS d FROM commitments
         WHERE opportunity_id = ? AND owner = 'me' AND status IN ('open','snoozed')`,
      )
      .get(id) as { d: string | null }
  ).d;

  const result = scoreOpportunity({
    value: opp.value as number,
    pipelineMedian: median ?? pipelineMedian(),
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

  db.prepare(
    `UPDATE opportunities
     SET priority_score = ?, priority_band = ?, priority_reasons = ?, risk_reasons = ?,
         last_interaction_at = ?, next_action_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
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
  db.prepare("UPDATE customers SET health = ? WHERE id = ?").run(health, opp.customer_id as number);
}

export function rescoreAll() {
  const median = pipelineMedian();
  const ids = db.prepare("SELECT id FROM opportunities").all() as { id: number }[];
  for (const { id } of ids) rescoreOpportunity(id, median);
}

/** The opportunity a commitment or interaction should attach to by default. */
export function primaryOpportunityFor(customerId: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM opportunities WHERE customer_id = ? AND stage NOT IN ('won','lost')
       ORDER BY value DESC LIMIT 1`,
    )
    .get(customerId) as { id: number } | undefined;
  return row?.id ?? null;
}
