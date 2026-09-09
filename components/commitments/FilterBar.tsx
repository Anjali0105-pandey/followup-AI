"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
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
export function Tabs({ tabs, param = "tab" }: { tabs: TabDef[]; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get(param) ?? tabs[0].key;

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

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const active = ["priority", "stage", "customer", "kind", "minValue", "q"].filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <input
        defaultValue={params.get("q") ?? ""}
        onChange={(e) => set("q", e.target.value)}
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
