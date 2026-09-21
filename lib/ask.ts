import "server-only";
import db from "@/lib/db";
import type { AskResult, AskResultItem } from "@/lib/ask-shared";
import type { CommitmentView } from "@/lib/types";
import { answerQuestion } from "@/lib/ai";
import { listCommitments, priorityFeed } from "@/lib/repo/commitments";
import { computeInsights } from "@/lib/repo/insights";
import { getCustomer, getCustomerByName, listInteractions, listSignals } from "@/lib/repo/customers";
import { moneyShort } from "@/lib/format";
import { relativeDue, relativePast, today } from "@/lib/dates";
import { currentUser, currentWorkspaceId } from "@/lib/repo/workspace";
import { getDecryptedApiKeyForServerUse } from "@/lib/repo/credentials";

/** The asking user's own key, when they have supplied one. */
async function currentUserApiKey(): Promise<string | null> {
  const user = await currentUser();
  return getDecryptedApiKeyForServerUse(user.id);
}

/**
 * Natural-language ask. The point is that answers are *actionable*, not chat:
 * an intent router matches the question to a structural handler that returns
 * real entities the UI renders as cards with buttons. Only genuinely open
 * questions fall through to the model.
 */

type Handler = (q: string) => Promise<AskResult | null>;

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

function commitmentItems(rows: CommitmentView[]): AskResultItem[] {
  return rows.map((c) => ({
    title: c.title,
    subtitle: `${c.company}${c.opportunity_value ? ` · ${moneyShort(c.opportunity_value)}` : ""}`,
    detail: c.ai_recommendation ?? undefined,
    href: `/customers/${c.customer_id}`,
    customerId: c.customer_id,
    commitmentId: c.id,
    badge: relativeDue(c.due_date),
    tone: c.due_date < today() ? "risk" : "neutral",
  }));
}

const HANDLERS: Handler[] = [
  // "Who should I follow up with today?"
  async (q) => {
    if (!has(q, "follow up", "followup", "who should i", "what should i do", "priorit", "today")) return null;
    const rows = await listCommitments({ owner: "me", tab: "today" });
    return {
      intent: "today",
      answer: rows.length
        ? `${rows.length} follow-up${rows.length === 1 ? "" : "s"} need you today. Highest priority first.`
        : "Nothing is due today. You're clear.",
      items: commitmentItems(rows).slice(0, 8),
    };
  },

  // "Which deals are going cold / at risk?"
  async (q) => {
    if (!has(q, "cold", "at risk", "risk", "stall", "quiet", "silent")) return null;
    const ins = await computeInsights();
    const rows = [...ins.at_risk, ...ins.going_cold];
    return {
      intent: "risk",
      answer: rows.length
        ? `${rows.length} opportunit${rows.length === 1 ? "y is" : "ies are"} at risk or going cold.`
        : "No deals are showing risk signals right now.",
      items: rows.slice(0, 8).map((i) => ({
        title: i.title,
        subtitle: i.why.join(" · "),
        detail: i.recommendation,
        href: `/customers/${i.customer_id}`,
        customerId: i.customer_id,
        badge: i.severity === "risk" ? "At risk" : "Going cold",
        tone: i.severity === "risk" ? "risk" : "attention",
      })),
    };
  },

  // "What did I promise Sarah?" / "What do I owe Acme?"
  async (q) => {
    if (!has(q, "promise", "owe", "commit")) return null;
    const customer = await findCustomer(q);
    const rows = await listCommitments({ owner: "me", customerId: customer?.id, tab: "open" });
    return {
      intent: "commitments",
      answer: rows.length
        ? `You owe ${customer ? customer.company : "customers"} ${rows.length} thing${rows.length === 1 ? "" : "s"}.`
        : `Nothing outstanding${customer ? ` for ${customer.company}` : ""}.`,
      items: commitmentItems(rows).slice(0, 8),
    };
  },

  // "Which customers are waiting on me?"
  async (q) => {
    if (!has(q, "waiting", "unanswered", "no reply", "haven't replied")) return null;
    const ins = await computeInsights();
    const rows = [...ins.waiting_on_us, ...ins.unanswered_question];
    return {
      intent: "waiting",
      answer: rows.length
        ? `${rows.length} customer${rows.length === 1 ? " is" : "s are"} waiting on something from you.`
        : "Nobody is waiting on you.",
      items: rows.slice(0, 8).map((i) => ({
        title: i.title,
        subtitle: `${i.company} · ${i.why[0] ?? ""}`,
        detail: i.recommendation,
        href: `/customers/${i.customer_id}`,
        customerId: i.customer_id,
        badge: "Waiting",
        tone: "attention",
      })),
    };
  },

  // "Show me opportunities above $10K with no activity for 7 days"
  async (q) => {
    const valueMatch = q.match(/(?:above|over|more than|>)\s*\$?\s*([\d,.]+)\s*(k|m)?/i);
    const daysMatch = q.match(/(\d+)\s*days?/i);
    if (!valueMatch && !daysMatch) return null;
    if (!has(q, "opportunit", "deal", "show me", "pipeline")) return null;

    let min = 0;
    if (valueMatch) {
      min = parseFloat(valueMatch[1].replace(/,/g, ""));
      if (/k/i.test(valueMatch[2] ?? "")) min *= 1_000;
      if (/m/i.test(valueMatch[2] ?? "")) min *= 1_000_000;
    }
    const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;

    const rows = await db.all(
      `SELECT o.id, o.value, o.stage, o.last_interaction_at, c.id AS cid, c.company
       FROM opportunities o JOIN customers c ON c.id = o.customer_id
       WHERE c.workspace_id = ? AND o.stage NOT IN ('won','lost') AND o.value >= ?
         AND (?::int = 0 OR o.last_interaction_at IS NULL
              OR (CURRENT_DATE - LEFT(o.last_interaction_at, 10)::date) >= ?::int)
       ORDER BY o.value DESC`,
      await currentWorkspaceId(),
      min,
      days,
      days,
    );

    return {
      intent: "filter",
      answer: `${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}${
        min ? ` above ${moneyShort(min)}` : ""
      }${days ? ` with no activity for ${days}+ days` : ""}.`,
      items: rows.map((r) => ({
        title: r.company as string,
        subtitle: `${moneyShort(r.value as number)} · ${r.stage} · last touch ${relativePast(r.last_interaction_at as string | null)}`,
        href: `/customers/${r.cid}`,
        tone: "neutral" as const,
      })),
    };
  },

  // "Prepare me for my meeting with Acme tomorrow"
  async (q) => {
    if (!has(q, "prepare", "brief", "prep me", "getting ready")) return null;
    const customer = await findCustomer(q);
    if (!customer) return null;
    const [allSignals, owed, theirs, recent] = await Promise.all([
      listSignals(customer.id),
      listCommitments({ owner: "me", customerId: customer.id, tab: "open" }),
      listCommitments({ owner: "customer", customerId: customer.id, tab: "open" }),
      listInteractions(customer.id, 1),
    ]);
    const signals = allSignals.filter((s) => !s.resolved_at);
    const last = recent[0];

    const lines = [
      customer.ai_summary,
      last ? `Last touch: ${last.subject} (${relativePast(last.occurred_at)}).` : null,
      owed.length ? `You owe them: ${owed.map((c) => c.title).join(", ")}.` : null,
      theirs.length ? `They owe you: ${theirs.map((c) => c.title).join(", ")}.` : null,
    ].filter(Boolean);

    return {
      intent: "brief",
      answer: lines.join(" "),
      items: signals.slice(0, 6).map((s) => ({
        title: s.label,
        subtitle: `${s.kind} signal`,
        detail: s.detail ?? undefined,
        href: `/customers/${customer.id}`,
        badge: s.kind,
        tone: s.kind === "risk" || s.kind === "objection" ? "risk" : s.kind === "buying" ? "positive" : "neutral",
      })),
    };
  },

  // "Draft a follow-up for John"
  async (q) => {
    if (!has(q, "draft", "write a", "compose")) return null;
    const customer = await findCustomer(q);
    const rows = await listCommitments({ owner: "me", customerId: customer?.id, tab: "open" });
    return {
      intent: "draft",
      answer: customer
        ? `Pick what to draft for ${customer.company} — generating from their live context.`
        : "Which follow-up should I draft? Here's what's open.",
      items: commitmentItems(rows).slice(0, 6),
    };
  },
];

