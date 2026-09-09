"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CommitmentView } from "@/lib/types";
import type { FeedItem } from "@/lib/repo/commitments";
import { BAND_BAR, PriorityChip, Avatar } from "@/components/ui";
import { money } from "@/lib/format";
import { relativeDue, relativePast, today } from "@/lib/dates";
import { completeCommitmentAction, reopenCommitmentAction, snoozeCommitmentAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";
import { useGenerator } from "@/components/generator/GeneratorProvider";

/**
 * The Command Center feed. Every card answers the same five questions in the
 * same order — what, why it matters, what you promised, when, what to do — so
 * a rep learns the shape once and can then scan it.
 */
export default function PriorityFeed({ items: feed }: { items: FeedItem[] }) {
  const items = feed.map((f) => f.lead);
  const alsoByLead = new Map(feed.map((f) => [f.lead.id, f.also]));
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();
  const { openGenerator } = useGenerator();
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  const visible = items.filter((i) => !dismissed.has(i.id));

  function dismiss(id: number) {
    setDismissed((s) => new Set(s).add(id));
  }
  function restore(id: number) {
    setDismissed((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  function complete(item: CommitmentView) {
    dismiss(item.id);
    startTransition(async () => {
      await completeCommitmentAction(item.id);
      toast(`Done — ${item.title}`, {
        tone: "positive",
        undo: () => {
          restore(item.id);
          startTransition(() => void reopenCommitmentAction(item.id));
        },
      });
    });
  }

  function snooze(item: CommitmentView, days: number) {
    dismiss(item.id);
    startTransition(async () => {
      await snoozeCommitmentAction(item.id, days);
      toast(`Snoozed ${days === 1 ? "1 day" : `${days} days`}`, { undo: () => restore(item.id) });
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const item = visible[cursor];

      switch (e.key.toLowerCase()) {
        case "j":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, visible.length - 1));
          break;
        case "k":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "enter":
          if (item) {
            e.preventDefault();
            router.push(`/customers/${item.customer_id}`);
          }
          break;
        case "d":
          if (item) {
            e.preventDefault();
            complete(item);
          }
          break;
        case "s":
          if (item) {
            e.preventDefault();
            snooze(item, 1);
          }
          break;
        case "c":
          if (item) {
            e.preventDefault();
            openGenerator({ commitmentId: item.id, customerId: item.customer_id });
          }
          break;
        case "e":
          if (item) {
            e.preventDefault();
            openGenerator({ commitmentId: item.id, customerId: item.customer_id, channel: "email" });
          }
          break;
        case "w":
          if (item) {
            e.preventDefault();
            openGenerator({ commitmentId: item.id, customerId: item.customer_id, channel: "whatsapp" });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    refs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const t = today();

  return (
    <ul className="space-y-3">
      {visible.map((item, i) => {
        const overdue = item.due_date < t;
        const focused = i === cursor;
        const silent = item.risk_reasons.find((r) => r.startsWith("No contact"));

        return (
          <li
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onMouseEnter={() => setCursor(i)}
            className={`card card-interactive anim-in relative overflow-hidden ${
              focused ? "border-brand-line shadow-[var(--shadow-raised)]" : ""
            }`}
          >
            <span className={`absolute left-0 top-0 h-full w-[3px] ${BAND_BAR[item.priority_band]}`} />

            <div className="grid min-w-0 gap-4 p-4 pl-5 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                {/* Who + how much */}
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityChip band={item.priority_band} score={item.priority_score} reasons={item.priority_reasons} />
                  {overdue && (
                    <span className="rounded-full bg-risk-tint px-2 py-0.5 text-[11px] font-medium text-risk">
                      {relativeDue(item.due_date)}
                    </span>
                  )}
                  {silent && (
                    <span className="rounded-full bg-attention-tint px-2 py-0.5 text-[11px] font-medium text-attention">
                      {silent}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <Link
                    href={`/customers/${item.customer_id}`}
                    className="focus-ring t-h2 rounded hover:text-brand hover:underline"
                  >
                    {item.company}
                  </Link>
                  {item.opportunity_value != null && (
                    <span className="tabular text-[13px] font-medium text-ink-2">
                      {money(item.opportunity_value)} opportunity
                    </span>
                  )}
                </div>

                {item.contact_name && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Avatar name={item.contact_name} size={20} />
                    <span className="t-meta">
                      {item.contact_name}
                      {item.contact_role && <span className="text-ink-3"> · {item.contact_role}</span>}
                    </span>
                    <span className="text-ink-3">·</span>
                    <span className="t-meta">Last touch {relativePast(item.last_interaction_at)}</span>
                  </div>
                )}

                {/* Why this is here */}
                {item.ai_insight && (
                  <div className="ai-block mt-3 px-3 py-2">
                    <div className="t-label mb-0.5 text-ai">✦ AI insight</div>
                    <p className="text-[13px] leading-5">{item.ai_insight}</p>
                  </div>
                )}

                {/* The promise */}
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <div className="t-label">{item.owner === "me" ? "You promised" : "They owe you"}</div>
                    <p className="text-[13.5px] font-medium">{item.title}</p>
                    {item.detail && <p className="t-meta mt-0.5">{item.detail}</p>}
                  </div>
                  <div className="sm:text-right">
                    <div className="t-label">Due</div>
                    <p className={`text-[13.5px] font-medium ${overdue ? "text-risk" : ""}`}>
                      {relativeDue(item.due_date)}
                    </p>
                  </div>
                </div>

                {/* Everything else this account needs, so one card covers the
                    whole relationship rather than one task. */}
                {(alsoByLead.get(item.id)?.length ?? 0) > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
                    <li className="t-label">Also for {item.company}</li>
                    {alsoByLead.get(item.id)!.map((extra) => (
                      <li key={extra.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13px] text-ink-2">{extra.title}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={`text-[12px] ${extra.due_date < t ? "text-risk" : "text-ink-3"}`}>
                            {relativeDue(extra.due_date)}
                          </span>
                          <button
                            onClick={() => openGenerator({ commitmentId: extra.id, customerId: extra.customer_id })}
                            className="focus-ring rounded-[6px] border border-ai-line bg-ai-tint px-1.5 py-0.5 text-[11px] font-medium text-ai"
                          >
                            ✦
                          </button>
                          <button
                            onClick={() => complete(extra)}
                            className="focus-ring rounded-[6px] border border-line px-1.5 py-0.5 text-[11px] hover:bg-sunken"
                          >
                            Done
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* What to do about it */}
                {item.ai_recommendation && (
                  <div className="mt-3 border-t border-line-soft pt-3">
                    <div className="t-label mb-0.5 text-ai">✦ Recommended action</div>
                    <p className="text-[13px] leading-5 text-ink-2">{item.ai_recommendation}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex min-w-0 flex-row flex-wrap items-start gap-2 md:w-[150px] md:flex-col">
                <button
                  onClick={() => openGenerator({ commitmentId: item.id, customerId: item.customer_id })}
                  className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-[7px] bg-brand px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  <span>✦</span> Generate
                </button>
                <button
                  onClick={() => complete(item)}
                  className="focus-ring w-full rounded-[7px] border border-line px-3 py-2 text-[13px] transition-colors hover:bg-sunken"
                >
                  Mark done
                </button>
                <SnoozeMenu onPick={(d) => snooze(item, d)} />
                {focused && (
                  <p className="hidden w-full text-center text-[11px] text-ink-3 md:block">
                    <kbd>D</kbd> done · <kbd>S</kbd> snooze · <kbd>C</kbd> draft
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SnoozeMenu({ onPick }: { onPick: (days: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring w-full rounded-[7px] border border-line px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-sunken"
      >
        Snooze ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="anim-in absolute right-0 top-full z-20 mt-1 w-32 rounded-[8px] border border-line bg-card py-1 shadow-[var(--shadow-overlay)]">
            {[
              { d: 1, label: "Tomorrow" },
              { d: 3, label: "In 3 days" },
              { d: 7, label: "Next week" },
              { d: 14, label: "In 2 weeks" },
            ].map((o) => (
              <button
                key={o.d}
                onClick={() => {
                  setOpen(false);
                  onPick(o.d);
                }}
                className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-sunken"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
