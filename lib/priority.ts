import type { PriorityBand, Stage } from "@/lib/types";
import { daysBetween, today } from "@/lib/dates";

// The scoring model is deterministic arithmetic, not an AI call. The AI's job
// is to produce *signals* (buying intent, objections, questions) from raw
// conversation; turning signals into a rank is arithmetic, and arithmetic is
// explainable, testable, and free. Every component that contributes at least
// MIN_REASON_POINTS emits a human-readable reason, so the UI can always answer
// "why is this at the top?" — an unexplained rank is treated as a bug.

const MIN_REASON_POINTS = 5;

export interface ScoreInput {
  value: number;
  /** Median open-deal value in the pipeline, used to normalise deal size. */
  pipelineMedian: number;
  stage: Stage;
  probability: number;
  /** Days past due for the most overdue open commitment we owe. 0 if none. */
  daysOverdue: number;
  dueToday: boolean;
  daysSinceInteraction: number | null;
  buyingSignals: number;
  /** Summed strength (1-3) of those signals. One "send me the contract" outranks three "looks interesting". */
  buyingStrength: number;
  riskSignals: number;
  competitorMentions: number;
  openQuestions: number;
  hasNextStep: boolean;
}

export interface ScoreResult {
  score: number;
  band: PriorityBand;
  reasons: string[];
  riskReasons: string[];
}

/** Days of silence that count as "normal" before a stage starts to look stale. */
const STAGE_SILENCE_NORM: Record<Stage, number> = {
  new: 7,
  qualified: 7,
  discovery: 7,
  demo: 5,
  proposal: 4,
  negotiation: 3,
  won: 30,
  lost: 90,
};

const STAGE_WEIGHT: Record<Stage, number> = {
  new: 0.2,
  qualified: 0.4,
  discovery: 0.6,
  demo: 0.75,
  proposal: 0.9,
  negotiation: 1,
  won: 0,
  lost: 0,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function scoreOpportunity(input: ScoreInput): ScoreResult {
  const reasons: string[] = [];
  const riskReasons: string[] = [];
  const add = (points: number, reason: string, risk = false) => {
    if (points >= MIN_REASON_POINTS) {
      reasons.push(reason);
      if (risk) riskReasons.push(reason);
    }
    return points;
  };

  let score = 0;

  // 1. Deal value (18) — log-scaled against the pipeline median so one huge
  //    deal doesn't flatten everything else to zero.
  const median = Math.max(input.pipelineMedian, 1);
  const ratio = Math.max(input.value, 1) / median;
  const valuePoints = clamp(9 + Math.log2(ratio) * 6, 0, 18);
  score += add(
    valuePoints,
    valuePoints >= 14 ? `High-value deal (${compact(input.value)})` : `${compact(input.value)} opportunity`,
  );

  // 2. Overdue follow-up (22) — the single strongest "act now" trigger.
  if (input.daysOverdue > 0) {
    const p = clamp(10 + input.daysOverdue * 3, 0, 22);
    score += add(p, `Follow-up overdue by ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"}`, true);
  } else if (input.dueToday) {
    score += add(14, "Follow-up due today");
  }

  // 3. Buying signals, weighted by strength (20).
  if (input.buyingSignals > 0) {
    const p = clamp(input.buyingStrength * 7, 0, 20);
    score += add(p, `${input.buyingSignals} buying signal${input.buyingSignals === 1 ? "" : "s"} detected`);
  }

  // 4. Silence relative to what's normal for the stage (15).
  const norm = STAGE_SILENCE_NORM[input.stage];
  if (input.daysSinceInteraction != null && input.daysSinceInteraction > norm) {
    const over = input.daysSinceInteraction - norm;
    const p = clamp(over * 2.5, 0, 15);
    score += add(p, `No contact for ${input.daysSinceInteraction} days`, true);
  }

  // 5. Stage x probability (16) — late-stage deals deserve attention.
  const stagePoints = STAGE_WEIGHT[input.stage] * (input.probability / 100) * 16;
  score += add(stagePoints, `${input.probability}% likely, late stage`);

  // 6. Unanswered customer questions (10) — the cheapest deal-killer to fix.
  if (input.openQuestions > 0) {
    const p = clamp(input.openQuestions * 6, 0, 10);
    score += add(
      p,
      `${input.openQuestions} unanswered question${input.openQuestions === 1 ? "" : "s"}`,
      true,
    );
  }

  // 7. Risk signals (12).
  let riskPoints = 0;
  if (input.riskSignals > 0) riskPoints += input.riskSignals * 4;
  if (input.competitorMentions >= 2) riskPoints += 4;
  if (!input.hasNextStep) riskPoints += 5;
  riskPoints = clamp(riskPoints, 0, 12);
  if (riskPoints > 0) {
    const label = !input.hasNextStep && input.riskSignals === 0
      ? "No next step scheduled"
      : input.competitorMentions >= 2
        ? `Competitor mentioned ${input.competitorMentions} times`
        : `${input.riskSignals} risk signal${input.riskSignals === 1 ? "" : "s"}`;
    score += add(riskPoints, label, true);
  }

  const rounded = Math.round(clamp(score, 0, 100));
  return { score: rounded, band: bandFor(rounded), reasons, riskReasons };
}

export function bandFor(score: number): PriorityBand {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export const BAND_ORDER: Record<PriorityBand, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const BAND_LABEL: Record<PriorityBand, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Days past due for the most overdue item in a list of due dates. */
export function maxDaysOverdue(dueDates: string[]): number {
  const t = today();
  let max = 0;
  for (const d of dueDates) {
    const diff = daysBetween(d, t);
    if (diff > max) max = diff;
  }
  return max;
}
