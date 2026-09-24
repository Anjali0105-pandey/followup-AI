import Link from "next/link";
import { headlineCounts, listCommitments, priorityFeed } from "@/lib/repo/commitments";
import { computeInsights } from "@/lib/repo/insights";
import { listOpportunities } from "@/lib/repo/opportunities";
import { currentDay, currentUser } from "@/lib/repo/workspace";
import { SectionTitle, EmptyState, Badge, AiMark } from "@/components/ui";
import PriorityFeed from "@/components/feed/PriorityFeed";
import AiBriefing from "@/components/dashboard/AiBriefing";
import KpiCard, { type KpiTrend } from "@/components/dashboard/KpiCard";
import { moneyShort } from "@/lib/format";
import { daysBetween, relativeDue, relativePast } from "@/lib/dates";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const INSIGHT_LABEL: Record<string, string> = {
  buying_signal: "Buying signal",
  unanswered_question: "Unanswered question",
  going_cold: "Going cold",
  missed_followup: "Missed follow-up",
  no_next_step: "No next step",
  waiting_on_us: "Waiting on us",
  at_risk: "At risk",
  hot: "Hot",
};

const INSIGHT_TONE: Record<string, "risk" | "attention" | "positive" | "ai"> = {
  buying_signal: "positive",
  hot: "positive",
  unanswered_question: "attention",
  waiting_on_us: "attention",
  no_next_step: "attention",
  going_cold: "risk",
  missed_followup: "risk",
  at_risk: "risk",
};

