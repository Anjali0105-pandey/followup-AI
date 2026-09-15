import Link from "next/link";
import { listCustomers } from "@/lib/repo/customers";
import { PageHeader, PriorityChip, HealthPill, Avatar, Badge } from "@/components/ui";
import { money } from "@/lib/format";
import { relativeDue, relativePast } from "@/lib/dates";
import type { PriorityBand, Stage } from "@/lib/types";
import { STAGE_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CustomersPage(props: PageProps<"/customers">) {
  const sp = await props.searchParams;
  const q = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) as string | undefined)?.toLowerCase() ?? "";

  const all = await listCustomers();
  const customers = q
    ? all.filter((c) => `${c.company} ${c.name} ${c.industry ?? ""}`.toLowerCase().includes(q))
    : all;

  const totalOpen = customers.reduce((sum, c) => sum + c.open_value, 0);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} accounts · ${money(totalOpen)} in open pipeline`}
        actions={
          <form className="contents">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search accounts…"
              className="focus-ring h-8 w-56 rounded-[7px] border border-line bg-card px-2.5 text-[13px] outline-none placeholder:text-ink-3"
            />
          </form>
        }
      />

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_110px_110px_120px_130px] gap-3 border-b border-line bg-sunken/50 px-4 py-2 lg:grid">
          <span className="t-label">Account</span>
          <span className="t-label">Decision maker</span>
          <span className="t-label text-right">Open value</span>
          <span className="t-label">Stage</span>
          <span className="t-label">Last touch</span>
          <span className="t-label">Next action</span>
        </div>

        <ul className="divide-y divide-line-soft">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.id}`}
                className="grid gap-2 px-4 py-3 transition-colors hover:bg-sunken/40 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_110px_110px_120px_130px] lg:items-center lg:gap-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={c.company} size={30} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium">{c.company}</span>
                      <HealthPill health={c.health} />
                    </div>
                    <p className="t-meta truncate text-[12px]">
                      {c.industry}
                      {c.segment ? ` · ${c.segment}` : ""}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  {c.primary_contact ? (
                    <>
                      <p className="truncate text-[13px]">{c.primary_contact}</p>
                      <p className="t-meta truncate text-[12px]">{c.contact_role}</p>
                    </>
                  ) : (
                    <p className="t-meta text-[12px]">No contact recorded</p>
                  )}
                </div>

                <span className="tabular text-[13px] font-medium lg:text-right">{money(c.open_value)}</span>

                <span>
                  {c.best_stage ? (
                    <Badge tone="brand">{STAGE_LABEL[c.best_stage as Stage]}</Badge>
                  ) : (
                    <span className="t-meta text-[12px]">—</span>
                  )}
                </span>

                <span className="t-meta text-[12.5px]">{relativePast(c.last_interaction_at)}</span>

                <div className="flex items-center gap-2">
                  <PriorityChip band={c.priority_band as PriorityBand} score={c.priority_score} />
                  {c.next_due && <span className="t-meta text-[12px]">{relativeDue(c.next_due)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
