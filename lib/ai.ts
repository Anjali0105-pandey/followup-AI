import { GoogleGenAI, Type } from "@google/genai";
import type { CommitmentKind, SignalKind } from "@/lib/types";

// No API key: run in mock mode so the whole product is demoable without
// billing. Unlike a stub that returns "[MOCK] add an API key", these mocks are
// derived from the actual input and are rich enough to drive every screen —
// a demo that shows placeholder text is not a demo. Set GEMINI_API_KEY and
// every function below switches to the real model with no code change.
const MOCK_MODE = !process.env.GEMINI_API_KEY;
const genAI = MOCK_MODE ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const AI_MODE: "live" | "mock" = MOCK_MODE ? "mock" : "live";

const MODEL = "gemini-2.5-flash";

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/* ============================================================
   MEETING EXTRACTION — the wedge feature.
   One transcript in, a fully structured account update out.
   ============================================================ */

export interface ExtractedCommitment {
  owner: "me" | "customer";
  kind: CommitmentKind;
  title: string;
  detail?: string;
  /** Days from the meeting date. 0 = same day. */
  due_in_days: number;
}

export interface ExtractedSignal {
  kind: SignalKind;
  label: string;
  detail?: string;
  strength: number;
}

export interface MeetingExtraction {
  summary: string;
  pain_points: string[];
  requirements: string[];
  objections: string[];
  questions: string[];
  buying_signals: string[];
  decision_makers: string[];
  budget: string | null;
  timeline: string | null;
  competitors: string[];
  next_steps: string[];
  commitments: ExtractedCommitment[];
  signals: ExtractedSignal[];
  updated_facts: Record<string, string>;
  follow_up_in_days: number | null;
}

const strList = (description: string) => ({
  type: Type.ARRAY,
  items: { type: Type.STRING },
  description,
});

const EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "3-4 sentence summary written for a sales rep skimming it a week later." },
    pain_points: strList("Concrete problems the customer described."),
    requirements: strList("Capabilities the customer said they need."),
    objections: strList("Concerns or push-back raised."),
    questions: strList("Questions the customer asked that were NOT answered in this meeting."),
    buying_signals: strList("Statements indicating intent to move forward."),
    decision_makers: strList("People named as decision makers or approvers."),
    budget: { type: Type.STRING, nullable: true, description: "Budget stated or implied, or null." },
    timeline: { type: Type.STRING, nullable: true, description: "Timeline or deadline stated, or null." },
    competitors: strList("Competitors mentioned."),
    next_steps: strList("Agreed next steps."),
    commitments: {
      type: Type.ARRAY,
      description: "Every promise made by either side. This is the most important field — do not miss one.",
      items: {
        type: Type.OBJECT,
        properties: {
          owner: { type: Type.STRING, enum: ["me", "customer"], description: "'me' = the sales rep promised it." },
          kind: {
            type: Type.STRING,
            enum: ["call", "email", "whatsapp", "send_proposal", "send_pricing", "answer_question", "schedule_meeting", "send_document", "wait", "escalate"],
          },
          title: { type: Type.STRING, description: "Imperative and specific, e.g. 'Send implementation plan'." },
          detail: { type: Type.STRING, description: "One line of context." },
          due_in_days: { type: Type.INTEGER, description: "Days after the meeting this is due. 0 = same day." },
        },
        required: ["owner", "kind", "title", "due_in_days"],
      },
    },
    signals: {
      type: Type.ARRAY,
      description: "Buying, risk, objection, question, competitor, budget and timeline signals worth tracking.",
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["buying", "risk", "objection", "question", "competitor", "budget", "timeline"] },
          label: { type: Type.STRING, description: "Short headline for the signal." },
          detail: { type: Type.STRING },
          strength: { type: Type.INTEGER, description: "1 weak, 2 moderate, 3 strong." },
        },
        required: ["kind", "label", "strength"],
      },
    },
    updated_facts_json: {
      type: Type.STRING,
      description:
        "JSON-encoded object of durable facts worth remembering across meetings. Keys to prefer: budget, timeline, decision_maker, pain_points, objections, competitors_mentioned, seats. Values are short strings. '{}' if nothing new.",
    },
    follow_up_in_days: { type: Type.INTEGER, nullable: true, description: "When to follow up, in days from the meeting." },
  },
  required: [
    "summary", "pain_points", "requirements", "objections", "questions", "buying_signals",
    "decision_makers", "budget", "timeline", "competitors", "next_steps", "commitments",
    "signals", "updated_facts_json", "follow_up_in_days",
  ],
};

