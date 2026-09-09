import Link from "next/link";
import type { ReactNode } from "react";
import type { Health, PriorityBand, Stage } from "@/lib/types";
import { BAND_LABEL } from "@/lib/priority";
import { STAGE_LABEL } from "@/lib/types";

/* Shared presentational primitives. Server-safe (no client hooks) so pages
   stay Server Components by default. */

type Tone = "neutral" | "brand" | "ai" | "positive" | "attention" | "risk";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  brand: "bg-brand-tint text-brand border-brand-line",
  ai: "bg-ai-tint text-ai border-ai-line",
  positive: "bg-positive-tint text-positive border-positive-line",
  attention: "bg-attention-tint text-attention border-attention-line",
  risk: "bg-risk-tint text-risk border-risk-line",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export const BAND_TONE: Record<PriorityBand, Tone> = {
  critical: "risk",
  high: "attention",
  medium: "brand",
  low: "neutral",
};

export const BAND_BAR: Record<PriorityBand, string> = {
  critical: "bg-risk",
  high: "bg-attention",
  medium: "bg-brand",
  low: "bg-line",
};

/**
 * Priority chip. The score alone is meaningless to a rep, so the reasons that
 * produced it are always attached — hover on desktop, and rendered inline by
 * callers that have room. An unexplained rank is treated as a bug.
 */
export function PriorityChip({ band, score, reasons }: { band: PriorityBand; score?: number; reasons?: string[] }) {
  const title = reasons?.length
    ? `${BAND_LABEL[band]} priority because:\n• ${reasons.join("\n• ")}`
    : `${BAND_LABEL[band]} priority`;
  return (
    <span title={title}>
      <Badge tone={BAND_TONE[band]}>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {BAND_LABEL[band]}
        {score != null && <span className="tabular opacity-60">{score}</span>}
      </Badge>
    </span>
  );
}

const HEALTH: Record<Health, { tone: Tone; label: string }> = {
  healthy: { tone: "positive", label: "Healthy" },
  watch: { tone: "attention", label: "Watch" },
  at_risk: { tone: "risk", label: "At risk" },
};

export function HealthPill({ health }: { health: Health | string }) {
  const h = HEALTH[(health as Health) in HEALTH ? (health as Health) : "healthy"];
  return <Badge tone={h.tone}>{h.label}</Badge>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  const tone: Tone = stage === "won" ? "positive" : stage === "lost" ? "neutral" : "brand";
  return <Badge tone={tone}>{STAGE_LABEL[stage]}</Badge>;
}

/** The ✦ mark that prefixes every machine-authored line in the product. */
export function AiMark({ className = "" }: { className?: string }) {
  return (
    <span aria-label="AI generated" className={`text-ai ${className}`}>
      ✦
    </span>
  );
}

export function AiNote({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="ai-block px-3 py-2">
      <div className="t-label mb-0.5 flex items-center gap-1 text-ai">
        <AiMark />
        {label ?? "AI insight"}
      </div>
      <p className="t-body text-[13px] leading-5">{children}</p>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {subtitle && <p className="t-meta mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="t-h2">{children}</h2>
      {aside}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  tone = "neutral",
  hint,
  href,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  hint?: string;
  href?: string;
}) {
  const accent: Record<Tone, string> = {
    neutral: "text-ink",
    brand: "text-brand",
    ai: "text-ai",
    positive: "text-positive",
    attention: "text-attention",
    risk: "text-risk",
  };
  const body = (
    <>
      <div className="t-label">{label}</div>
      <div className={`tabular mt-1.5 text-[26px] font-semibold leading-none ${accent[tone]}`}>{value}</div>
      {hint && <div className="t-meta mt-1.5 text-[12px]">{hint}</div>}
    </>
  );
  const base = "card card-interactive block px-4 py-3.5";
  return href ? (
    <Link href={href} className={`${base} focus-ring`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card px-6 py-8 text-center">
      <p className="t-h2">{title}</p>
      {body && <p className="t-meta mx-auto mt-1.5 max-w-md">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  // Deterministic hue so the same person keeps the same colour everywhere.
  const hue = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${hue} 62% 94%)`,
        color: `hsl(${hue} 48% 34%)`,
      }}
    >
      {letters}
    </span>
  );
}

export function Divider() {
  return <div className="h-px bg-line-soft" />;
}
