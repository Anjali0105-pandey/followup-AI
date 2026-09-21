"use client";

import { useEffect } from "react";

/**
 * Tracks how many modal overlays are open.
 *
 * The priority feed's single-key shortcuts (D done, S snooze, C draft) listen
 * on `window`, so with the generator drawer or Ask palette open, typing outside
 * a text field still completed or snoozed the commitment hidden behind it. The
 * count lives on `document.body` rather than in React state because the
 * listeners are in sibling trees that share no provider, and because nesting
 * two overlays must not unlock on the first close.
 */
const ATTR = "data-overlay-depth";

function depth(): number {
  if (typeof document === "undefined") return 0;
  return Number(document.body.getAttribute(ATTR) ?? "0");
}

/** True while any modal overlay is mounted. Safe to call during an event. */
export function overlayOpen(): boolean {
  return depth() > 0;
}

/** Call from a modal component: marks an overlay open for as long as it lives. */
export function useOverlayLock(): void {
  useEffect(() => {
    document.body.setAttribute(ATTR, String(depth() + 1));
    return () => {
      const next = depth() - 1;
      if (next > 0) document.body.setAttribute(ATTR, String(next));
      else document.body.removeAttribute(ATTR);
    };
  }, []);
}

/**
 * True when the event came from somewhere typing should win — a text field, or
 * anywhere inside an open overlay.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable) {
    return true;
  }
  return overlayOpen();
}
