"use client";

import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export interface NavCounts {
  followups: number;
  overdue: number;
  commitments: number;
  insights: number;
}

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
  count?: number;
  countTone?: "risk" | "neutral";
  soon?: boolean;
  shortcut?: string;
}

/* Inline SVGs rather than an icon dependency: nine icons is not worth a
   package, and these inherit currentColor cleanly. */
const I = {
  home: <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V9.5Z" />,
  check: <path d="M4 10.5 8 14.5 16 5.5" />,
  handshake: <path d="M3 8h3l2.5 2.5a2 2 0 0 0 2.8 0L14 8h3M3 8v5a1 1 0 0 0 1 1h1M17 8v5a1 1 0 0 1-1 1h-1M6 6h8" />,
  calendar: <path d="M4 5h12v11H4zM4 8.5h12M7.5 3v3M12.5 3v3" />,
  users: <path d="M7.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 16c0-2.2 2-3.6 4.5-3.6S12 13.8 12 16M13.5 6.2a2 2 0 0 1 0 3.8M14 12.6c1.8.3 3 1.5 3 3.4" />,
  pipeline: <path d="M3.5 4.5h13M5 8.5h10M7 12.5h6M9 16.5h2" />,
  spark: <path d="M10 3.5 11.6 8 16 9.6 11.6 11.2 10 15.6 8.4 11.2 4 9.6 8.4 8Z" />,
  inbox: <path d="M3.5 11.5 5.5 5h9l2 6.5v3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-3Zm0 0h3.2l.9 2h4.8l.9-2h3.2" />,
  chart: <path d="M4 16V9M9 16V4.5M14 16v-4.5M3 17h14" />,
  gear: <path d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM16.4 12a1.3 1.3 0 0 0 .3 1.4l.1.1a1.6 1.6 0 1 1-2.2 2.2l-.1-.1a1.3 1.3 0 0 0-2.2.9v.1a1.6 1.6 0 1 1-3.2 0v-.1a1.3 1.3 0 0 0-2.2-.9l-.1.1a1.6 1.6 0 1 1-2.2-2.2l.1-.1a1.3 1.3 0 0 0-.9-2.2h-.1a1.6 1.6 0 1 1 0-3.2h.1a1.3 1.3 0 0 0 .9-2.2l-.1-.1a1.6 1.6 0 1 1 2.2-2.2l.1.1a1.3 1.3 0 0 0 2.2-.9v-.1a1.6 1.6 0 1 1 3.2 0v.1a1.3 1.3 0 0 0 2.2.9l.1-.1a1.6 1.6 0 1 1 2.2 2.2l-.1.1a1.3 1.3 0 0 0 .9 2.2h.1a1.6 1.6 0 1 1 0 3.2h-.1a1.3 1.3 0 0 0-1.2.8Z" />,
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
      {children}
    </svg>
  );
}

/* The collapsed flag lives in localStorage, which is an external store rather
   than React state — subscribing to it keeps the server render (always
   expanded) and the client in agreement without a setState-in-effect. */
const SIDEBAR_KEY = "fu.sidebar";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const getSnapshot = () => localStorage.getItem(SIDEBAR_KEY) === "collapsed";
const getServerSnapshot = () => false;

