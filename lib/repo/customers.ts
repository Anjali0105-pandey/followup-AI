import db from "@/lib/db";
import { toContact, toCustomer, toInteraction, toOpportunity, toSignal } from "@/lib/repo/rows";
import type { Contact, Customer, Interaction, Opportunity, Signal } from "@/lib/types";
import { currentWorkspaceId } from "@/lib/repo/workspace";

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

export async function listCustomers(): Promise<CustomerListItem[]> {
  const ws = await currentWorkspaceId();
  /* The decision-maker contact is pulled with scalar subqueries rather than a
     join: a customer can have more than one, and Postgres will not let a bare
     GROUP BY c.id collapse the duplicates the way SQLite did. */
  const rows = await db.all(
    `SELECT c.*,
            (SELECT name FROM contacts ct WHERE ct.customer_id = c.id AND ct.is_decision_maker = 1
              ORDER BY ct.id LIMIT 1) AS primary_contact,
            (SELECT role FROM contacts ct WHERE ct.customer_id = c.id AND ct.is_decision_maker = 1
              ORDER BY ct.id LIMIT 1) AS contact_role,
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
       SELECT customer_id, COUNT(*)::int AS open_commitments, MIN(due_date) AS next_due
       FROM commitments WHERE owner = 'me' AND status IN ('open','snoozed')
       GROUP BY customer_id
     ) cm ON cm.customer_id = c.id
     WHERE c.workspace_id = ?
     ORDER BY COALESCE(agg.score, 0) DESC`,
    ws,
  );

  return rows.map((r) => ({ ...toCustomer(r), ...r } as unknown as CustomerListItem));
}

export async function getCustomer(id: number): Promise<Customer | null> {
  const row = await db.get("SELECT * FROM customers WHERE id = ? AND workspace_id = ?", id, await currentWorkspaceId());
  return row ? toCustomer(row) : null;
}

/**
 * Case- and whitespace-insensitive, because this is what decides whether
 * logging a meeting reuses an account or creates a new one. An exact match
 * meant typing "abc technologies" for an existing "ABC Technologies" silently
 * created a second account, splitting that customer's history in two.
 */
export async function getCustomerByName(name: string): Promise<Customer | null> {
  const row = await db.get(
    `SELECT * FROM customers
     WHERE workspace_id = ? AND (lower(btrim(name)) = ? OR lower(btrim(company)) = ?)
     ORDER BY id LIMIT 1`,
    await currentWorkspaceId(),
    name.trim().toLowerCase(),
    name.trim().toLowerCase(),
  );
  return row ? toCustomer(row) : null;
}

export async function listContacts(customerId: number): Promise<Contact[]> {
  const rows = await db.all(
    `SELECT ct.* FROM contacts ct JOIN customers c ON c.id = ct.customer_id
     WHERE ct.customer_id = ? AND c.workspace_id = ?
     ORDER BY ct.is_decision_maker DESC, ct.name`,
    customerId,
    await currentWorkspaceId(),
  );
  return rows.map(toContact);
}

export async function listOpportunitiesFor(customerId: number): Promise<Opportunity[]> {
  const rows = await db.all(
    `SELECT o.* FROM opportunities o JOIN customers c ON c.id = o.customer_id
     WHERE o.customer_id = ? AND c.workspace_id = ? ORDER BY o.value DESC`,
    customerId,
    await currentWorkspaceId(),
  );
  return rows.map(toOpportunity);
}

export async function listInteractions(customerId: number, limit = 100): Promise<Interaction[]> {
  const rows = await db.all(
    `SELECT i.* FROM interactions i JOIN customers c ON c.id = i.customer_id
     WHERE i.customer_id = ? AND c.workspace_id = ?
     ORDER BY i.occurred_at DESC, i.id DESC LIMIT ?`,
    customerId,
    await currentWorkspaceId(),
    limit,
  );
  return rows.map(toInteraction);
}

export async function listSignals(customerId: number): Promise<Signal[]> {
  const rows = await db.all(
    `SELECT s.* FROM signals s JOIN customers c ON c.id = s.customer_id
     WHERE s.customer_id = ? AND c.workspace_id = ? ORDER BY s.created_at DESC`,
    customerId,
    await currentWorkspaceId(),
  );
  return rows.map(toSignal);
}

export async function createCustomer(input: {
  name: string;
  company: string;
  workspaceId?: number;
}): Promise<number> {
  const ws = input.workspaceId ?? (await currentWorkspaceId());
  return db.insert(
    "INSERT INTO customers (workspace_id, name, company) VALUES (?, ?, ?) RETURNING id",
    ws,
    input.name,
    input.company,
  );
}

export async function updateCustomerFacts(
  customerId: number,
  facts: Record<string, string>,
  aiSummary?: string,
) {
  // getCustomer is workspace-scoped, so a foreign id yields null and the
  // update below is a no-op rather than a cross-tenant write.
  const existing = await getCustomer(customerId);
  if (!existing) return;
  const merged = { ...(existing.facts ?? {}), ...facts };
  await db.run(
    `UPDATE customers SET facts = ?, ai_summary = COALESCE(?, ai_summary), updated_at = now()
     WHERE id = ? AND workspace_id = ?`,
    JSON.stringify(merged),
    aiSummary ?? null,
    customerId,
    await currentWorkspaceId(),
  );
}