/* ---------- Mock extraction ----------
   Rule-based but genuinely derived from the transcript, so the flow reads as
   real: it finds who promised what by looking for commitment verbs, and pulls
   unanswered questions out of the actual text. */

const PROMISE = /\b(i'?ll|we'?ll|i will|we will|let me|let'?s|i can|i'?ll get|happy to)\b/i;
const CUSTOMER_SPEAKER = /^(?!rahul|me|rep\b)([a-z][\w .'-]{1,28}):/i;

function classifyKind(line: string): CommitmentKind {
  const l = line.toLowerCase();
  if (/\b(proposal|contract|agreement|sow)\b/.test(l)) return "send_proposal";
  if (/\b(pricing|price|quote|cost)\b/.test(l)) return "send_pricing";
  if (/\b(schedule|book|set up|calendar|diary|meet)\b/.test(l)) return "schedule_meeting";
  if (/\b(bring|loop in|introduce|escalate)\b/.test(l)) return "escalate";
  if (/\b(call|ring|phone|dial)\b/.test(l)) return "call";
  if (/\b(plan|deck|doc|documentation|overview|comparison|case study|spec|report)\b/.test(l)) return "send_document";
  if (/\b(confirm|check|find out|look into|answer)\b/.test(l)) return "answer_question";
  if (/\b(send|share|forward|email|circulate|get you)\b/.test(l)) return "email";
  return "answer_question";
}

/** Split a speaker turn into sentences so a promise doesn't drag along the
    surrounding small talk ("Understood. I'll send the plan" -> the promise). */
function sentences(line: string): string[] {
  return line
    .replace(/^[^:]{1,30}:\s*/, "")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function titleCaseAction(text: string): string {
  const cleaned = text
    .replace(/^[^:]{1,30}:\s*/, "")
    .replace(/^(sure,?|ok(ay)?,?|understood,?|absolutely,?|of course,?)\s+/i, "")
    .replace(/^(i'?ll|i will|we'?ll|we will|let me|let'?s|i can|i'?d|happy to)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!,;]+$/, "");
  const short = cleaned.length > 72 ? `${cleaned.slice(0, 69)}\u2026` : cleaned;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function mockExtract(transcript: string, notes: string): MeetingExtraction {
  const text = `${transcript}\n${notes}`.trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const commitments: ExtractedCommitment[] = [];
  const signals: ExtractedSignal[] = [];
  const questions: string[] = [];
  const objections: string[] = [];
  const buying: string[] = [];
  const competitors: string[] = [];

  for (const line of lines) {
    const isCustomer = CUSTOMER_SPEAKER.test(line);

    for (const sentence of sentences(line)) {
      const l = sentence.toLowerCase();

      // A promise is a first-person future commitment, scoped to the sentence
      // that actually contains it.
      if (PROMISE.test(sentence)) {
        const kind = classifyKind(sentence);
        const title = titleCaseAction(sentence);
        if (title.length > 3) {
          commitments.push({
            owner: isCustomer ? "customer" : "me",
            kind,
            title,
            detail: sentence !== title ? sentence : undefined,
            due_in_days: kind === "call" || kind === "schedule_meeting" ? 2 : 1,
          });
        }
      }

      if (sentence.includes("?") && isCustomer) {
        questions.push(sentence);
        signals.push({
          kind: "question",
          label: sentence.length > 80 ? `${sentence.slice(0, 77)}\u2026` : sentence,
          strength: 2,
        });
      }

      if (/\b(worried|worry|concern|too (long|expensive)|problem is|hesitant|burned|risk)\b/.test(l)) {
        objections.push(sentence);
        signals.push({ kind: "objection", label: titleCaseAction(sentence), detail: sentence, strength: 3 });
      }

      if (
        /\b(contract|sign|go ahead|move forward|when can we start|purchase order|start monday)\b/.test(l) ||
        /\bbudget\b[^.]*\bapproved\b|\bapproved\b[^.]*\bbudget\b/.test(l)
      ) {
        buying.push(sentence);
        signals.push({ kind: "buying", label: titleCaseAction(sentence), detail: sentence, strength: 3 });
      }

      if (/\b(competitor|alternative|also (looking|evaluating)|another vendor|incumbent)\b/.test(l)) {
        competitors.push(titleCaseAction(sentence));
        signals.push({ kind: "competitor", label: titleCaseAction(sentence), strength: 2 });
      }
    }
  }

  const budget = text.match(/[$£€]\s?\d[\d,]*(\.\d+)?\s?(k|m|thousand|million|lakhs?)?/i)?.[0]?.trim() ?? null;
  const timeline =
    text.match(
      /\b(this|next)\s+(week|month|quarter|year)\b|\bby\s+(the\s+)?(end of\s+)?[a-z]+\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i,
    )?.[0]?.trim() ?? null;
  if (budget) signals.push({ kind: "budget", label: `Budget referenced: ${budget}`, strength: 2 });
  if (timeline) signals.push({ kind: "timeline", label: `Timeline referenced: ${timeline}`, strength: 2 });

  const facts: Record<string, string> = {};
  if (budget) facts.budget = budget;
  if (timeline) facts.timeline = timeline;
  if (competitors.length) facts.competitors_mentioned = competitors.join("; ");
  if (objections.length) facts.objections = objections.map(titleCaseAction).join("; ");

  const summaryBits = [
    `Covered ${lines.length} exchanges.`,
    commitments.length ? `${commitments.length} commitment${commitments.length === 1 ? "" : "s"} were made.` : "",
    questions.length ? `${questions.length} question${questions.length === 1 ? "" : "s"} went unanswered.` : "",
    objections.length ? `Main concern raised: ${titleCaseAction(objections[0])}.` : "",
    buying.length ? `Positive intent signal: ${titleCaseAction(buying[0])}.` : "",
  ].filter(Boolean);

  return {
    summary: summaryBits.join(" "),
    pain_points: objections.slice(0, 3).map(titleCaseAction),
    requirements: lines.filter((l) => /\bneed|require|must have\b/i.test(l)).slice(0, 3).map(titleCaseAction),
    objections: objections.map(titleCaseAction),
    questions,
    buying_signals: buying.map(titleCaseAction),
    decision_makers: [...new Set(lines.map((l) => l.match(CUSTOMER_SPEAKER)?.[1]).filter(Boolean) as string[])].slice(0, 3),
    budget,
    timeline,
    competitors,
    next_steps: commitments.map((c) => c.title),
    commitments,
    signals,
    updated_facts: facts,
    follow_up_in_days: commitments.length ? Math.min(...commitments.map((c) => c.due_in_days)) : 3,
  };
}

export async function extractMeeting(
  transcript: string,
  notes: string,
  existingFacts: Record<string, string>,
): Promise<MeetingExtraction> {
  if (MOCK_MODE || !genAI) return mockExtract(transcript, notes);

  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: `You are a sales analyst. Extract structured intelligence from this customer meeting.

Known facts about this customer so far: ${JSON.stringify(existingFacts)}

Rep's notes: ${notes || "(none)"}

Transcript:
${transcript || "(none — work from the notes)"}

Be precise. Never invent a commitment that was not actually promised.`,
    config: { responseMimeType: "application/json", responseSchema: EXTRACT_SCHEMA },
  });

  const parsed = safeJsonParse<Omit<MeetingExtraction, "updated_facts"> & { updated_facts_json: string }>(
    response.text ?? "{}",
    {
      summary: "", pain_points: [], requirements: [], objections: [], questions: [], buying_signals: [],
      decision_makers: [], budget: null, timeline: null, competitors: [], next_steps: [],
      commitments: [], signals: [], updated_facts_json: "{}", follow_up_in_days: 3,
    },
  );

  return {
    ...parsed,
    updated_facts: safeJsonParse<Record<string, string>>(parsed.updated_facts_json, {}),
  };
}

/* ============================================================
   FOLLOW-UP GENERATION
   ============================================================ */

export type MessageChannel = "email" | "whatsapp" | "linkedin" | "call_script";

export const CHANNEL_LABEL: Record<MessageChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  call_script: "Call script",
};

