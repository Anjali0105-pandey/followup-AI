import db from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { listOpportunities } from "@/lib/repo/opportunities";
import { STAGES, STAGE_LABEL } from "@/lib/types";
import { money, moneyShort } from "@/lib/format";
import { today } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  // COUNT() arrives as a bigint string from the driver, so every aggregate is
  // cast; `due_date` is a 'YYYY-MM-DD' text column, so today is passed in as a
  // parameter rather than compared against now().
  const [opportunities, keptRow, missedRow, byChannel] = await Promise.all([
    listOpportunities(),
    db.get<{ n: number }>("SELECT COUNT(*)::int n FROM commitments WHERE owner='me' AND status='done'"),
    db.get<{ n: number }>(
      "SELECT COUNT(*)::int n FROM commitments WHERE owner='me' AND status IN ('open','snoozed') AND due_date < ?",
      today(),
    ),
    db.all<{ type: string; n: number }>(
      "SELECT type, COUNT(*)::int n FROM interactions GROUP BY type ORDER BY n DESC",
    ),
  ]);

  const open = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const kept = keptRow?.n ?? 0;
  const missed = missedRow?.n ?? 0;
  const complianceRate = kept + missed > 0 ? Math.round((kept / (kept + missed)) * 100) : 100;

  const won = opportunities.filter((o) => o.stage === "won");
  const lost = opportunities.filter((o) => o.stage === "lost");
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

  const byStage = STAGES.filter((s) => s !== "won" && s !== "lost").map((stage) => {
    const rows = open.filter((o) => o.stage === stage);
    return { stage, count: rows.length, value: rows.reduce((s, o) => s + o.value, 0) };
  });
  const maxValue = Math.max(1, ...byStage.map((b) => b.value));

  const maxChannel = Math.max(1, ...byChannel.map((c) => c.n));

  return (
    <>
      <PageHeader title="Analytics" subtitle="How well the follow-up habit is actually holding." />

      <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Commitments kept" value={`${complianceRate}%`} hint={`${kept} kept · ${missed} overdue`} tone={complianceRate >= 80 ? "positive" : "attention"} />
        <Stat label="Win rate" value={`${winRate}%`} hint={`${won.length} won · ${lost.length} lost`} />
        <Stat label="Open pipeline" value={moneyShort(open.reduce((s, o) => s + o.value, 0))} hint={`${open.length} opportunities`} />
        <Stat label="Weighted" value={moneyShort(open.reduce((s, o) => s + (o.value * o.probability) / 100, 0))} hint="by probability" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="t-h2 mb-4">Pipeline by stage</h2>
          <ul className="space-y-2.5">
            {byStage.map((b) => (
              <li key={b.stage}>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span>{STAGE_LABEL[b.stage]}</span>
                  <span className="tabular text-ink-2">
                    {b.count} · {money(b.value)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(b.value / maxValue) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="t-h2 mb-4">Activity by channel</h2>
          <ul className="space-y-2.5">
            {byChannel.map((c) => (
              <li key={c.type}>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span className="capitalize">{c.type}</span>
                  <span className="tabular text-ink-2">{c.n}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-ai" style={{ width: `${(c.n / maxChannel) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "positive" | "attention" }) {
  const color = tone === "positive" ? "text-positive" : tone === "attention" ? "text-attention" : "text-ink";
  return (
    <div className="card px-4 py-3.5">
      <div className="t-label">{label}</div>
      <div className={`tabular mt-1 text-[26px] font-semibold leading-none ${color}`}>{value}</div>
      <div className="t-meta mt-1.5 text-[12px]">{hint}</div>
    </div>
  );
}
