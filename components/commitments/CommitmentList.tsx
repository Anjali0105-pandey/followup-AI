"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { CommitmentView } from "@/lib/types";
import { COMMITMENT_KIND_LABEL } from "@/lib/types";
import { BAND_BAR, PriorityChip, Badge } from "@/components/ui";
import { moneyShort } from "@/lib/format";
import { relativeDue, relativePast, today, DUE_BUCKET_ORDER, dueBucket } from "@/lib/dates";
import {
  completeCommitmentAction,
  deleteCommitmentAction,
  reopenCommitmentAction,
  rescheduleCommitmentAction,
  snoozeCommitmentAction,
} from "@/app/actions";
import { useToast } from "@/components/shell/Toast";
import { useGenerator } from "@/components/generator/GeneratorProvider";

/**
 * Dense list used by both Follow-ups and Commitments. Rows collapse to the
 * essentials and expand to show the AI reasoning — the reason a row is ranked
 * where it is must always be one click away, never hidden entirely.
 */
export default function CommitmentList({
  items,
  groupByDue = false,
  showOwner = false,
}: {
  items: CommitmentView[];
  groupByDue?: boolean;
  showOwner?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const visible = items.filter((i) => !hidden.has(i.id));

  if (!groupByDue) {
    return <Rows items={visible} hide={setHidden} showOwner={showOwner} />;
  }

  const groups = DUE_BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: visible.filter((i) => dueBucket(i.due_date) === bucket),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.bucket}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className={`t-label ${g.bucket === "Overdue" ? "text-risk" : ""}`}>{g.bucket}</h3>
            <span className="tabular text-[11px] text-ink-3">{g.rows.length}</span>
          </div>
          <Rows items={g.rows} hide={setHidden} showOwner={showOwner} />
        </div>
      ))}
    </div>
  );
}

function Rows({
  items,
  hide,
  showOwner,
}: {
  items: CommitmentView[];
  hide: React.Dispatch<React.SetStateAction<Set<number>>>;
  showOwner: boolean;
}) {
  return (
    <ul className="card divide-y divide-line-soft overflow-hidden">
      {items.map((item) => (
        <Row key={item.id} item={item} hide={hide} showOwner={showOwner} />
      ))}
    </ul>
  );
}

