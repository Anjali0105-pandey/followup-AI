// Importing this from a Client Component is always a bug — `server-only`
// turns that into a build error instead of a confusing bundler failure.
import "server-only";
import { Pool, type QueryResultRow } from "pg";

/**
 * Postgres access layer.
 *
 * The repo layer was written against better-sqlite3's synchronous
 * prepare().all()/.get()/.run() shape. These helpers keep that shape — minus
 * the prepare step, plus a promise — so the queries themselves survive the
 * move mostly intact.
 *
 * Placeholders stay as `?` at the call sites and are rewritten to Postgres's
 * `$n` here, so no query string has to be renumbered by hand.
 */

declare global {
  // Next.js dev reloads this module on every edit; without a global handle each
  // reload would leak a fresh pool until Neon refuses new connections.
  var __followupPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — add it to .env.local (see .env.local.example).");
  }
  return new Pool({
    connectionString,
    // Neon's pooled endpoint does the heavy lifting; a small local ceiling
    // keeps serverless instances from each opening a wide pool.
    max: 5,
    idleTimeoutMillis: 30_000,
  });
}

const pool = globalThis.__followupPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__followupPool = pool;

/** `SELECT ... WHERE x = ?` → `SELECT ... WHERE x = $1`. */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function all<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(toPg(sql), params);
  return res.rows;
}

export async function get<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const res = await pool.query<T>(toPg(sql), params);
  return res.rows[0];
}

export async function run(sql: string, ...params: unknown[]): Promise<number> {
  const res = await pool.query(toPg(sql), params);
  return res.rowCount ?? 0;
}

/** For INSERTs. The statement must end with `RETURNING id`. */
export async function insert(sql: string, ...params: unknown[]): Promise<number> {
  const res = await pool.query<{ id: number }>(toPg(sql), params);
  const id = res.rows[0]?.id;
  if (id == null) throw new Error("insert() requires a RETURNING id clause");
  return id;
}

/** Multi-statement DDL. No placeholders. */
export async function exec(sql: string): Promise<void> {
  await pool.query(sql);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function tx<T>(fn: (c: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const client_: TxClient = {
      all: async (sql, ...params) => (await client.query(toPg(sql), params)).rows,
      get: async (sql, ...params) => (await client.query(toPg(sql), params)).rows[0],
      run: async (sql, ...params) => (await client.query(toPg(sql), params)).rowCount ?? 0,
      insert: async (sql, ...params) => {
        const res = await client.query<{ id: number }>(toPg(sql), params);
        const id = res.rows[0]?.id;
        if (id == null) throw new Error("insert() requires a RETURNING id clause");
        return id;
      },
      exec: async (sql) => void (await client.query(sql)),
    };
    const out = await fn(client_);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface TxClient {
  all<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    ...params: unknown[]
  ): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<number>;
  insert(sql: string, ...params: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
}

const db = { all, get, run, insert, exec, tx };
export default db;