const CHANNEL_INSTRUCTIONS: Record<MessageChannel, string> = {
  email: "Write a follow-up email. Start with 'Subject: ...' on its own line. Professional but warm, three short paragraphs at most, one clear ask at the end.",
  whatsapp: "Write a short, casual WhatsApp message. 2-4 sentences, no subject line, friendly, one clear ask.",
  linkedin: "Write a short LinkedIn message. Professional networking tone, no subject line, under 90 words.",
  call_script: "Write a call script: a one-line opener, 2-3 talking points referencing specifics, the most likely objection with a response, and a closing ask.",
};

export interface MessageContext {
  customerName: string;
  contactName: string | null;
  contactRole: string | null;
  repName: string;
  commitmentTitle: string | null;
  lastMeetingSummary: string | null;
  concerns: string[];
  openQuestions: string[];
  opportunityValue: number | null;
  stage: string | null;
  nextAction: string | null;
  facts: Record<string, string>;
}

/** "Send implementation plan" -> "the implementation plan", so a commitment
    title written as an imperative reads correctly inside a sentence. */
function promiseNoun(title: string | null): string {
  if (!title) return "the next step we discussed";
  const stripped = title.replace(
    /^(send|share|forward|email|write|put together|prepare|draft|confirm|answer|schedule|book|call|return)\s+/i,
    "",
  );
  if (stripped === title) return title.charAt(0).toLowerCase() + title.slice(1);
  return /^(the|a|an|our|your|their)\b/i.test(stripped) ? stripped : `the ${stripped}`;
}

