"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import * as C from "@/lib/repo/commitments";
import * as O from "@/lib/repo/opportunities";
import * as I from "@/lib/repo/interactions";
import { createCustomer, getCustomer, getCustomerByName, listContacts, listSignals, updateCustomerFacts } from "@/lib/repo/customers";
import { currentUser } from "@/lib/repo/workspace";
import { addDays, today } from "@/lib/dates";
import { generateMessage, extractMeeting, refineMessage } from "@/lib/ai";
import type { MessageChannel, MeetingExtraction } from "@/lib/ai";
import type { CommitmentKind, Stage } from "@/lib/types";
import { ask as runAsk } from "@/lib/ask";
import type { AskResult } from "@/lib/ask-shared";
import { seed } from "@/lib/seed/seed";

/** Every mutation refreshes the shell too, since nav counts live there. */
function refresh(...paths: string[]) {
  revalidatePath("/", "layout");
  for (const p of paths) revalidatePath(p);
}

/* ---------- Commitments / follow-ups ---------- */

export async function completeCommitmentAction(id: number) {
  await C.completeCommitment(id);
  refresh();
}

export async function reopenCommitmentAction(id: number) {
  await C.reopenCommitment(id);
  refresh();
}

export async function snoozeCommitmentAction(id: number, days: number) {
  await C.snoozeCommitment(id, days);
  refresh();
}

export async function rescheduleCommitmentAction(id: number, date: string) {
  await C.rescheduleCommitment(id, date);
  refresh();
}

export async function deleteCommitmentAction(id: number) {
  await C.deleteCommitment(id);
  refresh();
}

export async function createCommitmentAction(input: {
  customerId: number;
  owner: "me" | "customer";
  kind: CommitmentKind;
  title: string;
  detail?: string;
  dueDate: string;
}) {
  await C.createCommitment({
    ...input,
    opportunityId: await O.primaryOpportunityFor(input.customerId),
    source: "manual",
  });
  refresh();
}

/* ---------- Pipeline ---------- */

export async function moveStageAction(id: number, stage: Stage) {
  await O.moveStage(id, stage);
  refresh();
}

/* ---------- Signals ---------- */

export async function resolveSignalAction(id: number) {
  const row = await db.get<{ opportunity_id: number | null }>(
    "SELECT opportunity_id FROM signals WHERE id = ?",
    id,
  );
  await I.resolveSignal(id);
  if (row?.opportunity_id) await O.rescoreOpportunity(row.opportunity_id);
  refresh();
}

/* ---------- AI follow-up generator ---------- */

export interface DraftContext {
  customerName: string;
  contactName: string | null;
  commitmentTitle: string | null;
  lastMeeting: string | null;
  concerns: string[];
  openQuestions: string[];
  opportunity: string | null;
  nextAction: string | null;
  customerId: number;
}

export interface DraftResult {
  body: string;
  context: DraftContext;
}

/**
 * Assemble the exact context handed to the model, and return it alongside the
 * draft. Showing the rep what the AI was given is a trust feature: a draft you
 * cannot audit is a draft you cannot send.
 */
async function buildContext(customerIdInput: number | null, commitmentId: number | null) {
  const commitment = commitmentId ? await C.getCommitment(commitmentId) : null;
  // A caller that knows only the commitment (the Ask palette, a keyboard
  // shortcut on a feed card) shouldn't have to look the account up first.
  const customerId = customerIdInput || commitment?.customer_id || 0;
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error("Customer not found");

  const [contacts, allSignals, lastMeeting, user] = await Promise.all([
    listContacts(customerId),
    listSignals(customerId),
    db.get<{ ai_summary: string | null; subject: string }>(
      `SELECT ai_summary, subject FROM interactions
       WHERE customer_id = ? AND type IN ('meeting','call') ORDER BY occurred_at DESC LIMIT 1`,
      customerId,
    ),
    currentUser(),
  ]);

  const contact = commitment?.contact_name
    ? contacts.find((c) => c.name === commitment.contact_name) ?? contacts[0]
    : contacts.find((c) => c.is_decision_maker) ?? contacts[0];

  const signals = allSignals.filter((s) => !s.resolved_at);

  const opportunity = await (async () => {
    if (commitment?.opportunity_id) return O.getOpportunity(commitment.opportunity_id);
    const oid = await O.primaryOpportunityFor(customerId);
    return oid ? O.getOpportunity(oid) : null;
  })();

  const concerns = signals.filter((s) => s.kind === "objection" || s.kind === "risk").map((s) => s.label);
  const openQuestions = signals.filter((s) => s.kind === "question").map((s) => s.label);

  return {
    customerId,
    ai: {
      customerName: customer.company,
      contactName: contact?.name ?? null,
      contactRole: contact?.role ?? null,
      repName: user.name,
      commitmentTitle: commitment?.title ?? null,
      lastMeetingSummary: lastMeeting?.ai_summary ?? lastMeeting?.subject ?? null,
      concerns,
      openQuestions,
      opportunityValue: opportunity?.value ?? null,
      stage: opportunity?.stage ?? null,
      nextAction: commitment?.title ?? null,
      facts: customer.facts,
    },
    display: {
      customerName: customer.company,
      contactName: contact?.name ?? null,
      commitmentTitle: commitment?.title ?? null,
      lastMeeting: lastMeeting ? `${lastMeeting.subject}` : null,
      concerns,
      openQuestions,
      opportunity: opportunity ? `${opportunity.name} · ${opportunity.stage}` : null,
      nextAction: commitment?.title ?? null,
      customerId,
    } satisfies DraftContext,
  };
}

