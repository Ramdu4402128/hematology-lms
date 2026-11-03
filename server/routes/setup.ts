import { z } from "zod";
import { timingSafeEqual, createHash } from "node:crypto";
import type { Route } from "../context";
import { audit } from "../context";
import { one } from "../db";
import { readBody, HttpError, notFound } from "../http";
import { hashPassword, PASSWORD_MIN } from "../auth";
import { seedDemo } from "../seed/demo";

const setupSchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(PASSWORD_MIN).max(200),
  schoolName: z.string().trim().max(200).optional(),
  demo: z.boolean().default(false),
});

const digest = (s: string) => createHash("sha256").update(s).digest();

export const setupRoutes: Route[] = [
  {
    method: "GET", path: "/api/setup/status", access: "public",
    async handler({ ctx }) {
      const r = await one<{ n: string }>(ctx.db, `SELECT count(*) AS n FROM users`);
      return { needsSetup: Number(r!.n) === 0, setupEnabled: !!ctx.env.SETUP_TOKEN };
    },
  },
  {
    method: "POST", path: "/api/setup", access: "public",
    async handler({ req, ctx }) {
      const expected = ctx.env.SETUP_TOKEN;
      if (!expected) throw notFound();
      const given = req.headers.get("x-setup-token") ?? "";
      if (!timingSafeEqual(digest(given), digest(expected))) throw new HttpError(403, "bad_setup_token", "Setup token ไม่ถูกต้อง");
      const b = await readBody(req, setupSchema);
      return ctx.db.tx(async (db) => {
        // Serialise concurrent setup attempts; only the very first account can be created this way.
        await db.query(`LOCK TABLE users IN EXCLUSIVE MODE`);
        const r = await one<{ n: string }>(db, `SELECT count(*) AS n FROM users`);
        if (Number(r!.n) > 0) throw new HttpError(409, "already_initialised", "ระบบถูกตั้งค่าไปแล้ว");
        const u = await one<{ id: string }>(db,
          `INSERT INTO users (email, display_name, password_hash, must_change_password) VALUES ($1,$2,$3,false) RETURNING id`,
          [b.email, b.displayName, await hashPassword(b.password)]);
        await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'school_admin')`, [u!.id]);
        if (b.schoolName) await db.query(`UPDATE settings SET value = $1::jsonb WHERE key = 'school'`, [JSON.stringify({ name: b.schoolName })]);
        const demoAccounts = b.demo ? await seedDemo(db, ctx.now()) : [];
        await audit(db, u!.id, "setup", "", { demo: b.demo });
        return { ok: true, demoAccounts };
      });
    },
  },
];
