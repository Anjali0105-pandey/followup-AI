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
export function currentUser(): SessionUser {
  const row = db
    .prepare("SELECT u.*, w.name AS workspace FROM users u JOIN workspaces w ON w.id = u.workspace_id LIMIT 1")
    .get() as { id: number; name: string; role: string; email: string; workspace: string } | undefined;

  const fallback = { id: 0, name: "Sales Rep", role: "Account Executive", email: "", workspace: "Workspace" };
  const u = row ?? fallback;
  return { ...u, firstName: u.name.split(" ")[0] };
}

export function navCounts() {
  const t = today();
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    followups: n("SELECT COUNT(*) n FROM commitments WHERE owner='me' AND status='open' AND due_date <= ?", t),
    overdue: n("SELECT COUNT(*) n FROM commitments WHERE owner='me' AND status='open' AND due_date < ?", t),
    commitments: n("SELECT COUNT(*) n FROM commitments WHERE status IN ('open','snoozed')"),
    insights: n(
      `SELECT (SELECT COUNT(*) FROM opportunities WHERE stage NOT IN ('won','lost') AND json_array_length(risk_reasons) >= 2)
            + (SELECT COUNT(*) FROM signals WHERE kind='question' AND resolved_at IS NULL) AS n`,
    ),
  };
}