function mockMessage(channel: MessageChannel, ctx: MessageContext): string {
  const first = (ctx.contactName ?? ctx.customerName).split(" ")[0];
  const concern = ctx.concerns[0];
  const question = ctx.openQuestions[0];
  const noun = promiseNoun(ctx.commitmentTitle);
  const verb = /^(call|schedule|book)/i.test(ctx.commitmentTitle ?? "") ? "set up" : "put together";

  if (channel === "whatsapp") {
    return [
      `Hi ${first} — quick one.`,
      concern
        ? `I know ${concern.toLowerCase()} was the sticking point, so I've ${verb} ${noun}.`
        : `Following up with ${noun}.`,
      question ? `I also owe you an answer on "${question}" — covering that too.` : "",
      `Does Thursday afternoon work for 15 minutes to go through it?`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (channel === "linkedin") {
    return `Hi ${first} — good speaking recently about ${ctx.customerName}'s plans${
      ctx.stage ? ` (we're at the ${ctx.stage} stage)` : ""
    }. I've just finished ${noun} and would value 15 minutes to walk you through it. Would later this week suit?`;
  }

  if (channel === "call_script") {
    return [
      `OPENER`,
      `"Hi ${first}, it's ${ctx.repName} — is now still a good moment? I'll keep it to ten minutes."`,
      ``,
      `TALKING POINTS`,
      `1. Recap where you left off${ctx.lastMeetingSummary ? ` — context on file: ${ctx.lastMeetingSummary}` : ""}.`,
      `2. Walk through ${noun} on the call rather than emailing it cold.`,
      question ? `3. Answer their open question: "${question}".` : `3. Confirm nothing has changed on their side.`,
      ``,
      `LIKELY OBJECTION`,
      concern
        ? `"${concern}" -> Acknowledge it, give the specific number or plan, then ask what would make them comfortable.`
        : `"We're still discussing internally" -> Ask who else needs to see it and offer to join that conversation.`,
      ``,
      `CLOSE`,
      `"Can we put 30 minutes in the diary${
        ctx.stage === "negotiation" ? " to agree the final terms" : " to review it together"
      }?"`,
    ].join("\n");
  }

  return [
    `Subject: ${ctx.commitmentTitle ?? "Following up"}${ctx.customerName ? ` — ${ctx.customerName}` : ""}`,
    ``,
    `Hi ${first},`,
    ``,
    `Thanks again for the time earlier this week.`,
    ``,
    concern
      ? `You mentioned ${concern.toLowerCase()} was the main concern, so I've ${verb} ${noun} to address it directly.`
      : `As promised, I've ${verb} ${noun}.`,
    // Never fabricate the answer to an open question — flag that it is owed and
    // leave the rep a marked slot to fill.
    ...(question ? [``, `You also asked: "${question}". [Answer here before sending.]`] : []),
    ``,
    `Would Thursday afternoon work for a quick review?`,
    ``,
    `Best,`,
    ctx.repName,
  ].join("\n");
}

export async function generateMessage(channel: MessageChannel, ctx: MessageContext): Promise<string> {
  if (MOCK_MODE || !genAI) return mockMessage(channel, ctx);

  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: `You are drafting a sales follow-up on behalf of ${ctx.repName}.

Customer: ${ctx.customerName}
Contact: ${ctx.contactName ?? "unknown"}${ctx.contactRole ? ` (${ctx.contactRole})` : ""}
Opportunity: ${ctx.opportunityValue ? `$${ctx.opportunityValue}` : "unknown value"}${ctx.stage ? `, ${ctx.stage} stage` : ""}
What we promised: ${ctx.commitmentTitle ?? "unspecified"}
Last meeting: ${ctx.lastMeetingSummary ?? "no record"}
Their concerns: ${ctx.concerns.join("; ") || "none recorded"}
Their unanswered questions: ${ctx.openQuestions.join("; ") || "none"}
Known facts: ${JSON.stringify(ctx.facts)}

${CHANNEL_INSTRUCTIONS[channel]}

Reference actual specifics above. Never write generic filler like "just checking in". Output only the message.`,
  });

  return response.text ?? "";
}

