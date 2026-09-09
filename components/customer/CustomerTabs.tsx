"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export default function CustomerTabs({ tabs }: { tabs: { key: string; label: string; count?: number; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0].key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <>
      <div className="mb-5 flex gap-0.5 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={`focus-ring -mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors ${
              t.key === active
                ? "border-brand font-medium text-brand"
                : "border-transparent text-ink-2 hover:border-line hover:text-ink"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="tabular ml-1.5 text-[12px] opacity-60">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="anim-in">{current.content}</div>
    </>
  );
}