export default async function CommandCenter() {
  // One round of parallel reads rather than ten sequential trips to Neon.
  // `t` is the rep's own day, not the server's — see currentDay().
  const [t, user, counts, feed, insights, opportunities, upcoming, waiting, todayItems, overdueItems] =
    await Promise.all([
      currentDay(),
      currentUser(),
      headlineCounts(),
      priorityFeed(8),
      computeInsights(),
      listOpportunities(),
      listCommitments({ owner: "me", tab: "upcoming" }),
      listCommitments({ owner: "customer", tab: "waiting" }),
      listCommitments({ owner: "me", tab: "today" }),
      listCommitments({ owner: "me", tab: "overdue" }),
    ]);

  const hot = opportunities
    .filter((o) => o.stage !== "won" && o.stage !== "lost")
    .filter((o) => insights.hot.some((h) => h.opportunity_id === o.id))
    .slice(0, 4);
  const atRisk = insights.at_risk.slice(0, 4);
  const recentlyWon = opportunities.filter((o) => o.stage === "won").slice(0, 3);

  /* Trend chips are derived from the data actually in the database — severity
     and exposure, not invented week-over-week deltas. There are no historical
     snapshots to compare against, so a percentage here would be fiction. */
  const urgentToday = todayItems.filter(
    (c) => c.priority_band === "critical" || c.priority_band === "high",
  ).length;
  const worstOverdue = overdueItems.reduce(
    (max, c) => Math.max(max, daysBetween(c.due_date, t)),
    0,
  );
  const atRiskValue = insights.at_risk.reduce((sum, i) => sum + (i.value ?? 0), 0);
  const hotValue = insights.hot.reduce((sum, i) => sum + (i.value ?? 0), 0);
  const openQuestions = insights.unanswered_question.length;

  const trendToday: KpiTrend | undefined =
    urgentToday > 0 ? { direction: "up", label: `${urgentToday} urgent` } : undefined;
  const trendOverdue: KpiTrend | undefined =
    worstOverdue > 0 ? { direction: "up", label: `${worstOverdue}d worst` } : undefined;
  const trendAtRisk: KpiTrend | undefined =
    atRiskValue > 0 ? { direction: "down", label: moneyShort(atRiskValue) } : undefined;
  const trendHot: KpiTrend | undefined =
    hotValue > 0 ? { direction: "up", label: moneyShort(hotValue) } : undefined;
  const trendWaiting: KpiTrend | undefined =
    openQuestions > 0 ? { direction: "up", label: `${openQuestions} open` } : undefined;

  // One line that frames the whole day, built from what is actually true.
  const framing = [
    counts.overdue > 0 ? `${pluralize(counts.overdue, "thing")} overdue` : null,
    insights.going_cold.length > 0 ? `${insights.going_cold.length} deals went quiet` : null,
    insights.buying_signal.length > 0 ? `${insights.buying_signal.length} buying signals this week` : null,
  ].filter((s): s is string => Boolean(s));

  /* Machine-detected findings across every lens, most severe first, so the rep
     sees what the model noticed without opening the Insights page. Hot and
     at-risk are excluded — they already have their own panels. */
  const SEVERITY_RANK = { risk: 0, attention: 1, info: 2 } as const;
  const detected = Object.values(insights)
    .flat()
    .filter((i) => i.category !== "hot" && i.category !== "at_risk")
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.value ?? 0) - (a.value ?? 0),
    )
    .slice(0, 4);

  return (
    <>
      <AiBriefing
        firstName={user.firstName}
        greeting={greeting()}
        attentionCount={counts.todayActions}
        framing={framing}
        actions={feed.slice(0, 3).map((f) => f.lead)}
        today={t}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Today" value={counts.todayActions} hint="actions due" href="/followups?tab=today" trend={trendToday} delay={0} />
        <KpiCard label="Overdue" value={counts.overdue} tone={counts.overdue ? "risk" : "neutral"} hint="past promised date" href="/followups?tab=overdue" trend={trendOverdue} delay={50} />
        <KpiCard label="At risk" value={counts.atRisk} tone={counts.atRisk ? "attention" : "neutral"} hint="deals showing risk" href="/insights#at_risk" trend={trendAtRisk} delay={100} />
        <KpiCard label="Hot" value={counts.hot} tone={counts.hot ? "positive" : "neutral"} hint="buying signals" href="/insights#hot" trend={trendHot} delay={150} />
        <KpiCard label="Waiting on you" value={counts.waitingOnYou} tone={counts.waitingOnYou ? "attention" : "neutral"} hint="unanswered customers" href="/insights#waiting_on_us" trend={trendWaiting} delay={200} />
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <SectionTitle
            aside={
              <span className="t-meta hidden text-[12px] sm:inline">
                <kbd>J</kbd> <kbd>K</kbd> to move · <kbd>?</kbd> for shortcuts
              </span>
            }
          >
            <span className="flex items-center gap-1.5">
              <AiMark /> Your priorities
            </span>
          </SectionTitle>

          {feed.length > 0 ? (
            <PriorityFeed items={feed} />
          ) : (
            /* An empty state that still tells the rep what is coming, rather
               than a blank page congratulating them. */
            <EmptyState title="You're all caught up 🎉" body="Nothing needs your attention right now.">
              <div className="mx-auto max-w-sm space-y-2 text-left">
                <UpcomingLine count={upcoming.length} label="follow-ups scheduled" href="/followups?tab=upcoming" />
                <UpcomingLine count={waiting.length} label="items waiting on customers" href="/commitments?tab=theirs" />
                <UpcomingLine count={insights.no_next_step.length} label="opportunities with no next step" href="/insights#no_next_step" />
              </div>
            </EmptyState>
          )}

          {detected.length > 0 && (
            <section className="mt-8">
              <SectionTitle>
                <span className="flex items-center gap-1.5">
                  <AiMark /> Recently detected AI insights
                </span>
              </SectionTitle>
              <ul className="grid gap-3 sm:grid-cols-2">
                {detected.map((i, idx) => (
                  <li
                    key={`${i.category}-${i.opportunity_id ?? i.customer_id}`}
                    style={{ animationDelay: `${idx * 60}ms` }}
                    className="card card-interactive card-interactive-ai anim-rise min-w-0"
                  >
                    <Link href={`/customers/${i.customer_id}`} className="focus-ring block p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-[13.5px] font-medium">{i.company}</span>
                        <Badge tone={INSIGHT_TONE[i.category] ?? "ai"}>
                          {INSIGHT_LABEL[i.category] ?? i.category}
                        </Badge>
                      </div>
                      {i.why[0] && (
                        <p className="t-meta mt-1.5 text-[12.5px] leading-[1.35rem]">{i.why[0]}</p>
                      )}
                      {i.value != null && (
                        <p className="t-meta tabular mt-1 text-[12px] text-ink-3">{moneyShort(i.value)}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <Panel title="Hot deals" href="/insights#hot" emptyLabel="No active buying signals." delay={0}>
            {hot.map((o) => (
              <Link key={o.id} href={`/customers/${o.customer_id}`} className="block rounded-[7px] px-2 py-2 transition-colors hover:bg-sunken">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{o.company}</span>
                  <span className="tabular shrink-0 text-[13px] text-positive">{moneyShort(o.value)}</span>
                </div>
                <p className="t-meta truncate text-[12px]">
                  {o.contact_name ?? "No contact"} · {o.probability}% · {o.stage}
                </p>
              </Link>
            ))}
          </Panel>

          <Panel title="At risk deals" href="/insights#at_risk" emptyLabel="Nothing flagged at risk." delay={60}>
            {atRisk.map((i) => (
              <Link key={i.opportunity_id ?? i.customer_id} href={`/customers/${i.customer_id}`} className="block rounded-[7px] px-2 py-2 transition-colors hover:bg-sunken">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{i.company}</span>
                  <span className="tabular shrink-0 text-[13px] text-risk">{moneyShort(i.value)}</span>
                </div>
                <p className="t-meta truncate text-[12px]">{i.why[0]}</p>
              </Link>
            ))}
          </Panel>

          <Panel title="Upcoming commitments" href="/followups?tab=upcoming" emptyLabel="Nothing scheduled ahead." delay={120}>
            {upcoming.slice(0, 4).map((c) => (
              <Link key={c.id} href={`/customers/${c.customer_id}`} className="block rounded-[7px] px-2 py-2 transition-colors hover:bg-sunken">
                <p className="truncate text-[13px] font-medium">{c.title}</p>
                <p className="t-meta truncate text-[12px]">
                  {c.company} · {relativeDue(c.due_date, t)}
                </p>
              </Link>
            ))}
          </Panel>

          <Panel title="Waiting on customer" href="/commitments?tab=theirs" emptyLabel="Nothing outstanding with customers." delay={180}>
            {waiting.slice(0, 4).map((c) => (
              <Link key={c.id} href={`/customers/${c.customer_id}`} className="block rounded-[7px] px-2 py-2 transition-colors hover:bg-sunken">
                <p className="truncate text-[13px] font-medium">{c.title}</p>
                <p className="t-meta truncate text-[12px]">
                  {c.company} · {relativeDue(c.due_date, t)}
                </p>
              </Link>
            ))}
          </Panel>

          {recentlyWon.length > 0 && (
            <Panel title="Recently won" emptyLabel="" delay={240}>
              {recentlyWon.map((o) => (
                <Link key={o.id} href={`/customers/${o.customer_id}`} className="block rounded-[7px] px-2 py-2 transition-colors hover:bg-sunken">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{o.company}</span>
                    <Badge tone="positive">{moneyShort(o.value)}</Badge>
                  </div>
                  <p className="t-meta text-[12px]">Closed {relativePast(o.last_interaction_at, t)}</p>
                </Link>
              ))}
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function Panel({
  title,
  href,
  emptyLabel,
  delay = 0,
  children,
}: {
  title: string;
  href?: string;
  emptyLabel: string;
  delay?: number;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="card card-interactive anim-rise p-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1.5 flex items-baseline justify-between px-2">
        <h3 className="t-label">{title}</h3>
        {href && (
          <Link href={href} className="text-[11px] text-brand hover:underline">
            View all
          </Link>
        )}
      </div>
      {items.length > 0 ? <div className="space-y-0.5">{items}</div> : <p className="t-meta px-2 py-1 text-[12px]">{emptyLabel}</p>}
    </div>
  );
}

function UpcomingLine({ count, label, href }: { count: number; label: string; href: string }) {
  if (count === 0) return null;
  return (
    <Link href={href} className="flex items-center justify-between rounded-[7px] border border-line px-3 py-2 text-[13px] hover:bg-sunken">
      <span>
        <span className="tabular font-semibold">{count}</span> {label}
      </span>
      <span className="text-brand">→</span>
    </Link>
  );
}
