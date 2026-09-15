// Demo dataset. All dates are expressed as *offsets in days from today* so the
// demo never goes stale — a fixed calendar date would have "overdue by 3 days"
// silently become "overdue by 400 days" a year from now.

import type { CommitmentKind, InteractionType, SignalKind, Stage } from "@/lib/types";

export interface SeedSignal {
  kind: SignalKind;
  label: string;
  detail?: string;
  strength?: number;
  resolved?: boolean;
}

export interface SeedInteraction {
  type: InteractionType;
  direction?: "inbound" | "outbound";
  daysAgo: number;
  subject: string;
  body?: string;
  transcript?: string;
  aiSummary?: string;
  signals?: SeedSignal[];
}

export interface SeedCommitment {
  owner: "me" | "customer";
  kind: CommitmentKind;
  title: string;
  detail?: string;
  dueInDays: number;
  status?: "open" | "done";
  source?: "ai_extracted" | "manual";
}

export interface SeedCustomer {
  name: string;
  company: string;
  industry: string;
  segment: string;
  website: string;
  aiSummary: string;
  facts: Record<string, string>;
  contacts: {
    name: string;
    role: string;
    email: string;
    phone?: string;
    decisionMaker?: boolean;
    champion?: boolean;
  }[];
  opportunity?: {
    name: string;
    value: number;
    stage: Stage;
    probability: number;
    closeInDays: number;
  };
  interactions: SeedInteraction[];
  commitments: SeedCommitment[];
}

export const WORKSPACE = { name: "Northwind Sales", plan: "pro" };
export const USER = {
  name: "Anjali Pandey",
  email: "anjali@northwind.io",
  role: "Senior Account Executive",
  initials: "AP",
};

