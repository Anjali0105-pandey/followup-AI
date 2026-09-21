// Importing this from a Client Component is always a bug — `server-only`
// turns that into a build error instead of a confusing bundler failure.
import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Pool, type QueryResultRow } from "pg";

/* Neon publishes both A and AAAA records. On a network with no working IPv6
   route to AWS, every connection stalls until the timeout.
 *
 * Preferring A records is not enough on its own: Node's Happy Eyeballs
 * (autoSelectFamily, on by default since v20) races both families and ignores
 * the resolver order, so the dead IPv6 attempt still blocks. Measured on a
 * broken-IPv6 network: ipv4first alone timed out at 15s, while turning the
 * race off connected in 3s. Where IPv6 does work this simply uses the first
 * A record, which is what we want anyway. */
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

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
    /* Opening a connection to Neon costs ~1.7s from a distant region (TLS +
       auth), against ~280ms for a query on an established one. So the pool is
       sized and kept alive to avoid reconnecting, not to cap concurrency:
       `max` sits above the widest parallel wave (computeInsights issues 8 at
       once) so queries never queue behind each other, and the idle timeout is
       long enough that a browsing session reuses warm connections instead of
       paying the handshake on every page. Safe against the `-pooler` endpoint,
       which multiplexes server-side. */
    max: 12,
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
  });
}

const pool = globalThis.__followupPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalThis.__followupPool = pool;
  /* Open a few connections up front so the first page a developer hits does
     not pay the handshake serially. Deliberately not awaited and deliberately
     dev-only — a serverless instance should connect on demand. */
  void Promise.all(Array.from({ length: 4 }, () => pool.query("SELECT 1"))).catch(() => {});
}

/** `SELECT ... WHERE x = ?` → `SELECT ... WHERE x = $1`. */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * DEBUG_SQL=1 logs every statement with its duration. Against a remote
 * database the query count matters more than query cost — each round-trip is
 * a fixed network toll — so this prints a running count to make an N+1 or an
 * accidentally sequential await chain obvious.
 */
const DEBUG_SQL = process.env.DEBUG_SQL === "1";
let queryCount = 0;

async function timed<T>(sql: string, run: () => Promise<T>): Promise<T> {
  if (!DEBUG_SQL) return run();
  const started = performance.now();
  const out = await run();
  const ms = Math.round(performance.now() - started);
  const label = sql.trim().replace(/\s+/g, " ").slice(0, 70);
  console.log(`[sql ${String(++queryCount).padStart(3)}] ${String(ms).padStart(5)}ms  ${label}`);
  return out;
}

export async function all<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return timed(sql, async () => (await pool.query<T>(toPg(sql), params)).rows);
}

export async function get<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  return timed(sql, async () => (await pool.query<T>(toPg(sql), params)).rows[0]);
}

export async function run(sql: string, ...params: unknown[]): Promise<number> {
  return timed(sql, async () => (await pool.query(toPg(sql), params)).rowCount ?? 0);
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
