import { listCommitments } from "@/lib/repo/commitments";
import { PageHeader, EmptyState, AiMark } from "@/components/ui";
import CommitmentList from "@/components/commitments/CommitmentList";
import { Tabs } from "@/components/commitments/FilterBar";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Salespeople don't only forget follow-ups — they forget *promises*, in both
 * directions. Splitting "you owe" from "they owe" is the whole feature: the
 * second half is the one no CRM tracks and the one that quietly kills deals.
 */
export default async function CommitmentsPage(props: PageProps<"/commitments">) {
  const sp = await props.searchParams;
  const tab = ((Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) as string) ?? "owed";

  const [mine, theirs, done] = await Promise.all([
    listCommitments({ owner: "me", tab: "open" }),
    listCommitments({ owner: "customer", tab: "open" }),
    listCommitments({ tab: "completed" }),
  ]);

  const active = tab === "theirs" ? theirs : tab === "done" ? done : mine;

  const overdueMine = mine.filter((c) => c.due_date < new Date().toISOString().slice(0, 10)).length;

  return (
    <>
      <PageHeader
        title="Commitments"
        subtitle="Every promise made in either direction, with a date attached. Nothing here was typed twice — it comes out of your meetings."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="You owe" value={mine.length} hint={overdueMine ? `${overdueMine} past due` : "all on schedule"} tone={overdueMine ? "risk" : "neutral"} />
        <SummaryCard label="Customer owes" value={theirs.length} hint="waiting on them" tone="neutral" />
        <SummaryCard label="Kept" value={done.length} hint="completed commitments" tone="positive" />
      </div>

      <Tabs
        tabs={[
          { key: "owed", label: "You owe", count: mine.length },
          { key: "theirs", label: "Customer owes", count: theirs.length },
          { key: "done", label: "Completed", count: done.length },
        ]}
      />

      <div className="pt-4">
        {tab === "theirs" && theirs.length > 0 && (
          <div className="ai-block mb-4 px-3 py-2.5">
            <div className="t-label mb-0.5 text-ai">
              <AiMark /> Why this list matters
            </div>
            <p className="text-[13px] leading-5">
              {pluralize(theirs.length, "commitment")} sitting with customers. A promise they made and forgot is not a
              lost deal yet — but it becomes one silently. Nudge, don&apos;t wait.
            </p>
          </div>
        )}

        {active.length > 0 ? (
          <CommitmentList items={active} groupByDue={tab !== "done"} showOwner={tab === "done"} />
        ) : (
          <EmptyState
            title={tab === "theirs" ? "Nothing sitting with customers" : "No open commitments"}
            body={
              tab === "theirs"
                ? "Every ball is in your court. Check the You owe tab."
                : "You've delivered everything you promised."
            }
          />
        )}
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "neutral" | "risk" | "positive";
}) {
  const color = tone === "risk" ? "text-risk" : tone === "positive" ? "text-positive" : "text-ink";
  return (
    <div className="card px-4 py-3.5">
      <div className="t-label">{label}</div>
      <div className={`tabular mt-1 text-[26px] font-semibold leading-none ${color}`}>{value}</div>
      <div className="t-meta mt-1.5 text-[12px]">{hint}</div>
    </div>
  );
}
