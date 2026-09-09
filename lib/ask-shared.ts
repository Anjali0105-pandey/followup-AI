/** Client-safe half of the Ask feature: types and copy, no database import. */

export interface AskResultItem {
  title: string;
  subtitle?: string;
  detail?: string;
  href: string;
  customerId?: number;
  commitmentId?: number;
  badge?: string;
  tone?: "risk" | "attention" | "positive" | "neutral";
}

export interface AskResult {
  answer: string;
  intent: string;
  items: AskResultItem[];
  /** True when the answer came from the model rather than a structural query. */
  freeform?: boolean;
}

export const SUGGESTED_QUESTIONS = [
  "Who should I follow up with today?",
  "Which deals are going cold?",
  "Which customers are waiting on me?",
  "What did I promise Acme?",
  "Show me opportunities above $10K with no activity for 7 days",
  "Prepare me for my meeting with Acme",
];
