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

export async function listMeetings(): Promise<MeetingListItem[]> {
  const rows = await db.all(
    `SELECT i.*, c.name AS customer_name, c.company,
            (SELECT COUNT(*)::int FROM commitments cm WHERE cm.interaction_id = i.id) AS actions_created,
            (SELECT COUNT(*)::int FROM signals s WHERE s.interaction_id = i.id) AS signal_count
     FROM interactions i JOIN customers c ON c.id = i.customer_id
     WHERE i.type = 'meeting'
     ORDER BY i.occurred_at DESC`,
  );
  return rows.map((r) => ({ ...toInteraction(r), ...r } as unknown as MeetingListItem));
}

export async function getInteraction(id: number) {
  const row = await db.get(
    `SELECT i.*, c.name AS customer_name, c.company
     FROM interactions i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    id,
  );
  if (!row) return null;
  return { ...toInteraction(row), customer_name: row.customer_name as string, company: row.company as string };
}

export async function createInteraction(input: {
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
}): Promise<number> {
  const id = await db.insert(
    `INSERT INTO interactions
       (customer_id, opportunity_id, contact_id, type, direction, occurred_at, subject, body, transcript, ai_summary, ai_processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
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
  if (input.opportunityId) await rescoreOpportunity(input.opportunityId);
  return id;
}

export async function createSignal(input: {
  customerId: number;
  opportunityId?: number | null;
  interactionId?: number | null;
  kind: SignalKind;
  label: string;
  detail?: string | null;
  strength?: number;
}): Promise<number> {
  return db.insert(
    `INSERT INTO signals (customer_id, opportunity_id, interaction_id, kind, label, detail, strength)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    input.customerId,
    input.opportunityId ?? null,
    input.interactionId ?? null,
    input.kind,
    input.label,
    input.detail ?? null,
    input.strength ?? 2,
  );
}

export async function resolveSignal(id: number) {
  await db.run(
    `UPDATE signals SET resolved_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
    id,
  );
}

export async function signalsForInteraction(interactionId: number) {
  return db.all("SELECT * FROM signals WHERE interaction_id = ?", interactionId);
}
