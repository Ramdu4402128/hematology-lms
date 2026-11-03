import { getDatabase } from "@netlify/database";
import { fromPgPool, type Db } from "./db";

let cached: Db | null = null;

/** Netlify Database connection (reads NETLIFY_DB_URL, injected by Netlify in deploys and `netlify dev`). */
export function netlifyDb(): Db {
  if (!cached) cached = fromPgPool(getDatabase().pool as never);
  return cached;
}
