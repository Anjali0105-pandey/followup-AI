"use client";

import Link from "next/link";
import type { InsightItem } from "@/lib/types";
import { INSIGHT_META } from "@/lib/types";
import { Badge } from "@/components/ui";
import { moneyShort } from "@/lib/format";
import { useGenerator } from "@/components/generator/GeneratorProvider";

const TONE_CLASS = {
  positive: "border-l-positive",
  attention: "border-l-attention",
  risk: "border-l-risk",
  ai: "border-l-ai",
} as const;

export default function InsightSection({
  category,
  items,
}: {
  category: keyof typeof INSIGHT_META;
  items: InsightItem[];
}) {
  const meta = INSIGHT_META[category];
  const { openGenerator } = useGenerator();

  return (
    <section id={category} className="scroll-mt-20">
      <div className="mb-3">
        <h2 className="t-h2 flex items-center gap-2">
          {meta.title}
          <span className="tabular rounded-full bg-sunken px-2 py-0.5 text-[12px] font-normal text-ink-2">
            {items.length}
          </span>
        </h2>
        <p className="t-meta text-[12.5px]">{meta.blurb}</p>
      </div>

      {items.length === 0 ? (
        <p className="card px-4 py-3 text-[13px] text-ink-3">Nothing in this category right now.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i, n) => (
            <li key={`${i.customer_id}-${n}`} className={`card border-l-[3px] p-3.5 ${TONE_CLASS[meta.tone]}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/customers/${i.customer_id}`}
                      className="text-[13.5px] font-medium hover:text-brand hover:underline"
                    >
                      {i.title}
                    </Link>
                    {i.value != null && <Badge>{moneyShort(i.value)}</Badge>}
                  </div>

                  {i.why.filter(Boolean).length > 0 && (
                    <div className="mt-1.5">
                      <span className="t-label">Why</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {i.why.filter(Boolean).map((w) => (
                          <li key={w} className="text-[12.5px] text-ink-2">
                            • {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-2 flex items-start gap-1.5">
                    <span className="text-ai">✦</span>
                    <p className="text-[12.5px] leading-5 text-ai">{i.recommendation}</p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => openGenerator({ customerId: i.customer_id })}
                    className="focus-ring rounded-[6px] border border-ai-line bg-ai-tint px-2 py-1 text-[12px] font-medium text-ai hover:brightness-95"
                  >
                    ✦ Draft
                  </button>
                  <Link
                    href={`/customers/${i.customer_id}`}
                    className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-sunken"
                  >
                    Open
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
