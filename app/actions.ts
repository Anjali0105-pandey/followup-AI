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
  C.completeCommitment(id);
  refresh();
}

export async function reopenCommitmentAction(id: number) {
  C.reopenCommitment(id);
  refresh();
}

export async function snoozeCommitmentAction(id: number, days: number) {
  C.snoozeCommitment(id, days);
  refresh();
}

export async function rescheduleCommitmentAction(id: number, date: string) {
  C.rescheduleCommitment(id, date);
  refresh();
}

export async function deleteCommitmentAction(id: number) {
  C.deleteCommitment(id);
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
  C.createCommitment({
    ...input,
    opportunityId: O.primaryOpportunityFor(input.customerId),
    source: "manual",
  });
  refresh();
}

/* ---------- Pipeline ---------- */

export async function moveStageAction(id: number, stage: Stage) {
  O.moveStage(id, stage);
  refresh();
}

/* ---------- Signals ---------- */

export async function resolveSignalAction(id: number) {
  const row = db.prepare("SELECT opportunity_id FROM signals WHERE id = ?").get(id) as
    | { opportunity_id: number | null }
    | undefined;
  I.resolveSignal(id);
  if (row?.opportunity_id) O.rescoreOpportunity(row.opportunity_id);
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
function buildContext(customerIdInput: number | null, commitmentId: number | null) {
  const commitment = commitmentId ? C.getCommitment(commitmentId) : null;
  // A caller that knows only the commitment (the Ask palette, a keyboard
  // shortcut on a feed card) shouldn't have to look the account up first.
  const customerId = customerIdInput || commitment?.customer_id || 0;
  const customer = getCustomer(customerId);
  if (!customer) throw new Error("Customer not found");

  const contacts = listContacts(customerId);
  const contact = commitment?.contact_name
    ? contacts.find((c) => c.name === commitment.contact_name) ?? contacts[0]
    : contacts.find((c) => c.is_decision_maker) ?? contacts[0];

  const signals = listSignals(customerId).filter((s) => !s.resolved_at);
  const lastMeeting = db
    .prepare(
      `SELECT ai_summary, subject FROM interactions
       WHERE customer_id = ? AND type IN ('meeting','call') ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get(customerId) as { ai_summary: string | null; subject: string } | undefined;

  const opportunity = commitment?.opportunity_id
    ? O.getOpportunity(commitment.opportunity_id)
    : (() => {
        const oid = O.primaryOpportunityFor(customerId);
        return oid ? O.getOpportunity(oid) : null;
      })();

  const concerns = signals.filter((s) => s.kind === "objection" || s.kind === "risk").map((s) => s.label);
  const openQuestions = signals.filter((s) => s.kind === "question").map((s) => s.label);
  const user = currentUser();

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
  const ctx = buildContext(customerId, commitmentId);
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
  db.prepare(
    "INSERT INTO generated_messages (commitment_id, customer_id, channel, body, sent_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).run(input.commitmentId, input.customerId, input.channel, input.body);

  const subjectLine = input.body.match(/^Subject:\s*(.+)$/m)?.[1];
  I.createInteraction({
    customerId: input.customerId,
    opportunityId: O.primaryOpportunityFor(input.customerId),
    type: input.channel === "call_script" ? "call" : (input.channel as "email" | "whatsapp" | "linkedin"),
    direction: "outbound",
    occurredAt: today(),
    subject: subjectLine ?? `Follow-up sent via ${input.channel}`,
    body: input.body,
  });

  if (input.commitmentId) C.completeCommitment(input.commitmentId);
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
  let customer = getCustomerByName(input.customerName);
  if (!customer) {
    const id = createCustomer({ name: input.customerName, company: input.company || input.customerName });
    customer = getCustomer(id)!;
  }

  const extraction = await extractMeeting(input.transcript, input.notes, customer.facts);
  const opportunityId = O.primaryOpportunityFor(customer.id);
  const contacts = listContacts(customer.id);
  const contactId = contacts.find((c) => c.is_decision_maker)?.id ?? contacts[0]?.id ?? null;

  const interactionId = I.createInteraction({
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
    I.createSignal({
      customerId: customer.id,
      opportunityId,
      interactionId,
      kind: s.kind,
      label: s.label,
      detail: s.detail ?? null,
      strength: s.strength,
    });
  }

  updateCustomerFacts(customer.id, extraction.updated_facts, extraction.summary);
  if (opportunityId) O.rescoreOpportunity(opportunityId);
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
  const opportunityId = O.primaryOpportunityFor(input.customerId);
  const contacts = listContacts(input.customerId);
  const contactId = contacts.find((c) => c.is_decision_maker)?.id ?? contacts[0]?.id ?? null;

  for (const c of input.commitments) {
    C.createCommitment({
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
  if (opportunityId) O.rescoreOpportunity(opportunityId);
  refresh();
}

/* ---------- Ask ---------- */

export async function askAction(question: string): Promise<AskResult> {
  return runAsk(question);
}

/* ---------- Demo data ---------- */

export async function reseedAction() {
  seed();
  refresh();
}
