import { z } from "zod";
import type { Route } from "../context";
import { audit } from "../context";
import { one, type Db } from "../db";
import { readBody, notFound, conflict, forbidden, bad, HttpError } from "../http";
import { hasFeature } from "../entitlements";
import { SUB_TOPIC } from "../../shared/taxonomy";
import type { AuthUser } from "../auth";

const STAFF = ["faculty", "content_reviewer", "advisor", "school_admin"] as const;

interface NoteRow {
  id: string; topic: string; subtopic: string; title: string; summary: string; body: string; refs: string; free_access: boolean;
  status: string; version: number; author_id: string | null; last_edited_by: string | null; certified_by: string | null;
  certified_at: Date | null; updated_at: Date; author_name: string | null; certifier_name: string | null;
}
const COLS = `n.id, n.topic, n.subtopic, n.title, n.summary, n.body, n.refs, n.free_access, n.status, n.version, n.author_id, n.last_edited_by,
  n.certified_by, n.certified_at, n.updated_at, au.display_name AS author_name, ce.display_name AS certifier_name`;
const FROM = `FROM review_notes n LEFT JOIN users au ON au.id = n.author_id LEFT JOIN users ce ON ce.id = n.certified_by`;

const toNote = (r: NoteRow, withBody: boolean) => ({
  id: r.id, topic: r.topic, subtopic: r.subtopic, title: r.title, summary: r.summary, body: withBody ? r.body : null, refs: withBody ? r.refs : null,
  freeAccess: r.free_access, status: r.status, version: r.version, authorId: r.author_id, authorName: r.author_name, lastEditedBy: r.last_edited_by,
  certifiedBy: r.certifier_name, certifiedAt: r.certified_at ? new Date(r.certified_at).toISOString() : null, updatedAt: new Date(r.updated_at).toISOString(),
});

async function getNote(db: Db, id: string) {
  return one<NoteRow>(db, `SELECT ${COLS} ${FROM} WHERE n.id = $1`, [id]);
}

const isStaff = (u: AuthUser) => u.roles.some((r) => (STAFF as readonly string[]).includes(r));
async function canReadFull(db: Db, u: AuthUser, n: NoteRow, now: Date) {
  return n.free_access || isStaff(u) || (await hasFeature(db, u.id, "notes.full", now));
}

const noteInput = z.object({
  topic: z.string(), subtopic: z.string(), title: z.string().trim().max(200).default(""), summary: z.string().trim().max(1000).default(""),
  body: z.string().max(40000).default(""), refs: z.string().max(4000).default(""), freeAccess: z.boolean().default(false),
}).refine((v) => SUB_TOPIC[v.subtopic] === v.topic, { message: "subtopic ไม่อยู่ใน Topic ที่เลือก", path: ["subtopic"] });
const saveSchema = z.object({ note: noteInput, baseUpdatedAt: z.string().optional() });
const certifySchema = z.object({ decision: z.enum(["certify", "revise"]), comment: z.string().trim().max(4000).default(""), confirm: z.boolean().default(false) });

export function noteChecks(n: { title: string; summary: string; body: string; refs: string }) {
  return [
    { id: "title", label: "มีชื่อเรื่อง", ok: n.title.trim().length > 0 },
    { id: "summary", label: "มีบทนำ/สรุปสั้น (ผู้ใช้ฟรีเห็นส่วนนี้)", ok: n.summary.trim().length >= 20 },
    { id: "body", label: "มีเนื้อหาอย่างน้อย 200 ตัวอักษร", ok: n.body.trim().length >= 200 },
    { id: "refs", label: "มีเอกสารอ้างอิง", ok: n.refs.trim().length > 0 },
  ];
}

