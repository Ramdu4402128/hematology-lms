import { z } from "zod";
import type { Route } from "../context";
import { audit } from "../context";
import { one } from "../db";
import { readBody, notFound, conflict, forbidden, bad, HttpError } from "../http";
import { getItem, itemInputSchema, normalizeOptions, inputOf } from "../items";
import { latestAttempts, overallPct } from "../analytics";
import { blockingFailures, qualityChecks } from "../../shared/quality";
import { RUBRIC, TOPICS, KEYS } from "../../shared/taxonomy";

const F = ["faculty"] as const;

const saveSchema = z.object({ item: itemInputSchema, baseUpdatedAt: z.string().optional() });
const reviewSchema = z.object({
  decision: z.enum(["approve", "revise"]),
  checks: z.array(z.boolean()).length(RUBRIC.length),
  comment: z.string().trim().max(4000).default(""),
});
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const closeSchema = z.object({ resolution: z.string().trim().min(1).max(2000) });

async function nextItemId(db: Parameters<typeof one>[0]): Promise<string> {
  const r = await one<{ n: string }>(db, `SELECT nextval('item_number_seq') AS n`);
  return `HEM-${String(r!.n).padStart(4, "0")}`;
}

/** Difficulty (p) and upper–lower discrimination (D) from each learner's first attempt at the current version. */
async function itemStats(db: Parameters<typeof one>[0], id: string, version: number) {
  const first = await db.query<{ user_id: string; choice: string; is_correct: boolean; time_ms: number | null }>(
    `SELECT DISTINCT ON (user_id) user_id, choice, is_correct, time_ms FROM attempts
      WHERE item_id = $1 AND item_version = $2 ORDER BY user_id, created_at, id`, [id, version]);
  const n = first.length;
  const dist = Object.fromEntries(KEYS.map((k) => [k, first.filter((a) => a.choice === k).length]));
  const p = n ? first.filter((a) => a.is_correct).length / n : null;
  let d: number | null = null;
  if (n >= 10) {
    const latest = await latestAttempts(db, first.map((a) => a.user_id));
    const scored = first.map((a) => ({ ok: a.is_correct, score: overallPct(latest.filter((r) => r.user_id === a.user_id && r.item_id !== id)) ?? 0 }))
      .sort((x, y) => y.score - x.score);
    const k = Math.max(1, Math.round(n * 0.27));
    const rate = (xs: { ok: boolean }[]) => xs.filter((x) => x.ok).length / xs.length;
    d = Math.round((rate(scored.slice(0, k)) - rate(scored.slice(-k))) * 100) / 100;
  }
  const times = first.map((a) => a.time_ms).filter((t): t is number => t != null).sort((a, b) => a - b);
  return { n, p: p == null ? null : Math.round(p * 100) / 100, d, distribution: dist, medianSeconds: times.length ? Math.round(times[Math.floor(times.length / 2)] / 1000) : null };
}

