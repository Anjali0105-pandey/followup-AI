/**
 * Date helpers. Everything in the app uses YYYY-MM-DD day strings.
 *
 * "Which day is it" is a per-user question, not a per-server one. Called with
 * no argument these still read the *runtime's* local day, which is correct in a
 * browser — that is the user's own clock — and wrong on a server, where Vercel
 * runs UTC. So every server-side caller passes the user's timezone (or a day
 * already resolved in it); see currentDay() in lib/repo/workspace.ts.
 *
 * Passing nothing keeps the old behaviour exactly, which is what makes this
 * safe to adopt call site by call site, and what a workspace with no timezone
 * recorded yet still gets.
 */

/**
 * Today's date in `timeZone`, or in the runtime's own zone when omitted.
 *
 * `en-CA` formats as YYYY-MM-DD, which is the shape every date column and
 * comparison in this app already uses — cheaper and less error-prone than
 * reassembling the parts by hand.
 */
export function today(timeZone?: string): string {
  if (!timeZone) return toDay(new Date());
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unknown or malformed zone must not take a page down; the runtime's
    // own day is a defensible fallback and matches the pre-timezone behaviour.
    return toDay(new Date());
  }
}

export function toDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Whole days from `from` to `to`. Negative means `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function daysAgo(day: string | null, reference: string = today()): number | null {
  if (!day) return null;
  return daysBetween(day, reference);
}

/** "Today", "Tomorrow", "3 days overdue", "Fri 12 Sep" — for due dates. */
export function relativeDue(day: string, reference: string = today()): string {
  const diff = daysBetween(reference, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < -1) return `${-diff} days overdue`;
  if (diff <= 6) return formatDay(day, { weekday: "long" });
  return formatDay(day);
}

/** "2 days ago", "Today", "3 weeks ago" — for past events. */
export function relativePast(day: string | null, reference: string = today()): string {
  if (!day) return "Never";
  const diff = daysBetween(day.slice(0, 10), reference);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 21) return `${diff} days ago`;
  if (diff < 60) return `${Math.round(diff / 7)} weeks ago`;
  return `${Math.round(diff / 30)} months ago`;
}

export function formatDay(day: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-US", opts ?? { month: "short", day: "numeric" });
}

/** Bucket label used to group commitment lists. */
export function dueBucket(day: string, reference: string = today()): string {
  const diff = daysBetween(reference, day);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7) return "This week";
  return "Later";
}

export const DUE_BUCKET_ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later"];
