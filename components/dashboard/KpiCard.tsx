"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Tone = "neutral" | "brand" | "positive" | "attention" | "risk";

const ACCENT: Record<Tone, string> = {
  neutral: "text-ink",
  brand: "text-brand",
  positive: "text-positive",
  attention: "text-attention",
  risk: "text-risk",
};

const TREND_TONE: Record<Tone, string> = {
  neutral: "text-ink-3",
  brand: "text-brand",
  positive: "text-positive",
  attention: "text-attention",
  risk: "text-risk",
};

/**
 * Counts up to `value` on mount. Deliberately short — this is a dashboard a
 * rep opens twenty times a day, so the number has to settle almost instantly.
 * Progress starts as null so the server-rendered markup and reduced-motion
 * users get the real number rather than a zero.
 */
function useCountUp(value: number, duration = 550) {
  const [progress, setProgress] = useState<number | null>(null);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) return;

    const start = performance.now();

    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic — fast out of the gate, gentle landing.
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    }

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return progress === null ? value : Math.round(value * progress);
}

export interface KpiTrend {
  /** up = number is climbing, down = falling, flat = no movement to report. */
  direction: "up" | "down" | "flat";
  /** Must be derived from real data — never a fabricated percentage. */
  label: string;
}

export default function KpiCard({
  label,
  value,
  tone = "neutral",
  hint,
  href,
  trend,
  delay = 0,
}: {
  label: string;
  value: number;
  tone?: Tone;
  hint?: string;
  href: string;
  trend?: KpiTrend;
  delay?: number;
}) {
  const shown = useCountUp(value);
  const arrow = trend?.direction === "up" ? "▲" : trend?.direction === "down" ? "▼" : "—";

  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className="card card-interactive anim-rise focus-ring group block px-4 py-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="t-label">{label}</div>
        {trend && (
          <span className={`flex shrink-0 items-center gap-1 text-[11px] font-medium ${TREND_TONE[tone]}`}>
            <span aria-hidden className="text-[9px]">
              {arrow}
            </span>
            <span className="tabular">{trend.label}</span>
          </span>
        )}
      </div>

      <div className={`tabular mt-1.5 text-[26px] font-semibold leading-none ${ACCENT[tone]}`}>{shown}</div>

      {hint && (
        <div className="t-meta mt-1.5 flex items-center gap-1 text-[12px]">
          <span className="truncate">{hint}</span>
          <span className="text-brand opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
            →
          </span>
        </div>
      )}
    </Link>
  );
}
