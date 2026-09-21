import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The security invariants that, if broken, reintroduce the worst defects this
 * codebase has had. Each test below maps to a real bug that shipped.
 *
 * These are deliberately source-level rather than integration tests: they need
 * no database, no server and no session, so they run in a second and can gate
 * every commit. They import nothing from the app — the repo layer is
 * `server-only` and reaches Clerk's ESM subpaths, which is exactly the problem
 * the seed script already has to work around.
 *
 * What they do NOT cover: whether a query returns the right rows, or whether a
 * gate rejects a real session. They cover the structural properties whose
 * absence caused anonymous writes and cross-tenant reads.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir, match, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, match, out);
    else if (match.test(entry.name)) out.push(rel);
  }
  return out;
}

/* ============================================================
   1. Every Server Action authenticates before it does anything.

   A Server Action is a POST endpoint. It does NOT render through
   app/(app)/layout.tsx, so that layout's redirect protects pages only —
   Next's own docs put it bluntly: "render-time gating is not a security
   boundary, because requests can be sent without going through the UI."

   Two actions once missed this. markSentAction ran its INSERT first, so an
   anonymous POST with no cookie wrote a row to the database. reseedAction had
   no check at all in front of a whole-database TRUNCATE.
   ============================================================ */

const GATE = /await (requireUser|assertAdmin)\(\)/;

/**
 * The property checked is "nothing is awaited before the gate", not "the gate
 * is on line one". That is the property that actually matters — every database
 * read, every write and every provider call is awaited, so if the gate is the
 * first `await` in the function, none of them can run without a session.
 *
 * It also leaves room for the synchronous input validation that legitimately
 * runs alongside the gate (assertDay, channel checks, trimming): those touch
 * nothing, so their order is a style question, not a security one.
 */
