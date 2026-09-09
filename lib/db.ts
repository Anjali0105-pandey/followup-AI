// Importing this from a Client Component is always a bug — `server-only`
// turns that into a build error instead of a confusing bundler failure.
import "server-only";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "followup.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Schema v2. The v1 schema (customers + meetings only) could not express an
// opportunity, a commitment, or a channel, which is why the v1 UI could only
// ever render "customer + date". SCHEMA_VERSION gates a destructive rebuild:
// this is a local demo database seeded from lib/seed/demo.ts, so migrating v1
// rows forward would be more code than it is worth.
const SCHEMA_VERSION = 2;

function currentVersion(): number {
  return (db.pragma("user_version", { simple: true }) as number) ?? 0;
}

if (currentVersion() < SCHEMA_VERSION) {
  db.exec(`
    DROP TABLE IF EXISTS generated_messages;
    DROP TABLE IF EXISTS commitments;
    DROP TABLE IF EXISTS signals;
    DROP TABLE IF EXISTS interactions;
    DROP TABLE IF EXISTS opportunities;
    DROP TABLE IF EXISTS contacts;
    DROP TABLE IF EXISTS meetings;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS workspaces;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'pro',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Account Executive',
    initials TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    is_decision_maker INTEGER NOT NULL DEFAULT 0,
    is_champion INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    stage TEXT NOT NULL DEFAULT 'new',
    probability INTEGER NOT NULL DEFAULT 10,
    expected_close_date TEXT,
    primary_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    priority_score INTEGER NOT NULL DEFAULT 0,
    priority_band TEXT NOT NULL DEFAULT 'low',
    priority_reasons TEXT NOT NULL DEFAULT '[]',
    risk_reasons TEXT NOT NULL DEFAULT '[]',
    last_interaction_at TEXT,
    next_action_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interaction_id INTEGER REFERENCES interactions(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT,
    strength INTEGER NOT NULL DEFAULT 2,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generated_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER REFERENCES commitments(id) ON DELETE SET NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    body TEXT NOT NULL,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(status, due_date);
  CREATE INDEX IF NOT EXISTS idx_commitments_customer ON commitments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_interactions_customer ON interactions(customer_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_signals_customer ON signals(customer_id);
  CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);
`);

db.pragma(`user_version = ${SCHEMA_VERSION}`);

export default db;
