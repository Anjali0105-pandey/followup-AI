import db from "@/lib/db";
import { CUSTOMERS, USER, WORKSPACE } from "@/lib/seed/data";
import { addDays, today } from "@/lib/dates";
import { rescoreAll } from "@/lib/repo/opportunities";
import { SCHEMA_SQL } from "@/lib/schema";
import type { TxClient } from "@/lib/db";

export interface SeedCounts {
  customers: number;
  opportunities: number;
  commitments: number;
  interactions: number;
  signals: number;
}

/**
 * Inserts the demo dataset into one workspace. Shared by the CLI bootstrap and
 * by the in-app "Reset demo data" button, so the two can never drift into
 * producing different demos.
 */
async function insertDemoData(
  c_: TxClient,
  wsId: number,
  userId: number,
  t: string,
): Promise<Omit<SeedCounts, "customers">> {
  let opportunities = 0;
  let commitments = 0;
  let interactions = 0;
  let signals = 0;

  for (const c of CUSTOMERS) {
    const customerId = await c_.insert(
      `INSERT INTO customers (workspace_id, name, company, industry, website, segment, ai_summary, facts, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      wsId,
      c.name,
      c.company,
      c.industry,
      c.website,
      c.segment,
      c.aiSummary,
      JSON.stringify(c.facts),
      userId,
    );

    const contactIds: number[] = [];
    let decisionMakerId: number | null = null;
    for (const ct of c.contacts) {
      const id = await c_.insert(
        `INSERT INTO contacts (customer_id, name, role, email, phone, is_decision_maker, is_champion)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        customerId,
        ct.name,
        ct.role,
        ct.email,
        ct.phone ?? null,
        ct.decisionMaker ? 1 : 0,
        ct.champion ? 1 : 0,
      );
      contactIds.push(id);
      if (ct.decisionMaker && decisionMakerId === null) decisionMakerId = id;
    }
    const primaryContact = decisionMakerId ?? contactIds[0] ?? null;

    let opportunityId: number | null = null;
    if (c.opportunity) {
      const o = c.opportunity;
      opportunityId = await c_.insert(
        `INSERT INTO opportunities (customer_id, name, value, stage, probability, expected_close_date, primary_contact_id)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        customerId,
        o.name,
        o.value,
        o.stage,
        o.probability,
        addDays(t, o.closeInDays),
        primaryContact,
      );
      opportunities++;
    }

    for (const i of c.interactions) {
      const occurredAt = addDays(t, -i.daysAgo);
      const interactionId = await c_.insert(
        `INSERT INTO interactions
           (customer_id, opportunity_id, contact_id, type, direction, occurred_at, subject, body, transcript, ai_summary, ai_processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        customerId,
        opportunityId,
        primaryContact,
        i.type,
        i.direction ?? "outbound",
        occurredAt,
        i.subject,
        i.body ?? null,
        i.transcript ?? null,
        i.aiSummary ?? null,
        i.aiSummary ? occurredAt : null,
      );
      interactions++;

      for (const s of i.signals ?? []) {
        await c_.run(
          `INSERT INTO signals (customer_id, opportunity_id, interaction_id, kind, label, detail, strength, resolved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          customerId,
          opportunityId,
          interactionId,
          s.kind,
          s.label,
          s.detail ?? null,
          s.strength ?? 2,
          s.resolved ? occurredAt : null,
          occurredAt,
        );
        signals++;
      }
    }

    const lastMeeting = await c_.get<{ id: number }>(
      "SELECT id FROM interactions WHERE customer_id = ? AND type='meeting' ORDER BY occurred_at DESC LIMIT 1",
      customerId,
    );

    for (const cm of c.commitments) {
      await c_.run(
        `INSERT INTO commitments
           (customer_id, opportunity_id, contact_id, interaction_id, owner, kind, title, detail, due_date, status, completed_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        customerId,
        opportunityId,
        primaryContact,
        cm.source === "ai_extracted" ? lastMeeting?.id ?? null : null,
        cm.owner,
        cm.kind,
        cm.title,
        cm.detail ?? null,
        addDays(t, cm.dueInDays),
        cm.status ?? "open",
        cm.status === "done" ? addDays(t, cm.dueInDays) : null,
        cm.source ?? "manual",
      );
      commitments++;
    }
  }

  // A handful of already-completed items so the Completed tabs and the
  // "commitments kept" story aren't empty on first run.
  const someCustomers = await c_.all<{ id: number }>(
    "SELECT id FROM customers WHERE workspace_id = ? ORDER BY id LIMIT 6",
    wsId,
  );
  const doneTemplates = [
    { kind: "email", title: "Send recap email", ago: 2 },
    { kind: "send_pricing", title: "Send pricing sheet", ago: 4 },
    { kind: "call", title: "Intro call", ago: 6 },
    { kind: "send_document", title: "Send security overview", ago: 8 },
    { kind: "schedule_meeting", title: "Book demo", ago: 9 },
    { kind: "answer_question", title: "Answer integration question", ago: 11 },
  ];
  for (const [idx, cust] of someCustomers.entries()) {
    const tpl = doneTemplates[idx % doneTemplates.length];
    const day = addDays(t, -tpl.ago);
    await c_.run(
      `INSERT INTO commitments (customer_id, opportunity_id, owner, kind, title, due_date, status, completed_at, source)
       VALUES (?, (SELECT id FROM opportunities WHERE customer_id=? LIMIT 1), 'me', ?, ?, ?, 'done', ?, 'ai_extracted')`,
      cust.id,
      cust.id,
      tpl.kind,
      tpl.title,
      day,
      day,
    );
    commitments++;
  }

  return { opportunities, commitments, interactions, signals };
}

/**
 * Full-database bootstrap, for the `npm run seed` CLI only.
 *
 * This TRUNCATEs every table, users and workspaces included, so it destroys
 * every tenant. It must never be reachable from the application — the Settings
 * button calls reseedWorkspace() instead, which is scoped to one workspace.
 */
export async function seed(): Promise<SeedCounts> {
  const t = today();

  // Create the tables if this is a fresh database, then clear them. TRUNCATE
  // ... RESTART IDENTITY replaces the old sqlite_sequence reset: stable ids
  // keep demo links and bookmarks working across reseeds.
  await db.exec(SCHEMA_SQL);
  await db.exec(`
    TRUNCATE generated_messages, commitments, signals, interactions,
             opportunities, contacts, customers, users, workspaces
    RESTART IDENTITY CASCADE;
  `);

  let counts!: Omit<SeedCounts, "customers">;
  let seededWorkspaceId = 0;

  await db.tx(async (c_) => {
    const wsId = await c_.insert(
      "INSERT INTO workspaces (name, plan) VALUES (?, ?) RETURNING id",
      WORKSPACE.name,
      WORKSPACE.plan,
    );
    seededWorkspaceId = wsId;
    const userId = await c_.insert(
      "INSERT INTO users (workspace_id, name, email, role, initials) VALUES (?, ?, ?, ?, ?) RETURNING id",
      wsId,
      USER.name,
      USER.email,
      USER.role,
      USER.initials,
    );
    counts = await insertDemoData(c_, wsId, userId, t);
  });

  // Explicit workspace: the seed runs from the CLI, where there is no session
  // for rescoreAll() to infer a tenant from.
  await rescoreAll(seededWorkspaceId);

  return { customers: CUSTOMERS.length, ...counts };
}

/**
 * Rebuilds the demo dataset inside ONE workspace, leaving every other tenant —
 * and every user row, including stored API keys — untouched.
 *
 * Deleting the workspace's customers is enough to clear it: contacts,
 * opportunities, interactions, signals, commitments and generated_messages all
 * cascade from customers. The whole thing runs in one transaction, so a failure
 * halfway through cannot leave the workspace half-wiped.
 */
export async function reseedWorkspace(workspaceId: number, userId: number): Promise<SeedCounts> {
  const t = today();

  const counts = await db.tx(async (c_) => {
    await c_.run("DELETE FROM customers WHERE workspace_id = ?", workspaceId);
    return insertDemoData(c_, workspaceId, userId, t);
  });

  await rescoreAll(workspaceId);

  return { customers: CUSTOMERS.length, ...counts };
}