export default function Sidebar({
  counts,
  user,
}: {
  counts: NavCounts;
  user: { name: string; role: string; workspace: string; isAdmin: boolean };
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = useCallback(() => {
    localStorage.setItem(SIDEBAR_KEY, getSnapshot() ? "open" : "collapsed");
    listeners.forEach((l) => l());
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const groups: { label: string; items: Item[] }[] = [
    {
      label: "Work",
      items: [
        { href: "/", label: "Command Center", icon: <Icon>{I.home}</Icon>, shortcut: "1" },
        { href: "/followups", label: "Follow-ups", icon: <Icon>{I.check}</Icon>, count: counts.followups, countTone: counts.overdue > 0 ? "risk" : "neutral", shortcut: "2" },
        { href: "/commitments", label: "Commitments", icon: <Icon>{I.handshake}</Icon>, count: counts.commitments, shortcut: "3" },
        { href: "/meetings", label: "Meetings", icon: <Icon>{I.calendar}</Icon>, shortcut: "4" },
      ],
    },
    {
      label: "Pipeline",
      items: [
        { href: "/customers", label: "Customers", icon: <Icon>{I.users}</Icon>, shortcut: "5" },
        { href: "/opportunities", label: "Opportunities", icon: <Icon>{I.pipeline}</Icon>, shortcut: "6" },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { href: "/insights", label: "AI Insights", icon: <Icon>{I.spark}</Icon>, count: counts.insights, shortcut: "7" },
        { href: "/inbox", label: "Inbox", icon: <Icon>{I.inbox}</Icon>, soon: true },
        { href: "/analytics", label: "Analytics", icon: <Icon>{I.chart}</Icon>, soon: true },
      ],
    },
    // Only rendered for admins; the route itself 404s for everyone else.
    ...(user.isAdmin
      ? [{ label: "Operations", items: [{ href: "/admin", label: "Admin", icon: <Icon>{I.chart}</Icon> }] }]
      : []),
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const width = collapsed ? "w-[64px]" : "w-[236px]";

  const nav = (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center gap-2 border-b border-line px-3 ${collapsed ? "justify-center" : ""}`}>
        <Link href="/" onClick={closeMobile} className="flex items-center gap-2 focus-ring rounded">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand text-[13px] font-bold text-white">F</span>
          {!collapsed && <span className="t-h2 tracking-tight">FollowUp AI</span>}
        </Link>
      </div>

      <nav className="thin-scroll flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {!collapsed && <div className="t-label px-2 pb-1.5">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={closeMobile}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`focus-ring group flex items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-[13px] transition-colors ${
                        active ? "bg-brand-tint font-medium text-brand" : "text-ink-2 hover:bg-sunken hover:text-ink"
                      } ${collapsed ? "justify-center" : ""}`}
                    >
                      {item.icon}
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.soon && <span className="t-label text-[9px] text-ink-3">Soon</span>}
                          {item.count != null && item.count > 0 && (
                            <span
                              className={`tabular rounded-full px-1.5 py-px text-[11px] font-medium ${
                                item.countTone === "risk" ? "bg-risk-tint text-risk" : "bg-sunken text-ink-2"
                              }`}
                            >
                              {item.count}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <Link
          href="/settings"
          onClick={closeMobile}
          className={`focus-ring flex items-center gap-2.5 rounded-[7px] px-2 py-2 text-[13px] transition-colors hover:bg-sunken ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
            {user.name.split(" ").map((p) => p[0]).join("")}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{user.name}</span>
              <span className="block truncate text-[11px] text-ink-3">{user.workspace}</span>
            </span>
          )}
        </Link>
        <div className={`mt-1 flex ${collapsed ? "justify-center" : "px-2"}`}>
          <SignOutButton>
            <button className="focus-ring rounded-[7px] px-1 py-1 text-[12px] text-ink-3 transition-colors hover:text-ink-2">
              {collapsed ? "\u21AA" : "Sign out"}
            </button>
          </SignOutButton>
        </div>
        <button
          onClick={toggle}
          className="focus-ring mt-1 hidden w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[12px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink-2 lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[18px] w-[18px] shrink-0">
            <path d={collapsed ? "M7 5l5 5-5 5" : "M13 5l-5 5 5 5"} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && "Collapse"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile trigger lives in the top bar; this is the overlay drawer. */}
      <button
        onClick={() => setMobileOpen(true)}
        className="focus-ring fixed left-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-[7px] border border-line bg-card lg:hidden"
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.5" fill="none" className="h-[18px] w-[18px]">
          <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
        </svg>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/25" onClick={closeMobile} />
          <aside className="anim-drawer absolute left-0 top-0 h-full w-[236px] border-r border-line bg-card">{nav}</aside>
        </div>
      )}

      <aside
        className={`${width} sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-card transition-[width] duration-200 lg:block`}
      >
        {nav}
      </aside>
    </>
  );
}
