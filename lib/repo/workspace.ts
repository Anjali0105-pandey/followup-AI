import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { today } from "@/lib/dates";

/**
 * Clerk is imported lazily rather than at module scope. The seed script runs
 * under plain Node, which cannot resolve Clerk's ESM subpath exports — and it
 * reaches this module transitively through the repo layer. Deferring the
 * import keeps the CLI path working, since the seed never asks for a session.
 */
async function clerk() {
  return import("@clerk/nextjs/server");
}

export interface SessionUser {
  id: number;
  workspaceId: number;
  name: string;
  firstName: string;
  role: string;
  email: string;
  workspace: string;
  isAdmin: boolean;
  /** IANA zone the browser last reported, or null before it has. */
  timeZone: string | null;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

interface UserRow {
  id: number;
  workspace_id: number;
  name: string;
  role: string;
  email: string;
  is_admin: number;
  timezone: string | null;
  workspace: string;
}

const SELECT_USER = `
  SELECT u.id, u.workspace_id, u.name, u.role, u.email, u.is_admin, u.timezone, w.name AS workspace
  FROM users u JOIN workspaces w ON w.id = u.workspace_id
`;

/**
 * Admins are named explicitly in the environment rather than promoted in the
 * UI. A "first user becomes admin" rule would hand the role to whoever signs
 * up first in production, which is not a race worth running.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The signed-in user, provisioned on first sign-in. Never falls back to a
 * default account: doing so would hand one tenant another tenant's pipeline.
 */
export const currentUser = cache(async function currentUser(): Promise<SessionUser> {
  const { auth } = await clerk();
  const { userId: clerkId } = await auth();
  /* Next renders layouts and pages in parallel, so a page reaches this before
     the layout's redirect takes effect. Redirecting here too means a signed-out
     request ends at the sign-in screen rather than throwing first. */
  if (!clerkId) redirect("/sign-in");

  const existing = await db.get<UserRow>(`${SELECT_USER} WHERE u.clerk_user_id = ?`, clerkId);
  const row = existing ?? (await provision(clerkId));

  // Re-evaluated on every sign-in so revoking an admin is a config change
  // rather than a database edit.
  const shouldBeAdmin = adminEmails().includes(row.email.toLowerCase());
  if (shouldBeAdmin !== (row.is_admin === 1)) {
    await db.run("UPDATE users SET is_admin = ? WHERE id = ?", shouldBeAdmin ? 1 : 0, row.id);
    row.is_admin = shouldBeAdmin ? 1 : 0;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    firstName: row.name.split(" ")[0],
    role: row.role,
    email: row.email,
    workspace: row.workspace,
    isAdmin: row.is_admin === 1,
    timeZone: row.timezone,
  };
});

/**
 * Today, in the signed-in user's own timezone.
 *
 * Every server-side date decision goes through this rather than `today()`:
 * which follow-ups are due, what counts as overdue, which tab a row lands in.
 * The server runs UTC on Vercel, so calling bare `today()` there put a rep in
 * IST on the wrong day for the first 5.5 hours of theirs — an item due today
 * reading as "Tomorrow", and overdue counts a day short.
 *
 * cache() collapses this to one lookup per request, and a user who has not
 * reported a zone yet gets the server's own day, which is the previous
 * behaviour rather than a new failure mode.
 */
export const currentDay = cache(async function currentDay(): Promise<string> {
  const { timeZone } = await currentUser();
  return today(timeZone ?? undefined);
});

/**
 * Records the zone the browser reported. Written only when it actually
 * changes, so a rep reloading all day costs no writes — and a rep who flies
 * somewhere gets their dates corrected on the next page load.
 */
export async function setUserTimeZone(userId: number, timeZone: string): Promise<void> {
  await db.run("UPDATE users SET timezone = ? WHERE id = ? AND timezone IS DISTINCT FROM ?", timeZone, userId, timeZone);
}

/**
 * The tenant boundary. Every repo query filters on this rather than taking a
 * workspace id as an argument — a caller cannot forget to pass it, and there
 * is no signature through which one tenant could request another's rows.
 * React's cache() collapses the lookup to once per request.
 */
export async function currentWorkspaceId(): Promise<number> {
  return (await currentUser()).workspaceId;
}

/**
 * First sign-in. The very first person to sign in adopts the seeded demo
 * workspace so the product has something to show; everyone after gets their
 * own empty workspace of their own.
 */
async function provision(clerkId: string): Promise<UserRow> {
  const { currentUser: clerkCurrentUser } = await clerk();
  const profile = await clerkCurrentUser();
  const email = profile?.primaryEmailAddress?.emailAddress ?? "";
  const name =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    profile?.username ||
    email.split("@")[0] ||
    "New user";

  const claimed = await db.get<{ id: number }>(
    `UPDATE users SET clerk_user_id = ?, name = ?, email = COALESCE(NULLIF(?, ''), email),
                      initials = ?, last_active_at = now()
     WHERE id = (SELECT id FROM users WHERE clerk_user_id IS NULL ORDER BY id LIMIT 1)
     RETURNING id`,
    clerkId,
    name,
    email,
    initialsOf(name),
  );

  if (!claimed) {
    const workspaceId = await db.insert(
      "INSERT INTO workspaces (name, plan) VALUES (?, 'free') RETURNING id",
      `${name.split(" ")[0]}'s workspace`,
    );
    await db.insert(
      `INSERT INTO users (workspace_id, name, email, role, initials, clerk_user_id, last_active_at)
       VALUES (?, ?, ?, 'Account Executive', ?, ?, now()) RETURNING id`,
      workspaceId,
      name,
      email,
      initialsOf(name),
      clerkId,
    );
  }

  const row = await db.get<UserRow>(`${SELECT_USER} WHERE u.clerk_user_id = ?`, clerkId);
  if (!row) throw new Error("Failed to provision user");
  return row;
}

/** Fire-and-forget activity stamp, used by the admin overview. */
export async function touchLastActive(userId: number): Promise<void> {
  await db.run("UPDATE users SET last_active_at = now() WHERE id = ?", userId);
}

export async function navCounts() {
  const [t, { workspaceId }] = await Promise.all([currentDay(), currentUser()]);
  // Postgres returns COUNT() as bigint, which the driver hands back as a
  // string — the ::int casts keep these numbers.
  const n = async (sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))?.n ?? 0;

