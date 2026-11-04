import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { Route, Ctx } from "../context";
import { audit } from "../context";
import { one, type Db } from "../db";
import { readBody, HttpError, bad, conflict, notFound } from "../http";
import { hashPassword, issueSession, sessionCookie, loadUser, publicMe, PASSWORD_MIN } from "../auth";
import { getEntitlements, grantPlus } from "../entitlements";
import { FEATURES, FREE_INCLUDES } from "../../shared/plans";
import { LEARNER_LEVELS, STUDY_GOALS } from "../../shared/taxonomy";

export interface Membership { registrationOpen: boolean; trialDays: number }
export interface Disclaimer { version: string; text: string }

export async function getMembership(db: Db): Promise<Membership> {
  const r = await one<{ value: Membership }>(db, `SELECT value FROM settings WHERE key = 'membership'`);
  return r?.value ?? { registrationOpen: false, trialDays: 0 };
}
export async function getDisclaimer(db: Db): Promise<Disclaimer> {
  const r = await one<{ value: Disclaimer }>(db, `SELECT value FROM settings WHERE key = 'disclaimer'`);
  return r?.value ?? { version: "", text: "" };
}

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(2).max(120),
  password: z.string().min(PASSWORD_MIN).max(200),
  learnerLevel: z.enum(LEARNER_LEVELS as [string, ...string[]]),
  institutionName: z.string().trim().max(200).default(""),
  studyGoal: z.enum(STUDY_GOALS as [string, ...string[]]),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "ต้องยอมรับเงื่อนไขการใช้งานก่อนสมัคร" }) }),
  termsVersion: z.string().max(40),
  marketingOptIn: z.boolean().default(false),
});
const redeemSchema = z.object({ code: z.string().trim().min(4).max(40) });
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  learnerLevel: z.enum(LEARNER_LEVELS as [string, ...string[]]).optional(),
  institutionName: z.string().trim().max(200).optional(),
  studyGoal: z.enum(STUDY_GOALS as [string, ...string[]]).optional(),
  marketingOptIn: z.boolean().optional(),
});

const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export async function redeemCode(ctx: Ctx, userId: string, raw: string) {
  const code = normCode(raw);
  return ctx.db.tx(async (db) => {
    const c = await one<{ code: string; duration_days: number; max_uses: number; used_count: number; expires_at: Date | null; disabled: boolean }>(db,
      `SELECT code, duration_days, max_uses, used_count, expires_at, disabled FROM redeem_codes WHERE code = $1 FOR UPDATE`, [code]);
    const now = ctx.now();
    if (!c || c.disabled) throw bad("invalid_code", "ไม่พบโค้ดนี้ หรือโค้ดถูกปิดใช้งานแล้ว");
    if (c.expires_at && new Date(c.expires_at) <= now) throw bad("code_expired", "โค้ดนี้หมดอายุแล้ว");
    if (c.used_count >= c.max_uses) throw bad("code_used_up", "โค้ดนี้ถูกใช้ครบจำนวนแล้ว");
    if (await one(db, `SELECT 1 FROM redemptions WHERE code = $1 AND user_id = $2`, [code, userId])) throw conflict("already_redeemed", "คุณใช้โค้ดนี้ไปแล้ว");
    const g = await grantPlus(db, { userId, days: c.duration_days, source: "redeem", ref: code, now });
    await db.query(`INSERT INTO redemptions (code, user_id, grant_id, redeemed_at) VALUES ($1,$2,$3,$4)`, [code, userId, g.id, now.toISOString()]);
    await db.query(`UPDATE redeem_codes SET used_count = used_count + 1 WHERE code = $1`, [code]);
    await audit(db, userId, "membership.redeem", code);
    return { days: c.duration_days, endsAt: g.endsAt };
  });
}

/** HEM-XXXX-XXXX from an unambiguous alphabet. */
export function makeCode(prefix = "HEM") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const out: string[] = [];
  while (out.length < 8) for (const b of randomBytes(12)) if (b < 224 && out.length < 8) out.push(alphabet[b % 32]);
  return `${normCode(prefix) || "HEM"}-${out.slice(0, 4).join("")}-${out.slice(4).join("")}`;
}

