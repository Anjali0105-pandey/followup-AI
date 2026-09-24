import Link from "next/link";
import type { CommitmentView } from "@/lib/types";
import { AiMark, PriorityChip } from "@/components/ui";
import { relativeDue } from "@/lib/dates";
import { money, pluralize } from "@/lib/format";

/**
 * The briefing answers "what should I do today, and why?" above the fold.
 * It reuses the same priority feed the rest of the Command Center runs on —
 * the top three leads, with the model's reasoning attached to each, because a
 * ranked action without its reason is not actionable.
 */
export default function AiBriefing({
  firstName,
  greeting,
  attentionCount,
  framing,
  actions,
  today: t,
}: {
  firstName: string;
  greeting: string;
  attentionCount: number;
  framing: string[];
  actions: CommitmentView[];
  /* Passed in rather than derived: this renders on the server, where the
     clock is UTC and would disagree with the rep's own day. */
  today: string;
}) {

  return (
    <section className="ai-briefing anim-rise mb-6 overflow-hidden">
      <div className="border-b border-ai-line/70 px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="t-display">
            {greeting}, {firstName}
          </h1>
          <span aria-hidden className="text-[22px]">
            👋
          </span>
        </div>

        <p className="t-body mt-1.5 text-ink-2">
          {attentionCount > 0 ? (
            <>
              You have{" "}
              <span className="font-semibold text-ink">
                {pluralize(attentionCount, "thing")}
              </span>{" "}
              that need your attention today.
            </>
          ) : (
            <>Nothing is demanding your attention today.</>
          )}
          {framing.length > 0 && <span className="text-ink-3"> {framing.join(" · ")}.</span>}
        </p>
      </div>

      {actions.length > 0 && (
        <div className="px-5 py-4 sm:px-6">
          <div className="t-label mb-3 flex items-center gap-1.5 text-ai">
            <AiMark /> Top {actions.length === 1 ? "recommendation" : `${actions.length} recommendations`}
          </div>

          <ol className="grid gap-3 lg:grid-cols-3">
            {actions.map((item, i) => {
              const overdue = item.due_date < t;
              const why = item.ai_insight ?? item.priority_reasons[0] ?? null;

              return (
                <li
                  key={item.id}
                  style={{ animationDelay: `${80 + i * 70}ms` }}
                  className="card card-interactive card-interactive-ai anim-rise flex min-w-0 flex-col gap-2.5 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/customers/${item.customer_id}`}
                      className="focus-ring min-w-0 rounded font-semibold hover:text-brand hover:underline"
                    >
                      <span aria-hidden>{overdue ? "🔥 " : ""}</span>
                      <span className="break-words">{item.company}</span>
                    </Link>
                    <span className="shrink-0">
                      <PriorityChip
                        band={item.priority_band}
                        score={item.priority_score}
                        reasons={item.priority_reasons}
                      />
                    </span>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium leading-5">{item.title}</p>
                    <p className={`t-meta mt-0.5 text-[12px] ${overdue ? "text-risk" : ""}`}>
                      Due {relativeDue(item.due_date, t).toLowerCase()}
                      {item.opportunity_value != null && (
                        <span className="text-ink-3"> · {money(item.opportunity_value)}</span>
                      )}
                    </p>
                  </div>

                  {why && (
                    <div className="ai-block mt-auto px-2.5 py-2">
                      <div className="t-label mb-0.5 flex items-center gap-1 text-ai">
                        <AiMark /> Why
                      </div>
                      <p className="text-[12.5px] leading-[1.35rem]">{why}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
