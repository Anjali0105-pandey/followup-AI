import db from "@/lib/db";
import { toInteraction } from "@/lib/repo/rows";
import type { Interaction, InteractionType, SignalKind } from "@/lib/types";
import { rescoreOpportunity } from "@/lib/repo/opportunities";

export interface MeetingListItem extends Interaction {
  customer_name: string;
  company: string;
  actions_created: number;
  signal_count: number;
}

export function listMeetings(): MeetingListItem[] {
  return (
    db
      .prepare(
        `SELECT i.*, c.name AS customer_name, c.company,
                (SELECT COUNT(*) FROM commitments cm WHERE cm.interaction_id = i.id) AS actions_created,
                (SELECT COUNT(*) FROM signals s WHERE s.interaction_id = i.id) AS signal_count
         FROM interactions i JOIN customers c ON c.id = i.customer_id
         WHERE i.type = 'meeting'
         ORDER BY i.occurred_at DESC`,
      )
      .all() as Record<string, unknown>[]
  ).map((r) => ({ ...toInteraction(r), ...r } as unknown as MeetingListItem));
}

export function getInteraction(id: number) {
  const row = db
    .prepare(
      `SELECT i.*, c.name AS customer_name, c.company
       FROM interactions i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...toInteraction(row), customer_name: row.customer_name as string, company: row.company as string };
}

export function createInteraction(input: {
  customerId: number;
  opportunityId?: number | null;
  contactId?: number | null;
  type: InteractionType;
  direction?: "inbound" | "outbound";
  occurredAt: string;
  subject: string;
  body?: string | null;
  transcript?: string | null;
  aiSummary?: string | null;
}): number {
  const info = db
    .prepare(
      `INSERT INTO interactions
         (customer_id, opportunity_id, contact_id, type, direction, occurred_at, subject, body, transcript, ai_summary, ai_processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.customerId,
      input.opportunityId ?? null,
      input.contactId ?? null,
      input.type,
      input.direction ?? "outbound",
      input.occurredAt,
      input.subject,
      input.body ?? null,
      input.transcript ?? null,
      input.aiSummary ?? null,
      input.aiSummary ? new Date().toISOString() : null,
    );
  if (input.opportunityId) rescoreOpportunity(input.opportunityId);
  return Number(info.lastInsertRowid);
}

export function createSignal(input: {
  customerId: number;
  opportunityId?: number | null;
  interactionId?: number | null;
  kind: SignalKind;
  label: string;
  detail?: string | null;
  strength?: number;
}): number {
  const info = db
    .prepare(
      `INSERT INTO signals (customer_id, opportunity_id, interaction_id, kind, label, detail, strength)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.customerId,
      input.opportunityId ?? null,
      input.interactionId ?? null,
      input.kind,
      input.label,
      input.detail ?? null,
      input.strength ?? 2,
    );
  return Number(info.lastInsertRowid);
}

export function resolveSignal(id: number) {
  db.prepare("UPDATE signals SET resolved_at = datetime('now') WHERE id = ?").run(id);
}

export function signalsForInteraction(interactionId: number) {
  return db.prepare("SELECT * FROM signals WHERE interaction_id = ?").all(interactionId) as Record<string, unknown>[];
}
