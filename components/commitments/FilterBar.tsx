"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { STAGES, STAGE_LABEL } from "@/lib/types";
import { COMMITMENT_KIND_LABEL } from "@/lib/types";

export interface TabDef {
  key: string;
  label: string;
  count: number;
}

/**
 * Tabs and filters write to the URL rather than component state, so a filtered
 * view is shareable, bookmarkable, and survives back/forward.
 */
export function Tabs({
  tabs,
  param = "tab",
  defaultTab,
}: {
  tabs: TabDef[];
  param?: string;
  /** The tab the page shows when the URL carries none. Must match the page's
      own default, or the highlighted tab disagrees with the data below it —
      Follow-ups defaults to "today" while this component highlighted "All". */
  defaultTab?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get(param) ?? defaultTab ?? tabs[0].key;

  const set = useCallback(
    (key: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(param, key);
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router, param],
  );

  return (
    <div className="flex gap-0.5 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => set(t.key)}
            className={`focus-ring -mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors ${
              isActive
                ? "border-brand font-medium text-brand"
                : "border-transparent text-ink-2 hover:border-line hover:text-ink"
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="tabular ml-1.5 text-[12px] opacity-60">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

const VALUE_STEPS = [
  { key: "", label: "Any value" },
  { key: "5000", label: "$5K+" },
  { key: "10000", label: "$10K+" },
  { key: "25000", label: "$25K+" },
];

export function Filters({ customers }: { customers: { id: number; company: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  /* The search box is controlled locally and pushed to the URL on a debounce.
     It used to push on every keystroke, and each push re-ran the whole page on
     the server — eight queries against a remote database per character typed,
     which made typing visibly lag and could drop characters as the server
     component re-rendered under the cursor. */
  const urlQuery = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const typing = useRef(false);

  // Adopt the URL value when it changes from outside (Clear filters, back/forward).
  useEffect(() => {
    if (!typing.current) setSearch(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (search === urlQuery) return;
    const id = setTimeout(() => {
      typing.current = false;
      set("q", search);
    }, 350);
    return () => clearTimeout(id);
  }, [search, urlQuery, set]);

  const active = ["priority", "stage", "customer", "kind", "minValue", "q"].filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <input
        value={search}
        onChange={(e) => {
          typing.current = true;
          setSearch(e.target.value);
        }}
        aria-label="Search follow-ups"
        placeholder="Search follow-ups…"
        className="focus-ring h-8 w-48 rounded-[7px] border border-line bg-card px-2.5 text-[13px] outline-none placeholder:text-ink-3"
      />
      <Select value={params.get("priority") ?? ""} onChange={(v) => set("priority", v)}
        options={[["", "Any priority"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]} />
      <Select value={params.get("stage") ?? ""} onChange={(v) => set("stage", v)}
        options={[["", "Any stage"], ...STAGES.map((s) => [s, STAGE_LABEL[s]] as [string, string])]} />
      <Select value={params.get("kind") ?? ""} onChange={(v) => set("kind", v)}
        options={[["", "Any type"], ...Object.entries(COMMITMENT_KIND_LABEL)]} />
      <Select value={params.get("minValue") ?? ""} onChange={(v) => set("minValue", v)}
        options={VALUE_STEPS.map((v) => [v.key, v.label] as [string, string])} />
      <Select value={params.get("customer") ?? ""} onChange={(v) => set("customer", v)}
        options={[["", "Any customer"], ...customers.map((c) => [String(c.id), c.company] as [string, string])]} />

      {active.length > 0 && (
        <button
          onClick={() => {
            typing.current = false;
            setSearch("");
            const next = new URLSearchParams();
            const tab = params.get("tab");
            if (tab) next.set("tab", tab);
            router.push(`${pathname}?${next.toString()}`, { scroll: false });
          }}
          className="focus-ring rounded-[7px] px-2 py-1 text-[12px] text-ink-3 hover:text-ink"
        >
          Clear {active.length} filter{active.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`focus-ring h-8 rounded-[7px] border bg-card px-2 text-[13px] outline-none ${
        value ? "border-brand-line text-brand" : "border-line text-ink-2"
      }`}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
