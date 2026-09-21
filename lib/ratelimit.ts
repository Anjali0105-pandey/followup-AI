import "server-only";

/**
 * Per-user rate limiting for the expensive and destructive actions.
 *
 * The app had none, which mattered most for the AI paths: every model call is
 * billed to a key the user stored (or to the server's), and a stuck client
 * retry loop or a bored user holding down "Regenerate" could run up real spend
 * with nothing in the way. Nothing here protects against a determined attacker
 * — see the honest limits below — but it does stop the runaway cases, which are
 * the ones that actually happen.
 *
 * Deliberately a fixed window with an in-memory counter:
 *
 * - **In-memory** because the alternative is a network round-trip on every
 *   action, and this codebase's measured cost for one of those is ~280ms warm.
 *   A limiter that adds a database call to every mutation is a latency
 *   regression sold as a safety feature.
 * - **Fixed window** rather than a token bucket because the failure mode being
 *   prevented is a loop, not a carefully paced abuser, and a window is
 *   trivially auditable.
 *
 * The honest limitation: this counts per server instance. On Vercel, several
 * instances mean several independent budgets, and a cold start resets the
 * count. So treat these numbers as a circuit breaker, not a quota. A real
 * quota belongs in Postgres (a row per user per window) or Redis, and should
 * be added the moment spend is metered per customer.
 */

declare global {
  // Next reloads modules on every edit in dev; without a global handle each
  // reload would hand every user a fresh, empty budget.
  var __followupRateLimits: Map<string, { count: number; resetAt: number }> | undefined;
}

const buckets = globalThis.__followupRateLimits ?? new Map<string, { count: number; resetAt: number }>();
if (process.env.NODE_ENV !== "production") globalThis.__followupRateLimits = buckets;

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Shown to the user when they hit it, so the message names the real action. */
  label: string;
}

/**
 * Limits are set per action rather than globally: drafting is cheap and used in
 * bursts while a rep compares channels, extraction is expensive and used once
 * per meeting, and a reseed is destructive and wanted about never.
 */
export const LIMITS = {
  draft: { max: 30, windowMs: 60_000, label: "drafting follow-ups" },
  refine: { max: 40, windowMs: 60_000, label: "revising drafts" },
  extract: { max: 10, windowMs: 60_000, label: "reading meetings" },
  ask: { max: 20, windowMs: 60_000, label: "asking questions" },
  reseed: { max: 3, windowMs: 60 * 60_000, label: "resetting demo data" },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

/** Stops the map growing without bound as users and windows come and go. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/**
 * Throws when `userId` has exceeded `name`'s budget. Synchronous on purpose:
 * it must not add an `await` before an action's auth gate, and there is nothing
 * to wait for.
 *
 * The error is written for the person who hit it — what was limited and when to
 * try again — because it surfaces directly in a toast.
 */
export function checkRateLimit(name: LimitName, userId: number): void {
  const limit = LIMITS[name];
  const now = Date.now();
  sweep(now);

  const key = `${name}:${userId}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return;
  }

  if (bucket.count >= limit.max) {
    const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const wait = seconds >= 60 ? `${Math.ceil(seconds / 60)} minute${seconds >= 120 ? "s" : ""}` : `${seconds} seconds`;
    throw new Error(`You've hit the limit for ${limit.label}. Try again in ${wait}.`);
  }

  bucket.count += 1;
}