export const CUSTOMERS: SeedCustomer[] = [
  {
    name: "ABC Technologies",
    company: "ABC Technologies",
    industry: "Software",
    segment: "Mid-market",
    website: "abctech.io",
    aiSummary:
      "ABC is evaluating the platform for a 140-person engineering org. John Smith (CTO) is the technical decision maker and is sold on the product itself — his open concern is implementation time, which he raised twice in the last meeting. Procurement sign-off sits with the CFO, who has not yet been in a call.",
    facts: {
      budget: "$18,000 approved for this fiscal year",
      timeline: "Wants to be live before the end of the quarter",
      decision_maker: "John Smith (CTO), CFO signs the contract",
      pain_points: "Manual handoffs between support and engineering; no audit trail",
      objections: "Worried implementation will take more than a month",
      products_discussed: "Core platform + SSO add-on",
      seats: "140",
    },
    contacts: [
      { name: "John Smith", role: "CTO", email: "john@abctech.io", phone: "+1 415 555 0142", decisionMaker: true, champion: true },
      { name: "Priya Raman", role: "Engineering Manager", email: "priya@abctech.io" },
    ],
    opportunity: { name: "ABC Technologies — Platform rollout", value: 18000, stage: "proposal", probability: 65, closeInDays: 21 },
    interactions: [
      {
        type: "meeting",
        daysAgo: 2,
        subject: "Technical deep-dive with engineering",
        aiSummary:
          "John was genuinely enthusiastic about the product but returned twice to implementation effort. He asked for a concrete week-by-week rollout plan before taking it to the CFO.",
        transcript:
          "John: The product itself looks great — the team liked the audit trail.\nAnjali: Glad to hear it.\nJohn: My worry is time. Last tool we bought took four months to roll out and it burned goodwill internally.\nAnjali: Understood. Our median for a 140-seat org is two weeks.\nJohn: If you can put that in writing week by week, I can take it to our CFO.\nPriya: Also — does SSO come in the base tier or is it an add-on?\nAnjali: I'll confirm the exact packaging.\nJohn: Send both and let's talk Thursday.",
        signals: [
          { kind: "buying", label: "Asked for a rollout plan to take to the CFO", detail: "Explicitly framed as the last step before internal approval.", strength: 3 },
          { kind: "objection", label: "Implementation time", detail: "Previous tool took four months to roll out.", strength: 3 },
          { kind: "question", label: "Is SSO in the base tier or an add-on?", detail: "Asked by Priya Raman, not answered in the meeting." },
        ],
      },
      { type: "email", direction: "outbound", daysAgo: 5, subject: "Recap + pricing sheet", body: "Sharing the pricing sheet we walked through, plus the security overview." },
      { type: "call", direction: "outbound", daysAgo: 12, subject: "Discovery call", aiSummary: "Scoped the team size at 140 and confirmed budget authority sits with the CFO." },
    ],
    commitments: [
      { owner: "me", kind: "send_document", title: "Send implementation plan", detail: "Week-by-week 2-week rollout plan John will take to the CFO.", dueInDays: 0, source: "ai_extracted" },
      { owner: "me", kind: "answer_question", title: "Confirm whether SSO is base tier or add-on", dueInDays: 0, source: "ai_extracted" },
      { owner: "customer", kind: "schedule_meeting", title: "John to bring the CFO to the review call", dueInDays: 2, source: "ai_extracted" },
    ],
  },
  {
    name: "XYZ Corp",
    company: "XYZ Corp",
    industry: "Logistics",
    segment: "Mid-market",
    website: "xyzcorp.com",
    aiSummary:
      "XYZ went silent 11 days ago, immediately after the pricing conversation. The proposal has been opened four times since then, so interest has not disappeared — the blocker is almost certainly price or an internal approval they haven't voiced. Sarah historically replied within 24 hours, which makes this silence a real signal rather than noise.",
    facts: {
      budget: "Indicated $10K ceiling, proposal came in at $12K",
      decision_maker: "Sarah Chen (VP Ops)",
      objections: "Price above the number she pitched internally",
      competitors_mentioned: "Evaluating Shiptrack as the cheaper option",
      timeline: "Wanted a decision this month",
    },
    contacts: [
      { name: "Sarah Chen", role: "VP Operations", email: "sarah.chen@xyzcorp.com", phone: "+1 312 555 0188", decisionMaker: true },
      { name: "Marcus Webb", role: "Ops Analyst", email: "marcus@xyzcorp.com", champion: true },
    ],
    opportunity: { name: "XYZ Corp — Ops automation", value: 12000, stage: "negotiation", probability: 55, closeInDays: 9 },
    interactions: [
      {
        type: "email",
        direction: "outbound",
        daysAgo: 11,
        subject: "Proposal — XYZ Corp ops automation",
        body: "Attaching the proposal we discussed at $12,000 annual.",
        aiSummary: "Proposal sent at $12K against a stated $10K ceiling. No reply since.",
        signals: [
          { kind: "buying", label: "Proposal opened 4 times", detail: "Re-opened twice in the last 48 hours despite no reply.", strength: 3 },
          { kind: "risk", label: "Went silent immediately after pricing", detail: "Sarah previously replied within 24 hours.", strength: 3 },
          { kind: "competitor", label: "Shiptrack mentioned as cheaper alternative", strength: 2 },
          { kind: "competitor", label: "Shiptrack raised again by procurement", strength: 2 },
        ],
      },
      { type: "meeting", daysAgo: 14, subject: "Pricing and packaging review", aiSummary: "Sarah pushed back on price and referenced a competitor quote at a lower number." },
      { type: "whatsapp", direction: "inbound", daysAgo: 16, subject: "Quick question on rollout", body: "Can you handle 40 warehouses in phase one?" },
    ],
    commitments: [
      { owner: "me", kind: "call", title: "Call Sarah about the pricing gap", detail: "Email is not landing — get her on the phone and find the real blocker.", dueInDays: -3, source: "ai_extracted" },
      { owner: "customer", kind: "answer_question", title: "Sarah to confirm the approved budget number", dueInDays: -1 },
    ],
  },
  {
    name: "Brightpath Media",
    company: "Brightpath Media",
    industry: "Media",
    segment: "SMB",
    website: "brightpath.media",
    aiSummary:
      "Small, fast-moving deal. Leo asked for the contract directly over WhatsApp yesterday — this is a closing signal and the only thing standing between here and revenue is sending the paperwork.",
    facts: {
      budget: "$6,500",
      decision_maker: "Leo Marchetti (Founder)",
      timeline: "Wants to start immediately",
    },
    contacts: [{ name: "Leo Marchetti", role: "Founder", email: "leo@brightpath.media", phone: "+39 02 5555 0177", decisionMaker: true, champion: true }],
    opportunity: { name: "Brightpath Media — Team plan", value: 6500, stage: "negotiation", probability: 85, closeInDays: 5 },
    interactions: [
      {
        type: "whatsapp",
        direction: "inbound",
        daysAgo: 1,
        subject: "Can you send me the contract today?",
        body: "Loved the trial. Can you send me the contract today so we can start Monday?",
        aiSummary: "Leo asked for the contract directly and named a Monday start.",
        signals: [{ kind: "buying", label: "Asked for the contract", detail: "Explicit closing signal with a named start date.", strength: 3 }],
      },
      { type: "meeting", daysAgo: 6, subject: "Trial wrap-up call" },
    ],
    commitments: [{ owner: "me", kind: "send_proposal", title: "Send contract to Leo", detail: "He asked for it yesterday and wants a Monday start.", dueInDays: 0, source: "ai_extracted" }],
  },
];
