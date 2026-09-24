import Link from "next/link";
import { PageHeader, Badge, AiMark, EmptyState } from "@/components/ui";
import db from "@/lib/db";
import { currentDay, currentWorkspaceId } from "@/lib/repo/workspace";
import { relativePast } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * A real unified inbox needs Gmail/WhatsApp OAuth, sync, threading and dedup —
 * a product in its own right. Rather than ship a fake mailbox, this shows the
 * inbound messages we genuinely have (logged interactions) and is honest that
 * live channels are not connected yet.
 */
export default async function InboxPage() {
  // SQLite's group_concat(x, sep) is string_agg(x, sep) in Postgres.
  // The workspace filter is not optional: without it this page listed every
  // tenant's inbound messages, bodies and detected signals to anyone signed in.
  const inbound = await db.all<Record<string, unknown>>(
    `SELECT i.*, c.company, c.id AS cid,
            (SELECT string_agg(s.kind || '|' || s.label, '§') FROM signals s WHERE s.interaction_id = i.id) AS sig
     FROM interactions i JOIN customers c ON c.id = i.customer_id
     WHERE c.workspace_id = ? AND i.direction = 'inbound'
     ORDER BY i.occurred_at DESC`,
    await currentWorkspaceId(),
  );
  const t = await currentDay();

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Inbound customer messages, with the signals the AI found in them."
        actions={<Badge tone="attention">Channels not connected</Badge>}
      />

      <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-brand-line bg-brand-tint p-4">
        <div>
          <p className="text-[13.5px] font-medium text-brand">Connect a channel to make this live</p>
          <p className="t-meta mt-0.5 text-[12.5px]">
            Email, WhatsApp and SMS sync are stubbed behind a mock integration layer. Until one is connected, this shows
            inbound messages captured when you log a meeting or mark a follow-up as sent.
          </p>
        </div>
        <Link
          href="/settings"
          className="focus-ring shrink-0 rounded-[7px] bg-brand px-3 py-2 text-[13px] font-medium text-white hover:bg-brand-hover"
        >
          Set up integrations
        </Link>
      </div>

      {inbound.length === 0 && (
        <EmptyState
          title="No inbound messages yet"
          body="Messages appear here once a customer replies in a logged thread, or once you connect an email channel."
        />
      )}

      <ul className="space-y-2">
        {inbound.map((m) => {
          const signals = ((m.sig as string) ?? "").split("§").filter(Boolean).map((s) => s.split("|"));
          return (
            <li key={m.id as number} className="card card-interactive p-4">
              <Link href={`/customers/${m.cid}`} className="block">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="t-h2">{m.company as string}</span>
                    <Badge>{m.type as string}</Badge>
                  </div>
                  <span className="t-meta text-[12px]">{relativePast(m.occurred_at as string, t)}</span>
                </div>
                <p className="mt-1 text-[13.5px] font-medium">{m.subject as string}</p>
                {(m.body as string) && <p className="t-meta mt-1 text-[13px] leading-5">{m.body as string}</p>}

                {signals.length > 0 && (
                  <div className="ai-block mt-3 px-3 py-2">
                    <div className="t-label mb-1 text-ai">
                      <AiMark /> Detected
                    </div>
                    <ul className="space-y-0.5">
                      {signals.map(([kind, label], i) => (
                        <li key={i} className="text-[12.5px]">
                          <span className="font-medium capitalize">{kind}</span> — {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
