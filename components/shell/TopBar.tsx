"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AskPalette from "@/components/shell/AskPalette";
import ShortcutHelp from "@/components/shell/ShortcutHelp";

const CRUMBS: Record<string, string> = {
  "": "Command Center",
  followups: "Follow-ups",
  commitments: "Commitments",
  meetings: "Meetings",
  customers: "Customers",
  opportunities: "Opportunities",
  insights: "AI Insights",
  inbox: "Inbox",
  analytics: "Analytics",
  settings: "Settings",
};

export default function TopBar({ aiMode }: { aiMode: "live" | "mock" }) {
  const pathname = usePathname();
  const [askOpen, setAskOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const segment = pathname.split("/")[1] ?? "";
  const crumb = CRUMBS[segment] ?? "Command Center";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskOpen(true);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        setAskOpen(true);
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-8">
        <div className="ml-11 min-w-0 flex-1 lg:ml-0">
          <span className="t-meta truncate text-[13px] font-medium text-ink">{crumb}</span>
        </div>

        <button
          onClick={() => setAskOpen(true)}
          className="focus-ring hidden h-8 items-center gap-2 rounded-[7px] border border-line bg-card px-2.5 text-[13px] text-ink-3 transition-colors hover:border-brand-line hover:text-ink-2 sm:flex"
        >
          <span className="text-ai">✦</span>
          <span className="hidden md:inline">Ask anything…</span>
          <kbd className="ml-4 hidden md:inline">⌘K</kbd>
        </button>

        <button
          onClick={() => setAskOpen(true)}
          aria-label="Ask"
          className="focus-ring grid h-8 w-8 place-items-center rounded-[7px] border border-line bg-card text-ai sm:hidden"
        >
          ✦
        </button>

        {aiMode === "mock" && (
          <span
            title="No GEMINI_API_KEY set — AI features run on local mock generation. Add a key to .env.local for live models."
            className="hidden rounded-full border border-attention-line bg-attention-tint px-2 py-0.5 text-[11px] font-medium text-attention lg:inline"
          >
            AI: mock mode
          </span>
        )}

        <Link
          href="/meetings/new"
          className="focus-ring flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <span className="text-[15px] leading-none">+</span>
          <span className="hidden sm:inline">Log meeting</span>
        </Link>
      </header>

      {askOpen && <AskPalette onClose={() => setAskOpen(false)} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}