const REFINEMENTS: Record<string, string> = {
  shorter: "Make it significantly shorter without losing the specific details or the ask.",
  casual: "Make the tone more casual and human, as if writing to a peer you know well.",
  persuasive: "Make it more persuasive: lead with the outcome they care about and make the ask harder to defer.",
  formal: "Make the tone more formal and suitable for a senior executive.",
};

export async function refineMessage(previous: string, instructionKey: string): Promise<string> {
  const instruction = REFINEMENTS[instructionKey] ?? instructionKey;

  if (MOCK_MODE || !genAI) {
    // Deterministic local transforms so refinement visibly does something.
    if (instructionKey === "shorter") {
      const lines = previous.split("\n").filter((l) => l.trim());
      const subject = lines.find((l) => l.startsWith("Subject:"));
      const kept = lines.filter((l) => !l.startsWith("Subject:")).slice(0, 4);
      return [subject, "", ...kept].filter(Boolean).join("\n");
    }
    if (instructionKey === "casual") {
      return previous
        .replace(/\bThanks again for the time\b/g, "Great catching up")
        .replace(/\bWould Thursday afternoon work for a quick review\?/g, "Fancy a quick look Thursday?")
        .replace(/\bBest,/g, "Cheers,");
    }
    if (instructionKey === "persuasive") {
      return previous.replace(
        /Would Thursday afternoon work for a quick review\?/,
        "Every week we wait pushes your go-live back by the same amount — can we lock in Thursday afternoon to review and agree next steps?",
      );
    }
    return `${previous}\n\n(Formal tone applied.)`;
  }

  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: `Draft:\n\n${previous}\n\nRevise it: ${instruction}\n\nOutput only the revised message.`,
  });
  return response.text ?? "";
}

/* ============================================================
   FREEFORM ASK — used only as the fallback path when the intent
   router in lib/ask.ts cannot answer structurally.
   ============================================================ */

export async function answerQuestion(question: string, context: string): Promise<string> {
  if (MOCK_MODE || !genAI) {
    return `I can answer that from your pipeline data, but freeform reasoning needs a live model. Set GEMINI_API_KEY in .env.local to enable it. Here is the relevant context I found:\n\n${context.slice(0, 600)}`;
  }

  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: `A sales rep asked: "${question}"

Answer strictly from the pipeline data below. If it is not in the data, say so plainly.

${context}

Answer in 2-4 sentences, no preamble.`,
  });
  return response.text ?? "";
}
