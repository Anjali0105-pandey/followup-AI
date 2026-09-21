import { listCommitments } from "@/lib/repo/commitments";
import { listCustomers } from "@/lib/repo/customers";
import { PageHeader, EmptyState } from "@/components/ui";
import CommitmentList from "@/components/commitments/CommitmentList";
import { Filters, Tabs } from "@/components/commitments/FilterBar";
import type { PriorityBand } from "@/lib/types";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "waiting", label: "Waiting" },
  { key: "completed", label: "Completed" },
];

export default async function FollowUpsPage(props: PageProps<"/followups">) {
  const sp = await props.searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const tab = one("tab") ?? "today";

  const filter = {
    owner: tab === "waiting" ? undefined : ("me" as const),
    tab,
    priority: one("priority") as PriorityBand | undefined,
    stage: one("stage"),
    kind: one("kind"),
    customerId: one("customer") ? Number(one("customer")) : undefined,
    minValue: one("minValue") ? Number(one("minValue")) : undefined,
    search: one("q") || undefined,
  };

  // Tab counts respect the active filters, so the numbers always match what a
  // click would actually show. Every query here is independent, so they all go
  // out at once rather than as a chain of round-trips to a remote database.
  const [items, allCustomers, countEntries] = await Promise.all([
    listCommitments(filter),
    listCustomers(),
    Promise.all(
      TABS.map(async (t) => [
        t.key,
        (await listCommitments({ ...filter, tab: t.key, owner: t.key === "waiting" ? undefined : "me" })).length,
      ]),
    ),
  ]);

  const customers = allCustomers.map((c) => ({ id: c.id, company: c.company }));
  const counts = Object.fromEntries(countEntries);

  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle={`${pluralize(items.length, "follow-up")} in this view. Everything you owe a customer, ranked by what it costs you to miss.`}
      />

      <Tabs tabs={TABS.map((t) => ({ ...t, count: counts[t.key] ?? 0 }))} defaultTab="today" />
      <Filters customers={customers} />

      {items.length > 0 ? (
        <CommitmentList items={items} groupByDue={tab !== "completed"} showOwner={tab === "waiting" || tab === "all"} />
      ) : (
        <EmptyState
          title={tab === "overdue" ? "Nothing overdue" : "Nothing here"}
          body={
            tab === "overdue"
              ? "You have not missed a promised date. That is the whole point of the product working."
              : "No follow-ups match this view. Try a different tab or clear your filters."
          }
        />
      )}
    </>
  );
}