export const membershipRoutes: Route[] = [
  {
    method: "GET", path: "/api/public/config", access: "public",
    async handler({ ctx }) {
      const m = await getMembership(ctx.db);
      const school = await one<{ value: { name: string } }>(ctx.db, `SELECT value FROM settings WHERE key = 'school'`);
      return {
        registrationOpen: m.registrationOpen, trialDays: m.trialDays, disclaimer: await getDisclaimer(ctx.db),
        schoolName: school?.value.name ?? "", plus: Object.values(FEATURES), free: FREE_INCLUDES,
        learnerLevels: LEARNER_LEVELS, studyGoals: STUDY_GOALS,
      };
    },
  },
  {
    method: "POST", path: "/api/auth/register", access: "public",
    async handler({ req, ctx, cookies, secure }) {
      const b = await readBody(req, registerSchema);
      const m = await getMembership(ctx.db);
      if (!m.registrationOpen) throw new HttpError(403, "registration_closed", "ขณะนี้ยังไม่เปิดรับสมัครสมาชิกทั่วไป");
      const d = await getDisclaimer(ctx.db);
      if (b.termsVersion !== d.version) throw conflict("terms_changed", "เงื่อนไขการใช้งานมีการปรับปรุง กรุณาโหลดหน้าใหม่แล้วอ่านอีกครั้ง");
      const hash = await hashPassword(b.password);
      const now = ctx.now();
      try {
        const id = await ctx.db.tx(async (db) => {
          const u = await one<{ id: string }>(db,
            `INSERT INTO users (email, display_name, password_hash, must_change_password, self_registered, learner_level, institution_name,
                                study_goal, terms_accepted_at, terms_version, marketing_opt_in, last_login_at)
             VALUES ($1,$2,$3,false,true,$4,$5,$6,$7,$8,$9,$7) RETURNING id`,
            [b.email, b.displayName, hash, b.learnerLevel, b.institutionName, b.studyGoal, now.toISOString(), d.version, b.marketingOptIn]);
          await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'learner')`, [u!.id]);
          if (m.trialDays > 0) await grantPlus(db, { userId: u!.id, days: m.trialDays, source: "trial", now });
          await audit(db, u!.id, "membership.register");
          return u!.id;
        });
        cookies.push(sessionCookie(await issueSession(id, 1, ctx.env.SESSION_SECRET, now), secure));
        return { me: publicMe((await loadUser(ctx.db, id))!) };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("email_taken", "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบ หรือติดต่อผู้ดูแลเพื่อรีเซ็ตรหัส");
        throw e;
      }
    },
  },
  {
    method: "GET", path: "/api/me/entitlements", access: "auth",
    async handler({ ctx, user }) { return getEntitlements(ctx.db, user.id, ctx.now()); },
  },
  {
    method: "POST", path: "/api/me/redeem", access: "auth",
    async handler({ req, ctx, user }) {
      const { code } = await readBody(req, redeemSchema);
      const r = await redeemCode(ctx, user.id, code);
      return { ...r, entitlements: await getEntitlements(ctx.db, user.id, ctx.now()) };
    },
  },
  {
    method: "GET", path: "/api/me/profile", access: "auth",
    async handler({ ctx, user }) {
      const p = await one<{ learner_level: string | null; institution_name: string | null; study_goal: string | null; marketing_opt_in: boolean; self_registered: boolean }>(ctx.db,
        `SELECT learner_level, institution_name, study_goal, marketing_opt_in, self_registered FROM users WHERE id = $1`, [user.id]);
      return { displayName: user.displayName, learnerLevel: p?.learner_level, institutionName: p?.institution_name, studyGoal: p?.study_goal, marketingOptIn: p?.marketing_opt_in, selfRegistered: p?.self_registered };
    },
  },
  {
    method: "PATCH", path: "/api/me/profile", access: "auth",
    async handler({ req, ctx, user }) {
      const b = await readBody(req, profileSchema);
      await ctx.db.query(
        `UPDATE users SET display_name = COALESCE($2, display_name), learner_level = COALESCE($3, learner_level),
                institution_name = COALESCE($4, institution_name), study_goal = COALESCE($5, study_goal),
                marketing_opt_in = COALESCE($6, marketing_opt_in) WHERE id = $1`,
        [user.id, b.displayName ?? null, b.learnerLevel ?? null, b.institutionName ?? null, b.studyGoal ?? null, b.marketingOptIn ?? null]);
      return { me: publicMe((await loadUser(ctx.db, user.id))!) };
    },
  },
];

/* ---------- admin: membership settings, grants, codes ---------- */
const A = ["school_admin"] as const;
const uuid = z.string().uuid();
const membershipSchema = z.object({
  registrationOpen: z.boolean(), trialDays: z.number().int().min(0).max(60),
  disclaimerText: z.string().trim().min(20).max(4000).optional(),
});
const codesSchema = z.object({
  count: z.number().int().min(1).max(500), durationDays: z.number().int().min(1).max(3650),
  maxUses: z.number().int().min(1).max(10000).default(1), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  campaign: z.string().trim().max(80).default(""), prefix: z.string().trim().max(8).default("HEM"),
});
const grantSchema = z.object({ userId: uuid, days: z.number().int().min(1).max(3650).nullable(), note: z.string().trim().max(200).default("") });
const cohortGrantSchema = z.object({ days: z.number().int().min(1).max(3650) });

export const membershipAdminRoutes: Route[] = [
  {
    method: "GET", path: "/api/admin/membership", access: [...A],
    async handler({ ctx }) {
      const now = ctx.now().toISOString();
      const stats = await one<{ registered: string; plus_active: string; trial_active: string; registered_30: string }>(ctx.db,
        `SELECT (SELECT count(*) FROM users WHERE self_registered) AS registered,
                (SELECT count(*) FROM users WHERE self_registered AND created_at > $1::timestamptz - interval '30 days') AS registered_30,
                (SELECT count(DISTINCT user_id) FROM entitlement_grants WHERE revoked_at IS NULL AND starts_at <= $1 AND (ends_at IS NULL OR ends_at > $1)) AS plus_active,
                (SELECT count(DISTINCT user_id) FROM entitlement_grants g WHERE source = 'trial' AND revoked_at IS NULL AND ends_at > $1
                   AND NOT EXISTS (SELECT 1 FROM entitlement_grants o WHERE o.user_id = g.user_id AND o.source <> 'trial' AND o.revoked_at IS NULL AND (o.ends_at IS NULL OR o.ends_at > $1))) AS trial_active`, [now]);
      return {
        ...(await getMembership(ctx.db)), disclaimer: await getDisclaimer(ctx.db),
        stats: { registered: Number(stats!.registered), registered30d: Number(stats!.registered_30), plusActive: Number(stats!.plus_active), trialOnly: Number(stats!.trial_active) },
      };
    },
  },
  {
    method: "PUT", path: "/api/admin/membership", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, membershipSchema);
      await ctx.db.query(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'membership'`, [JSON.stringify({ registrationOpen: b.registrationOpen, trialDays: b.trialDays })]);
      if (b.disclaimerText) {
        const cur = await getDisclaimer(ctx.db);
        if (cur.text !== b.disclaimerText) {
          // New wording gets a new version; new sign-ups accept the version they were shown.
          const version = ctx.now().toISOString().slice(0, 16).replace(/[-:T]/g, "");
          await ctx.db.query(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'disclaimer'`, [JSON.stringify({ version, text: b.disclaimerText })]);
        }
      }
      await audit(ctx.db, user.id, "membership.settings", "", { registrationOpen: b.registrationOpen, trialDays: b.trialDays });
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/admin/codes", access: [...A],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ code: string; duration_days: number; max_uses: number; used_count: number; expires_at: Date | null; campaign: string; disabled: boolean; created_at: Date }>(
        `SELECT code, duration_days, max_uses, used_count, expires_at, campaign, disabled, created_at FROM redeem_codes ORDER BY created_at DESC, code LIMIT 1000`);
      return { codes: rows.map((r) => ({ code: r.code, durationDays: r.duration_days, maxUses: r.max_uses, usedCount: r.used_count, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, campaign: r.campaign, disabled: r.disabled, createdAt: new Date(r.created_at).toISOString() })) };
    },
  },
  {
    method: "POST", path: "/api/admin/codes", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, codesSchema);
      const codes: string[] = [];
      await ctx.db.tx(async (db) => {
        while (codes.length < b.count) {
          const c = makeCode(b.prefix);
          const r = await one(db,
            `INSERT INTO redeem_codes (code, duration_days, max_uses, expires_at, campaign, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING code`,
            [c, b.durationDays, b.maxUses, b.expiresAt ? `${b.expiresAt}T23:59:59+07:00` : null, b.campaign, user.id]);
          if (r) codes.push(c);
        }
        await audit(db, user.id, "codes.create", b.campaign, { count: b.count, durationDays: b.durationDays });
      });
      return { codes };
    },
  },
  {
    method: "POST", path: "/api/admin/codes/:code/disable", access: [...A],
    async handler({ params, ctx, user }) {
      const r = await one(ctx.db, `UPDATE redeem_codes SET disabled = true WHERE code = $1 RETURNING code`, [normCode(params.code)]);
      if (!r) throw notFound();
      await audit(ctx.db, user.id, "codes.disable", params.code);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/admin/users/:id/grants", access: [...A],
    async handler({ params, ctx }) {
      if (!uuid.safeParse(params.id).success) throw notFound();
      const rows = await ctx.db.query<{ id: string; source: string; starts_at: Date; ends_at: Date | null; revoked_at: Date | null; ref: string }>(
        `SELECT id, source, starts_at, ends_at, revoked_at, ref FROM entitlement_grants WHERE user_id = $1 ORDER BY starts_at DESC`, [params.id]);
      return {
        entitlements: await getEntitlements(ctx.db, params.id, ctx.now()),
        grants: rows.map((g) => ({ id: String(g.id), source: g.source, startsAt: new Date(g.starts_at).toISOString(), endsAt: g.ends_at ? new Date(g.ends_at).toISOString() : null, revokedAt: g.revoked_at ? new Date(g.revoked_at).toISOString() : null, ref: g.ref })),
      };
    },
  },
  {
    method: "POST", path: "/api/admin/grants", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, grantSchema);
      const u = await one(ctx.db, `SELECT 1 FROM users WHERE id = $1`, [b.userId]);
      if (!u) throw notFound();
      const g = await grantPlus(ctx.db, { userId: b.userId, days: b.days, source: "admin", ref: b.note, grantedBy: user.id, now: ctx.now() });
      await audit(ctx.db, user.id, "grant.add", b.userId, { days: b.days });
      return g;
    },
  },
  {
    method: "POST", path: "/api/admin/grants/:id/revoke", access: [...A],
    async handler({ params, ctx, user }) {
      if (!/^\d+$/.test(params.id)) throw notFound();
      const r = await one<{ user_id: string }>(ctx.db, `UPDATE entitlement_grants SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING user_id`, [params.id, ctx.now().toISOString()]);
      if (!r) throw notFound();
      await audit(ctx.db, user.id, "grant.revoke", r.user_id, { grantId: params.id });
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/api/admin/cohorts/:id/grant", access: [...A],
    async handler({ req, params, ctx, user }) {
      const { days } = await readBody(req, cohortGrantSchema);
      if (!uuid.safeParse(params.id).success) throw notFound();
      return ctx.db.tx(async (db) => {
        const members = await db.query<{ user_id: string }>(
          `SELECT m.user_id FROM cohort_members m JOIN user_roles r ON r.user_id = m.user_id AND r.role = 'learner' WHERE m.cohort_id = $1`, [params.id]);
        for (const m of members) await grantPlus(db, { userId: m.user_id, days, source: "institution", ref: params.id, grantedBy: user.id, now: ctx.now() });
        await audit(db, user.id, "grant.cohort", params.id, { days, members: members.length });
        return { granted: members.length };
      });
    },
  },
];
