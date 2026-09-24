import db from "../lib/db";
import { SCHEMA_SQL } from "../lib/schema";

/**
 * Applies the schema without touching a single row.
 *
 * Until this existed, SCHEMA_SQL was only ever executed by seed(), which
 * TRUNCATEs every table first — so the only supported way to add a column was
 * to destroy all the data. That is fine for a demo bootstrap and unusable for
 * a database anyone cares about.
 *
 * Safe to run repeatedly and safe to run against a populated database: every
 * statement in SCHEMA_SQL is CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD
 * COLUMN IF NOT EXISTS, or CREATE INDEX IF NOT EXISTS. Nothing drops, nothing
 * rewrites, nothing back-fills.
 */
const before = await db.all<{ table_name: string; column_name: string }>(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
);

await db.exec(SCHEMA_SQL);

const after = await db.all<{ table_name: string; column_name: string }>(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
);

const key = (r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`;
const had = new Set(before.map(key));
const added = after.map(key).filter((k) => !had.has(k));

console.log(`Schema applied. ${after.length} columns across ${new Set(after.map((r) => r.table_name)).size} tables.`);
if (added.length === 0) console.log("No changes — the database was already up to date.");
else console.log(`Added: ${added.join(", ")}`);

// The pg pool holds the process open otherwise.
process.exit(0);
