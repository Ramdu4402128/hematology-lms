/** Minimal database port. Production uses Netlify Database (Postgres); tests use PGlite (Postgres in WASM). */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs fn inside a transaction. Nested calls reuse the outer transaction. */
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
}

export async function one<T>(db: Db, text: string, params?: unknown[]): Promise<T | null> {
  const rows = await db.query<T>(text, params);
  return rows[0] ?? null;
}

interface PgLikeClient { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; release(): void }
interface PgLikePool { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; connect(): Promise<PgLikeClient> }

/** Adapter for any node-postgres-compatible pool (pg.Pool or @neondatabase/serverless Pool). */
export function fromPgPool(pool: PgLikePool): Db {
  const clientDb = (client: PgLikeClient): Db => ({
    async query<T>(text: string, params?: unknown[]) { return (await client.query(text, params)).rows as T[]; },
    async tx(fn) { return fn(clientDb(client)); },
  });
  return {
    async query<T>(text: string, params?: unknown[]) { return (await pool.query(text, params)).rows as T[]; },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(clientDb(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
