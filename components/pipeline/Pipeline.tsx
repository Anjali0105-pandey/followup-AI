"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { OpportunityView } from "@/lib/repo/opportunities";
import type { Stage } from "@/lib/types";
import { STAGES, STAGE_LABEL } from "@/lib/types";
import { money, moneyShort } from "@/lib/format";
import { relativePast } from "@/lib/dates";
import { PriorityChip, Badge, Avatar } from "@/components/ui";
import { moveStageAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";
import { useGenerator } from "@/components/generator/GeneratorProvider";

const HEALTH_DOT: Record<string, string> = {
  healthy: "bg-positive",
  watch: "bg-attention",
  at_risk: "bg-risk",
};

export default function Pipeline({ opportunities }: { opportunities: OpportunityView[] }) {
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [items, setItems] = useState(opportunities);
  const [dragging, setDragging] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function move(id: number, stage: Stage) {
    const opp = items.find((o) => o.id === id);
    if (!opp || opp.stage === stage) return;
    const previous = opp.stage;

    // Optimistic: the card lands in the new column immediately, and the
    // server call reconciles (and re-scores) behind it.
    setItems((list) => list.map((o) => (o.id === id ? { ...o, stage } : o)));
    startTransition(async () => {
      await moveStageAction(id, stage);
      toast(`${opp.company} moved to ${STAGE_LABEL[stage]}`, {
        undo: () => {
          setItems((list) => list.map((o) => (o.id === id ? { ...o, stage: previous } : o)));
          startTransition(() => void moveStageAction(id, previous));
        },
      });
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-0.5 rounded-[7px] border border-line bg-card p-0.5">
          {(["kanban", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`focus-ring rounded-[5px] px-2.5 py-1 text-[12.5px] capitalize transition-colors ${
                view === v ? "bg-brand-tint font-medium text-brand" : "text-ink-2 hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="t-meta text-[12px]">Drag a card to change stage — probability and priority update automatically.</p>
      </div>

      {view === "kanban" ? (
        <div className="thin-scroll -mx-4 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8">
          <div className="flex gap-3">
            {STAGES.map((stage) => {
              const cards = items.filter((o) => o.stage === stage);
              const total = cards.reduce((s, o) => s + o.value, 0);
              return (
                <div
                  key={stage}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging != null) move(dragging, stage);
                    setDragging(null);
                  }}
                  className="flex w-[248px] shrink-0 flex-col rounded-[10px] bg-sunken/60 p-2"
                >
                  <div className="mb-2 flex items-baseline justify-between px-1.5">
                    <span className="t-label">{STAGE_LABEL[stage]}</span>
                    <span className="tabular text-[11px] text-ink-3">
                      {cards.length} · {moneyShort(total)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {cards.map((o) => (
                      <Card key={o.id} opp={o} onDragStart={() => setDragging(o.id)} />
                    ))}
                    {cards.length === 0 && (
                      <p className="px-1.5 py-3 text-[12px] text-ink-3">Nothing at this stage</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ListView items={items} onMove={move} />
      )}
    </>
  );
}

function Card({ opp, onDragStart }: { opp: OpportunityView; onDragStart: () => void }) {
  const { openGenerator } = useGenerator();
  const stale = opp.days_inactive != null && opp.days_inactive >= 10;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="card card-interactive cursor-grab p-2.5 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/customers/${opp.customer_id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT[opp.health] ?? "bg-line"}`} title={opp.health} />
            <span className="truncate text-[13px] font-medium hover:text-brand">{opp.company}</span>
          </div>
        </Link>
        <span className="tabular shrink-0 text-[13px] font-semibold">{moneyShort(opp.value)}</span>
      </div>

      {opp.contact_name && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Avatar name={opp.contact_name} size={18} />
          <span className="t-meta truncate text-[11.5px]">{opp.contact_name}</span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityChip band={opp.priority_band} reasons={opp.priority_reasons} />
        <span className="t-meta text-[11px]">{opp.probability}%</span>
        {stale && <Badge tone="attention">{opp.days_inactive}d quiet</Badge>}
      </div>

      <div className="mt-2 border-t border-line-soft pt-2">
        {opp.next_action ? (
          <p className="truncate text-[11.5px] text-ink-2">Next: {opp.next_action}</p>
        ) : (
          <p className="text-[11.5px] text-attention">No next step</p>
        )}
        <button
          onClick={() => openGenerator({ customerId: opp.customer_id })}
          className="mt-1.5 text-[11.5px] font-medium text-ai hover:underline"
        >
          ✦ Draft follow-up
        </button>
      </div>
    </div>
  );
}

function ListView({ items, onMove }: { items: OpportunityView[]; onMove: (id: number, s: Stage) => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_100px_130px_80px_110px_120px] gap-3 border-b border-line bg-sunken/50 px-4 py-2 lg:grid">
        {["Company", "Contact", "Value", "Stage", "Prob.", "Last touch", "Priority"].map((h) => (
          <span key={h} className="t-label">
            {h}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-line-soft">
        {items.map((o) => (
          <li
            key={o.id}
            className="grid gap-2 px-4 py-2.5 hover:bg-sunken/40 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_100px_130px_80px_110px_120px] lg:items-center lg:gap-3"
          >
            <Link href={`/customers/${o.customer_id}`} className="min-w-0">
              <p className="truncate text-[13.5px] font-medium hover:text-brand">{o.company}</p>
              <p className="t-meta truncate text-[12px]">{o.name}</p>
            </Link>
            <span className="t-meta truncate text-[12.5px]">{o.contact_name ?? "—"}</span>
            <span className="tabular text-[13px] font-medium">{money(o.value)}</span>
            <select
              value={o.stage}
              onChange={(e) => onMove(o.id, e.target.value as Stage)}
              className="focus-ring h-7 rounded-[6px] border border-line bg-card px-1.5 text-[12.5px]"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            <span className="tabular text-[12.5px] text-ink-2">{o.probability}%</span>
            <span className="t-meta text-[12.5px]">{relativePast(o.last_interaction_at)}</span>
            <PriorityChip band={o.priority_band} score={o.priority_score} reasons={o.priority_reasons} />
          </li>
        ))}
      </ul>
    </div>
  );
}