export const facultyRoutes: Route[] = [
  {
    method: "GET", path: "/api/faculty/items", access: [...F],
    async handler({ url, ctx }) {
      const status = url.searchParams.get("status");
      const topic = url.searchParams.get("topic");
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT i.id, i.topic, i.subtopic, i.level, i.lead_in, i.status, i.version, i.author_id, au.display_name AS author_name, i.updated_at,
                (SELECT count(*) FROM attempts a WHERE a.item_id = i.id AND a.item_version = i.version) AS n,
                (SELECT count(*) FROM attempts a WHERE a.item_id = i.id AND a.item_version = i.version AND a.is_correct) AS c,
                (SELECT count(*) FROM item_reports r WHERE r.item_id = i.id AND r.status = 'open') AS open_reports
           FROM items i LEFT JOIN users au ON au.id = i.author_id
          WHERE ($1::text IS NULL OR i.status = $1) AND ($2::text IS NULL OR i.topic = $2)
            AND ($3 = '' OR i.id ILIKE '%' || $3 || '%' OR i.lead_in ILIKE '%' || $3 || '%' OR i.vignette ILIKE '%' || $3 || '%')
          ORDER BY i.id`, [status || null, topic || null, q]);
      const counts = await ctx.db.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM items GROUP BY status`);
      return {
        items: rows.map((r) => ({
          id: r.id, topic: r.topic, subtopic: r.subtopic, level: r.level, leadIn: r.lead_in, status: r.status, version: r.version,
          authorId: r.author_id, authorName: r.author_name, updatedAt: new Date(r.updated_at as string).toISOString(),
          n: Number(r.n), p: Number(r.n) ? Math.round((Number(r.c) / Number(r.n)) * 100) / 100 : null, openReports: Number(r.open_reports),
        })),
        counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
      };
    },
  },
  {
    method: "GET", path: "/api/faculty/items/:id", access: [...F],
    async handler({ params, ctx }) {
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      const reviews = await ctx.db.query<{ id: string; version: number; decision: string; checks: boolean[]; comment: string; created_at: Date; reviewer: string | null }>(
        `SELECT r.id, r.version, r.decision, r.checks, r.comment, r.created_at, u.display_name AS reviewer
           FROM item_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.item_id = $1 ORDER BY r.created_at DESC`, [it.id]);
      const reports = await ctx.db.query<{ id: string; version: number; reason: string; detail: string; status: string; resolution: string; created_at: Date }>(
        `SELECT id, version, reason, detail, status, resolution, created_at FROM item_reports WHERE item_id = $1 ORDER BY created_at DESC`, [it.id]);
      const editor = it.lastEditedBy ? await one<{ display_name: string }>(ctx.db, `SELECT display_name FROM users WHERE id = $1`, [it.lastEditedBy]) : null;
      return {
        item: { ...it, lastEditedByName: editor?.display_name ?? null },
        checks: qualityChecks(inputOf(it)),
        stats: await itemStats(ctx.db, it.id, it.version),
        reviews: reviews.map((r) => ({ id: String(r.id), version: r.version, decision: r.decision, checks: r.checks, comment: r.comment, reviewer: r.reviewer, at: new Date(r.created_at).toISOString() })),
        // Reporter identity is not exposed to faculty — learners report anonymously.
        reports: reports.map((r) => ({ id: String(r.id), version: r.version, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution, at: new Date(r.created_at).toISOString() })),
      };
    },
  },
  {
    method: "POST", path: "/api/faculty/items", access: [...F],
    async handler({ req, ctx, user }) {
      const { item } = await readBody(req, saveSchema);
      const id = await nextItemId(ctx.db);
      await ctx.db.query(
        `INSERT INTO items (id, topic, subtopic, level, vignette, labs, lead_in, options, correct_key, explanation, reference, status, version, author_id, last_edited_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,'draft',1,$12,$12,$13,$13)`,
        [id, item.topic, item.subtopic, item.level, item.vignette, JSON.stringify(item.labs), item.leadIn,
          JSON.stringify(normalizeOptions(item.options)), item.correctKey, item.explanation, item.reference, user.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "item.create", id);
      return { item: await getItem(ctx.db, id) };
    },
  },
  {
    method: "PUT", path: "/api/faculty/items/:id", access: [...F],
    async handler({ req, params, ctx, user }) {
      const { item, baseUpdatedAt } = await readBody(req, saveSchema);
      return ctx.db.tx(async (db) => {
        const cur = await one<{ status: string; updated_at: Date }>(db, `SELECT status, updated_at FROM items WHERE id = $1 FOR UPDATE`, [params.id]);
        if (!cur) throw notFound();
        if (cur.status !== "draft") throw conflict("not_draft", "แก้ไขได้เฉพาะข้อที่เป็น Draft — ข้อที่อนุมัติแล้วให้กด “แก้ไขเป็นเวอร์ชันใหม่”");
        if (baseUpdatedAt && new Date(cur.updated_at).toISOString() !== baseUpdatedAt) {
          throw conflict("stale", "มีผู้แก้ไขข้อนี้หลังจากที่คุณเปิด กรุณาโหลดใหม่ก่อนบันทึก");
        }
        await db.query(
          `UPDATE items SET topic=$2, subtopic=$3, level=$4, vignette=$5, labs=$6::jsonb, lead_in=$7, options=$8::jsonb, correct_key=$9,
                  explanation=$10, reference=$11, last_edited_by=$12, updated_at=$13 WHERE id=$1`,
          [params.id, item.topic, item.subtopic, item.level, item.vignette, JSON.stringify(item.labs), item.leadIn,
            JSON.stringify(normalizeOptions(item.options)), item.correctKey, item.explanation, item.reference, user.id, ctx.now().toISOString()]);
        return { item: await getItem(db, params.id) };
      });
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/submit", access: [...F],
    async handler({ params, ctx, user }) {
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      if (it.status !== "draft") throw conflict("not_draft", "ส่งรีวิวได้เฉพาะข้อที่เป็น Draft");
      const fails = blockingFailures(inputOf(it));
      if (fails.length) throw new HttpError(422, "quality_checks_failed", `ยังส่งรีวิวไม่ได้: ${fails.map((f) => f.label).join(", ")}`);
      await ctx.db.query(`UPDATE items SET status='review', updated_at=$2 WHERE id=$1`, [it.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "item.submit", it.id, { version: it.version });
      return { item: await getItem(ctx.db, it.id) };
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/revise", access: [...F],
    async handler({ params, ctx, user }) {
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      if (it.status !== "approved" && it.status !== "retired") throw conflict("not_published", "ข้อนี้ยังเป็น Draft หรืออยู่ระหว่างรีวิว");
      await ctx.db.query(`UPDATE items SET status='draft', version=version+1, last_edited_by=$2, updated_at=$3 WHERE id=$1`, [it.id, user.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "item.revise", it.id, { fromVersion: it.version });
      return { item: await getItem(ctx.db, it.id) };
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/withdraw", access: [...F],
    async handler({ params, ctx, user }) {
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      if (it.status !== "review") throw conflict("not_in_review", "ข้อนี้ไม่ได้อยู่ระหว่างรีวิว");
      if (it.authorId !== user.id && it.lastEditedBy !== user.id) throw forbidden("not_editor", "ดึงกลับได้เฉพาะผู้เขียนหรือผู้แก้ไขล่าสุด");
      await ctx.db.query(`UPDATE items SET status='draft', updated_at=$2 WHERE id=$1`, [it.id, ctx.now().toISOString()]);
      return { item: await getItem(ctx.db, it.id) };
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/retire", access: [...F],
    async handler({ req, params, ctx, user }) {
      const { reason } = await readBody(req, reasonSchema);
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      if (it.status !== "approved") throw conflict("not_approved", "ถอนได้เฉพาะข้อที่อนุมัติแล้ว");
      await ctx.db.query(`UPDATE items SET status='retired', updated_at=$2 WHERE id=$1`, [it.id, ctx.now().toISOString()]);
      await ctx.db.query(`DELETE FROM pending_questions WHERE item_id = $1`, [it.id]);
      await audit(ctx.db, user.id, "item.retire", it.id, { reason });
      return { item: await getItem(ctx.db, it.id) };
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/restore", access: [...F],
    async handler({ params, ctx, user }) {
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      if (it.status !== "retired") throw conflict("not_retired", "ข้อนี้ไม่ได้ถูกถอน");
      await ctx.db.query(`UPDATE items SET status='approved', updated_at=$2 WHERE id=$1`, [it.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "item.restore", it.id);
      return { item: await getItem(ctx.db, it.id) };
    },
  },
  {
    method: "DELETE", path: "/api/faculty/items/:id", access: [...F],
    async handler({ params, ctx, user }) {
      const r = await one<{ status: string; author_id: string | null; approved_at: Date | null; n: string }>(ctx.db,
        `SELECT status, author_id, approved_at, (SELECT count(*) FROM attempts WHERE item_id = items.id) AS n FROM items WHERE id = $1`, [params.id]);
      if (!r) throw notFound();
      if (r.status !== "draft" || r.approved_at || Number(r.n) > 0) throw conflict("not_deletable", "ลบได้เฉพาะ Draft ที่ไม่เคยเผยแพร่ ข้อที่เคยใช้แล้วให้ถอน (retire) แทน");
      if (r.author_id !== user.id) throw forbidden("not_author", "ลบได้เฉพาะผู้เขียน");
      await ctx.db.query(`DELETE FROM items WHERE id = $1`, [params.id]);
      await audit(ctx.db, user.id, "item.delete", params.id);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/faculty/review-queue", access: [...F],
    async handler({ ctx, user }) {
      const rows = await ctx.db.query<{ id: string; topic: string; subtopic: string; level: string; lead_in: string; version: number; author_name: string | null; author_id: string | null; last_edited_by: string | null; updated_at: Date }>(
        `SELECT i.id, i.topic, i.subtopic, i.level, i.lead_in, i.version, au.display_name AS author_name, i.author_id, i.last_edited_by, i.updated_at
           FROM items i LEFT JOIN users au ON au.id = i.author_id WHERE i.status = 'review' ORDER BY i.updated_at`);
      return {
        items: rows.map((r) => ({
          id: r.id, topic: r.topic, subtopic: r.subtopic, level: r.level, leadIn: r.lead_in, version: r.version, authorName: r.author_name,
          submittedAt: new Date(r.updated_at).toISOString(), canReview: r.author_id !== user.id && r.last_edited_by !== user.id,
        })),
      };
    },
  },
  {
    method: "POST", path: "/api/faculty/items/:id/review", access: [...F],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, reviewSchema);
      return ctx.db.tx(async (db) => {
        const it = await one<{ status: string; version: number; author_id: string | null; last_edited_by: string | null }>(db,
          `SELECT status, version, author_id, last_edited_by FROM items WHERE id = $1 FOR UPDATE`, [params.id]);
        if (!it) throw notFound();
        if (it.status !== "review") throw conflict("not_in_review", "ข้อนี้ไม่ได้อยู่ระหว่างรีวิวแล้ว");
        if (it.author_id === user.id || it.last_edited_by === user.id) throw forbidden("own_item", "ผู้เขียนหรือผู้แก้ไขล่าสุดรีวิวข้อของตนเองไม่ได้");
        if (b.decision === "approve" && !b.checks.every(Boolean)) throw bad("rubric_incomplete", "อนุมัติได้เมื่อผ่าน rubric ครบทั้ง 7 ข้อ");
        if (b.decision === "revise" && !b.comment) throw bad("comment_required", "กรุณาระบุสิ่งที่ต้องแก้ไขให้ผู้เขียน");
        const now = ctx.now().toISOString();
        await db.query(`INSERT INTO item_reviews (item_id, version, reviewer_id, decision, checks, comment, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [params.id, it.version, user.id, b.decision, JSON.stringify(b.checks), b.comment, now]);
        if (b.decision === "approve") {
          await db.query(`UPDATE items SET status='approved', approved_at=$2, updated_at=$2 WHERE id=$1`, [params.id, now]);
        } else {
          await db.query(`UPDATE items SET status='draft', updated_at=$2 WHERE id=$1`, [params.id, now]);
        }
        await audit(db, user.id, `item.review.${b.decision}`, params.id, { version: it.version });
        return { item: await getItem(db, params.id) };
      });
    },
  },
  {
    method: "GET", path: "/api/faculty/reports", access: [...F],
    async handler({ url, ctx }) {
      const status = url.searchParams.get("status") === "closed" ? "closed" : "open";
      const rows = await ctx.db.query<{ id: string; item_id: string; version: number; reason: string; detail: string; status: string; resolution: string; created_at: Date; closed_at: Date | null; lead_in: string; topic: string; item_status: string; item_version: number }>(
        `SELECT r.id, r.item_id, r.version, r.reason, r.detail, r.status, r.resolution, r.created_at, r.closed_at,
                i.lead_in, i.topic, i.status AS item_status, i.version AS item_version
           FROM item_reports r JOIN items i ON i.id = r.item_id WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 300`, [status]);
      return {
        reports: rows.map((r) => ({
          id: String(r.id), itemId: r.item_id, version: r.version, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution,
          at: new Date(r.created_at).toISOString(), closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
          leadIn: r.lead_in, topic: r.topic, itemStatus: r.item_status, itemVersion: r.item_version,
        })),
      };
    },
  },
  {
    method: "POST", path: "/api/faculty/reports/:id/close", access: [...F],
    async handler({ req, params, ctx, user }) {
      const { resolution } = await readBody(req, closeSchema);
      if (!/^\d+$/.test(params.id)) throw notFound();
      const r = await one<{ id: string }>(ctx.db,
        `UPDATE item_reports SET status='closed', resolution=$2, closed_by=$3, closed_at=$4 WHERE id=$1 AND status='open' RETURNING id`,
        [params.id, resolution, user.id, ctx.now().toISOString()]);
      if (!r) throw conflict("not_open", "รายงานนี้ปิดไปแล้ว");
      await audit(ctx.db, user.id, "report.close", params.id);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/api/faculty/coverage", access: [...F],
    async handler({ ctx }) {
      const rows = await ctx.db.query<{ subtopic: string; level: string; status: string; n: string }>(
        `SELECT subtopic, level, status, count(*) AS n FROM items GROUP BY subtopic, level, status`);
      return {
        topics: TOPICS.map((t) => ({
          code: t.code, name: t.name,
          subs: t.subs.map(([code, name]) => {
            const r = rows.filter((x) => x.subtopic === code);
            const sum = (st: string) => r.filter((x) => x.status === st).reduce((a, x) => a + Number(x.n), 0);
            return { code, name, approved: sum("approved"), review: sum("review"), draft: sum("draft") };
          }),
        })),
      };
    },
  },
];
