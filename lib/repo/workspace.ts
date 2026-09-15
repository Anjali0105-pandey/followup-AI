import db from "@/lib/db";
import { today } from "@/lib/dates";

export interface SessionUser {
  id: number;
  name: string;
  firstName: string;
  role: string;
  email: string;
  workspace: string;
}

/**
 * Single-tenant demo: there is exactly one seeded user. This function is the
 * seam where real auth plugs in later — every caller already treats the
 * current user as something it is *given*, not something it assumes.
 */
export async function currentUser(): Promise<SessionUser> {
  const row = await db.get<{
    id: number;
    name: string;
    role: string;
    email: string;
    workspace: string;
  }>(
    "SELECT u.*, w.name AS workspace FROM users u JOIN workspaces w ON w.id = u.workspace_id LIMIT 1",
  );

  const fallback = { id: 0, name: "Sales Rep", role: "Account Executive", email: "", workspace: "Workspace" };
  const u = row ?? fallback;
  return { ...u, firstName: u.name.split(" ")[0] };
}

export async function navCounts() {
  const t = today();
  // Postgres returns COUNT() as bigint, which the driver hands back as a
  // string — the ::int casts keep these numbers.
  const n = async (sql: string, ...p: unknown[]) =>
    (await db.get<{ n: number }>(sql, ...p))?.n ?? 0;

  const [followups, overdue, commitments, insights] = await Promise.all([
    n("SELECT COUNT(*)::int n FROM commitments WHERE owner='me' AND status='open' AND due_date <= ?", t),
    n("SELECT COUNT(*)::int n FROM commitments WHERE owner='me' AND status='open' AND due_date < ?", t),
    n("SELECT COUNT(*)::int n FROM commitments WHERE status IN ('open','snoozed')"),
    n(
      `SELECT ((SELECT COUNT(*) FROM opportunities WHERE stage NOT IN ('won','lost') AND jsonb_array_length(risk_reasons) >= 2)
             + (SELECT COUNT(*) FROM signals WHERE kind='question' AND resolved_at IS NULL))::int AS n`,
    ),
  ]);

  return { followups, overdue, commitments, insights };
}
