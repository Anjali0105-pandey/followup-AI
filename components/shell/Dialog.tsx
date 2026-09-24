"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useOverlayLock } from "@/components/shell/useOverlay";

/**
 * The modal shell every form dialog is built on.
 *
 * It exists because the three overlays that shipped before it each
 * re-implemented the same scaffolding and each got a different subset right:
 * one handled Escape, one didn't, none of them managed focus, so a keyboard
 * user tabbed straight out of the dialog into the page behind it. Doing it once
 * here means a new dialog cannot inherit only half the behaviour.
 *
 * What it guarantees:
 * - focus moves into the dialog on open and returns to the trigger on close
 * - Tab and Shift+Tab cycle inside it rather than escaping to the page
 * - Escape and a backdrop click both close
 * - single-key shortcuts elsewhere (D, S, C on the feed) are suppressed while
 *   it is open, via the shared overlay lock
 */
export default function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  labelledBy = "dialog-title",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  labelledBy?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useOverlayLock();

  useEffect(() => {
    // Remember what had focus so it can be handed back on close — otherwise
    // closing a dialog drops the keyboard user at the top of the document.
    restoreTo.current = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <div
        ref={panel}
        className="anim-in thin-scroll absolute left-1/2 top-[8vh] max-h-[84vh] w-[min(560px,92vw)] -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-[var(--shadow-overlay)]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={labelledBy} className="t-h2">
              {title}
            </h2>
            {subtitle && <p className="t-meta mt-0.5 text-[12.5px]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring shrink-0 rounded p-1 text-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5" fill="none">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3.5">{children}</div>

        <div className="mt-5 flex flex-wrap items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}

/* ---------- Shared form primitives ---------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-label mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case tracking-normal text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2.5 text-[13px] outline-none";

export const selectClass = "focus-ring h-9 w-full rounded-[7px] border border-line bg-card px-2 text-[13px]";

/** Primary action for a dialog footer. */
export function SubmitButton({
  pending,
  disabled,
  label,
  pendingLabel,
  onClick,
}: {
  pending: boolean;
  disabled?: boolean;
  label: string;
  pendingLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="focus-ring rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring rounded-[7px] border border-line px-4 py-2 text-[13px] hover:bg-sunken"
    >
      Cancel
    </button>
  );
}

/**
 * Two-step delete. Irreversible actions in this app confirm rather than offer
 * an Undo they cannot honour, and the confirm names what is actually lost.
 */
export function DeleteConfirm({
  consequence,
  pending,
  confirming,
  onArm,
  onConfirm,
  onCancel,
  label = "Delete",
}: {
  consequence: string;
  pending: boolean;
  confirming: boolean;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onArm}
        className="focus-ring ml-auto rounded-[7px] border border-risk-line px-3 py-2 text-[13px] text-risk transition-colors hover:bg-risk-tint"
      >
        {label}…
      </button>
    );
  }

  return (
    <span className="ml-auto flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] text-risk">{consequence}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="focus-ring rounded-[7px] bg-risk px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="focus-ring rounded-[7px] border border-line px-3 py-2 text-[13px] hover:bg-sunken"
      >
        Keep
      </button>
    </span>
  );
}
