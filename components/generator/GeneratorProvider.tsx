"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import GeneratorDrawer from "@/components/generator/GeneratorDrawer";

export interface GeneratorTarget {
  commitmentId?: number;
  customerId?: number;
  /** Pre-select a channel, e.g. the `W` shortcut opening straight to WhatsApp. */
  channel?: "email" | "whatsapp" | "linkedin" | "call_script";
}

const Ctx = createContext<{
  openGenerator: (t: GeneratorTarget) => void;
  closeGenerator: () => void;
}>({ openGenerator: () => {}, closeGenerator: () => {} });

export const useGenerator = () => useContext(Ctx);

/** The generator is global state, not a route: it must open over whatever
    screen the rep is already on without losing their place. */
export function GeneratorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<GeneratorTarget | null>(null);

  const openGenerator = useCallback((t: GeneratorTarget) => setTarget(t), []);
  const closeGenerator = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ openGenerator, closeGenerator }), [openGenerator, closeGenerator]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {target && <GeneratorDrawer target={target} onClose={closeGenerator} />}
    </Ctx.Provider>
  );
}
