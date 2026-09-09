"use client";

import { useState } from "react";
import type { Interaction } from "@/lib/types";
import { INTERACTION_LABEL } from "@/lib/types";
import { formatDay, relativePast } from "@/lib/dates";

const ICON: Record<string, string> = {
  meeting: "◍",
  call: "☏",
  email: "✉",
  whatsapp: "◐",
  linkedin: "in",
  proposal: "▤",
  sms: "◇",
  note: "✎",
};

const TYPES = ["all", "meeting", "call", "email", "whatsapp", "proposal"] as const;

export default function Timeline({ interactions }: { interactions: Interaction[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<number | null>(interactions[0]?.id ?? null);

  const rows = filter === "all" ? interactions : interactions.filter((i) => i.type === filter);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`focus-ring rounded-full px-2.5 py-1 text-[12px] transition-colors ${
              filter === t ? "bg-brand-tint font-medium text-brand" : "text-ink-2 hover:bg-sunken"
            }`}
          >
            {t === "all" ? "All" : INTERACTION_LABEL[t]}
          </button>
        ))}
      </div>

      <ol className="relative space-y-1 border-l border-line pl-0">
        {rows.map((i) => {
          const open = openId === i.id;
          return (
            <li key={i.id} className="relative pl-6">
              <span className="absolute -left-[9px] top-3 grid h-[18px] w-[18px] place-items-center rounded-full border border-line bg-card text-[9px] text-ink-2">
                {ICON[i.type] ?? "•"}
              </span>
              <button
                onClick={() => setOpenId(open ? null : i.id)}
                className="w-full rounded-[7px] px-2 py-2 text-left transition-colors hover:bg-sunken/50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium">{i.subject}</span>
                  <span className="t-meta shrink-0 text-[12px]">
                    {formatDay(i.occurred_at)} · {relativePast(i.occurred_at)}
                  </span>
                </div>
                <p className="t-meta text-[12px]">
                  {INTERACTION_LABEL[i.type]} · {i.direction === "inbound" ? "from customer" : "from you"}
                </p>
              </button>

              {open && (i.ai_summary || i.body || i.transcript) && (
                <div className="anim-in mb-2 ml-2 space-y-2">
                  {i.ai_summary && (
                    <div className="ai-block px-3 py-2">
                      <div className="t-label mb-0.5 text-ai">✦ Summary</div>
                      <p className="text-[12.5px] leading-5">{i.ai_summary}</p>
                    </div>
                  )}
                  {i.body && <p className="rounded-[7px] bg-sunken px-3 py-2 text-[12.5px] leading-5 text-ink-2">{i.body}</p>}
                  {i.transcript && (
                    <details className="rounded-[7px] border border-line px-3 py-2">
                      <summary className="cursor-pointer text-[12px] text-ink-2">Transcript</summary>
                      <pre className="thin-scroll mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-5 text-ink-2">
                        {i.transcript}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
