import db from "@/lib/db";
import { CUSTOMERS, USER, WORKSPACE } from "@/lib/seed/data";
import { addDays, today } from "@/lib/dates";
import { rescoreAll } from "@/lib/repo/opportunities";

/** Wipe and reseed. Idempotent: running it twice gives the same database. */
export function seed(): { customers: number; opportunities: number; commitments: number; interactions: number; signals: number } {
  const t = today();

  db.exec(`
    DELETE FROM generated_messages;
    DELETE FROM commitments;
    DELETE FROM signals;
    DELETE FROM interactions;
    DELETE FROM opportunities;
    DELETE FROM contacts;
    DELETE FROM customers;
    DELETE FROM users;
    DELETE FROM workspaces;
    -- Reset AUTOINCREMENT so a reseed always yields the same ids; stable ids
    -- keep demo links and bookmarks working across reseeds.
    DELETE FROM sqlite_sequence;
  `);

  const wsId = Number(
    db.prepare("INSERT INTO workspaces (name, plan) VALUES (?, ?)").run(WORKSPACE.name, WORKSPACE.plan).lastInsertRowid,
  );
  const userId = Number(
    db
      .prepare("INSERT INTO users (workspace_id, name, email, role, initials) VALUES (?, ?, ?, ?, ?)")
      .run(wsId, USER.name, USER.email, USER.role, USER.initials).lastInsertRowid,
  );

  let opportunities = 0;
  let commitments = 0;
  let interactions = 0;
  let signals = 0;

  const insertAll = db.transaction(() => {
    for (const c of CUSTOMERS) {
      const customerId = Number(
        db
          .prepare(
            `INSERT INTO customers (workspace_id, name, company, industry, website, segment, ai_summary, facts, owner_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(wsId, c.name, c.company, c.industry, c.website, c.segment, c.aiSummary, JSON.stringify(c.facts), userId)
          .lastInsertRowid,
      );

      const contactIds: number[] = [];
      let decisionMakerId: number | null = null;
      for (const ct of c.contacts) {
        const id = Number(
          db
            .prepare(
              `INSERT INTO contacts (customer_id, name, role, email, phone, is_decision_maker, is_champion)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(customerId, ct.name, ct.role, ct.email, ct.phone ?? null, ct.decisionMaker ? 1 : 0, ct.champion ? 1 : 0)
            .lastInsertRowid,
        );
        contactIds.push(id);
        if (ct.decisionMaker && decisionMakerId === null) decisionMakerId = id;
      }
      const primaryContact = decisionMakerId ?? contactIds[0] ?? null;

      let opportunityId: number | null = null;
      if (c.opportunity) {
        const o = c.opportunity;
        opportunityId = Number(
          db
            .prepare(
              `INSERT INTO opportunities (customer_id, name, value, stage, probability, expected_close_date, primary_contact_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(customerId, o.name, o.value, o.stage, o.probability, addDays(t, o.closeInDays), primaryContact)
            .lastInsertRowid,
        );
        opportunities++;
      }

      for (const i of c.interactions) {
        const occurredAt = addDays(t, -i.daysAgo);
        const interactionId = Number(
          db
            .prepare(
              `INSERT INTO interactions
                 (customer_id, opportunity_id, contact_id, type, direction, occurred_at, subject, body, transcript, ai_summary, ai_processed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              customerId,
              opportunityId,
              primaryContact,
              i.type,
              i.direction ?? (i.type === "meeting" || i.type === "call" ? "outbound" : "outbound"),
              occurredAt,
              i.subject,
              i.body ?? null,
              i.transcript ?? null,
              i.aiSummary ?? null,
              i.aiSummary ? occurredAt : null,
            ).lastInsertRowid,
        );
        interactions++;

        for (const s of i.signals ?? []) {
          db.prepare(
            `INSERT INTO signals (customer_id, opportunity_id, interaction_id, kind, label, detail, strength, resolved_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
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

      const lastMeeting = db
        .prepare("SELECT id FROM interactions WHERE customer_id = ? AND type='meeting' ORDER BY occurred_at DESC LIMIT 1")
        .get(customerId) as { id: number } | undefined;

      for (const cm of c.commitments) {
        db.prepare(
          `INSERT INTO commitments
             (customer_id, opportunity_id, contact_id, interaction_id, owner, kind, title, detail, due_date, status, completed_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
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
  });

  insertAll();

  // A handful of already-completed items so the Completed tabs and the
  // "commitments kept" story aren't empty on first run.
  const someCustomers = db.prepare("SELECT id FROM customers LIMIT 6").all() as { id: number }[];
  const doneTemplates = [
    { kind: "email", title: "Send recap email", ago: 2 },
    { kind: "send_pricing", title: "Send pricing sheet", ago: 4 },
    { kind: "call", title: "Intro call", ago: 6 },
    { kind: "send_document", title: "Send security overview", ago: 8 },
    { kind: "schedule_meeting", title: "Book demo", ago: 9 },
    { kind: "answer_question", title: "Answer integration question", ago: 11 },
  ];
  someCustomers.forEach((c, idx) => {
    const tpl = doneTemplates[idx % doneTemplates.length];
    const day = addDays(t, -tpl.ago);
    db.prepare(
      `INSERT INTO commitments (customer_id, opportunity_id, owner, kind, title, due_date, status, completed_at, source)
       VALUES (?, (SELECT id FROM opportunities WHERE customer_id=? LIMIT 1), 'me', ?, ?, ?, 'done', ?, 'ai_extracted')`,
    ).run(c.id, c.id, tpl.kind, tpl.title, day, day);
    commitments++;
  });

  rescoreAll();

  return { customers: CUSTOMERS.length, opportunities, commitments, interactions, signals };
}
