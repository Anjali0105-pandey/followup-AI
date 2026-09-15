import { currentUser } from "@/lib/repo/workspace";
import { PageHeader, Badge, SectionTitle, Avatar } from "@/components/ui";
import { PROVIDERS } from "@/lib/integrations";
import { AI_MODE } from "@/lib/ai";
import ReseedButton from "@/components/settings/ReseedButton";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Postgres hands COUNT() back as a bigint string, so each one is cast to int
  // — otherwise these render as strings and any arithmetic on them concatenates.
  const [user, counts] = await Promise.all([
    currentUser(),
    db.get<{ c: number; o: number; m: number; i: number }>(
      `SELECT (SELECT COUNT(*) FROM customers)::int c, (SELECT COUNT(*) FROM opportunities)::int o,
              (SELECT COUNT(*) FROM commitments)::int m, (SELECT COUNT(*) FROM interactions)::int i`,
    ),
  ]);
  const { c = 0, o = 0, m = 0, i = 0 } = counts ?? {};

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, workspace, integrations and demo data." />

      <div className="max-w-[760px] space-y-8">
        <section>
          <SectionTitle>Profile</SectionTitle>
          <div className="card flex items-center gap-3 p-4">
            <Avatar name={user.name} size={44} />
            <div>
              <p className="text-[14px] font-medium">{user.name}</p>
              <p className="t-meta">
                {user.role} · {user.email}
              </p>
              <p className="t-meta text-[12px]">Workspace: {user.workspace}</p>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle
            aside={
              <Badge tone={AI_MODE === "live" ? "positive" : "attention"}>
                {AI_MODE === "live" ? "Live model" : "Mock mode"}
              </Badge>
            }
          >
            AI engine
          </SectionTitle>
          <div className="card p-4">
            <p className="text-[13px] leading-6 text-ink-2">
              {AI_MODE === "live" ? (
                <>
                  Connected to Gemini 2.5 Flash. Meeting extraction, follow-up drafting and freeform answers all run
                  against the live model.
                </>
              ) : (
                <>
                  No <code className="rounded bg-sunken px-1 text-[12px]">GEMINI_API_KEY</code> is set, so extraction and
                  drafting run on local rule-based generation. Everything is fully usable — add a key to{" "}
                  <code className="rounded bg-sunken px-1 text-[12px]">.env.local</code> and the same code paths switch to
                  the live model with no other change.
                </>
              )}
            </p>
          </div>
        </section>

        <section>
          <SectionTitle>Integrations</SectionTitle>
          <ul className="space-y-2">
            {PROVIDERS.map((p) => (
              <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium">{p.name}</span>
                    <Badge tone={p.connected ? "positive" : "neutral"}>{p.connected ? "Connected" : "Not connected"}</Badge>
                  </div>
                  <p className="t-meta mt-0.5 text-[12.5px]">{p.description}</p>
                  <p className="t-meta mt-1 text-[12px] text-ai">✦ Unlocks: {p.unlocks}</p>
                  <p className="t-meta mt-1 text-[11.5px] text-ink-3">{p.vendors.join(" · ")}</p>
                </div>
                <button
                  disabled
                  title="Connector interfaces are defined in lib/integrations — no live provider is wired up yet."
                  className="shrink-0 cursor-not-allowed rounded-[7px] border border-line px-3 py-1.5 text-[13px] text-ink-3"
                >
                  Connect
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle>Demo data</SectionTitle>
          <div className="card p-4">
            <p className="text-[13px] leading-6 text-ink-2">
              This workspace holds {c} customers, {o} opportunities, {i} interactions and {m}{" "}
              commitments. Dates are relative to today, so the demo never goes stale. Resetting discards anything you
              changed and rebuilds the original dataset.
            </p>
            <div className="mt-3">
              <ReseedButton />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