export const noteRoutes: Route[] = [
  /* ---------- readers ---------- */
  {
    method: "GET", path: "/api/notes", access: "auth",
    async handler({ ctx, user }) {
      const rows = await ctx.db.query<NoteRow>(`SELECT ${COLS} ${FROM} WHERE n.status = 'published' ORDER BY n.topic, n.subtopic, n.title`);
      const full = isStaff(user) || (await hasFeature(ctx.db, user.id, "notes.full", ctx.now()));
      return { notes: rows.map((r) => ({ ...toNote(r, false), locked: !(r.free_access || full) })) };
    },
  },
  {
    method: "GET", path: "/api/notes/:id", access: "auth",
    async handler({ params, ctx, user }) {
      const n = await getNote(ctx.db, params.id);
      if (!n || n.status !== "published") throw notFound();
      if (!(await canReadFull(ctx.db, user, n, ctx.now()))) {
        return { note: { ...toNote(n, false), locked: true } };
      }
      return { note: { ...toNote(n, true), locked: false } };
    },
  },

  /* ---------- authoring (faculty) ---------- */
  {
    method: "GET", path: "/api/faculty/notes", access: ["faculty", "content_reviewer"],
    async handler({ ctx }) {
      const rows = await ctx.db.query<NoteRow>(`SELECT ${COLS} ${FROM} ORDER BY n.topic, n.subtopic, n.id`);
      return { notes: rows.map((r) => toNote(r, false)) };
    },
  },
  {
    method: "GET", path: "/api/faculty/notes/:id", access: ["faculty", "content_reviewer"],
    async handler({ params, ctx }) {
      const n = await getNote(ctx.db, params.id);
      if (!n) throw notFound();
      const reviews = await ctx.db.query<{ id: string; version: number; decision: string; comment: string; created_at: Date; reviewer: string | null }>(
        `SELECT r.id, r.version, r.decision, r.comment, r.created_at, u.display_name AS reviewer FROM note_reviews r LEFT JOIN users u ON u.id = r.reviewer_id
          WHERE r.note_id = $1 ORDER BY r.created_at DESC`, [n.id]);
      return {
        note: toNote(n, true), checks: noteChecks(n),
        reviews: reviews.map((r) => ({ id: String(r.id), version: r.version, decision: r.decision, comment: r.comment, reviewer: r.reviewer, at: new Date(r.created_at).toISOString() })),
      };
    },
  },
  {
    method: "POST", path: "/api/faculty/notes", access: ["faculty"],
    async handler({ req, ctx, user }) {
      const { note } = await readBody(req, saveSchema);
      const r = await one<{ n: string }>(ctx.db, `SELECT nextval('note_number_seq') AS n`);
      const id = `NOTE-${String(r!.n).padStart(4, "0")}`;
      const now = ctx.now().toISOString();
      await ctx.db.query(
        `INSERT INTO review_notes (id, topic, subtopic, title, summary, body, refs, free_access, author_id, last_edited_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)`,
        [id, note.topic, note.subtopic, note.title, note.summary, note.body, note.refs, note.freeAccess, user.id, now]);
      await audit(ctx.db, user.id, "note.create", id);
      return { note: toNote((await getNote(ctx.db, id))!, true) };
    },
  },
  {
    method: "PUT", path: "/api/faculty/notes/:id", access: ["faculty"],
    async handler({ req, params, ctx, user }) {
      const { note, baseUpdatedAt } = await readBody(req, saveSchema);
      return ctx.db.tx(async (db) => {
        const cur = await one<{ status: string; updated_at: Date }>(db, `SELECT status, updated_at FROM review_notes WHERE id = $1 FOR UPDATE`, [params.id]);
        if (!cur) throw notFound();
        if (cur.status !== "draft") throw conflict("not_draft", "แก้ไขได้เฉพาะ Draft — ฉบับที่เผยแพร่แล้วให้กด “แก้ไขเป็นเวอร์ชันใหม่”");
        if (baseUpdatedAt && new Date(cur.updated_at).toISOString() !== baseUpdatedAt) throw conflict("stale", "มีผู้แก้ไขหลังจากที่คุณเปิด กรุณาโหลดใหม่");
        await db.query(
          `UPDATE review_notes SET topic=$2, subtopic=$3, title=$4, summary=$5, body=$6, refs=$7, free_access=$8, last_edited_by=$9, updated_at=$10 WHERE id=$1`,
          [params.id, note.topic, note.subtopic, note.title, note.summary, note.body, note.refs, note.freeAccess, user.id, ctx.now().toISOString()]);
        return { note: toNote((await getNote(db, params.id))!, true) };
      });
    },
  },
  {
    method: "POST", path: "/api/faculty/notes/:id/submit", access: ["faculty"],
    async handler({ params, ctx, user }) {
      const n = await getNote(ctx.db, params.id);
      if (!n) throw notFound();
      if (n.status !== "draft") throw conflict("not_draft", "ส่งรับรองได้เฉพาะ Draft");
      const fails = noteChecks(n).filter((c) => !c.ok);
      if (fails.length) throw new HttpError(422, "checks_failed", `ยังส่งรับรองไม่ได้: ${fails.map((f) => f.label).join(", ")}`);
      await ctx.db.query(`UPDATE review_notes SET status='review', updated_at=$2 WHERE id=$1`, [n.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "note.submit", n.id, { version: n.version });
      return { note: toNote((await getNote(ctx.db, n.id))!, true) };
    },
  },
  {
    method: "POST", path: "/api/faculty/notes/:id/revise", access: ["faculty"],
    async handler({ params, ctx, user }) {
      const n = await getNote(ctx.db, params.id);
      if (!n) throw notFound();
      if (n.status !== "published" && n.status !== "retired") throw conflict("not_published", "ฉบับนี้ยังเป็น Draft หรือรอรับรอง");
      // One row per note: it leaves the library while being revised and returns once re-certified, like items do.
      await ctx.db.query(`UPDATE review_notes SET status='draft', version=version+1, certified_by=NULL, certified_at=NULL, last_edited_by=$2, updated_at=$3 WHERE id=$1`,
        [n.id, user.id, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "note.revise", n.id, { fromVersion: n.version });
      return { note: toNote((await getNote(ctx.db, n.id))!, true) };
    },
  },
  {
    method: "POST", path: "/api/faculty/notes/:id/retire", access: ["faculty", "content_reviewer"],
    async handler({ params, ctx, user }) {
      const r = await one(ctx.db, `UPDATE review_notes SET status='retired', updated_at=$2 WHERE id=$1 AND status='published' RETURNING id`, [params.id, ctx.now().toISOString()]);
      if (!r) throw conflict("not_published", "ถอนได้เฉพาะฉบับที่เผยแพร่อยู่");
      await audit(ctx.db, user.id, "note.retire", params.id);
      return { ok: true };
    },
  },

  /* ---------- certification (content_reviewer) ---------- */
  {
    method: "GET", path: "/api/certify/queue", access: ["content_reviewer"],
    async handler({ ctx, user }) {
      const rows = await ctx.db.query<NoteRow>(`SELECT ${COLS} ${FROM} WHERE n.status = 'review' ORDER BY n.updated_at`);
      return { notes: rows.map((r) => ({ ...toNote(r, false), canCertify: r.author_id !== user.id && r.last_edited_by !== user.id })) };
    },
  },
  {
    method: "POST", path: "/api/certify/notes/:id", access: ["content_reviewer"],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, certifySchema);
      return ctx.db.tx(async (db) => {
        const n = await one<{ status: string; version: number; author_id: string | null; last_edited_by: string | null }>(db,
          `SELECT status, version, author_id, last_edited_by FROM review_notes WHERE id = $1 FOR UPDATE`, [params.id]);
        if (!n) throw notFound();
        if (n.status !== "review") throw conflict("not_in_review", "ฉบับนี้ไม่ได้รอรับรองแล้ว");
        if (n.author_id === user.id || n.last_edited_by === user.id) throw forbidden("own_note", "ผู้เขียนหรือผู้แก้ไขล่าสุดรับรองเนื้อหาของตนเองไม่ได้");
        if (b.decision === "certify" && !b.confirm) throw bad("confirm_required", "กรุณายืนยันว่าได้ตรวจความถูกต้องทางวิชาการแล้ว");
        if (b.decision === "revise" && !b.comment) throw bad("comment_required", "กรุณาระบุสิ่งที่ต้องแก้ไข");
        const now = ctx.now().toISOString();
        await db.query(`INSERT INTO note_reviews (note_id, version, reviewer_id, decision, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [params.id, n.version, user.id, b.decision, b.comment, now]);
        if (b.decision === "certify") {
          await db.query(`UPDATE review_notes SET status='published', certified_by=$2, certified_at=$3, updated_at=$3 WHERE id=$1`, [params.id, user.id, now]);
        } else {
          await db.query(`UPDATE review_notes SET status='draft', updated_at=$2 WHERE id=$1`, [params.id, now]);
        }
        await audit(db, user.id, `note.${b.decision}`, params.id, { version: n.version });
        return { note: toNote((await getNote(db, params.id))!, true) };
      });
    },
  },
];
