"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExtractedCommitmentsAction, logMeetingAction } from "@/app/actions";
import type { MeetingResult } from "@/app/actions";
import type { CommitmentKind } from "@/lib/types";
import { COMMITMENT_KIND_LABEL } from "@/lib/types";
import { addDays, today } from "@/lib/dates";
import { useToast } from "@/components/shell/Toast";
import { Badge } from "@/components/ui";

const SAMPLE = `John: The product itself looks great — the team liked the audit trail.
Anjali: Glad to hear it.
John: My worry is implementation time. The last tool we bought took four months and it burned goodwill internally.
Anjali: Understood. Our median for a 140-seat org is two weeks. I'll send you a week-by-week plan.
Priya: Does SSO come in the base tier or is it an add-on?
Anjali: I'll confirm the exact packaging and send it across.
John: If the plan holds up I'll bring our CFO to the next call. Budget is approved at $18,000.
Anjali: Perfect — let's schedule that for Thursday.`;

type Step = "form" | "extracting" | "review";

/* Guards against a dropped file that is not a transcript. A .txt/.vtt/.srt/.md
   file is read as text; anything else (a PDF, an image, a 200MB archive) used
   to be decoded as UTF-8 and pasted into the textarea as binary noise. */
const TRANSCRIPT_EXT = /\.(txt|vtt|srt|md|log|csv)$/i;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

/**
 * The core loop in one screen: transcript in → structured intelligence out →
 * commitments created. Nothing is written to the database until the rep
 * confirms the extracted actions, so the AI proposes and the human decides.
 */
