"use client";

import { useState, useTransition } from "react";
import { reseedAction } from "@/app/actions";
import { useToast } from "@/components/shell/Toast";

export default function ReseedButton() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="focus-ring rounded-[7px] border border-line px-3 py-2 text-[13px] hover:bg-sunken"
      >
        Reset demo data
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-risk">This discards your changes. Sure?</span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await reseedAction();
            toast("Demo workspace rebuilt", { tone: "positive" });
            setConfirming(false);
          })
        }
        className="focus-ring rounded-[7px] bg-risk px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Yes, reset"}
      </button>
      <button onClick={() => setConfirming(false)} className="focus-ring rounded-[7px] border border-line px-3 py-2 text-[13px]">
        Cancel
      </button>
    </div>
  );
}
