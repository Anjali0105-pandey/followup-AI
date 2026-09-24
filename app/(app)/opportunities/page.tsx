import Link from "next/link";
import { listOpportunities } from "@/lib/repo/opportunities";
import { PageHeader, EmptyState } from "@/components/ui";
import Pipeline from "@/components/pipeline/Pipeline";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const opportunities = await listOpportunities();
  const open = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const openValue = open.reduce((s, o) => s + o.value, 0);
  const weighted = open.reduce((s, o) => s + (o.value * o.probability) / 100, 0);

  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle={`${open.length} open · ${money(openValue)} pipeline · ${money(weighted)} weighted`}
      />
      {opportunities.length === 0 ? (
        /* A deal belongs to an account, so the way in is an account page —
           pointing there beats a picker that duplicates the same choice. */
        <EmptyState
          title="No deals yet"
          body="Deals live on an account. Open one and add a deal there — it will appear on this board straight away."
        >
          <Link
            href="/customers"
            className="focus-ring inline-block rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover"
          >
            Go to accounts
          </Link>
        </EmptyState>
      ) : (
        <Pipeline opportunities={opportunities} />
      )}
    </>
  );
}