function Row({
  item,
  hide,
  showOwner,
}: {
  item: CommitmentView;
  hide: React.Dispatch<React.SetStateAction<Set<number>>>;
  showOwner: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const { openGenerator } = useGenerator();

  const overdue = item.status !== "done" && item.due_date < today();
  const done = item.status === "done";

  const remove = () => hide((s) => new Set(s).add(item.id));
  const restore = () =>
    hide((s) => {
      const n = new Set(s);
      n.delete(item.id);
      return n;
    });

  return (
    <li className={`relative transition-colors hover:bg-sunken/40 ${done ? "opacity-60" : ""}`}>
      <span className={`absolute left-0 top-0 h-full w-[3px] ${BAND_BAR[item.priority_band]}`} />
      <div className="grid min-w-0 gap-3 py-3 pl-4 pr-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <button onClick={() => setExpanded((e) => !e)} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[13.5px] font-medium ${done ? "line-through" : ""}`}>{item.title}</span>
            <Badge>{COMMITMENT_KIND_LABEL[item.kind]}</Badge>
            {showOwner && <Badge tone={item.owner === "me" ? "brand" : "neutral"}>{item.owner === "me" ? "You owe" : "They owe"}</Badge>}
            {item.source === "ai_extracted" && (
              <span title="Created automatically from a meeting" className="text-[11px] text-ai">
                ✦ auto
              </span>
            )}
          </div>
          <div className="t-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
            <span className="font-medium text-ink-2">{item.company}</span>
            {item.contact_name && <span>· {item.contact_name}</span>}
            {item.opportunity_value != null && <span className="tabular">· {moneyShort(item.opportunity_value)}</span>}
            {item.opportunity_stage && <span>· {item.opportunity_stage}</span>}
            <span>· last touch {relativePast(item.last_interaction_at)}</span>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <PriorityChip band={item.priority_band} score={item.priority_score} reasons={item.priority_reasons} />
          <span className={`tabular w-[104px] text-[12.5px] ${overdue ? "font-medium text-risk" : "text-ink-2"} md:text-right`}>
            {relativeDue(item.due_date)}
          </span>

          {done ? (
            <button
              onClick={() => startTransition(() => void reopenCommitmentAction(item.id))}
              className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-sunken"
            >
              Reopen
            </button>
          ) : (
            <>
              <button
                onClick={() => openGenerator({ commitmentId: item.id, customerId: item.customer_id })}
                title="Generate follow-up"
                className="focus-ring rounded-[6px] border border-ai-line bg-ai-tint px-2 py-1 text-[12px] font-medium text-ai hover:brightness-95"
              >
                ✦ Draft
              </button>
              <button
                onClick={() => {
                  remove();
                  startTransition(async () => {
                    await completeCommitmentAction(item.id);
                    toast(`Done — ${item.title}`, {
                      tone: "positive",
                      undo: () => {
                        restore();
                        startTransition(() => void reopenCommitmentAction(item.id));
                      },
                    });
                  });
                }}
                className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-sunken"
              >
                Done
              </button>
              <RowMenu item={item} onAct={remove} onUndo={restore} />
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="anim-in grid gap-3 border-t border-line-soft bg-sunken/30 px-4 py-3 pl-5 md:grid-cols-2">
          <div>
            <div className="t-label mb-1">Why it&apos;s ranked here</div>
            {item.priority_reasons.length > 0 ? (
              <ul className="space-y-0.5">
                {item.priority_reasons.map((r) => (
                  <li key={r} className="text-[12.5px] text-ink-2">
                    • {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta text-[12.5px]">No opportunity linked, so this is ranked by due date only.</p>
            )}
            {item.detail && (
              <>
                <div className="t-label mb-1 mt-3">Detail</div>
                <p className="text-[12.5px] text-ink-2">{item.detail}</p>
              </>
            )}
          </div>
          <div>
            {item.ai_recommendation && (
              <div className="ai-block px-3 py-2">
                <div className="t-label mb-0.5 text-ai">✦ Recommended action</div>
                <p className="text-[12.5px] leading-5">{item.ai_recommendation}</p>
              </div>
            )}
            <Link
              href={`/customers/${item.customer_id}`}
              className="mt-2 inline-block text-[12.5px] text-brand hover:underline"
            >
              Open {item.company} →
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function RowMenu({
  item,
  onAct,
  onUndo,
}: {
  item: CommitmentView;
  onAct: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const snooze = (days: number) => {
    setOpen(false);
    onAct();
    startTransition(async () => {
      await snoozeCommitmentAction(item.id, days);
      toast(`Snoozed ${days} day${days === 1 ? "" : "s"}`, { undo: onUndo });
    });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="focus-ring rounded-[6px] border border-line px-1.5 py-1 text-[12px] text-ink-2 hover:bg-sunken"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="anim-in absolute right-0 top-full z-20 mt-1 w-44 rounded-[8px] border border-line bg-card py-1 shadow-[var(--shadow-overlay)]">
            <div className="t-label px-3 py-1">Snooze</div>
            {[
              [1, "Tomorrow"],
              [3, "In 3 days"],
              [7, "Next week"],
            ].map(([d, label]) => (
              <button key={d} onClick={() => snooze(d as number)} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-sunken">
                {label}
              </button>
            ))}
            <div className="my-1 h-px bg-line-soft" />
            <label className="block px-3 py-1.5 text-[13px] hover:bg-sunken">
              Reschedule…
              <input
                type="date"
                defaultValue={item.due_date}
                onChange={(e) => {
                  const date = e.target.value;
                  setOpen(false);
                  startTransition(async () => {
                    await rescheduleCommitmentAction(item.id, date);
                    toast(`Moved to ${date}`);
                  });
                }}
                className="mt-1 w-full rounded border border-line px-1.5 py-1 text-[12px]"
              />
            </label>
            <div className="my-1 h-px bg-line-soft" />
            <Link href={`/customers/${item.customer_id}`} className="block px-3 py-1.5 text-[13px] hover:bg-sunken">
              Open customer
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                onAct();
                startTransition(async () => {
                  await deleteCommitmentAction(item.id);
                  toast("Deleted", { tone: "risk" });
                });
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-risk hover:bg-risk-tint"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
