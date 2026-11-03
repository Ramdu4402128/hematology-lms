import { z } from "zod";
import type { Route } from "../context";
import { audit } from "../context";
import { one } from "../db";
import { readBody, HttpError, bad } from "../http";
import {
  verifyPassword, hashPassword, issueSession, sessionCookie, clearCookie, loadUser, publicMe, getDummyHash,
  MAX_FAILED, LOCK_MINUTES, PASSWORD_MIN,
} from "../auth";

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const pwSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(PASSWORD_MIN).max(200) });
const prefSchema = z.object({
  leaderboardOptIn: z.boolean().optional(),
  leaderboardAlias: z.string().trim().max(40).nullable().optional(),
});

interface LoginRow { id: string; password_hash: string; active: boolean; failed_logins: number; locked_until: Date | null; session_version: number }

export const authRoutes: Route[] = [
  {
    method: "POST", path: "/api/auth/login", access: "public",
    async handler({ req, ctx, cookies, secure }) {
      const body = await readBody(req, loginSchema);
      const now = ctx.now();
      const u = await one<LoginRow>(ctx.db,
        `SELECT id, password_hash, active, failed_logins, locked_until, session_version FROM users WHERE lower(email) = lower($1)`, [body.email]);
      const invalid = new HttpError(401, "invalid_credentials", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      if (!u) { await verifyPassword(body.password, await getDummyHash()); throw invalid; }
      if (u.locked_until && new Date(u.locked_until) > now) {
        throw new HttpError(429, "locked", `บัญชีถูกล็อกชั่วคราวจากการใส่รหัสผิดหลายครั้ง ลองใหม่หลัง ${LOCK_MINUTES} นาที หรือติดต่อผู้ดูแลระบบ`);
      }
      const ok = await verifyPassword(body.password, u.password_hash);
      if (!ok || !u.active) {
        if (u.active) {
          const failed = u.failed_logins + 1;
          const lock = failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
          await ctx.db.query(`UPDATE users SET failed_logins = $2, locked_until = COALESCE($3::timestamptz, locked_until) WHERE id = $1`,
            [u.id, lock ? 0 : failed, lock]);
          if (failed >= MAX_FAILED) await audit(ctx.db, u.id, "auth.locked");
        }
        throw invalid;
      }
      await ctx.db.query(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1`, [u.id, now.toISOString()]);
      cookies.push(sessionCookie(await issueSession(u.id, u.session_version, ctx.env.SESSION_SECRET, now), secure));
      const me = await loadUser(ctx.db, u.id);
      return { me: publicMe(me!) };
    },
  },
  {
    method: "POST", path: "/api/auth/logout", access: "public",
    async handler({ cookies, secure }) {
      cookies.push(clearCookie(secure));
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/auth/me", access: "auth", duringPasswordChange: true,
    async handler({ user }) { return { me: publicMe(user) }; },
  },
  {
    method: "POST", path: "/api/auth/password", access: "auth", duringPasswordChange: true,
    async handler({ req, ctx, user, cookies, secure }) {
      const body = await readBody(req, pwSchema);
      const row = await one<{ password_hash: string }>(ctx.db, `SELECT password_hash FROM users WHERE id = $1`, [user.id]);
      if (!row || !(await verifyPassword(body.current, row.password_hash))) throw new HttpError(401, "invalid_credentials", "รหัสผ่านปัจจุบันไม่ถูกต้อง");
      if (body.current === body.next) throw bad("same_password", "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม");
      const hash = await hashPassword(body.next);
      const r = await one<{ session_version: number }>(ctx.db,
        `UPDATE users SET password_hash = $2, must_change_password = false, session_version = session_version + 1 WHERE id = $1 RETURNING session_version`,
        [user.id, hash]);
      await audit(ctx.db, user.id, "auth.password_changed");
      cookies.push(sessionCookie(await issueSession(user.id, r!.session_version, ctx.env.SESSION_SECRET, ctx.now()), secure));
      return { me: publicMe((await loadUser(ctx.db, user.id))!) };
    },
  },
  {
    method: "POST", path: "/api/auth/logout-everywhere", access: "auth",
    async handler({ ctx, user, cookies, secure }) {
      await ctx.db.query(`UPDATE users SET session_version = session_version + 1 WHERE id = $1`, [user.id]);
      cookies.push(clearCookie(secure));
      return { ok: true };
    },
  },
  {
    method: "PATCH", path: "/api/me/preferences", access: "auth",
    async handler({ req, ctx, user }) {
      const b = await readBody(req, prefSchema);
      await ctx.db.query(
        `UPDATE users SET leaderboard_opt_in = COALESCE($2, leaderboard_opt_in),
                          leaderboard_alias = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE leaderboard_alias END
          WHERE id = $1`,
        [user.id, b.leaderboardOptIn ?? null, b.leaderboardAlias !== undefined, b.leaderboardAlias ?? null]);
      return { me: publicMe((await loadUser(ctx.db, user.id))!) };
    },
  },
];