/** Regex metacharacters in a name would otherwise change the pattern's meaning
    — or throw outright, taking the whole Ask down. Names reach us from AI
    extraction and free-text entry, so they are not safe to interpolate raw. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match a customer, contact, or company named anywhere in the question. */
async function findCustomer(q: string) {
  const ws = await currentWorkspaceId();
  const rows = await db.all<{ id: number; name: string; company: string }>(
    "SELECT id, name, company FROM customers WHERE workspace_id = ?",
    ws,
  );
  const direct = rows.find((r) => q.includes(r.name.toLowerCase()) || q.includes(r.company.toLowerCase()));
  if (direct) return getCustomerByName(direct.name);

  // Fall back to a contact's first name ("what did John say about pricing?").
  const contact = await db.all<{ customer_id: number; name: string }>(
    `SELECT ct.customer_id, ct.name FROM contacts ct JOIN customers c ON c.id = ct.customer_id
     WHERE c.workspace_id = ?`,
    ws,
  );
  const byContact = contact.find((c) => {
    const first = c.name.split(" ")[0].toLowerCase();
    return first.length > 2 && new RegExp(`\\b${escapeRegExp(first)}\\b`).test(q);
  });
  if (!byContact) return null;
  // getCustomer already decodes `facts`, so the hand-rolled parse is gone.
  return getCustomer(byContact.customer_id);
}

export async function ask(question: string): Promise<AskResult> {
  const q = question.toLowerCase().trim();
  if (!q) return { answer: "Ask me anything about your pipeline.", intent: "none", items: [] };

  for (const handler of HANDLERS) {
    const result = await handler(q);
    if (result) return result;
  }

  // Freeform fallback: "What did John from Acme say about pricing?"
  const customer = await findCustomer(q);
  if (customer) {
    const interactions = await listInteractions(customer.id, 8);
    const signals = await listSignals(customer.id);
    const context = [
      `Customer: ${customer.company}`,
      `Summary: ${customer.ai_summary ?? "none"}`,
      `Facts: ${JSON.stringify(customer.facts)}`,
      `Signals: ${signals.map((s) => `${s.kind}: ${s.label}`).join(" | ")}`,
      `History:`,
      ...interactions.map((i) => `- ${i.occurred_at} ${i.type}: ${i.subject}. ${i.ai_summary ?? i.body ?? ""}`),
    ].join("\n");

    return {
      intent: "freeform",
      freeform: true,
      answer: await answerQuestion(question, context, await currentUserApiKey()),
      items: [{ title: `Open ${customer.company}`, subtitle: "Full account history", href: `/customers/${customer.id}` }],
    };
  }

  // No customer identified — answer from the top of the priority feed.
  const feed = (await priorityFeed(5)).map((f) => f.lead);
  return {
    intent: "fallback",
    answer:
      "I couldn't match that to a specific customer. Here's what's at the top of your list — or try naming a company.",
    items: commitmentItems(feed),
  };
}

export type { AskResult, AskResultItem } from "@/lib/ask-shared";
