import "server-only";
import db from "@/lib/db";
import { currentUser } from "@/lib/repo/workspace";

/**
 * Admin overview — operational metrics only.
 *
 * Deliberately no pipeline content: an admin can see that a user has 12
 * customers, never who they are. That keeps support useful without making
 * every admin account a read-through to everyone's private deal data, and it
 * means this screen needs no privacy disclosure.
 */

export interface AdminUserRow {
  id: number;
  name: string;
  email: string;
  workspace: string;
  isAdmin: boolean;
  hasOwnKey: boolean;
  createdAt: string | null;
  lastActiveAt: string | null;
  customers: number;
  opportunities: number;
  commitments: number;
  meetings: number;
  pipelineValue: number;
}

export interface AdminOverview {
  totals: {
    users: number;
    workspaces: number;
    activeThisWeek: number;
    withOwnKey: number;
  };
  users: AdminUserRow[];
}

/** Throws unless the caller is an admin. Every admin read goes through this. */
export async function assertAdmin() {
  const user = await currentUser();
  if (!user.isAdmin) throw new Error("Not authorised");
  return user;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await assertAdmin();

  const [totals, users] = await Promise.all([
    db.get<{ users: number; workspaces: number; active_week: number; with_key: number }>(
      `SELECT (SELECT COUNT(*) FROM users)::int                              AS users,
              (SELECT COUNT(*) FROM workspaces)::int                         AS workspaces,
              (SELECT COUNT(*) FROM users
                WHERE last_active_at > now() - interval '7 days')::int       AS active_week,
              (SELECT COUNT(*) FROM users WHERE ai_key_ciphertext IS NOT NULL)::int AS with_key`,
    ),
    db.all<{
      id: number;
      name: string;
      email: string;
      workspace: string;
      is_admin: number;
      has_own_key: boolean;
      created_at: Date | null;
      last_active_at: Date | null;
      customers: number;
      opportunities: number;
      commitments: number;
      meetings: number;
      pipeline_value: number;
    }>(
      `SELECT u.id, u.name, u.email, u.is_admin, u.created_at, u.last_active_at,
              w.name AS workspace,
              (u.ai_key_ciphertext IS NOT NULL) AS has_own_key,
              (SELECT COUNT(*) FROM customers c WHERE c.workspace_id = w.id)::int AS customers,
              (SELECT COUNT(*) FROM opportunities o JOIN customers c ON c.id = o.customer_id
                WHERE c.workspace_id = w.id)::int AS opportunities,
              (SELECT COUNT(*) FROM commitments cm JOIN customers c ON c.id = cm.customer_id
                WHERE c.workspace_id = w.id)::int AS commitments,
              (SELECT COUNT(*) FROM interactions i JOIN customers c ON c.id = i.customer_id
                WHERE c.workspace_id = w.id AND i.type = 'meeting')::int AS meetings,
              COALESCE((SELECT SUM(o.value) FROM opportunities o JOIN customers c ON c.id = o.customer_id
                WHERE c.workspace_id = w.id AND o.stage NOT IN ('won','lost')), 0)::float8 AS pipeline_value
       FROM users u JOIN workspaces w ON w.id = u.workspace_id
       ORDER BY u.last_active_at DESC NULLS LAST, u.id`,
    ),
  ]);

  return {
    totals: {
      users: totals?.users ?? 0,
      workspaces: totals?.workspaces ?? 0,
      activeThisWeek: totals?.active_week ?? 0,
      withOwnKey: totals?.with_key ?? 0,
    },
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      workspace: u.workspace,
      isAdmin: u.is_admin === 1,
      hasOwnKey: u.has_own_key,
      createdAt: u.created_at ? u.created_at.toISOString() : null,
      lastActiveAt: u.last_active_at ? u.last_active_at.toISOString() : null,
      customers: u.customers,
      opportunities: u.opportunities,
      commitments: u.commitments,
      meetings: u.meetings,
      pipelineValue: u.pipeline_value,
    })),
  };
}
