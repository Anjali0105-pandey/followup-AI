"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui";
import { removeApiKeyAction, saveApiKeyAction } from "@/app/actions";
import type { StoredKeyInfo } from "@/lib/repo/credentials";
import { useToast } from "@/components/shell/Toast";
import { relativePast } from "@/lib/dates";

/**
 * Bring-your-own-key form. The stored key is write-only: the server sends back
 * a masked hint and nothing else, so there is deliberately no way to reveal a
 * saved key here — only to replace or remove it.
 */
export default function ApiKeyForm({ initial }: { initial: StoredKeyInfo }) {
  const [info, setInfo] = useState(initial);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!initial.hint);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await saveApiKeyAction("gemini", value);
        setInfo(next);
        setValue("");
        setEditing(false);
        toast("API key saved", { tone: "positive" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the key.");
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const next = await removeApiKeyAction();
      setInfo(next);
      setEditing(true);
      toast("API key removed");
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">Your Gemini API key</p>
          <p className="t-meta mt-0.5 text-[12.5px]">
            Used for your own meeting extraction and drafting. Stored encrypted — it is never shown again after saving.
          </p>
        </div>
        <Badge tone={info.hint ? "positive" : "neutral"}>{info.hint ? "Key stored" : "No key"}</Badge>
      </div>

      {info.hint && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="tabular rounded-[6px] border border-line bg-sunken px-2 py-1 text-[12.5px]">
            {info.hint}
          </code>
          {info.updatedAt && (
            /* relativePast, not toLocaleDateString: the server renders in one
               locale and the browser in another, which is a hydration mismatch. */
            <span className="t-meta text-[12px]">Updated {relativePast(info.updatedAt.slice(0, 10))}</span>
          )}
          <span className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="focus-ring rounded-[7px] border border-line px-3 py-1.5 text-[13px] transition-colors hover:bg-sunken"
            >
              Replace
            </button>
            <button
              onClick={remove}
              disabled={pending}
              className="focus-ring rounded-[7px] border border-risk-line px-3 py-1.5 text-[13px] text-risk transition-colors hover:bg-risk-tint disabled:opacity-50"
            >
              Remove
            </button>
          </span>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) save();
              }}
              placeholder="AIza…"
              aria-label="Gemini API key"
              className="focus-ring min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-1.5 font-mono text-[13px]"
            />
            <button
              onClick={save}
              disabled={pending || !value.trim()}
              className="focus-ring rounded-[7px] bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save key"}
            </button>
            {info.hint && (
              <button
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError(null);
                }}
                className="focus-ring rounded-[7px] border border-line px-3 py-1.5 text-[13px] transition-colors hover:bg-sunken"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="t-meta mt-2 text-[12px]">
            Get one free at{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              aistudio.google.com/apikey
            </a>
            .
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-[12.5px] text-risk">{error}</p>}
    </div>
  );
}
