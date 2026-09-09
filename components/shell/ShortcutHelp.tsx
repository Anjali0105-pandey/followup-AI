"use client";

const GROUPS = [
  {
    label: "Navigate",
    keys: [
      ["⌘K or /", "Ask anything"],
      ["G then 1-7", "Jump to a section"],
      ["?", "This help"],
      ["Esc", "Close any overlay"],
    ],
  },
  {
    label: "On the priority feed",
    keys: [
      ["J / K", "Next / previous action"],
      ["Enter", "Open the account"],
      ["D", "Mark done"],
      ["S", "Snooze 1 day"],
      ["C", "Generate follow-up"],
      ["E", "Draft email"],
      ["W", "Draft WhatsApp"],
    ],
  },
];

export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <div className="anim-in absolute left-1/2 top-1/2 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-card p-5 shadow-[var(--shadow-overlay)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="t-h2">Keyboard shortcuts</h2>
          <kbd>esc</kbd>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="t-label mb-2">{g.label}</div>
              <ul className="space-y-1.5">
                {g.keys.map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-ink-2">{v}</span>
                    <kbd>{k}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
