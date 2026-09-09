"use client";

import { useEffect, useState, useTransition } from "react";
import { generateDraftAction, markSentAction, refineDraftAction } from "@/app/actions";
import type { DraftContext } from "@/app/actions";
import type { GeneratorTarget } from "@/components/generator/GeneratorProvider";
import { useToast } from "@/components/shell/Toast";

type Channel = "email" | "whatsapp" | "linkedin" | "call_script";

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "call_script", label: "Call script" },
];

const REFINEMENTS = [
  { key: "shorter", label: "Make shorter" },
  { key: "casual", label: "More casual" },
  { key: "persuasive", label: "More persuasive" },
  { key: "formal", label: "More formal" },
];

export default function GeneratorDrawer({ target, onClose }: { target: GeneratorTarget; onClose: () => void }) {
  const [channel, setChannel] = useState<Channel>(target.channel ?? "email");
  const [body, setBody] = useState("");
  const [context, setContext] = useState<DraftContext | null>(null);
  const [showContext, setShowContext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // The drawer may be opened knowing only a commitment; the server resolves
  // the account and hands it back on the context.
  const [customerId, setCustomerId] = useState<number | null>(target.customerId ?? null);
  const commitmentId = target.commitmentId ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await generateDraftAction(target.customerId ?? null, commitmentId, channel);
      if (cancelled) return;
      setBody(result.body);
      setContext(result.context);
      setCustomerId(result.context.customerId);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, target.customerId, commitmentId]);

  function regenerate() {
    setLoading(true);
    startTransition(async () => {
      const result = await generateDraftAction(customerId, commitmentId, channel);
      setBody(result.body);
      setContext(result.context);
      setLoading(false);
    });
  }

  function refine(key: string) {
    setLoading(true);
    startTransition(async () => {
      setBody(await refineDraftAction(body, key));
      setLoading(false);
    });
  }

  return (
    <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true" aria-label="Generate follow-up">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <aside className="anim-drawer absolute right-0 top-0 flex h-full w-[min(560px,100vw)] flex-col border-l border-line bg-card">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="t-h2 flex items-center gap-1.5">
              <span className="text-ai">✦</span> Generate follow-up
            </h2>
            <p className="t-meta mt-0.5">
              {context?.customerName ?? "Loading…"}
              {context?.contactName ? ` · ${context.contactName}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="focus-ring rounded p-1 text-ink-3 hover:text-ink">
            <svg viewBox="0 0 20 20" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5" fill="none">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Context transparency: what the model was actually given. */}
        <div className="border-b border-line px-5 py-3">
          <button
            onClick={() => setShowContext((s) => !s)}
            className="t-label flex w-full items-center justify-between text-ink-3 hover:text-ink-2"
          >
            <span>Context used by AI</span>
            <span>{showContext ? "Hide" : "Show"}</span>
          </button>
          {showContext && context && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip label="Promised" value={context.commitmentTitle} />
              <Chip label="Last meeting" value={context.lastMeeting} />
              <Chip label="Opportunity" value={context.opportunity} />
              {context.concerns.slice(0, 2).map((c) => (
                <Chip key={c} label="Concern" value={c} tone="risk" />
              ))}
              {context.openQuestions.slice(0, 2).map((q) => (
                <Chip key={q} label="Open question" value={q} tone="attention" />
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1 border-b border-line px-5 py-2.5">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                if (c.key === channel) return;
                setLoading(true);
                setChannel(c.key);
              }}
              className={`focus-ring rounded-[7px] px-2.5 py-1.5 text-[13px] transition-colors ${
                channel === c.key ? "bg-brand-tint font-medium text-brand" : "text-ink-2 hover:bg-sunken"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-2">
              <div className="anim-thinking flex items-center gap-2 text-[13px] text-ai">
                <span>✦</span> Drafting from {context?.customerName ?? "account"} context…
              </div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-3.5 rounded bg-sunken" style={{ width: `${95 - i * 9}%` }} />
              ))}
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              className="focus-ring h-full min-h-[280px] w-full resize-none rounded-[7px] border border-line bg-card p-3 font-sans text-[13px] leading-6 outline-none"
            />
          )}
        </div>

        <footer className="border-t border-line px-5 py-3">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {REFINEMENTS.map((r) => (
              <button
                key={r.key}
                disabled={loading}
                onClick={() => refine(r.key)}
                className="focus-ring rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-sunken disabled:opacity-40"
              >
                {r.label}
              </button>
            ))}
            <button
              disabled={loading}
              onClick={regenerate}
              className="focus-ring rounded-full border border-ai-line bg-ai-tint px-2.5 py-1 text-[12px] font-medium text-ai disabled:opacity-40"
            >
              ✦ Regenerate
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(body);
                toast("Draft copied to clipboard", { tone: "positive" });
              }}
              className="focus-ring rounded-[7px] border border-line px-3 py-2 text-[13px] hover:bg-sunken"
            >
              Copy
            </button>
            <button
              disabled={pending || loading || !customerId}
              onClick={() =>
                startTransition(async () => {
                  await markSentAction({ customerId: customerId!, commitmentId, channel, body });
                  toast("Sent, logged, and follow-up closed", { tone: "positive" });
                  onClose();
                })
              }
              className="focus-ring flex-1 rounded-[7px] bg-brand px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {pending ? "Sending…" : "Mark as sent"}
            </button>
          </div>
          <p className="t-meta mt-2 text-[11px]">
            Marking as sent logs an outbound {channel === "call_script" ? "call" : channel} and completes the follow-up.
          </p>
        </footer>
      </aside>
    </div>
  );
}

function Chip({ label, value, tone = "neutral" }: { label: string; value: string | null; tone?: "neutral" | "risk" | "attention" }) {
  if (!value) return null;
  const cls =
    tone === "risk"
      ? "border-risk-line bg-risk-tint text-risk"
      : tone === "attention"
        ? "border-attention-line bg-attention-tint text-attention"
        : "border-line bg-sunken text-ink-2";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      <span className="opacity-60">{label}:</span>
      <span className="truncate">{value}</span>
    </span>
  );
}
