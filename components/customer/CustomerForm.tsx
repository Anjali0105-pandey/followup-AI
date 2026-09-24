"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Dialog, { CancelButton, DeleteConfirm, Field, SubmitButton, inputClass } from "@/components/shell/Dialog";
import { createCustomerAction, deleteCustomerAction, updateCustomerAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";

export interface CustomerDraft {
  id: number;
  name: string;
  company: string;
  industry: string | null;
  website: string | null;
  segment: string | null;
}

/**
 * Create or edit an account.
 *
 * Accounts could previously only appear as a side effect of logging a meeting,
 * which meant a typo in a company name was permanent and a pipeline that did
 * not arrive as a transcript could not be entered at all.
 */
export default function CustomerForm({
  existing,
  trigger = "button",
  label,
}: {
  existing?: CustomerDraft;
  trigger?: "button" | "subtle";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(existing);
  const text = label ?? (editing ? "Edit" : "New customer");

  return (
    <>
      {trigger === "subtle" ? (
        <button
          onClick={() => setOpen(true)}
          className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          {text}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <span className="text-[15px] leading-none">+</span> {text}
        </button>
      )}
      {open && <Body existing={existing} onClose={() => setOpen(false)} />}
    </>
  );
}

function Body({ existing, onClose }: { existing?: CustomerDraft; onClose: () => void }) {
  const [company, setCompany] = useState(existing?.company ?? "");
  const [name, setName] = useState(existing?.name === existing?.company ? "" : existing?.name ?? "");
  const [industry, setIndustry] = useState(existing?.industry ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [segment, setSegment] = useState(existing?.segment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const fields = { company, name, industry, website, segment };
  const valid = company.trim().length > 0;

  function save() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      try {
        if (existing) {
          await updateCustomerAction(existing.id, fields);
          toast("Account updated", { tone: "positive" });
        } else {
          const id = await createCustomerAction(fields);
          toast(`${company.trim()} added`, { tone: "positive" });
          router.push(`/customers/${id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save this account.");
        return;
      }
      onClose();
    });
  }

  function remove() {
    if (!existing) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteCustomerAction(existing.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete this account.");
        return;
      }
      toast(`${existing.company} deleted`, { tone: "risk" });
      onClose();
      router.push("/customers");
    });
  }

  return (
    <Dialog
      title={existing ? "Edit account" : "New account"}
      subtitle={
        existing
          ? "Changes apply everywhere this account appears."
          : "Add an account by hand, without logging a meeting first."
      }
      onClose={onClose}
      labelledBy="customer-dialog-title"
      footer={
        <>
          <SubmitButton
            pending={pending}
            disabled={!valid}
            onClick={save}
            label={existing ? "Save changes" : "Add account"}
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
              consequence="Deletes its contacts, deals, meetings and follow-ups too."
            />
          )}
        </>
      }
    >
      <Field label="Company">
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          maxLength={200}
          placeholder="e.g. ABC Technologies"
          className={inputClass}
        />
      </Field>

      <Field label="Account name" hint="Optional — defaults to the company">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} />
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Industry" hint="Optional">
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            maxLength={200}
            placeholder="e.g. Logistics"
            className={inputClass}
          />
        </Field>
        <Field label="Segment" hint="Optional">
          <input
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            maxLength={200}
            placeholder="e.g. Mid-market"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Website" hint="Optional">
        <input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          maxLength={200}
          placeholder="abctech.com"
          className={inputClass}
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
