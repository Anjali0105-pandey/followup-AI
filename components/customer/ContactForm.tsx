"use client";

import { useState, useTransition } from "react";
import Dialog, { CancelButton, DeleteConfirm, Field, SubmitButton, inputClass } from "@/components/shell/Dialog";
import { createContactAction, deleteContactAction, updateContactAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";
import type { Contact } from "@/lib/types";

/**
 * Create or edit a contact.
 *
 * Contacts were previously inserted by the seed script alone, so an account
 * created inside the app had nobody on it — and the follow-up generator, which
 * addresses the decision maker by first name, had nothing to address. Marking
 * one as decision maker is what makes that generated draft land on a person
 * rather than on a company.
 */
export default function ContactForm({
  customerId,
  existing,
  label,
}: {
  customerId: number;
  existing?: Contact;
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
        {label ?? (editing ? "Edit" : "+ Add contact")}
      </button>
      {open && <Body customerId={customerId} existing={existing} onClose={() => setOpen(false)} />}
    </>
  );
}

function Body({
  customerId,
  existing,
  onClose,
}: {
  customerId: number;
  existing?: Contact;
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [isDecisionMaker, setIsDecisionMaker] = useState(existing?.is_decision_maker ?? false);
  const [isChampion, setIsChampion] = useState(existing?.is_champion ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const valid = name.trim().length > 0;
  const fields = { name, role, email, phone, isDecisionMaker, isChampion, notes };

  function save() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      try {
        if (existing) await updateContactAction(existing.id, fields);
        else await createContactAction(customerId, fields);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save this contact.");
        return;
      }
      toast(existing ? "Contact updated" : `${name.trim()} added`, { tone: "positive" });
      onClose();
    });
  }

  function remove() {
    if (!existing) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteContactAction(existing.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete this contact.");
        return;
      }
      toast("Contact deleted", { tone: "risk" });
      onClose();
    });
  }

  return (
    <Dialog
      title={existing ? "Edit contact" : "Add a contact"}
      subtitle="The decision maker is who generated follow-ups are addressed to."
      onClose={onClose}
      labelledBy="contact-dialog-title"
      footer={
        <>
          <SubmitButton
            pending={pending}
            disabled={!valid}
            onClick={save}
            label={existing ? "Save changes" : "Add contact"}
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
              consequence="Meetings and follow-ups stay; they just lose this name."
            />
          )}
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. John Smith"
            className={inputClass}
          />
        </Field>
        <Field label="Role" hint="Optional">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={200}
            placeholder="e.g. VP Engineering"
            className={inputClass}
          />
        </Field>
        <Field label="Email" hint="Optional">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            placeholder="john@abctech.com"
            className={inputClass}
          />
        </Field>
        <Field label="Phone" hint="Optional">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isDecisionMaker}
            onChange={(e) => setIsDecisionMaker(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Decision maker
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isChampion}
            onChange={(e) => setIsChampion(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Champion
        </label>
      </div>

      <Field label="Notes" hint="Optional">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={1000}
          className="focus-ring w-full resize-y rounded-[7px] border border-line bg-card px-2.5 py-2 text-[13px] leading-5 outline-none"
        />
      </Field>

      {error && (
        <p role="alert" className="text-[12.5px] text-risk">
          {error}
        </p>
      )}
    </Dialog>
  );
}
