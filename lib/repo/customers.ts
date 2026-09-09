import db from "@/lib/db";
import { toContact, toCustomer, toInteraction, toOpportunity, toSignal } from "@/lib/repo/rows";
import type { Contact, Customer, Interaction, Opportunity, Signal } from "@/lib/types";

export interface CustomerListItem extends Customer {
  primary_contact: string | null;
  contact_role: string | null;
  open_value: number;
  best_stage: string | null;
  priority_band: string;
  priority_score: number;
  last_interaction_at: string | null;
  open_commitments: number;
  next_due: string | null;
}

const BAND_RANK = `CASE o.priority_band WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

export function listCustomers(): CustomerListItem[] {
  const rows = db
    .prepare(
      `SELECT c.*,
              ct.name  AS primary_contact,
              ct.role  AS contact_role,
              COALESCE(agg.open_value, 0) AS open_value,
              agg.best_stage,
              COALESCE(agg.band, 'low')   AS priority_band,
              COALESCE(agg.score, 0)      AS priority_score,
              agg.last_interaction_at,
              COALESCE(cm.open_commitments, 0) AS open_commitments,
              cm.next_due
       FROM customers c
       LEFT JOIN (
         SELECT o.customer_id,
                SUM(CASE WHEN o.stage NOT IN ('won','lost') THEN o.value ELSE 0 END) AS open_value,
                MAX(o.last_interaction_at) AS last_interaction_at,
                MAX(o.priority_score)      AS score,
                (SELECT priority_band FROM opportunities x WHERE x.customer_id = o.customer_id
                  ORDER BY ${BAND_RANK.replace(/o\./g, "x.")}, x.priority_score DESC LIMIT 1) AS band,
                (SELECT stage FROM opportunities x WHERE x.customer_id = o.customer_id
                  AND x.stage NOT IN ('won','lost') ORDER BY x.value DESC LIMIT 1) AS best_stage
         FROM opportunities o GROUP BY o.customer_id
       ) agg ON agg.customer_id = c.id
       LEFT JOIN (
         SELECT customer_id, COUNT(*) AS open_commitments, MIN(due_date) AS next_due
         FROM commitments WHERE owner = 'me' AND status IN ('open','snoozed')
         GROUP BY customer_id
       ) cm ON cm.customer_id = c.id
       LEFT JOIN contacts ct ON ct.customer_id = c.id AND ct.is_decision_maker = 1
       GROUP BY c.id
       ORDER BY COALESCE(agg.score, 0) DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({ ...toCustomer(r), ...r } as unknown as CustomerListItem));
}

export function getCustomer(id: number): Customer | null {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? toCustomer(row) : null;
}

export function getCustomerByName(name: string): Customer | null {
  const row = db.prepare("SELECT * FROM customers WHERE name = ? OR company = ?").get(name, name) as
    | Record<string, unknown>
    | undefined;
  return row ? toCustomer(row) : null;
}

export function listContacts(customerId: number): Contact[] {
  return (
    db
      .prepare("SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_decision_maker DESC, name")
      .all(customerId) as Record<string, unknown>[]
  ).map(toContact);
}

export function listOpportunitiesFor(customerId: number): Opportunity[] {
  return (
    db
      .prepare("SELECT * FROM opportunities WHERE customer_id = ? ORDER BY value DESC")
      .all(customerId) as Record<string, unknown>[]
  ).map(toOpportunity);
}

export function listInteractions(customerId: number, limit = 100): Interaction[] {
  return (
    db
      .prepare("SELECT * FROM interactions WHERE customer_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .all(customerId, limit) as Record<string, unknown>[]
  ).map(toInteraction);
}

export function listSignals(customerId: number): Signal[] {
  return (
    db
      .prepare("SELECT * FROM signals WHERE customer_id = ? ORDER BY created_at DESC")
      .all(customerId) as Record<string, unknown>[]
  ).map(toSignal);
}

export function createCustomer(input: { name: string; company: string; workspaceId?: number }): number {
  const ws =
    input.workspaceId ??
    ((db.prepare("SELECT id FROM workspaces ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? 1);
  const info = db
    .prepare("INSERT INTO customers (workspace_id, name, company) VALUES (?, ?, ?)")
    .run(ws, input.name, input.company);
  return Number(info.lastInsertRowid);
}

export function updateCustomerFacts(customerId: number, facts: Record<string, string>, aiSummary?: string) {
  const existing = getCustomer(customerId);
  const merged = { ...(existing?.facts ?? {}), ...facts };
  db.prepare(
    `UPDATE customers SET facts = ?, ai_summary = COALESCE(?, ai_summary), updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(merged), aiSummary ?? null, customerId);
}
