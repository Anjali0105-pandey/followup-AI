import Link from "next/link";
import { listMeetings } from "@/lib/repo/interactions";
import { PageHeader, EmptyState, Badge, Avatar, AiMark } from "@/components/ui";
import { formatDay, relativePast } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const meetings = await listMeetings();
  const totalActions = meetings.reduce((s, m) => s + m.actions_created, 0);

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle={`${meetings.length} logged · ${totalActions} follow-ups created automatically from them`}
        actions={
          <Link
            href="/meetings/new"
            className="focus-ring flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-hover"
          >
            + Log meeting
          </Link>
        }
      />

      {meetings.length > 0 ? (
        <ul className="space-y-3">
          {meetings.map((m) => (
            <li key={m.id} className="card card-interactive">
              <Link href={`/meetings/${m.id}`} className="block p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar name={m.company} size={32} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="t-h2">{m.company}</span>
                        <Badge>{m.subject}</Badge>
                      </div>
                      <p className="t-meta mt-0.5 text-[12.5px]">
                        {formatDay(m.occurred_at, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
                        {relativePast(m.occurred_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {m.actions_created > 0 && <Badge tone="brand">{m.actions_created} actions</Badge>}
                    {m.signal_count > 0 && <Badge tone="ai">{m.signal_count} signals</Badge>}
                    {m.transcript && <Badge>Transcript</Badge>}
                  </div>
                </div>

                {m.ai_summary && (
                  <div className="ai-block mt-3 px-3 py-2">
                    <div className="t-label mb-0.5 text-ai">
                      <AiMark /> Summary
                    </div>
                    <p className="text-[13px] leading-5">{m.ai_summary}</p>
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No meetings logged yet" body="Paste a transcript and the AI will do the rest.">
          <Link href="/meetings/new" className="inline-block rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white">
            Log your first meeting
          </Link>
        </EmptyState>
      )}
    </>
  );
}
