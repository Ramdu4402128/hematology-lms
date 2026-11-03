import type { Db } from "../server/db";
import type { Ctx } from "../server/context";
import { handle } from "../server/app";
import { openPGlite } from "../server/db-pglite";

export async function freshDb(): Promise<{ db: Db }> {
  const { db } = await openPGlite();
  return { db };
}

export const SECRET = "test-secret-test-secret-test-secret-123";
export const SETUP_TOKEN = "setup-token-for-tests";

export function makeCtx(db: Db, start = new Date("2026-11-03T03:00:00Z")) {
  let t = start.getTime();
  const ctx: Ctx = { db, env: { SESSION_SECRET: SECRET, SETUP_TOKEN }, now: () => new Date(t) };
  return { ctx, advance: (ms: number) => { t += ms; } };
}

/** A tiny browser: keeps its own cookie jar and sends the CSRF header. */
export class Client {
  cookie = "";
  constructor(private ctx: Ctx) {}
  async call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const h: Record<string, string> = { "x-requested-with": "hlms", ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await handle(new Request(`https://lms.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), this.ctx);
    const set = res.headers.get("set-cookie");
    if (set) {
      const v = set.split(";")[0];
      this.cookie = v.endsWith("=") ? "" : v;
    }
    return { status: res.status, body: (await res.json()) as T };
  }
  get<T = any>(p: string) { return this.call<T>("GET", p); }
  post<T = any>(p: string, b: unknown = {}) { return this.call<T>("POST", p, b); }
  put<T = any>(p: string, b: unknown) { return this.call<T>("PUT", p, b); }
  patch<T = any>(p: string, b: unknown) { return this.call<T>("PATCH", p, b); }
  del<T = any>(p: string) { return this.call<T>("DELETE", p); }
}

/** Signs in with a one-time password and replaces it, as a real first login would. */
export async function firstLogin(ctx: Ctx, email: string, temp: string, next = "a-strong-new-password-1"): Promise<Client> {
  const c = new Client(ctx);
  const r = await c.post("/api/auth/login", { email, password: temp });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  const p = await c.post("/api/auth/password", { current: temp, next });
  if (p.status !== 200) throw new Error(`password change failed: ${JSON.stringify(p.body)}`);
  return c;
}
