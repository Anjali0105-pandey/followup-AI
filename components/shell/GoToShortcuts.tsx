"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const ROUTES = ["/", "/followups", "/commitments", "/meetings", "/customers", "/opportunities", "/insights"];

/**
 * "G then <n>" section jumping. A chord rather than a bare digit so typing a
 * number into a filter never teleports the rep somewhere unexpected.
 */
export default function GoToShortcuts() {
  const router = useRouter();
  const armed = useRef(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;

      if (armed.current) {
        const index = parseInt(e.key, 10) - 1;
        armed.current = false;
        if (index >= 0 && index < ROUTES.length) {
          e.preventDefault();
          router.push(ROUTES[index]);
        }
        return;
      }
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) {
        armed.current = true;
        setTimeout(() => (armed.current = false), 1200);
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        router.push(ROUTES[parseInt(e.key, 10) - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
