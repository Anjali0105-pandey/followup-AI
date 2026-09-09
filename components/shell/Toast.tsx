"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  tone: "default" | "positive" | "risk";
  undo?: () => void;
}

const ToastCtx = createContext<{
  toast: (message: string, opts?: { tone?: Toast["tone"]; undo?: () => void }) => void;
}>({ toast: () => {} });

export const useToast = () => useContext(ToastCtx);

/** Toasts carry the undo affordance for destructive actions — complete,
    snooze and delete are all reversible for five seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, opts?: { tone?: Toast["tone"]; undo?: () => void }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone: opts?.tone ?? "default", undo: opts?.undo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="anim-in pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[13px] text-white shadow-[var(--shadow-overlay)]"
          >
            {t.tone === "positive" && <span className="text-emerald-300">✓</span>}
            {t.tone === "risk" && <span className="text-rose-300">!</span>}
            <span>{t.message}</span>
            {t.undo && (
              <button
                onClick={() => {
                  t.undo?.();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
                className="focus-ring rounded px-1.5 py-0.5 font-medium text-white/70 underline-offset-2 hover:text-white hover:underline"
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
