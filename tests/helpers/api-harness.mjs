/**
 * In-process harness for app/api/sikgu/route.ts.
 *
 * Node 22 strips TypeScript types natively, so the real route module is
 * imported directly. The only things stubbed are the platform modules:
 * `cloudflare:workers` (D1 + R2 bindings), `next/headers` (identity headers),
 * `next/server` (`after`), and `next/navigation` (`redirect`). D1 is emulated
 * with node:sqlite and the real migrations, so every SQL statement the route
 * runs is executed for real.
 */
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../../", import.meta.url);
const hooks = `data:text/javascript,${encodeURIComponent(`
  import { existsSync } from "node:fs";
  const stubs = new Map([
    ["cloudflare:workers", "data:text/javascript,export const env = new Proxy({}, { get: (_, key) => globalThis.__sikguEnv?.[key] });"],
    ["next/headers", "data:text/javascript,export async function headers() { return new Headers(globalThis.__sikguHeaders || {}); }"],
    ["next/server", "data:text/javascript,export function after(task) { (globalThis.__sikguAfter ||= []).push(task); }"],
    ["next/navigation", "data:text/javascript,export function redirect(path) { throw new Error('redirect:' + path); }"],
  ]);
  export async function resolve(specifier, context, nextResolve) {
    const stub = stubs.get(specifier);
    if (stub) return { url: stub, shortCircuit: true };
    if (specifier.startsWith(".") && !/\\.[a-z]+$/i.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
        if (existsSync(new URL(base.href + ext))) return nextResolve(base.href + ext, context);
      }
    }
    return nextResolve(specifier, context);
  }
`)}`;
register(hooks);

const fix = (value) => (value === undefined ? null : value);

export function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("drizzle/", root);
  for (const name of readdirSync(dir).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
    for (const statement of readFileSync(new URL(name, dir), "utf8").split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql) db.exec(sql);
    }
  }
  return db;
}

export function d1(db) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values.map(fix); return statement; },
        async first() { return db.prepare(sql).get(...params) ?? null; },
        async all() { return { results: db.prepare(sql).all(...params), success: true, meta: {} }; },
        runSync() {
          const result = db.prepare(sql).run(...params);
          return { results: [], success: true, meta: { changes: result.changes } };
        },
        async run() {
          return statement.runSync();
        },
      };
      return statement;
    },
    // D1 runs a batch as one transaction with nothing interleaved, so the
    // statements execute synchronously here; an await between them would let
    // another in-flight request's batch start a nested transaction.
    async batch(statements) {
      const out = [];
      db.exec("BEGIN");
      try {
        for (const statement of statements) out.push(statement.runSync());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return out;
    },
  };
}

export function r2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) { objects.set(key, { value, options }); },
    async get(key) {
      const object = objects.get(key);
      return object ? { body: object.value, httpMetadata: object.options?.httpMetadata } : null;
    },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
}

export const origin = "https://sikgu.example";

export async function createApi({ uploads = r2() } = {}) {
  const db = openDatabase();
  globalThis.__sikguEnv = { DB: d1(db), UPLOADS: uploads };
  // Tasks scheduled with after() by earlier tests belong to their databases.
  globalThis.__sikguAfter = [];
  const route = await import("../../app/api/sikgu/route.ts");
  async function call(method, identity, { query = "", body, form, sameOrigin = true } = {}) {
    globalThis.__sikguHeaders = identity || {};
    const headers = { ...(identity || {}) };
    if (sameOrigin) {
      headers["x-sikgu-request"] = "1";
      headers.origin = origin;
    }
    let payload;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(payload));
    }
    if (form) {
      const data = new FormData();
      for (const [key, value] of Object.entries(form)) data.set(key, value);
      const encoded = new Request(origin, { method: "POST", body: data });
      payload = await encoded.arrayBuffer();
      headers["content-type"] = encoded.headers.get("content-type");
      headers["content-length"] = String(payload.byteLength);
    }
    const request = new Request(`${origin}/api/sikgu${query}`, { method, headers, body: payload });
    const response = await route[method](request);
    const type = response.headers.get("content-type") || "";
    const result = type.includes("json") ? await response.json() : await response.text();
    return { status: response.status, data: result, headers: response.headers };
  }
  return {
    db,
    uploads,
    call,
    post: (identity, body) => call("POST", identity, { body }),
    get: (identity, query) => call("GET", identity, { query, sameOrigin: false }),
    sql: (query, ...params) => db.prepare(query).all(...params.map(fix)),
    runAfterTasks: async () => {
      const tasks = globalThis.__sikguAfter || [];
      globalThis.__sikguAfter = [];
      for (const task of tasks) await task();
    },
  };
}

export function identity(email, fullName) {
  const headers = {};
  if (email !== undefined) headers["oai-authenticated-user-email"] = email;
  if (fullName !== undefined) {
    headers["oai-authenticated-user-full-name"] = encodeURIComponent(fullName);
    headers["oai-authenticated-user-full-name-encoding"] = "percent-encoded-utf-8";
  }
  return headers;
}

export const closesIn = (minutes) => Date.now() + minutes * 60 * 1000;
