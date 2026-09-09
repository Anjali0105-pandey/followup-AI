/** Date helpers. Everything in the app uses local YYYY-MM-DD day strings. */

export function today(): string {
  return toDay(new Date());
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

export function daysAgo(day: string | null): number | null {
  if (!day) return null;
  return daysBetween(day, today());
}

/** "Today", "Tomorrow", "3 days overdue", "Fri 12 Sep" — for due dates. */
export function relativeDue(day: string): string {
  const diff = daysBetween(today(), day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < -1) return `${-diff} days overdue`;
  if (diff <= 6) return formatDay(day, { weekday: "long" });
  return formatDay(day);
}

/** "2 days ago", "Today", "3 weeks ago" — for past events. */
export function relativePast(day: string | null): string {
  if (!day) return "Never";
  const diff = daysBetween(day.slice(0, 10), today());
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
export function dueBucket(day: string): string {
  const diff = daysBetween(today(), day);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7) return "This week";
  return "Later";
}

export const DUE_BUCKET_ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later"];
