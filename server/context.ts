import type { Db } from "./db";
import type { AuthUser } from "./auth";
import type { Role } from "../shared/taxonomy";

export interface Env { SESSION_SECRET: string; SETUP_TOKEN?: string }
export interface Ctx { db: Db; env: Env; now: () => Date }

export interface RouteArgs {
  req: Request;
  url: URL;
  params: Record<string, string>;
  ctx: Ctx;
  /** Null only on public routes. */
  user: AuthUser;
  /** Set-Cookie values to attach to the response. */
  cookies: string[];
  secure: boolean;
}

export type Access = "public" | "auth" | Role[];

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  access: Access;
  /** Allowed while the user still has to replace a temporary password. */
  duringPasswordChange?: boolean;
  handler: (a: RouteArgs) => Promise<unknown>;
}

export async function audit(db: Db, actorId: string | null, action: string, target = "", detail: object = {}) {
  await db.query(`INSERT INTO audit_log (actor_id, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)`, [actorId, action, target, JSON.stringify(detail)]);
}

export async function getThresholds(db: Db) {
  const rows = await db.query<{ value: { minAnswersPerTopic: number; lowMastery: number; inactiveDays: number } }>(
    `SELECT value FROM settings WHERE key = 'thresholds'`);
  return rows[0]?.value ?? { minAnswersPerTopic: 2, lowMastery: 50, inactiveDays: 7 };
}
