import { computeInsights } from "@/lib/repo/insights";
import { INSIGHT_META } from "@/lib/types";
import type { InsightCategory } from "@/lib/types";
import { PageHeader, AiMark } from "@/components/ui";
import InsightSection from "@/components/insights/InsightSection";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

const ORDER: InsightCategory[] = [
  "at_risk",
  "waiting_on_us",
  "unanswered_question",
  "missed_followup",
  "going_cold",
  "no_next_step",
  "hot",
  "buying_signal",
];

export default function InsightsPage() {
  const insights = computeInsights();

  // The headline is generated from what is actually true today, not a template.
  const headlines = [
    insights.going_cold.length && `${insights.going_cold.length} opportunities are going cold.`,
    insights.waiting_on_us.length && `${pluralize(insights.waiting_on_us.length, "customer")} are waiting for something from you.`,
    insights.buying_signal.length && `${insights.buying_signal.length} buying signals were detected recently.`,
    insights.no_next_step.length && `${insights.no_next_step.length} opportunities have no scheduled next step.`,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="Patterns across your pipeline that no single screen would surface. Every item says why it's here and what to do."
      />

      {headlines.length > 0 && (
        <div className="ai-block mb-7 px-4 py-3.5">
          <div className="t-label mb-1.5 text-ai">
            <AiMark /> This week
          </div>
          <ul className="space-y-1">
            {headlines.map((h) => (
              <li key={h} className="text-[13.5px] leading-6">{h}</li>
            ))}
          </ul>
        </div>
      )}

      <nav className="mb-7 flex flex-wrap gap-1.5">
        {ORDER.map((c) => (
          <a
            key={c}
            href={`#${c}`}
            className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-brand-line hover:text-brand"
          >
            {INSIGHT_META[c].title}
            <span className="tabular ml-1.5 opacity-60">{insights[c].length}</span>
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        {ORDER.map((c) => (
          <InsightSection key={c} category={c} items={insights[c]} />
        ))}
      </div>
    </>
  );
}
