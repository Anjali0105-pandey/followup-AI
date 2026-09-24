import "server-only";

/**
 * Postgres schema. Ported from the SQLite original, with the differences that
 * mattered: identity columns instead of AUTOINCREMENT, `now()` instead of
 * `datetime('now')`, and `jsonb` for the two columns the insight queries have
 * to look inside (`priority_reasons`, `risk_reasons`).
 *
 * Boolean-ish flags stay as smallint 0/1 rather than becoming real booleans —
 * the app reads them as numbers, and changing that is a separate refactor with
 * no user-visible payoff.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Account Executive',
  initials TEXT NOT NULL DEFAULT '',
  -- Set once Clerk is wired up; null for the seeded demo user.
  clerk_user_id TEXT UNIQUE,
  is_admin SMALLINT NOT NULL DEFAULT 0,
  -- Bring-your-own AI key. Ciphertext only (see lib/crypto.ts) — the
  -- plaintext must never be stored, logged, or returned to a browser.
  -- ai_key_hint is the masked form that IS safe to display.
  ai_key_provider TEXT,
  ai_key_ciphertext TEXT,
  ai_key_hint TEXT,
  ai_key_updated_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  -- IANA zone, e.g. 'Asia/Kolkata'. Reported by the browser on sign-in.
  -- "Today" is a per-user question: the server runs UTC, so without this a
  -- rep in IST sees the wrong day's work list for the first 5.5 hours of
  -- theirs. Null means "not reported yet" and falls back to server-local.
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  segment TEXT,
  health TEXT NOT NULL DEFAULT 'healthy',
  ai_summary TEXT,
  facts TEXT NOT NULL DEFAULT '{}',
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_decision_maker SMALLINT NOT NULL DEFAULT 0,
  is_champion SMALLINT NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  stage TEXT NOT NULL DEFAULT 'new',
  probability INTEGER NOT NULL DEFAULT 10,
  expected_close_date TEXT,
  primary_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  priority_score INTEGER NOT NULL DEFAULT 0,
  priority_band TEXT NOT NULL DEFAULT 'low',
  priority_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_interaction_at TEXT,
  next_action_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  occurred_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  transcript TEXT,
  ai_summary TEXT,
  ai_processed_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  interaction_id INTEGER REFERENCES interactions(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  strength INTEGER NOT NULL DEFAULT 2,
  resolved_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  interaction_id INTEGER REFERENCES interactions(id) ON DELETE SET NULL,
  owner TEXT NOT NULL DEFAULT 'me',
  kind TEXT NOT NULL DEFAULT 'email',
  title TEXT NOT NULL,
  detail TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  snoozed_until TEXT,
  completed_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commitment_id INTEGER REFERENCES commitments(id) ON DELETE SET NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* Additive migrations for databases created before these columns existed.
   CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so new columns
   have to be added explicitly. All are idempotent and safe to re-run. */
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_key_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_key_ciphertext TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_key_hint TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_key_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_commitments_customer ON commitments(customer_id);
CREATE INDEX IF NOT EXISTS idx_interactions_customer ON interactions(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_customer ON signals(customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);
`;

/** Dropped in dependency order so the FKs never block the rebuild. */
export const DROP_SQL = `
DROP TABLE IF EXISTS generated_messages, commitments, signals, interactions,
                     opportunities, contacts, customers, users, workspaces CASCADE;
`;
