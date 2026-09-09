import Link from "next/link";
import { headlineCounts, listCommitments, priorityFeed } from "@/lib/repo/commitments";
import { computeInsights } from "@/lib/repo/insights";
import { listOpportunities } from "@/lib/repo/opportunities";
import { currentUser } from "@/lib/repo/workspace";
import { MetricCard, SectionTitle, EmptyState, Badge, AiMark } from "@/components/ui";
import PriorityFeed from "@/components/feed/PriorityFeed";
import { moneyShort } from "@/lib/format";
import { relativeDue, relativePast } from "@/lib/dates";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function CommandCenter() {
  const user = currentUser();
  const counts = headlineCounts();
  const feed = priorityFeed(8);
  const insights = computeInsights();
  const opportunities = listOpportunities();

  const upcoming = listCommitments({ owner: "me", tab: "upcoming" });
  const waiting = listCommitments({ owner: "customer", tab: "waiting" });
  const hot = opportunities
    .filter((o) => o.stage !== "won" && o.stage !== "lost")
    .filter((o) => insights.hot.some((h) => h.opportunity_id === o.id))
    .slice(0, 4);
  const atRisk = insights.at_risk.slice(0, 4);
  const recentlyWon = opportunities.filter((o) => o.stage === "won").slice(0, 3);

  // One line that frames the whole day, built from what is actually true.
  const framing = [
    counts.overdue > 0 ? `${pluralize(counts.overdue, "thing")} overdue` : null,
    insights.going_cold.length > 0 ? `${insights.going_cold.length} deals went quiet` : null,
    insights.buying_signal.length > 0 ? `${insights.buying_signal.length} buying signals this week` : null,
  ].filter(Boolean);

  return (
    <>
      <div className="mb-6">
        <h1 className="t-display">
          {greeting()}, {user.firstName}
        </h1>
        <p className="t-meta mt-1.5">
          {feed.length > 0 ? "Here's what needs your attention today." : "Nothing is demanding your attention today."}
          {framing.length > 0 && (
            <span className="text-ink-3"> {framing.join(" · ")}.</span>
          )}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Today" value={counts.todayActions} hint="actions due" href="/followups?tab=today" />
        <MetricCard label="Overdue" value={counts.overdue} tone={counts.overdue ? "risk" : "neutral"} hint="past promised date" href="/followups?tab=overdue" />
        <MetricCard label="At risk" value={counts.atRisk} tone={counts.atRisk ? "attention" : "neutral"} hint="deals showing risk" href="/insights#at_risk" />
        <MetricCard label="Hot" value={counts.hot} tone={counts.hot ? "positive" : "neutral"} hint="buying signals" href="/insights#hot" />
        <MetricCard label="Waiting on you" value={counts.waitingOnYou} tone={counts.waitingOnYou ? "attention" : "neutral"} hint="unanswered customers" href="/insights#waiting_on_us" />
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <SectionTitle
            aside={
              <span className="t-meta text-[12px]">
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
        </section>

        <aside className="min-w-0 space-y-6">
          <Panel title="Hot opportunities" href="/insights#hot" emptyLabel="No active buying signals.">
            {hot.map((o) => (
              <Link key={o.id} href={`/customers/${o.customer_id}`} className="block rounded-[7px] px-2 py-2 hover:bg-sunken">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{o.company}</span>
                  <span className="tabular shrink-0 text-[13px] text-ink-2">{moneyShort(o.value)}</span>
                </div>
                <p className="t-meta truncate text-[12px]">
                  {o.contact_name ?? "No contact"} · {o.probability}% · {o.stage}
                </p>
              </Link>
            ))}
          </Panel>

          <Panel title="Deals at risk" href="/insights#at_risk" emptyLabel="Nothing flagged at risk.">
            {atRisk.map((i) => (
              <Link key={i.opportunity_id ?? i.customer_id} href={`/customers/${i.customer_id}`} className="block rounded-[7px] px-2 py-2 hover:bg-sunken">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{i.company}</span>
                  <span className="tabular shrink-0 text-[13px] text-risk">{moneyShort(i.value)}</span>
                </div>
                <p className="t-meta truncate text-[12px]">{i.why[0]}</p>
              </Link>
            ))}
          </Panel>

          <Panel title="Waiting on customer" href="/commitments?tab=theirs" emptyLabel="Nothing outstanding with customers.">
            {waiting.slice(0, 4).map((c) => (
              <Link key={c.id} href={`/customers/${c.customer_id}`} className="block rounded-[7px] px-2 py-2 hover:bg-sunken">
                <p className="truncate text-[13px] font-medium">{c.title}</p>
                <p className="t-meta truncate text-[12px]">
                  {c.company} · {relativeDue(c.due_date)}
                </p>
              </Link>
            ))}
          </Panel>

          {recentlyWon.length > 0 && (
            <Panel title="Recently won" emptyLabel="">
              {recentlyWon.map((o) => (
                <Link key={o.id} href={`/customers/${o.customer_id}`} className="block rounded-[7px] px-2 py-2 hover:bg-sunken">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{o.company}</span>
                    <Badge tone="positive">{moneyShort(o.value)}</Badge>
                  </div>
                  <p className="t-meta text-[12px]">Closed {relativePast(o.last_interaction_at)}</p>
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
  children,
}: {
  title: string;
  href?: string;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="card p-3">
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