export default function MeetingForm({ customers }: { customers: { id: number; company: string }[] }) {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  const [customerName, setCustomerName] = useState("");
  const [date, setDate] = useState(today());
  const [type, setType] = useState<"meeting" | "call">("meeting");
  const [participants, setParticipants] = useState("");
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");

  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [edited, setEdited] = useState<Record<number, { title: string; dueInDays: number; owner: "me" | "customer"; kind: CommitmentKind }>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim() || (!transcript.trim() && !notes.trim())) return;
    setError(null);
    setStep("extracting");
    /* Without this catch a failed extraction (bad API key, quota, network,
       database error) left the screen on the "Reading the meeting…" animation
       forever, with the rep's pasted transcript unrecoverable. */
    startTransition(async () => {
      try {
        const res = await logMeetingAction({ customerName: customerName.trim(), date, type, participants, notes, transcript });
        setResult(res);
        const init: typeof edited = {};
        const sel: Record<number, boolean> = {};
        res.extraction.commitments.forEach((c, i) => {
          init[i] = { title: c.title, dueInDays: c.due_in_days, owner: c.owner, kind: c.kind };
          sel[i] = true;
        });
        setEdited(init);
        setSelected(sel);
        setStep("review");
      } catch (err) {
        // Back to the form with everything the rep typed still in place.
        setError(err instanceof Error ? err.message : "Could not read that meeting. Try again.");
        setStep("form");
      }
    });
  }

  async function handleFile(file: File) {
    if (!TRANSCRIPT_EXT.test(file.name)) {
      setError(`${file.name} isn't a transcript. Drop a .txt, .vtt, .srt or .md file.`);
      return;
    }
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      setError(`${file.name} is too large (max 2 MB).`);
      return;
    }
    setError(null);
    setTranscript(await file.text());
  }

  if (step === "extracting") {
    return (
      <div className="card p-8">
        <div className="anim-thinking mb-5 flex items-center gap-2 text-[14px] font-medium text-ai">
          <span>✦</span> Reading the {type}…
        </div>
        <ul className="space-y-2.5">
          {["Summarising the conversation", "Finding pain points and objections", "Detecting buying signals",
            "Extracting commitments from both sides", "Setting follow-up dates"].map((s, i) => (
            <li key={s} className="flex items-center gap-2.5 text-[13px] text-ink-2" style={{ opacity: 1 - i * 0.13 }}>
              <span className="h-1.5 w-1.5 rounded-full bg-ai" />
              {s}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (step === "review" && result) {
    const x = result.extraction;
    const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));

    return (
      <div className="space-y-6">
        {/* The payoff moment. */}
        <div className="card border-ai-line bg-ai-tint p-5">
          <h2 className="t-h1 flex items-center gap-2 text-ai">
            <span>✦</span> {x.commitments.length} action{x.commitments.length === 1 ? "" : "s"} detected
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Review, edit, then create. Nothing is saved to your follow-ups until you confirm.
          </p>

          <ul className="mt-4 space-y-2">
            {x.commitments.map((c, i) => {
              const e = edited[i];
              if (!e) return null;
              return (
                <li key={i} className="card flex flex-wrap items-center gap-2 p-2.5">
                  <input
                    type="checkbox"
                    checked={!!selected[i]}
                    onChange={(ev) => setSelected((s) => ({ ...s, [i]: ev.target.checked }))}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  <input
                    value={e.title}
                    onChange={(ev) => setEdited((s) => ({ ...s, [i]: { ...e, title: ev.target.value } }))}
                    className="focus-ring min-w-[180px] flex-1 rounded-[6px] border border-line px-2 py-1 text-[13px] outline-none"
                  />
                  <select
                    value={e.owner}
                    onChange={(ev) => setEdited((s) => ({ ...s, [i]: { ...e, owner: ev.target.value as "me" | "customer" } }))}
                    className="focus-ring h-7 rounded-[6px] border border-line bg-card px-1.5 text-[12.5px]"
                  >
                    <option value="me">You owe</option>
                    <option value="customer">They owe</option>
                  </select>
                  <select
                    value={e.kind}
                    onChange={(ev) => setEdited((s) => ({ ...s, [i]: { ...e, kind: ev.target.value as CommitmentKind } }))}
                    className="focus-ring h-7 rounded-[6px] border border-line bg-card px-1.5 text-[12.5px]"
                  >
                    {Object.entries(COMMITMENT_KIND_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={addDays(date, e.dueInDays)}
                    onChange={(ev) => {
                      const days = Math.round(
                        (new Date(`${ev.target.value}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000,
                      );
                      setEdited((s) => ({ ...s, [i]: { ...e, dueInDays: days } }));
                    }}
                    className="focus-ring h-7 rounded-[6px] border border-line px-1.5 text-[12.5px]"
                  />
                </li>
              );
            })}
            {x.commitments.length === 0 && (
              <li className="card p-3 text-[13px] text-ink-2">
                No explicit promises found in this {type}. You can still add a follow-up manually from the account page.
              </li>
            )}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={chosen.length === 0 || creating}
              onClick={() => {
                setCreating(true);
                setError(null);
                startTransition(async () => {
                  try {
                    await createExtractedCommitmentsAction({
                      customerId: result.customerId,
                      interactionId: result.interactionId,
                      meetingDate: date,
                      commitments: chosen.map((i) => ({
                        owner: edited[i].owner,
                        kind: edited[i].kind,
                        title: edited[i].title,
                        dueInDays: edited[i].dueInDays,
                      })),
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create those follow-ups.");
                    setCreating(false);
                    return;
                  }
                  toast(`${chosen.length} follow-up${chosen.length === 1 ? "" : "s"} created`, { tone: "positive" });
                  router.push(`/customers/${result.customerId}`);
                });
              }}
              className="focus-ring rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover disabled:opacity-40"
            >
              {creating ? "Creating…" : `Create ${chosen.length} action${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => router.push(`/customers/${result.customerId}`)}
              className="focus-ring rounded-[7px] border border-line bg-card px-4 py-2 text-[13px] hover:bg-sunken"
            >
              Skip and open account
            </button>
          </div>

          {error && <p className="mt-3 text-[12.5px] text-risk">{error}</p>}
        </div>

        {/* Everything else the model pulled out. */}
        <div className="card p-5">
          <div className="t-label mb-1 text-ai">✦ Summary</div>
          <p className="text-[13.5px] leading-6">{x.summary}</p>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Extracted title="Pain points" items={x.pain_points} />
            <Extracted title="Requirements" items={x.requirements} />
            <Extracted title="Objections" items={x.objections} tone="risk" />
            <Extracted title="Unanswered questions" items={x.questions} tone="attention" />
            <Extracted title="Buying signals" items={x.buying_signals} tone="positive" />
            <Extracted title="Competitors" items={x.competitors} />
            <Extracted title="Decision makers" items={x.decision_makers} />
            <Extracted title="Next steps" items={x.next_steps} />
          </div>

          {(x.budget || x.timeline) && (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line-soft pt-4">
              {x.budget && <Badge tone="brand">Budget: {x.budget}</Badge>}
              {x.timeline && <Badge tone="brand">Timeline: {x.timeline}</Badge>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" hint="Type a new name to create the account">
          <input
            list="customer-list"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
            placeholder="e.g. ABC Technologies"
            className="focus-ring h-9 w-full rounded-[7px] border border-line px-2.5 text-[13px] outline-none"
          />
          <datalist id="customer-list">
            {customers.map((c) => (
              <option key={c.id} value={c.company} />
            ))}
          </datalist>
        </Field>

        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="focus-ring h-9 w-full rounded-[7px] border border-line px-2.5 text-[13px] outline-none"
          />
        </Field>

        <Field label="Type">
          <div className="flex gap-0.5 rounded-[7px] border border-line p-0.5">
            {(["meeting", "call"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`focus-ring flex-1 rounded-[5px] py-1.5 text-[13px] capitalize ${
                  type === t ? "bg-brand-tint font-medium text-brand" : "text-ink-2"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Participants" hint="Optional">
          <input
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="John Smith, Priya Raman"
            className="focus-ring h-9 w-full rounded-[7px] border border-line px-2.5 text-[13px] outline-none"
          />
        </Field>
      </div>

      <Field label="Notes" hint="Optional — the AI reads these too">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything you jotted down during the call…"
          className="focus-ring w-full resize-y rounded-[7px] border border-line px-2.5 py-2 text-[13px] leading-5 outline-none"
        />
      </Field>

      <Field
        label="Transcript"
        hint={
          <button type="button" onClick={() => setTranscript(SAMPLE)} className="text-brand hover:underline">
            Paste a sample
          </button>
        }
      >
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
          rows={12}
          placeholder="Paste the transcript here, or drop a .txt / .vtt file…"
          className="focus-ring w-full resize-y rounded-[7px] border border-line px-2.5 py-2 font-mono text-[12.5px] leading-5 outline-none"
        />
      </Field>

      {error && (
        <div className="card border-risk-line bg-risk-tint px-3 py-2.5" role="alert">
          <p className="text-[13px] font-medium text-risk">That didn&apos;t work</p>
          <p className="t-meta mt-0.5 text-[12.5px]">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-line-soft pt-4">
        <button
          type="submit"
          className="focus-ring flex items-center gap-1.5 rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover"
        >
          <span>✦</span> Extract and create actions
        </button>
        <p className="t-meta text-[12px]">
          The AI pulls out commitments, questions and signals, then proposes dated follow-ups for you to confirm.
        </p>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="t-label mb-1 flex items-center justify-between">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case tracking-normal text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Extracted({ title, items, tone }: { title: string; items: string[]; tone?: "risk" | "attention" | "positive" }) {
  if (!items?.length) return null;
  const color = tone === "risk" ? "text-risk" : tone === "attention" ? "text-attention" : tone === "positive" ? "text-positive" : "text-ink-3";
  return (
    <div>
      <div className={`t-label mb-1 ${color}`}>{title}</div>
      <ul className="space-y-1">
        {items.map((i, n) => (
          <li key={n} className="text-[13px] leading-5 text-ink-2">
            • {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
