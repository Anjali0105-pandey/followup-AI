import Link from "next/link";
import { notFound } from "next/navigation";
import { getInteraction, signalsForInteraction } from "@/lib/repo/interactions";
import { listCommitmentsForCustomer } from "@/lib/repo/commitments";
import { PageHeader, Badge, AiMark, SectionTitle } from "@/components/ui";
import CommitmentList from "@/components/commitments/CommitmentList";
import { formatDay, relativePast } from "@/lib/dates";

export const dynamic = "force-dynamic";

const SIGNAL_TONE: Record<string, "positive" | "risk" | "attention" | "neutral"> = {
  buying: "positive",
  risk: "risk",
  objection: "risk",
  question: "attention",
  competitor: "neutral",
  budget: "neutral",
  timeline: "neutral",
};

export default async function MeetingDetail(props: PageProps<"/meetings/[id]">) {
  const { id } = await props.params;
  const meeting = await getInteraction(Number(id));
  if (!meeting) notFound();

  const [signals, customerCommitments] = await Promise.all([
    signalsForInteraction(meeting.id),
    listCommitmentsForCustomer(meeting.customer_id),
  ]);
  const created = customerCommitments.filter((c) => c.interaction_id === meeting.id);

  return (
    <>
      <Link href="/meetings" className="t-meta mb-2 inline-block text-[12px] hover:text-ink">
        ← Meetings
      </Link>

      <PageHeader
        title={meeting.subject}
        subtitle={
          <>
            <Link href={`/customers/${meeting.customer_id}`} className="font-medium text-brand hover:underline">
              {meeting.company}
            </Link>
            {" · "}
            {formatDay(meeting.occurred_at, { weekday: "long", month: "long", day: "numeric" })} ·{" "}
            {relativePast(meeting.occurred_at)}
          </>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {meeting.ai_summary && (
            <section>
              <SectionTitle>
                <span className="flex items-center gap-1.5">
                  <AiMark /> What happened
                </span>
              </SectionTitle>
              <div className="ai-block px-4 py-3">
                <p className="text-[13.5px] leading-6">{meeting.ai_summary}</p>
              </div>
            </section>
          )}

          {created.length > 0 && (
            <section>
              <SectionTitle aside={<span className="t-meta text-[12px]">Created automatically from this meeting</span>}>
                Actions created
              </SectionTitle>
              <CommitmentList items={created} showOwner />
            </section>
          )}

          {meeting.transcript && (
            <section>
              <SectionTitle>Transcript</SectionTitle>
              <pre className="thin-scroll card max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-sans text-[13px] leading-6 text-ink-2">
                {meeting.transcript}
              </pre>
            </section>
          )}

          {meeting.body && !meeting.transcript && (
            <section>
              <SectionTitle>Notes</SectionTitle>
              <p className="card p-4 text-[13px] leading-6 text-ink-2">{meeting.body}</p>
            </section>
          )}
        </div>

        <aside>
          <div className="card p-4">
            <h3 className="t-label mb-2.5">
              <AiMark /> Signals detected ({signals.length})
            </h3>
            {signals.length > 0 ? (
              <ul className="space-y-2.5">
                {signals.map((s) => (
                  <li key={s.id as number}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] leading-5">{s.label as string}</p>
                      <Badge tone={SIGNAL_TONE[s.kind as string] ?? "neutral"}>{s.kind as string}</Badge>
                    </div>
                    {(s.detail as string) && <p className="t-meta mt-0.5 text-[12px]">{s.detail as string}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta text-[12.5px]">No signals extracted from this meeting.</p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
