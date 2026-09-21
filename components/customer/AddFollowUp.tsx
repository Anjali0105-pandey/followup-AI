"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createCommitmentAction } from "@/app/actions";
import { COMMITMENT_KIND_LABEL } from "@/lib/types";
import type { CommitmentKind } from "@/lib/types";
import { addDays, today } from "@/lib/dates";
import { useToast } from "@/components/shell/Toast";
import { useOverlayLock } from "@/components/shell/useOverlay";

/**
 * Book a follow-up by hand.
 *
 * `createCommitmentAction` was written, typed and validated but had no caller
 * anywhere in the UI — meanwhile the account header printed "Nothing scheduled
 * — book one" with no control that booked one. A rep could only ever get a
 * follow-up by logging a meeting and letting the AI extract it, which is the
 * happy path, not the only path: plenty of promises are made on a phone call
 * nobody transcribed.
 *
 * `variant` lets the same dialog hang off the header's action bar and off that
 * empty-state sentence, so the invitation and the control are the same thing.
 */
export default function AddFollowUp({
  customerId,
  variant = "button",
  label = "Add follow-up",
}: {
  customerId: number;
  variant?: "button" | "link";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  const trigger =
    variant === "link" ? (
      <button
        onClick={() => setOpen(true)}
        className="focus-ring rounded text-attention underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        {label}
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        /* inline-flex, not flex: this also renders inside EmptyState's
           text-center block, where a block-level flex button would stretch to
           full width and sit its label on the left. */
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-card px-3 text-[13px] font-medium transition-colors hover:bg-sunken"
      >
        <span className="text-[15px] leading-none">+</span> {label}
      </button>
    );

  return (
    <>
      {trigger}
      {open && <Dialog customerId={customerId} onClose={() => setOpen(false)} />}
    </>
  );
}

const DEFAULT_KIND: CommitmentKind = "email";

function Dialog({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [owner, setOwner] = useState<"me" | "customer">("me");
  const [kind, setKind] = useState<CommitmentKind>(DEFAULT_KIND);
  // Tomorrow, not today: a promise you are booking now is almost never due in
  // the next few hours, and a due-today default would put it straight into the
  // rep's overdue count tonight.
  const [dueDate, setDueDate] = useState(addDays(today(), 1));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);

  useOverlayLock();

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dueDate);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await createCommitmentAction({
          customerId,
          owner,
          kind,
          title: title.trim(),
          detail: detail.trim() || undefined,
          dueDate,
        });
      } catch (err) {
        // Keep the dialog open with everything typed still in it.
        setError(err instanceof Error ? err.message : "Could not create that follow-up.");
        return;
      }
      toast(owner === "me" ? "Follow-up booked" : "Logged what they owe you", { tone: "positive" });
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="add-followup-title">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <form
        onSubmit={submit}
        className="anim-in absolute left-1/2 top-[12vh] w-[min(520px,92vw)] -translate-x-1/2 rounded-xl border border-line bg-card p-5 shadow-[var(--shadow-overlay)]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="add-followup-title" className="t-h2">
              Add a follow-up
            </h2>
            <p className="t-meta mt-0.5 text-[12.5px]">
              A promise with a date on it. Nothing here needs a meeting transcript.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded p-1 text-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5" fill="none">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <label className="block">
            <span className="t-label mb-1 block">What was promised</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="e.g. Send the security overview"
              className="focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2.5 text-[13px] outline-none"
            />
          </label>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="t-label mb-1 block">Who owes it</span>
              <select
                value={owner}
                onChange={(e) => setOwner(e.target.value as "me" | "customer")}
                className="focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2 text-[13px]"
              >
                <option value="me">You owe them</option>
                <option value="customer">They owe you</option>
              </select>
            </label>

            <label className="block">
              <span className="t-label mb-1 block">Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as CommitmentKind)}
                className="focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2 text-[13px]"
              >
                {Object.entries(COMMITMENT_KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block sm:w-1/2">
            <span className="t-label mb-1 block">Due</span>
            <input
              type="date"
              value={dueDate}
              min={today()}
              onChange={(e) => setDueDate(e.target.value)}
              className="focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2.5 text-[13px] outline-none"
            />
          </label>

          <label className="block">
            <span className="t-label mb-1 block">
              Detail <span className="font-normal normal-case tracking-normal text-ink-3">Optional</span>
            </span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Anything the future you will need to remember"
              className="focus-ring w-full resize-y rounded-[7px] border border-line bg-card px-2.5 py-2 text-[13px] leading-5 outline-none"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[12.5px] text-risk">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="submit"
            disabled={!valid || pending}
            className="focus-ring rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
          >
            {pending ? "Adding…" : "Add follow-up"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-[7px] border border-line px-4 py-2 text-[13px] hover:bg-sunken"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
