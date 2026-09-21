"use client";

import { useState, useTransition } from "react";
import type { Signal } from "@/lib/types";
import { Badge } from "@/components/ui";
import { resolveSignalAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";

/**
 * Signals with a way to close them.
 *
 * resolveSignalAction existed but had no caller anywhere in the UI, so an open
 * question or objection could never be marked answered. That is not cosmetic:
 * unresolved signals feed the priority score, the "Waiting on you" KPI and the
 * Insights counts, so those numbers could only ever climb — a rep who answered
 * every question still saw the same backlog.
 */
export default function SignalList({
  signals,
  tone,
}: {
  signals: Signal[];
  tone: "positive" | "risk" | "attention" | "neutral";
}) {
  const [resolved, setResolved] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const visible = signals.filter((s) => !resolved.has(s.id));
  if (visible.length === 0) return null;

  function resolve(signal: Signal) {
    setResolved((s) => new Set(s).add(signal.id));
    startTransition(async () => {
      try {
        await resolveSignalAction(signal.id);
      } catch {
        setResolved((s) => {
          const next = new Set(s);
          next.delete(signal.id);
          return next;
        });
        toast("Could not resolve that. Try again.", { tone: "risk" });
        return;
      }
      toast("Signal resolved", { tone: "positive" });
    });
  }

  return (
    <ul className="card divide-y divide-line-soft">
      {visible.map((s) => (
        <li key={s.id} className="px-4 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px]">{s.label}</p>
              {s.detail && <p className="t-meta mt-0.5 text-[12.5px]">{s.detail}</p>}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <Badge tone={tone}>{"●".repeat(s.strength)}</Badge>
              <button
                onClick={() => resolve(s)}
                title="Mark this signal as handled"
                className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                Resolve
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
