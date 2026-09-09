// Shared entity types. Rows come back from SQLite with JSON-encoded columns
// as strings; the `*Row` types describe the raw row, the plain types describe
// what repositories hand to the UI (parsed, typed, joined).

export type PriorityBand = "critical" | "high" | "medium" | "low";
export type Health = "healthy" | "watch" | "at_risk";
export type Stage =
  | "new"
  | "qualified"
  | "discovery"
  | "demo"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export const STAGES: Stage[] = [
  "new",
  "qualified",
  "discovery",
  "demo",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  qualified: "Qualified",
  discovery: "Discovery",
  demo: "Demo",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export type InteractionType =
  | "meeting"
  | "call"
  | "email"
  | "whatsapp"
  | "linkedin"
  | "proposal"
  | "sms"
  | "note";

export const INTERACTION_LABEL: Record<InteractionType, string> = {
  meeting: "Meeting",
  call: "Call",
  email: "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  proposal: "Proposal",
  sms: "SMS",
  note: "Note",
};

export type SignalKind =
  | "buying"
  | "risk"
  | "objection"
  | "question"
  | "competitor"
  | "budget"
  | "timeline";

export type CommitmentOwner = "me" | "customer";
export type CommitmentStatus = "open" | "snoozed" | "done" | "cancelled";
export type CommitmentKind =
  | "call"
  | "email"
  | "whatsapp"
  | "send_proposal"
  | "send_pricing"
  | "answer_question"
  | "schedule_meeting"
  | "send_document"
  | "wait"
  | "escalate";

export const COMMITMENT_KIND_LABEL: Record<CommitmentKind, string> = {
  call: "Call",
  email: "Email",
  whatsapp: "WhatsApp",
  send_proposal: "Send proposal",
  send_pricing: "Send pricing",
  answer_question: "Answer question",
  schedule_meeting: "Schedule meeting",
  send_document: "Send document",
  wait: "Wait",
  escalate: "Escalate",
};

export type InsightCategory =
  | "hot"
  | "at_risk"
  | "going_cold"
  | "buying_signal"
  | "unanswered_question"
  | "missed_followup"
  | "no_next_step"
  | "waiting_on_us";

export const INSIGHT_META: Record<
  InsightCategory,
  { title: string; blurb: string; tone: "positive" | "attention" | "risk" | "ai" }
> = {
  hot: { title: "Hot leads", blurb: "Strong engagement and momentum right now.", tone: "positive" },
  at_risk: { title: "Deals at risk", blurb: "Something is actively threatening these deals.", tone: "risk" },
  going_cold: { title: "Going cold", blurb: "Silence is stretching past what's normal for this account.", tone: "attention" },
  buying_signal: { title: "Buying signals", blurb: "The customer signalled intent to move forward.", tone: "positive" },
  unanswered_question: { title: "Unanswered questions", blurb: "A customer asked and nobody answered.", tone: "attention" },
  missed_followup: { title: "Missed follow-ups", blurb: "You promised something and the date has passed.", tone: "risk" },
  no_next_step: { title: "No next step", blurb: "Open opportunities with nothing scheduled.", tone: "attention" },
  waiting_on_us: { title: "Customers waiting on you", blurb: "The ball has been in your court for a while.", tone: "risk" },
};

export interface User {
  id: number;
  workspace_id: number;
  name: string;
  email: string;
  role: string;
  initials: string;
  created_at: string;
}

export interface Workspace {
  id: number;
  name: string;
  plan: string;
  created_at: string;
}

export interface Customer {
  id: number;
  workspace_id: number;
  name: string;
  company: string;
  industry: string | null;
  website: string | null;
  segment: string | null;
  health: Health;
  ai_summary: string | null;
  facts: Record<string, string>;
  owner_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  customer_id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_decision_maker: boolean;
  is_champion: boolean;
  notes: string | null;
}

export interface Opportunity {
  id: number;
  customer_id: number;
  name: string;
  value: number;
  currency: string;
  stage: Stage;
  probability: number;
  expected_close_date: string | null;
  primary_contact_id: number | null;
  priority_score: number;
  priority_band: PriorityBand;
  priority_reasons: string[];
  risk_reasons: string[];
  last_interaction_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Interaction {
  id: number;
  customer_id: number;
  opportunity_id: number | null;
  contact_id: number | null;
  type: InteractionType;
  direction: "inbound" | "outbound";
  occurred_at: string;
  subject: string;
  body: string | null;
  transcript: string | null;
  ai_summary: string | null;
  ai_processed_at: string | null;
  created_at: string;
}

export interface Signal {
  id: number;
  interaction_id: number | null;
  customer_id: number;
  opportunity_id: number | null;
  kind: SignalKind;
  label: string;
  detail: string | null;
  strength: number;
  resolved_at: string | null;
  created_at: string;
}

export interface Commitment {
  id: number;
  customer_id: number;
  opportunity_id: number | null;
  contact_id: number | null;
  interaction_id: number | null;
  owner: CommitmentOwner;
  kind: CommitmentKind;
  title: string;
  detail: string | null;
  due_date: string;
  status: CommitmentStatus;
  snoozed_until: string | null;
  completed_at: string | null;
  source: "ai_extracted" | "manual";
  created_at: string;
}

/** A commitment joined with the account context every screen needs to render it. */
export interface CommitmentView extends Commitment {
  customer_name: string;
  company: string;
  contact_name: string | null;
  contact_role: string | null;
  opportunity_value: number | null;
  opportunity_stage: Stage | null;
  priority_band: PriorityBand;
  priority_score: number;
  priority_reasons: string[];
  risk_reasons: string[];
  last_interaction_at: string | null;
  ai_recommendation: string | null;
  ai_insight: string | null;
}

export interface InsightItem {
  category: InsightCategory;
  customer_id: number;
  customer_name: string;
  company: string;
  opportunity_id: number | null;
  value: number | null;
  title: string;
  why: string[];
  recommendation: string;
  severity: "info" | "attention" | "risk";
}

export interface GeneratedMessage {
  id: number;
  commitment_id: number | null;
  customer_id: number;
  channel: string;
  body: string;
  sent_at: string | null;
  created_at: string;
}
