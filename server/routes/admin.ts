import { z } from "zod";
import type { Route } from "../context";
import { audit, getThresholds } from "../context";
import { one } from "../db";
import { readBody, notFound, conflict, bad } from "../http";
import { hashPassword, tempPassword } from "../auth";
import { groupMedian, latestAttempts, masteryFrom } from "../analytics";
import { ROLES } from "../../shared/taxonomy";
import { seedSampleBank } from "../seed/sample-bank";

const A = ["school_admin"] as const;
const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const createUserSchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(120),
  roles: z.array(z.enum(ROLES)).min(1),
});
const patchUserSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  roles: z.array(z.enum(ROLES)).min(1).optional(),
  active: z.boolean().optional(),
});
const cohortSchema = z.object({
  name: z.string().trim().min(1).max(120), program: z.string().trim().max(200).default(""),
  startsOn: dateStr, endsOn: dateStr, archived: z.boolean().optional(),
});
const membersSchema = z.object({ members: z.array(z.object({ userId: uuid, track: z.string().trim().max(120).default("") })).max(2000) });
const assignSchema = z.object({ advisorId: uuid, learnerId: uuid });
const settingsSchema = z.object({
  minAnswersPerTopic: z.number().int().min(1).max(100),
  lowMastery: z.number().int().min(1).max(100),
  inactiveDays: z.number().int().min(1).max(365),
  schoolName: z.string().trim().min(1).max(200).optional(),
});

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

const importSchema = z.object({ status: z.enum(["draft", "approved"]) });