test("no Server Action awaits anything before it authenticates", () => {
  const src = read("app/actions.ts");
  assert.match(src, /^"use server";/, "app/actions.ts must be a server-action module");

  const declarations = [...src.matchAll(/export async function (\w+)\s*\(/g)];
  assert.ok(declarations.length > 0, "found no exported actions to check — has the file moved?");

  const ungated = [];
  for (const [index, decl] of declarations.entries()) {
    const name = decl[1];
    // From this declaration to the next exported one: the action's own source,
    // possibly trailed by a private helper. A helper can only add awaits after
    // the gate, so it cannot mask a violation.
    const end = declarations[index + 1]?.index ?? src.length;
    const body = src.slice(decl.index, end);

    const gateAt = body.search(GATE);
    if (gateAt === -1) {
      ungated.push(`${name} — never calls requireUser() or assertAdmin()`);
      continue;
    }

    const firstAwaitAt = body.indexOf("await ");
    if (firstAwaitAt < gateAt) {
      const leaked = body.slice(firstAwaitAt).split("\n")[0].trim();
      ungated.push(`${name} — awaits before authenticating: ${leaked}`);
    }
  }

  assert.deepEqual(
    ungated,
    [],
    `These Server Actions do work before authenticating, so an anonymous POST reaches it:\n  ${ungated.join("\n  ")}`,
  );
});

test("no Server Action is exported without the Action suffix", () => {
  // The naming convention is what makes the test above enumerable. A helper
  // exported by accident from a "use server" module is a public endpoint.
  const src = read("app/actions.ts");
  const exported = [...src.matchAll(/export async function (\w+)\s*\(/g)].map((m) => m[1]);
  const misnamed = exported.filter((n) => !n.endsWith("Action"));
  assert.deepEqual(misnamed, [], `Exported from a "use server" module but not named *Action: ${misnamed.join(", ")}`);
});

/**
 * Every action that can reach a paid provider call must also be metered.
 * Model calls are billed to a key the user stored, so an unmetered one is an
 * open tap: a stuck client retry or a held-down "Regenerate" runs up real
 * spend with nothing in the way.
 */
test("every action that can call the AI provider is rate limited", () => {
  const src = read("app/actions.ts");
  const declarations = [...src.matchAll(/export async function (\w+)\s*\(/g)];

  // The four entry points into lib/ai, plus the Ask router that falls through
  // to the model when no structural handler matches.
  const REACHES_MODEL = /\b(generateMessage|refineMessage|extractMeeting|runAsk)\(/;

  const unmetered = [];
  for (const [index, decl] of declarations.entries()) {
    const end = declarations[index + 1]?.index ?? src.length;
    const body = src.slice(decl.index, end);
    if (!REACHES_MODEL.test(body)) continue;
    if (!/checkRateLimit\(/.test(body)) unmetered.push(decl[1]);
  }

  assert.deepEqual(
    unmetered,
    [],
    `These actions can spend money on a model call with no rate limit:\n  ${unmetered.join("\n  ")}`,
  );
});

/* ============================================================
   2. Page-level SQL is scoped to the caller's workspace.

   The repo layer enforces tenancy without exception, deriving the workspace
   from the session so no caller can forget to pass it. The leaks happened in
   page components that bypassed that layer and hand-wrote a query: Inbox
   listed every tenant's inbound message bodies, and three Analytics
   aggregates counted the whole database.

   Page SQL is rare and always needs the predicate, which makes this rule
   precise. It is deliberately not applied to the repo layer, where inner
   queries are legitimately scoped by an id an outer ownership check already
   validated.
   ============================================================ */

const TENANT_TABLES = [
  "customers",
  "contacts",
  "opportunities",
  "interactions",
  "signals",
  "commitments",
  "generated_messages",
];

function sqlLiterals(src) {
  const found = [];
  for (const m of src.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  for (const m of src.matchAll(/"((?:SELECT|INSERT|UPDATE|DELETE)[^"]*)"/gi)) found.push(m[1]);
  return found.filter((s) => /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(s));
}

test("SQL written directly in a page component filters on workspace_id", () => {
  const pages = walk("app", /^page\.tsx$/);
  assert.ok(pages.length > 0, "found no pages to check — has the app directory moved?");

  const violations = [];
  for (const file of pages) {
    for (const sql of sqlLiterals(read(file))) {
      const flat = sql.replace(/\s+/g, " ").trim();
      const touches = TENANT_TABLES.filter((t) =>
        new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "i").test(flat),
      );
      if (touches.length === 0) continue;
      if (/workspace_id/i.test(flat)) continue;
      violations.push(`${file}\n    reads ${touches.join(", ")} with no workspace filter:\n    ${flat.slice(0, 120)}…`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Page SQL without a tenant filter leaks other workspaces' data:\n  ${violations.join("\n  ")}`,
  );
});

/* ============================================================
   3. The whole-database seed is unreachable from the application.

   seed() TRUNCATEs every table, users and workspaces included, so it destroys
   every tenant and every stored API key. The Settings "Reset demo data" button
   called it directly. The app must only ever reach reseedWorkspace(), which is
   scoped to one workspace; seed() belongs to `npm run seed` alone.
   ============================================================ */

test("only the seed CLI imports the destructive whole-database seed", () => {
  const appCode = [
    ...walk("app", /\.tsx?$/),
    ...walk("components", /\.tsx?$/),
    ...walk("lib", /\.tsx?$/).filter((f) => f !== path.join("lib", "seed", "seed.ts")),
  ];

  const offenders = [];
  for (const file of appCode) {
    const src = read(file);
    if (!/from ["']@\/lib\/seed\/seed["']/.test(src) && !/from ["']\.{1,2}\/.*seed\/seed["']/.test(src)) continue;
    // Importing reseedWorkspace is correct; importing seed is not.
    const importLine = src.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*seed\/seed["']/);
    const names = (importLine?.[1] ?? "").split(",").map((n) => n.trim().split(/\s+as\s+/)[0]);
    if (names.includes("seed")) offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `These files import seed(), which truncates every tenant's data. Use reseedWorkspace():\n  ${offenders.join("\n  ")}`,
  );
});

test("the in-app reseed is admin-gated and workspace-scoped", () => {
  const actions = read("app/actions.ts");
  const reseed = actions.slice(actions.indexOf("export async function reseedAction"));
  const body = reseed.slice(0, reseed.indexOf("\n}"));

  assert.match(body, /assertAdmin\(\)/, "reseedAction must require an admin");
  assert.match(body, /reseedWorkspace\(/, "reseedAction must use the workspace-scoped reseed");
  assert.doesNotMatch(body, /\bseed\(\)/, "reseedAction must not call the whole-database seed");
});

test("the workspace-scoped reseed never truncates and never touches users", () => {
  const src = read("lib/seed/seed.ts");
  const scoped = src.slice(src.indexOf("export async function reseedWorkspace"));

  assert.doesNotMatch(scoped, /TRUNCATE/i, "reseedWorkspace must not truncate");
  assert.doesNotMatch(
    scoped,
    /DELETE FROM (users|workspaces)/i,
    "reseedWorkspace must not delete accounts or workspaces — stored API keys live there",
  );
  assert.match(
    scoped,
    /DELETE FROM customers WHERE workspace_id = \?/,
    "reseedWorkspace must clear exactly one workspace's customers and let the FK cascade do the rest",
  );
});
