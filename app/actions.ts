"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import * as C from "@/lib/repo/commitments";
import * as O from "@/lib/repo/opportunities";
import * as I from "@/lib/repo/interactions";
import { createCustomer, getCustomer, getCustomerByName, listContacts, listSignals, updateCustomerFacts } from "@/lib/repo/customers";
import { currentUser, requireUser } from "@/lib/repo/workspace";
import { assertAdmin } from "@/lib/repo/admin";
import { checkRateLimit } from "@/lib/ratelimit";
import { clearUserApiKey, getDecryptedApiKeyForServerUse, getKeyInfo, setUserApiKey } from "@/lib/repo/credentials";
import type { AiProvider, StoredKeyInfo } from "@/lib/repo/credentials";
import { addDays, today } from "@/lib/dates";
import { generateMessage, extractMeeting, refineMessage } from "@/lib/ai";
import type { MessageChannel, MeetingExtraction } from "@/lib/ai";
import type { CommitmentKind, Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";
import { ask as runAsk } from "@/lib/ask";
import type { AskResult } from "@/lib/ask-shared";
import { reseedWorkspace } from "@/lib/seed/seed";

/** Every mutation refreshes the shell too, since nav counts live there. */
function refresh(...paths: string[]) {
  revalidatePath("/", "layout");
  for (const p of paths) revalidatePath(p);
}

/**
 * Server Actions are POST endpoints, reachable by anyone who can send the
 * request — they do NOT render through app/(app)/layout.tsx, so its redirect
 * protects pages only. Every action below therefore calls requireUser() (or
 * assertAdmin) before touching the database, and takes only an id plus the
 * change from the caller: ownership is re-read server-side from the session's
 * workspace, never trusted from the payload.
 */

/** Rejects a client-supplied date that is not a real YYYY-MM-DD day. */
function assertDay(value: string, field = "date"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00`))) {
    throw new Error(`Invalid ${field}.`);
  }
  return value;
}

const CHANNELS = new Set<MessageChannel>(["email", "whatsapp", "linkedin", "call_script"]);

/* ---------- Commitments / follow-ups ---------- */

export async function completeCommitmentAction(id: number) {
  await requireUser();
  await C.completeCommitment(id);
  refresh();
}

export async function reopenCommitmentAction(id: number) {
  await requireUser();
  await C.reopenCommitment(id);
  refresh();
}

/**
 * Returns the due date the commitment had before snoozing, so the caller's
 * "Undo" can put it back. Without this the toast's Undo only re-showed the
 * card locally and left the row snoozed — an undo that undid nothing.
 */
export async function snoozeCommitmentAction(id: number, days: number): Promise<{ previousDueDate: string | null }> {
  await requireUser();
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid snooze length.");
  const before = await C.getCommitment(id);
  await C.snoozeCommitment(id, days);
  refresh();
  return { previousDueDate: before?.due_date ?? null };
}

export async function rescheduleCommitmentAction(id: number, date: string) {
  await requireUser();
  assertDay(date, "due date");
  await C.rescheduleCommitment(id, date);
  refresh();
}

export async function deleteCommitmentAction(id: number) {
  await requireUser();
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
  await requireUser();
  assertDay(input.dueDate, "due date");
  if (!input.title.trim()) throw new Error("A commitment needs a title.");
  await C.createCommitment({
    ...input,
    title: input.title.trim(),
    opportunityId: await O.primaryOpportunityFor(input.customerId),
    source: "manual",
  });
  refresh();
}

/* ---------- Pipeline ---------- */

export async function moveStageAction(id: number, stage: Stage) {
  await requireUser();
  if (!STAGES.includes(stage)) throw new Error("Unknown stage.");
  await O.moveStage(id, stage);
  refresh();
}

/* ---------- Signals ---------- */

export async function resolveSignalAction(id: number) {
  const user = await requireUser();
  // Workspace-scoped: a guessed id from another tenant resolves to nothing
  // rather than revealing which opportunity it belongs to.
  const row = await db.get<{ opportunity_id: number | null }>(
    `SELECT s.opportunity_id FROM signals s JOIN customers c ON c.id = s.customer_id
     WHERE s.id = ? AND c.workspace_id = ?`,
    id,
    user.workspaceId,
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
  const user = await requireUser();
  checkRateLimit("draft", user.id);
  if (!CHANNELS.has(channel)) throw new Error("Unknown channel.");
  const ctx = await buildContext(customerId, commitmentId);
  const body = await generateMessage(channel, ctx.ai, await getDecryptedApiKeyForServerUse(user.id));
  return { body, context: { ...ctx.display, customerId: ctx.customerId } };
}

export async function refineDraftAction(previous: string, instruction: string): Promise<string> {
  const user = await requireUser();
  checkRateLimit("refine", user.id);
  if (!previous.trim()) throw new Error("There is no draft to revise.");
  return refineMessage(previous, instruction, await getDecryptedApiKeyForServerUse(user.id));
}

/**
 * Logs the message as a real outbound interaction and closes the loop.
 *
 * This action used to INSERT before doing any auth or ownership work, which
 * made it an unauthenticated write endpoint: a POST with no session could
 * attach arbitrary text to any tenant's customer. Both checks now come first.
 */
export async function markSentAction(input: {
  customerId: number;
  commitmentId: number | null;
  channel: string;
  body: string;
}) {
  await requireUser();

  if (!CHANNELS.has(input.channel as MessageChannel)) throw new Error("Unknown channel.");
  if (!input.body.trim()) throw new Error("There is nothing to send.");
  // Workspace-scoped read: a foreign customer id fails here rather than
  // becoming a cross-tenant row.
  const customer = await getCustomer(input.customerId);
  if (!customer) throw new Error("Customer not found");
  // Only a commitment in this workspace may be attached and completed.
  const commitment = input.commitmentId ? await C.getCommitment(input.commitmentId) : null;
  if (input.commitmentId && !commitment) throw new Error("Follow-up not found");

  const channel = input.channel as MessageChannel;
  const subjectLine = input.body.match(/^Subject:\s*(.+)$/m)?.[1];

  await db.run(
    `INSERT INTO generated_messages (commitment_id, customer_id, channel, body, sent_at)
     VALUES (?, ?, ?, ?, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))`,
    commitment?.id ?? null,
    customer.id,
    channel,
    input.body,
  );

  await I.createInteraction({
    customerId: customer.id,
    opportunityId: await O.primaryOpportunityFor(customer.id),
    type: channel === "call_script" ? "call" : channel,
    direction: "outbound",
    occurredAt: today(),
    subject: subjectLine ?? `Follow-up sent via ${channel}`,
    body: input.body,
  });

  if (commitment) await C.completeCommitment(commitment.id);
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
  const actor = await requireUser();
  checkRateLimit("extract", actor.id);

  const name = input.customerName.trim();
  if (!name) throw new Error("Which customer was this with?");
  if (!input.transcript.trim() && !input.notes.trim()) {
    throw new Error("Paste a transcript or some notes — there is nothing to read otherwise.");
  }
  assertDay(input.date, "meeting date");
  if (input.type !== "meeting" && input.type !== "call") throw new Error("Unknown meeting type.");

  let customer = await getCustomerByName(name);
  if (!customer) {
    const id = await createCustomer({ name, company: input.company?.trim() || name });
    customer = (await getCustomer(id))!;
  }

  const extraction = await extractMeeting(
    input.transcript,
    input.notes,
    customer.facts,
    await getDecryptedApiKeyForServerUse(actor.id),
  );
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
  await requireUser();
  assertDay(input.meetingDate, "meeting date");
  // Workspace-scoped, so a foreign interaction id cannot be stitched onto
  // commitments in this workspace.
  const meeting = await I.getInteraction(input.interactionId);
  if (!meeting || meeting.customer_id !== input.customerId) throw new Error("Meeting not found");

  const opportunityId = await O.primaryOpportunityFor(input.customerId);
  const contacts = await listContacts(input.customerId);
  const contactId = contacts.find((c) => c.is_decision_maker)?.id ?? contacts[0]?.id ?? null;

  for (const c of input.commitments) {
    if (!c.title.trim()) continue;
    if (!Number.isInteger(c.dueInDays)) throw new Error("Invalid due date on an extracted action.");
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
  const user = await requireUser();
  checkRateLimit("ask", user.id);
  if (question.length > 2000) throw new Error("That question is too long.");
  return runAsk(question);
}

/* ---------- AI credentials ---------- */

/**
 * Stores the user's own provider key, encrypted. The plaintext arrives here,
 * is encrypted, and is never returned — the caller gets back only the masked
 * hint, so a key cannot leak through an action's return value.
 */
export async function saveApiKeyAction(provider: AiProvider, plaintext: string): Promise<StoredKeyInfo> {
  const user = await requireUser();
  if (provider !== "gemini") throw new Error("Unsupported provider.");
  const trimmed = plaintext.trim();
  if (!trimmed) throw new Error("Enter a key before saving.");
  // Cheap shape check so an obviously wrong paste fails here rather than on
  // the first model call, when the rep is mid-task.
  if (provider === "gemini" && !trimmed.startsWith("AIza")) {
    throw new Error("That does not look like a Gemini API key — they start with 'AIza'.");
  }
  await setUserApiKey(user.id, provider, trimmed);
  refresh("/settings");
  return getKeyInfo(user.id);
}

export async function removeApiKeyAction(): Promise<StoredKeyInfo> {
  const user = await requireUser();
  await clearUserApiKey(user.id);
  refresh("/settings");
  return getKeyInfo(user.id);
}

/* ---------- Demo data ---------- */

/**
 * Rebuilds the demo dataset in the caller's own workspace.
 *
 * This previously called seed(), which TRUNCATEs every table — so one signed-in
 * user pressing "Reset demo data" destroyed every other tenant's pipeline and
 * every user row, stored API keys included. Worse, the action did no auth at
 * all, so an unauthenticated POST could do it. It is now gated on an admin
 * session and scoped to one workspace, which is what the Settings copy has
 * always promised ("This workspace holds…").
 */
export async function reseedAction() {
  const user = await assertAdmin();
  checkRateLimit("reseed", user.id);
  await reseedWorkspace(user.workspaceId, user.id);
  refresh();
}
