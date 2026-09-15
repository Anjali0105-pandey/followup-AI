import { listCustomers } from "@/lib/repo/customers";
import { PageHeader } from "@/components/ui";
import MeetingForm from "@/components/meetings/MeetingForm";

export const dynamic = "force-dynamic";

export default async function NewMeetingPage() {
  const customers = (await listCustomers()).map((c) => ({ id: c.id, company: c.company }));
  return (
    <>
      <PageHeader
        title="Log a meeting"
        subtitle="Paste what happened. The AI turns it into account memory, signals, and dated follow-ups."
      />
      <MeetingForm customers={customers} />
    </>
  );
}
