"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { askAction, completeCommitmentAction } from "@/app/actions";
import type { AskResult } from "@/lib/ask-shared";
import { SUGGESTED_QUESTIONS } from "@/lib/ask-shared";
import { useToast } from "@/components/shell/Toast";
import { useGenerator } from "@/components/generator/GeneratorProvider";

const NAV = [
  { label: "Command Center", href: "/", hint: "⌘1" },
  { label: "Follow-ups", href: "/followups", hint: "⌘2" },
  { label: "Commitments", href: "/commitments", hint: "⌘3" },
  { label: "Meetings", href: "/meetings", hint: "⌘4" },
  { label: "Customers", href: "/customers", hint: "⌘5" },
  { label: "Opportunities", href: "/opportunities", hint: "⌘6" },
  { label: "AI Insights", href: "/insights", hint: "⌘7" },
  { label: "Log a meeting", href: "/meetings/new", hint: "" },
  { label: "Settings", href: "/settings", hint: "" },
];

/**
 * One surface for navigation, search and natural-language ask. Answers render
 * as action cards rather than a chat bubble — the rep should be able to finish
 * the job from the result, not read about it.
 */
export default function AskPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const { openGenerator } = useGenerator();

  // Focusing an input is a DOM side effect, not derived state — and because
  // the parent unmounts this component on close, query/result reset for free.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const navMatches = query
    ? NAV.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
    : NAV.slice(0, 5);

  function submit() {
    const q = query.trim();
    if (!q) return;
    startTransition(async () => {
      setResult(await askAction(q));
    });
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Ask FollowUp AI">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]" onClick={onClose} />
      <div className="anim-in absolute left-1/2 top-[12vh] w-[min(680px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-card shadow-[var(--shadow-overlay)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <span className="text-ai">✦</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onClose();
            }}
            placeholder="Ask anything, or jump to a page…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
          />
          {pending ? (
            <span className="anim-thinking text-[12px] text-ai">Thinking…</span>
          ) : (
            <kbd>esc</kbd>
          )}
        </div>

        <div className="thin-scroll max-h-[58vh] overflow-y-auto">
          {!result && (
            <>
              {navMatches.length > 0 && (
                <Section label="Go to">
                  {navMatches.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={onClose}
                      className="flex items-center justify-between rounded-[7px] px-2.5 py-2 text-[13px] hover:bg-sunken"
                    >
                      <span>{n.label}</span>
                      {n.hint && <kbd>{n.hint}</kbd>}
                    </Link>
                  ))}
                </Section>
              )}
              {query.trim() && (
                <Section label="Ask">
                  <button
                    onClick={submit}
                    className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-sunken"
                  >
                    <span className="text-ai">✦</span>
                    <span className="truncate">
                      Ask FollowUp AI: <span className="font-medium">{query}</span>
                    </span>
                  </button>
                </Section>
              )}
              {!query && (
                <Section label="Try asking">
                  {SUGGESTED_QUESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setQuery(s);
                        startTransition(async () => setResult(await askAction(s)));
                      }}
                      className="block w-full truncate rounded-[7px] px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-sunken hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </Section>
              )}
            </>
          )}

          {result && (
            <div className="p-3">
              <div className="ai-block mb-3 px-3 py-2.5">
                <div className="t-label mb-1 text-ai">✦ Answer</div>
                <p className="whitespace-pre-wrap text-[13px] leading-5">{result.answer}</p>
              </div>

              {result.items.length > 0 && (
                <ul className="space-y-1.5">
                  {result.items.map((item, i) => (
                    <li key={i} className="card card-interactive px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{item.title}</p>
                          {item.subtitle && <p className="truncate text-[12px] text-ink-2">{item.subtitle}</p>}
                          {item.detail && <p className="mt-1 text-[12px] text-ai">✦ {item.detail}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {item.commitmentId && (
                            <>
                              <button
                                onClick={() => {
                                  openGenerator({ commitmentId: item.commitmentId!, customerId: item.customerId });
                                  onClose();
                                }}
                                className="focus-ring rounded-[6px] border border-ai-line bg-ai-tint px-2 py-1 text-[12px] font-medium text-ai hover:bg-ai-tint/70"
                              >
                                ✦ Draft
                              </button>
                              <button
                                onClick={() =>
                                  startTransition(async () => {
                                    await completeCommitmentAction(item.commitmentId!);
                                    toast("Marked done", { tone: "positive" });
                                    setResult({ ...result, items: result.items.filter((_, x) => x !== i) });
                                  })
                                }
                                className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-sunken"
                              >
                                Done
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              router.push(item.href);
                              onClose();
                            }}
                            className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-sunken"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={() => setResult(null)}
                className="mt-3 text-[12px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
              >
                ← Ask something else
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-2">
      <div className="t-label px-2.5 pb-1">{label}</div>
      {children}
    </div>
  );
}