export async function generateDraftAction(
  customerId: number | null,
  commitmentId: number | null,
  channel: MessageChannel,
): Promise<DraftResult> {
  const ctx = await buildContext(customerId, commitmentId);
  const body = await generateMessage(channel, ctx.ai);
  return { body, context: { ...ctx.display, customerId: ctx.customerId } };
}

export async function refineDraftAction(previous: string, instruction: string): Promise<string> {
  return refineMessage(previous, instruction);
}

/** Logs the message as a real outbound interaction and closes the loop. */
export async function markSentAction(input: {
  customerId: number;
  commitmentId: number | null;
  channel: string;
  body: string;
}) {
  await db.run(
    `INSERT INTO generated_messages (commitment_id, customer_id, channel, body, sent_at)
     VALUES (?, ?, ?, ?, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))`,
    input.commitmentId,
    input.customerId,
    input.channel,
    input.body,
  );

  const subjectLine = input.body.match(/^Subject:\s*(.+)$/m)?.[1];
  await I.createInteraction({
    customerId: input.customerId,
    opportunityId: await O.primaryOpportunityFor(input.customerId),
    type: input.channel === "call_script" ? "call" : (input.channel as "email" | "whatsapp" | "linkedin"),
    direction: "outbound",
    occurredAt: today(),
    subject: subjectLine ?? `Follow-up sent via ${input.channel}`,
    body: input.body,
  });

  if (input.commitmentId) await C.completeCommitment(input.commitmentId);
  refresh();
}

/* ---------- Meeting intelligence ---------- */

export interface MeetingResult {
  interactionId: number;
  customerId: number;
  extraction: MeetingExtraction;
}

export async function logMeetingAction(input: {
  customerName: string;
  company?: string;
  date: string;
  type: "meeting" | "call";
  participants?: string;
  notes: string;
  transcript: string;
}): Promise<MeetingResult> {
  let customer = await getCustomerByName(input.customerName);
  if (!customer) {
    const id = await createCustomer({ name: input.customerName, company: input.company || input.customerName });
    customer = (await getCustomer(id))!;
  }

  const extraction = await extractMeeting(input.transcript, input.notes, customer.facts);
  const opportunityId = await O.primaryOpportunityFor(customer.id);
  const contacts = await listContacts(customer.id);
  const contactId = contacts.find((c) => c.is_decision_maker)?.id ?? contacts[0]?.id ?? null;

  const interactionId = await I.createInteraction({
    customerId: customer.id,
    opportunityId,
    contactId,
    type: input.type,
    direction: "outbound",
    occurredAt: input.date,
    subject: input.participants ? `${titleFor(input.type)} with ${input.participants}` : titleFor(input.type),
    body: input.notes || null,
    transcript: input.transcript || null,
    aiSummary: extraction.summary,
  });

  for (const s of extraction.signals) {
    await I.createSignal({
      customerId: customer.id,
      opportunityId,
      interactionId,
      kind: s.kind,
      label: s.label,
      detail: s.detail ?? null,
      strength: s.strength,
    });
  }

  await updateCustomerFacts(customer.id, extraction.updated_facts, extraction.summary);
  if (opportunityId) await O.rescoreOpportunity(opportunityId);
  refresh();

  return { interactionId, customerId: customer.id, extraction };
}

function titleFor(type: "meeting" | "call") {
  return type === "call" ? "Call" : "Meeting";
}

/**
 * The payoff step of the meeting flow: turn the extracted promises into real,
 * dated commitments. The rep confirms; nothing is written until they do.
 */
export async function createExtractedCommitmentsAction(input: {
  customerId: number;
  interactionId: number;
  meetingDate: string;
  commitments: { owner: "me" | "customer"; kind: CommitmentKind; title: string; detail?: string; dueInDays: number }[];
}) {
  const opportunityId = await O.primaryOpportunityFor(input.customerId);
  const contacts = await listContacts(input.customerId);
  const contactId = contacts.find((c) => c.is_decision_maker)?.id ?? contacts[0]?.id ?? null;

  for (const c of input.commitments) {
    await C.createCommitment({
      customerId: input.customerId,
      opportunityId,
      contactId,
      interactionId: input.interactionId,
      owner: c.owner,
      kind: c.kind,
      title: c.title,
      detail: c.detail ?? null,
      dueDate: addDays(input.meetingDate, c.dueInDays),
      source: "ai_extracted",
    });
  }
  if (opportunityId) await O.rescoreOpportunity(opportunityId);
  refresh();
}

/* ---------- Ask ---------- */

export async function askAction(question: string): Promise<AskResult> {
  return runAsk(question);
}

/* ---------- Demo data ---------- */

export async function reseedAction() {
  await seed();
  refresh();
}