export const adminRoutes: Route[] = [
  {
    method: "GET", path: "/api/admin/sample-bank", access: [...A],
    async handler({ ctx }) {
      const r = await ctx.db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM items WHERE origin = 'sample_bank' GROUP BY status`);
      return { imported: r.length > 0, counts: Object.fromEntries(r.map((x) => [x.status, Number(x.n)])), available: 230 };
    },
  },
  {
    // Lets an already-initialised school pull in the simulated bank later (as drafts for review, or approved for a pilot).
    method: "POST", path: "/api/admin/sample-bank/import", access: [...A],
    async handler({ req, ctx, user }) {
      const { status } = await readBody(req, importSchema);
      return ctx.db.tx(async (db) => {
        const existing = await one(db, `SELECT 1 FROM items WHERE origin = 'sample_bank' LIMIT 1`);
        if (existing) throw conflict("already_imported", "นำเข้าคลังโจทย์ตัวอย่างไปแล้ว");
        const next = await one<{ n: string }>(db, `SELECT COALESCE(max(CAST(substring(id from 5) AS integer)), 200) + 1 AS n FROM items`);
        const n = await seedSampleBank(db, ctx.now(), { authorId: null, reviewerId: status === "approved" ? user.id : null, status, startNumber: Math.max(201, Number(next!.n)) });
        await audit(db, user.id, "sample_bank.import", "", { status, count: n });
        return { imported: n };
      });
    },
  },
  {
    method: "GET", path: "/api/admin/overview", access: [...A],
    async handler({ ctx }) {
      const db = ctx.db;
      const now = ctx.now().toISOString();
      const s = await getThresholds(db);
      const roleCounts = await db.query<{ role: string; n: string }>(
        `SELECT r.role, count(*) AS n FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.active GROUP BY r.role`);
      const itemCounts = await db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM items GROUP BY status`);
      const act = await one<{ active7: string; attempts7: string; attempts30: string; open_reports: string; unassigned: string; review_wait: string | null }>(db,
        `SELECT (SELECT count(DISTINCT user_id) FROM attempts WHERE created_at > $1::timestamptz - interval '7 days') AS active7,
                (SELECT count(*) FROM attempts WHERE created_at > $1::timestamptz - interval '7 days') AS attempts7,
                (SELECT count(*) FROM attempts WHERE created_at > $1::timestamptz - interval '30 days') AS attempts30,
                (SELECT count(*) FROM item_reports WHERE status = 'open') AS open_reports,
                (SELECT count(*) FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'learner'
                  WHERE u.active AND NOT EXISTS (SELECT 1 FROM advisor_assignments a WHERE a.learner_id = u.id)) AS unassigned,
                (SELECT round(extract(epoch FROM avg($1::timestamptz - updated_at)) / 86400)::text FROM items WHERE status = 'review') AS review_wait`, [now]);
      const cohorts = await db.query<{ id: string; name: string; program: string; members: string }>(
        `SELECT c.id, c.name, c.program, (SELECT count(*) FROM cohort_members m WHERE m.cohort_id = c.id) AS members
           FROM cohorts c WHERE NOT c.archived ORDER BY c.starts_on DESC NULLS LAST, c.created_at DESC`);
      const cohortStats = [];
      for (const c of cohorts) {
        const ids = (await db.query<{ user_id: string }>(
          `SELECT m.user_id FROM cohort_members m JOIN user_roles r ON r.user_id = m.user_id AND r.role = 'learner' WHERE m.cohort_id = $1`, [c.id])).map((r) => r.user_id);
        const rows = await latestAttempts(db, ids);
        cohortStats.push({ id: c.id, name: c.name, program: c.program, members: Number(c.members), median: groupMedian(ids.map((id) => masteryFrom(rows.filter((r) => r.user_id === id), s))) });
      }
      return {
        roles: Object.fromEntries(roleCounts.map((r) => [r.role, Number(r.n)])),
        items: Object.fromEntries(itemCounts.map((r) => [r.status, Number(r.n)])),
        activeLearners7d: Number(act!.active7), attempts7d: Number(act!.attempts7), attempts30d: Number(act!.attempts30),
        openReports: Number(act!.open_reports), learnersWithoutAdvisor: Number(act!.unassigned),
        avgReviewWaitDays: act!.review_wait == null ? null : Number(act!.review_wait),
        cohorts: cohortStats,
      };
    },
  },
  {
    method: "GET", path: "/api/admin/users", access: [...A],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ id: string; email: string; display_name: string; active: boolean; must_change_password: boolean; last_login_at: Date | null; locked_until: Date | null; roles: string[]; cohorts: string[]; self_registered: boolean; plus_grants: string; plus_open: boolean | null; plus_until: Date | null }>(
        `SELECT u.id, u.email, u.display_name, u.active, u.must_change_password, u.last_login_at, u.locked_until,
                COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = u.id), '{}') AS roles,
                COALESCE((SELECT array_agg(c.name ORDER BY c.name) FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id WHERE m.user_id = u.id AND NOT c.archived), '{}') AS cohorts,
                u.self_registered,
                (SELECT count(*) FROM entitlement_grants g
                  WHERE g.user_id = u.id AND g.revoked_at IS NULL AND g.starts_at <= $1 AND (g.ends_at IS NULL OR g.ends_at > $1)) AS plus_grants,
                (SELECT bool_or(g.ends_at IS NULL) FROM entitlement_grants g
                  WHERE g.user_id = u.id AND g.revoked_at IS NULL AND g.starts_at <= $1) AS plus_open,
                (SELECT max(g.ends_at) FROM entitlement_grants g
                  WHERE g.user_id = u.id AND g.revoked_at IS NULL AND g.ends_at > $1) AS plus_until
           FROM users u ORDER BY u.active DESC, u.display_name`, [ctx.now().toISOString()]);
      const now = ctx.now();
      return {
        users: rows.map((u) => ({
          id: u.id, email: u.email, displayName: u.display_name, active: u.active, pendingPassword: u.must_change_password,
          lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
          locked: !!u.locked_until && new Date(u.locked_until) > now, roles: u.roles, cohorts: u.cohorts,
          selfRegistered: u.self_registered, plus: Number(u.plus_grants) > 0,
          plusUntil: Number(u.plus_grants) > 0 && !u.plus_open && u.plus_until ? new Date(u.plus_until).toISOString() : null,
        })),
      };
    },
  },
  {
    method: "POST", path: "/api/admin/users", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, createUserSchema);
      const pw = tempPassword();
      const hash = await hashPassword(pw);
      try {
        return await ctx.db.tx(async (db) => {
          const u = await one<{ id: string }>(db,
            `INSERT INTO users (email, display_name, password_hash, must_change_password) VALUES ($1,$2,$3,true) RETURNING id`, [b.email, b.displayName, hash]);
          for (const r of new Set(b.roles)) await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [u!.id, r]);
          await audit(db, user.id, "user.create", u!.id, { roles: b.roles });
          // The temporary password is shown once to the admin and never stored in plain text.
          return { id: u!.id, tempPassword: pw };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("email_taken", "อีเมลนี้มีผู้ใช้อยู่แล้ว");
        throw e;
      }
    },
  },
  {
    method: "PATCH", path: "/api/admin/users/:id", access: [...A],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, patchUserSchema);
      if (!uuid.safeParse(params.id).success) throw notFound();
      if (params.id === user.id) {
        if (b.active === false) throw bad("self_deactivate", "ปิดบัญชีของตนเองไม่ได้");
        if (b.roles && !b.roles.includes("school_admin")) throw bad("self_demote", "ถอดสิทธิ์ผู้ดูแลระบบของตนเองไม่ได้");
      }
      try {
        return await ctx.db.tx(async (db) => {
          const u = await one<{ id: string }>(db,
            `UPDATE users SET display_name = COALESCE($2, display_name), email = COALESCE($3, email), active = COALESCE($4, active),
                    session_version = CASE WHEN $4::boolean IS FALSE THEN session_version + 1 ELSE session_version END
              WHERE id = $1 RETURNING id`, [params.id, b.displayName ?? null, b.email ?? null, b.active ?? null]);
          if (!u) throw notFound();
          if (b.roles) {
            await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [params.id]);
            for (const r of new Set(b.roles)) await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [params.id, r]);
          }
          await audit(db, user.id, "user.update", params.id, b);
          return { ok: true };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("email_taken", "อีเมลนี้มีผู้ใช้อยู่แล้ว");
        throw e;
      }
    },
  },
  {
    method: "POST", path: "/api/admin/users/:id/reset-password", access: [...A],
    async handler({ params, ctx, user }) {
      if (!uuid.safeParse(params.id).success) throw notFound();
      const pw = tempPassword();
      const r = await one(ctx.db,
        `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, session_version = session_version + 1
          WHERE id = $1 RETURNING id`, [params.id, await hashPassword(pw)]);
      if (!r) throw notFound();
      await audit(ctx.db, user.id, "user.reset_password", params.id);
      return { tempPassword: pw };
    },
  },
  {
    method: "GET", path: "/api/admin/cohorts", access: [...A],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ id: string; name: string; program: string; starts_on: string | null; ends_on: string | null; archived: boolean; members: string }>(
        `SELECT c.id, c.name, c.program, to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on, c.archived,
                (SELECT count(*) FROM cohort_members m WHERE m.cohort_id = c.id) AS members
           FROM cohorts c ORDER BY c.archived, c.starts_on DESC NULLS LAST, c.created_at DESC`);
      return { cohorts: rows.map((c) => ({ id: c.id, name: c.name, program: c.program, startsOn: c.starts_on, endsOn: c.ends_on, archived: c.archived, members: Number(c.members) })) };
    },
  },
  {
    method: "POST", path: "/api/admin/cohorts", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, cohortSchema);
      const r = await one<{ id: string }>(ctx.db, `INSERT INTO cohorts (name, program, starts_on, ends_on) VALUES ($1,$2,$3,$4) RETURNING id`,
        [b.name, b.program, b.startsOn ?? null, b.endsOn ?? null]);
      await audit(ctx.db, user.id, "cohort.create", r!.id);
      return { id: r!.id };
    },
  },
  {
    method: "PATCH", path: "/api/admin/cohorts/:id", access: [...A],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, cohortSchema);
      if (!uuid.safeParse(params.id).success) throw notFound();
      const r = await one(ctx.db, `UPDATE cohorts SET name=$2, program=$3, starts_on=$4, ends_on=$5, archived=COALESCE($6, archived) WHERE id=$1 RETURNING id`,
        [params.id, b.name, b.program, b.startsOn ?? null, b.endsOn ?? null, b.archived ?? null]);
      if (!r) throw notFound();
      await audit(ctx.db, user.id, "cohort.update", params.id);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/admin/cohorts/:id/members", access: [...A],
    async handler({ params, ctx }) {
      if (!uuid.safeParse(params.id).success) throw notFound();
      const rows = await ctx.db.query<{ user_id: string; track: string; display_name: string; email: string }>(
        `SELECT m.user_id, m.track, u.display_name, u.email FROM cohort_members m JOIN users u ON u.id = m.user_id WHERE m.cohort_id = $1 ORDER BY u.display_name`, [params.id]);
      return { members: rows.map((r) => ({ userId: r.user_id, track: r.track, displayName: r.display_name, email: r.email })) };
    },
  },
  {
    method: "PUT", path: "/api/admin/cohorts/:id/members", access: [...A],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, membersSchema);
      if (!uuid.safeParse(params.id).success) throw notFound();
      return ctx.db.tx(async (db) => {
        const c = await one(db, `SELECT 1 FROM cohorts WHERE id = $1`, [params.id]);
        if (!c) throw notFound();
        await db.query(`DELETE FROM cohort_members WHERE cohort_id = $1`, [params.id]);
        const seen = new Set<string>();
        for (const m of b.members) {
          if (seen.has(m.userId)) continue;
          seen.add(m.userId);
          await db.query(`INSERT INTO cohort_members (cohort_id, user_id, track) VALUES ($1,$2,$3)`, [params.id, m.userId, m.track]);
        }
        await audit(db, user.id, "cohort.members", params.id, { count: seen.size });
        return { ok: true, members: seen.size };
      });
    },
  },
  {
    method: "GET", path: "/api/admin/assignments", access: [...A],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ advisor_id: string; learner_id: string; advisor: string; learner: string }>(
        `SELECT a.advisor_id, a.learner_id, ad.display_name AS advisor, le.display_name AS learner
           FROM advisor_assignments a JOIN users ad ON ad.id = a.advisor_id JOIN users le ON le.id = a.learner_id
          ORDER BY ad.display_name, le.display_name`);
      return { assignments: rows.map((r) => ({ advisorId: r.advisor_id, learnerId: r.learner_id, advisor: r.advisor, learner: r.learner })) };
    },
  },
  {
    method: "POST", path: "/api/admin/assignments", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, assignSchema);
      const roles = await ctx.db.query<{ user_id: string; role: string }>(
        `SELECT user_id, role FROM user_roles WHERE user_id = ANY($1::uuid[])`, [[b.advisorId, b.learnerId]]);
      if (!roles.some((r) => r.user_id === b.advisorId && r.role === "advisor")) throw bad("not_advisor", "ผู้ใช้ที่เลือกไม่มีบทบาทอาจารย์ผู้ดูแล");
      if (!roles.some((r) => r.user_id === b.learnerId && r.role === "learner")) throw bad("not_learner", "ผู้ใช้ที่เลือกไม่มีบทบาทผู้เรียน");
      await ctx.db.query(`INSERT INTO advisor_assignments (advisor_id, learner_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [b.advisorId, b.learnerId]);
      await audit(ctx.db, user.id, "assignment.add", b.learnerId, { advisorId: b.advisorId });
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/api/admin/assignments/remove", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, assignSchema);
      await ctx.db.query(`DELETE FROM advisor_assignments WHERE advisor_id = $1 AND learner_id = $2`, [b.advisorId, b.learnerId]);
      await audit(ctx.db, user.id, "assignment.remove", b.learnerId, { advisorId: b.advisorId });
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/admin/settings", access: [...A],
    async handler({ ctx }) {
      const s = await getThresholds(ctx.db);
      const school = await one<{ value: { name: string } }>(ctx.db, `SELECT value FROM settings WHERE key = 'school'`);
      return { ...s, schoolName: school?.value.name ?? "" };
    },
  },
  {
    method: "PUT", path: "/api/admin/settings", access: [...A],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, settingsSchema);
      const { schoolName, ...thresholds } = b;
      await ctx.db.query(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'thresholds'`, [JSON.stringify(thresholds)]);
      if (schoolName) await ctx.db.query(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'school'`, [JSON.stringify({ name: schoolName })]);
      await audit(ctx.db, user.id, "settings.update", "", b);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/admin/audit", access: [...A],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ id: string; action: string; target: string; detail: object; at: Date; actor: string | null }>(
        `SELECT l.id, l.action, l.target, l.detail, l.at, u.display_name AS actor FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.at DESC, l.id DESC LIMIT 200`);
      return { entries: rows.map((r) => ({ id: String(r.id), action: r.action, target: r.target, detail: r.detail, actor: r.actor, at: new Date(r.at).toISOString() })) };
    },
  },
];
