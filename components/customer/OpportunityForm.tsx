"use client";

import { useState, useTransition } from "react";
import Dialog, {
  CancelButton,
  DeleteConfirm,
  Field,
  SubmitButton,
  inputClass,
  selectClass,
} from "@/components/shell/Dialog";
import { createOpportunityAction, deleteOpportunityAction, updateOpportunityAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";
import { STAGES, STAGE_LABEL } from "@/lib/types";
import type { Opportunity, Stage } from "@/lib/types";
import { addDays, today } from "@/lib/dates";

/**
 * Create or edit a deal.
 *
 * This is the piece that made a self-created account second class. Without an
 * opportunity an account has no value and no stage, its commitments link to
 * nothing so they carry no priority reasons, it never reaches the pipeline
 * board, and every Insight lens misses it — they all join opportunities. So
 * "add a deal" is really "make this account visible to the product".
 *
 * Probability is deliberately not a field: it is derived from the stage, the
 * same way dragging a card across the kanban derives it, so the two paths
 * cannot disagree.
 */
export default function OpportunityForm({
  customerId,
  contacts,
  existing,
  label,
}: {
  customerId: number;
  contacts: { id: number; name: string }[];
  existing?: Opportunity;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(existing);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          editing
            ? "focus-ring rounded-[6px] px-1.5 py-0.5 text-[11.5px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
            : "focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        }
      >
        {label ?? (editing ? "Edit" : "+ Add deal")}
      </button>
      {open && (
        <Body
          customerId={customerId}
          contacts={contacts}
          existing={existing}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Body({
  customerId,
  contacts,
  existing,
  onClose,
}: {
  customerId: number;
  contacts: { id: number; name: string }[];
  existing?: Opportunity;
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [stage, setStage] = useState<Stage>(existing?.stage ?? "new");
  // A default 60 days out beats an empty date: a deal with no close date is
  // invisible to every forecast, and a rough date is easy to correct.
  const [closeDate, setCloseDate] = useState(existing?.expected_close_date ?? addDays(today(), 60));
  const [contactId, setContactId] = useState(existing?.primary_contact_id ? String(existing.primary_contact_id) : "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const numericValue = Number(value.replace(/[,\s]/g, ""));
  const valid = name.trim().length > 0 && Number.isFinite(numericValue) && numericValue >= 0;

  function save() {
    if (!valid) return;
    setError(null);
    const fields = {
      name,
      value: numericValue,
      stage,
      expectedCloseDate: closeDate || null,
      primaryContactId: contactId ? Number(contactId) : null,
    };
    startTransition(async () => {
      try {
        if (existing) await updateOpportunityAction(existing.id, fields);
        else await createOpportunityAction(customerId, fields);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save this deal.");
        return;
      }
      toast(existing ? "Deal updated" : `${name.trim()} added`, { tone: "positive" });
      onClose();
    });
  }

  function remove() {
    if (!existing) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteOpportunityAction(existing.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete this deal.");
        return;
      }
      toast("Deal deleted", { tone: "risk" });
      onClose();
    });
  }

  return (
    <Dialog
      title={existing ? "Edit deal" : "Add a deal"}
      subtitle="Probability follows the stage automatically, so there is nothing to keep in sync."
      onClose={onClose}
      labelledBy="opportunity-dialog-title"
      footer={
        <>
          <SubmitButton
            pending={pending}
            disabled={!valid}
            onClick={save}
            label={existing ? "Save changes" : "Add deal"}
            pendingLabel="Saving…"
          />
          <CancelButton onClick={onClose} />
          {existing && (
            <DeleteConfirm
              pending={pending}
              confirming={confirming}
              onArm={() => setConfirming(true)}
              onCancel={() => setConfirming(false)}
              onConfirm={remove}
              consequence="Follow-ups stay, but lose their deal value and priority."
            />
          )}
        </>
      }
    >
      <Field label="Deal name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="e.g. ABC Technologies — Platform rollout"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Value (USD)">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder="18000"
            className={`${inputClass} tabular`}
          />
        </Field>
        <Field label="Stage">
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={selectClass}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected close" hint="Optional">
          <input
            type="date"
            value={closeDate ?? ""}
            onChange={(e) => setCloseDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Primary contact" hint={contacts.length === 0 ? "Add a contact first" : "Optional"}>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={contacts.length === 0}
            className={selectClass}
          >
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-risk">
          {error}
        </p>
      )}
    </Dialog>
  );
}
