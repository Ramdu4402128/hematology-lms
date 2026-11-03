// Dev/test only: Postgres-in-WASM so the API can run without a Netlify account. Not bundled into the function.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db";

const MIGRATIONS = fileURLToPath(new URL("../netlify/database/migrations/", import.meta.url));

/** Applies the real migration files in the same lexicographic order Netlify uses, tracking what has run. */
export async function migrate(pg: PGlite) {
  await pg.exec(`CREATE TABLE IF NOT EXISTS _local_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pg.query<{ name: string }>(`SELECT name FROM _local_migrations`)).rows.map((r) => r.name));
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      await tx.query(`INSERT INTO _local_migrations (name) VALUES ($1)`, [f]);
    });
  }
}

export function fromPGlite(pg: PGlite): Db {
  type Q = { query: PGlite["query"] };
  const wrap = (q: Q, inTx: boolean): Db => ({
    async query<T>(text: string, params?: unknown[]) { return (await q.query<T>(text, params as never[])).rows; },
    async tx(fn) {
      if (inTx) return fn(wrap(q, true));
      return pg.transaction(async (t) => fn(wrap(t as unknown as Q, true)));
    },
  });
  return wrap(pg, false);
}

export async function openPGlite(dataDir?: string): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite(dataDir);
  await migrate(pg);
  return { pg, db: fromPGlite(pg) };
}
