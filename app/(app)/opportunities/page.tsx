import { listOpportunities } from "@/lib/repo/opportunities";
import { PageHeader } from "@/components/ui";
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
      <Pipeline opportunities={opportunities} />
    </>
  );
}
