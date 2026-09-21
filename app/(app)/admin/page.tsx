import { notFound } from "next/navigation";
import { getAdminOverview } from "@/lib/repo/admin";
import { currentUser } from "@/lib/repo/workspace";
import { PageHeader, Badge, MetricCard, EmptyState } from "@/components/ui";
import { moneyShort } from "@/lib/format";
import { relativePast } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  // notFound rather than a 403: a non-admin has no business learning that this
  // route exists.
  if (!user.isAdmin) notFound();

  const { totals, users } = await getAdminOverview();

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Operational metrics across every workspace. No pipeline content is shown here — only activity and volume."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Users" value={totals.users} hint="total accounts" />
        <MetricCard label="Workspaces" value={totals.workspaces} hint="tenants" />
        <MetricCard
          label="Active"
          value={totals.activeThisWeek}
          tone={totals.activeThisWeek ? "positive" : "neutral"}
          hint="in the last 7 days"
        />
        <MetricCard label="Own AI key" value={totals.withOwnKey} hint="bringing their own" />
      </div>

      {users.length === 0 ? (
        <EmptyState title="No users yet" body="Accounts appear here after their first sign-in." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>User</Th>
                <Th>Workspace</Th>
                <Th>Last active</Th>
                <Th align="right">Customers</Th>
                <Th align="right">Deals</Th>
                <Th align="right">Actions</Th>
                <Th align="right">Meetings</Th>
                <Th align="right">Pipeline</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line-soft last:border-0 hover:bg-sunken">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{u.name}</span>
                      {u.isAdmin && <Badge tone="brand">Admin</Badge>}
                      {u.hasOwnKey && <Badge tone="ai">✦ key</Badge>}
                    </div>
                    <span className="t-meta text-[12px]">{u.email || "—"}</span>
                  </Td>
                  <Td>{u.workspace}</Td>
                  <Td>
                    <span className={u.lastActiveAt ? "" : "text-ink-3"}>
                      {u.lastActiveAt ? relativePast(u.lastActiveAt) : "Never"}
                    </span>
                  </Td>
                  <Td align="right">{u.customers}</Td>
                  <Td align="right">{u.opportunities}</Td>
                  <Td align="right">{u.commitments}</Td>
                  <Td align="right">{u.meetings}</Td>
                  <Td align="right">{u.pipelineValue ? moneyShort(u.pipelineValue) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`t-label px-3 py-2 ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={`px-3 py-2.5 align-top ${align === "right" ? "tabular text-right" : ""}`}>{children}</td>;
}