  const [followups, overdue, commitments, insights] = await Promise.all([
    n(
      `SELECT COUNT(*)::int n FROM commitments cm JOIN customers c ON c.id = cm.customer_id
       WHERE c.workspace_id = ? AND cm.owner='me' AND cm.status='open' AND cm.due_date <= ?`,
      workspaceId,
      t,
    ),
    n(
      `SELECT COUNT(*)::int n FROM commitments cm JOIN customers c ON c.id = cm.customer_id
       WHERE c.workspace_id = ? AND cm.owner='me' AND cm.status='open' AND cm.due_date < ?`,
      workspaceId,
      t,
    ),
    n(
      `SELECT COUNT(*)::int n FROM commitments cm JOIN customers c ON c.id = cm.customer_id
       WHERE c.workspace_id = ? AND cm.status IN ('open','snoozed')`,
      workspaceId,
    ),
    n(
      `SELECT ((SELECT COUNT(*) FROM opportunities o JOIN customers c ON c.id = o.customer_id
                 WHERE c.workspace_id = ? AND o.stage NOT IN ('won','lost')
                   AND jsonb_array_length(o.risk_reasons) >= 2)
             + (SELECT COUNT(*) FROM signals s JOIN customers c ON c.id = s.customer_id
                 WHERE c.workspace_id = ? AND s.kind='question' AND s.resolved_at IS NULL))::int AS n`,
      workspaceId,
      workspaceId,
    ),
  ]);

  return { followups, overdue, commitments, insights };
}

/**
 * The authorization gate for Server Actions.
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * request — it does NOT render through app/(app)/layout.tsx, so the layout's
 * redirect protects pages only. Every action must therefore call this (or
 * assertAdmin) *before* its first write. Two actions previously did not, and an
 * unauthenticated POST could write to the database.
 *
 * currentUser() redirects a signed-out caller to /sign-in, which is the desired
 * outcome for a real user whose session expired mid-task; the important part is
 * that nothing after this line runs without a session.
 */
export async function requireUser(): Promise<SessionUser> {
  return currentUser();
}
