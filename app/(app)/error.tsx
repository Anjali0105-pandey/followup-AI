"use client";

import Link from "next/link";

/** A dead end is never acceptable in this product — every error offers the
    rep a way to keep working. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <h1 className="t-h1">Something went wrong here</h1>
      <p className="t-meta mt-1.5">
        This screen failed to load. Your data is untouched — nothing was lost.
      </p>
      <pre className="thin-scroll mt-4 max-h-32 overflow-auto rounded-[7px] bg-sunken p-3 text-left text-[12px] text-ink-2">
        {error.message}
      </pre>
      <div className="mt-4 flex justify-center gap-2">
        <button
          onClick={reset}
          className="focus-ring rounded-[7px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover"
        >
          Try again
        </button>
        <Link href="/" className="focus-ring rounded-[7px] border border-line px-4 py-2 text-[13px] hover:bg-sunken">
          Back to Command Center
        </Link>
      </div>
    </div>
  );
}
