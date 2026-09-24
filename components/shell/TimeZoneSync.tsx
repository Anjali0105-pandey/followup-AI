"use client";

import { useEffect } from "react";
import { reportTimeZoneAction } from "@/app/actions";

/**
 * Tells the server which timezone the rep is actually in.
 *
 * The server needs this because "today" decides the whole work list — which
 * follow-ups are due, what is overdue, which tab a row lands in — and on
 * Vercel the server's own clock is UTC. Without it a rep in IST spends the
 * first 5.5 hours of every day looking at yesterday's list.
 *
 * Detected rather than asked for: the browser already knows, and a timezone
 * picker is a settings page nobody wants to visit. It reports on mount and
 * whenever the detected zone differs from what the server has, so a rep who
 * travels is corrected on their next page load.
 *
 * Renders nothing. Fire-and-forget: a failed report leaves the server on its
 * own day, which is the behaviour that shipped before this existed, so there
 * is nothing to surface to the user.
 */
export default function TimeZoneSync({ current }: { current: string | null }) {
  useEffect(() => {
    let detected: string | undefined;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === current) return;
    void reportTimeZoneAction(detected).catch(() => {});
  }, [current]);

  return null;
}
