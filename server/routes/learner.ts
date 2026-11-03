import { z } from "zod";
import type { Route } from "../context";
import { getThresholds } from "../context";
import { one } from "../db";
import { readBody, notFound, conflict, bad } from "../http";
import { latestAttempts, masteryFrom, overallPct, streakDays, subtopicMastery } from "../analytics";
import { getItem } from "../items";
import { KEYS, TOPICS, REPORT_REASONS } from "../../shared/taxonomy";
import type { AnswerResult, LearnerQuestion } from "../../shared/types";

const LEADERBOARD_MIN_ANSWERED = 10;

const answerSchema = z.object({ itemId: z.string().max(20), choice: z.enum(KEYS) });
const reportSchema = z.object({
  reason: z.enum(Object.keys(REPORT_REASONS) as [string, ...string[]]),
  detail: z.string().trim().max(2000).default(""),
});

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function toQuestion(it: NonNullable<Awaited<ReturnType<typeof getItem>>>): LearnerQuestion {
  return {
    id: it.id, version: it.version, topic: it.topic, subtopic: it.subtopic, level: it.level, vignette: it.vignette,
    labs: it.labs, leadIn: it.leadIn, options: it.options.map((o) => ({ key: o.key, text: o.text })),
  };
}

export const learnerRoutes: Route[] = [
  {
    method: "GET", path: "/api/learner/next", access: ["learner"],
    async handler({ url, ctx, user }) {
      const db = ctx.db;
      const topicParam = url.searchParams.get("topic");
      const topic = topicParam && TOPICS.some((t) => t.code === topicParam) ? topicParam : null;
      const skip = url.searchParams.get("skip") === "1";

      // Re-serve the open question (page refresh shouldn't hand out a fresh one) unless the learner skips it.
      const pending = await one<{ item_id: string; topic: string; status: string }>(db,
        `SELECT p.item_id, i.topic, i.status FROM pending_questions p JOIN items i ON i.id = p.item_id WHERE p.user_id = $1`, [user.id]);
      if (pending && !skip && pending.status === "approved" && (!topic || pending.topic === topic)) {
        const it = await getItem(db, pending.item_id);
        return { question: toQuestion(it!), mode: "resume" };
      }

      const pool = await db.query<{ id: string; topic: string }>(
        `SELECT id, topic FROM items WHERE status = 'approved' AND ($1::text IS NULL OR topic = $1)`, [topic]);
      if (!pool.length) {
        await db.query(`DELETE FROM pending_questions WHERE user_id = $1`, [user.id]);
        return { question: null, mode: "empty" };
      }
      const s = await getThresholds(db);
      const latest = await latestAttempts(db, [user.id]);
      const answered = new Map(latest.map((r) => [r.item_id, r.is_correct]));
      const mastery = masteryFrom(latest, s);
      const avoid = skip && pending ? pending.item_id : null;

      let mode: "new" | "review" | "repeat";
      let candidates = pool.filter((i) => !answered.has(i.id) && i.id !== avoid);
      if (candidates.length) {
        mode = "new";
        if (!topic) {
          // Adaptive: weakest topic first; topics without enough answers yet count as weakest.
          const score = (code: string) => { const m = mastery.find((x) => x.code === code)!; return m.enough ? m.pct! : -1; };
          const topics = [...new Set(candidates.map((c) => c.topic))];
          const best = Math.min(...topics.map(score));
          const chosen = pick(topics.filter((t) => score(t) === best));
          candidates = candidates.filter((c) => c.topic === chosen);
        }
      } else {
        candidates = pool.filter((i) => answered.get(i.id) === false && i.id !== avoid);
        mode = "review";
        if (!candidates.length) { candidates = pool.filter((i) => i.id !== avoid); mode = "repeat"; }
        if (!candidates.length) { candidates = pool; }
      }
      const chosen = pick(candidates);
      const it = await getItem(db, chosen.id);
      await db.query(
        `INSERT INTO pending_questions (user_id, item_id, version, served_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET item_id = EXCLUDED.item_id, version = EXCLUDED.version, served_at = EXCLUDED.served_at`,
        [user.id, it!.id, it!.version, ctx.now().toISOString()]);
      const remainingNew = pool.filter((i) => !answered.has(i.id)).length;
      return { question: toQuestion(it!), mode, remainingNew };
    },
  },
  {
    method: "POST", path: "/api/learner/answer", access: ["learner"],
    async handler({ req, ctx, user }) {
      const b = await readBody(req, answerSchema);
      return ctx.db.tx(async (db) => {
        const p = await one<{ item_id: string; version: number; served_at: Date }>(db,
          `DELETE FROM pending_questions WHERE user_id = $1 AND item_id = $2 RETURNING item_id, version, served_at`, [user.id, b.itemId]);
        if (!p) throw conflict("not_served", "ข้อนี้ไม่ได้อยู่ในชุดที่กำลังทำ กรุณาโหลดข้อถัดไปใหม่");
        const it = await getItem(db, b.itemId);
        if (!it || it.status === "retired") throw conflict("item_unavailable", "ข้อนี้ถูกถอนออกจากคลังแล้ว");
        const correct = b.choice === it.correctKey;
        const now = ctx.now();
        const timeMs = Math.max(0, Math.min(3_600_000, now.getTime() - new Date(p.served_at).getTime()));
        await db.query(
          `INSERT INTO attempts (user_id, item_id, item_version, choice, is_correct, time_ms, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [user.id, it.id, p.version, b.choice, correct, timeMs, now.toISOString()]);
        const res: AnswerResult = { correct, correctKey: it.correctKey, choice: b.choice, options: it.options, explanation: it.explanation, reference: it.reference };
        return res;
      });
    },
  },
  {
    method: "GET", path: "/api/learner/summary", access: ["learner"],
    async handler({ ctx, user }) {
      const db = ctx.db;
      const s = await getThresholds(db);
      const latest = await latestAttempts(db, [user.id]);
      const days = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM attempts WHERE user_id = $1 AND created_at > $2::timestamptz - interval '400 days'`, [user.id, ctx.now().toISOString()]);
      const totals = await one<{ total: string; pool: string }>(db,
        `SELECT (SELECT count(*) FROM attempts WHERE user_id = $1) AS total, (SELECT count(*) FROM items WHERE status = 'approved') AS pool`, [user.id]);
      const notes = await db.query<{ id: string; body: string; created_at: Date; author: string | null }>(
        `SELECT n.id, n.body, n.created_at, u.display_name AS author FROM feedback_notes n LEFT JOIN users u ON u.id = n.author_id
          WHERE n.learner_id = $1 AND n.visibility = 'learner' ORDER BY n.created_at DESC LIMIT 20`, [user.id]);

      // Leaderboard: opt-in only, and only against opted-in peers in the learner's current cohort.
      let leaderboard: unknown = { optedIn: user.leaderboardOptIn };
      if (user.leaderboardOptIn) {
        const cohort = await one<{ id: string; name: string }>(db,
          `SELECT c.id, c.name FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id
            WHERE m.user_id = $1 AND NOT c.archived ORDER BY c.starts_on DESC NULLS LAST, c.created_at DESC LIMIT 1`, [user.id]);
        if (cohort) {
          const peers = await db.query<{ id: string; name: string }>(
            `SELECT u.id, COALESCE(u.leaderboard_alias, u.display_name) AS name FROM cohort_members m JOIN users u ON u.id = m.user_id
              WHERE m.cohort_id = $1 AND u.active AND u.leaderboard_opt_in`, [cohort.id]);
          const rows = await latestAttempts(db, peers.map((p) => p.id));
          const entries = peers.map((p) => {
            const r = rows.filter((x) => x.user_id === p.id);
            return { name: p.name, isMe: p.id === user.id, answered: r.length, pct: overallPct(r) ?? 0 };
          }).filter((e) => e.answered >= LEADERBOARD_MIN_ANSWERED)
            .sort((a, b) => b.pct - a.pct || b.answered - a.answered)
            .map((e, i) => ({ ...e, rank: i + 1 }));
          leaderboard = { optedIn: true, cohortName: cohort.name, minAnswered: LEADERBOARD_MIN_ANSWERED, entries, participants: peers.length };
        } else {
          leaderboard = { optedIn: true, cohortName: null, entries: [], minAnswered: LEADERBOARD_MIN_ANSWERED, participants: 0 };
        }
      }
      return {
        settings: s,
        mastery: masteryFrom(latest, s),
        subtopics: subtopicMastery(latest),
        overall: overallPct(latest),
        answeredItems: latest.length,
        totalAttempts: Number(totals?.total ?? 0),
        poolSize: Number(totals?.pool ?? 0),
        streak: streakDays(days.map((d) => new Date(d.created_at)), ctx.now()),
        notes: notes.map((n) => ({ id: String(n.id), body: n.body, author: n.author, at: new Date(n.created_at).toISOString() })),
        leaderboard,
      };
    },
  },
  {
    method: "GET", path: "/api/learner/history", access: ["learner"],
    async handler({ url, ctx, user }) {
      const onlyWrong = url.searchParams.get("filter") === "wrong";
      const rows = await ctx.db.query<{ item_id: string; topic: string; subtopic: string; lead_in: string; is_correct: boolean; choice: string; created_at: Date; tries: string }>(
        `SELECT * FROM (
           SELECT DISTINCT ON (a.item_id) a.item_id, i.topic, i.subtopic, i.lead_in, a.is_correct, a.choice, a.created_at,
                  count(*) OVER (PARTITION BY a.item_id) AS tries
             FROM attempts a JOIN items i ON i.id = a.item_id
            WHERE a.user_id = $1 AND i.status <> 'retired'
            ORDER BY a.item_id, a.created_at DESC, a.id DESC) t
          WHERE NOT $2::boolean OR NOT t.is_correct
          ORDER BY t.created_at DESC LIMIT 200`, [user.id, onlyWrong]);
      return {
        rows: rows.map((r) => ({ itemId: r.item_id, topic: r.topic, subtopic: r.subtopic, leadIn: r.lead_in, correct: r.is_correct, choice: r.choice, tries: Number(r.tries), at: new Date(r.created_at).toISOString() })),
      };
    },
  },
  {
    method: "GET", path: "/api/learner/items/:id", access: ["learner"],
    async handler({ params, ctx, user }) {
      const mine = await ctx.db.query<{ choice: string; is_correct: boolean; created_at: Date }>(
        `SELECT choice, is_correct, created_at FROM attempts WHERE user_id = $1 AND item_id = $2 ORDER BY created_at DESC`, [user.id, params.id]);
      // The key and rationales are released only for items this learner has already answered.
      if (!mine.length) throw notFound();
      const it = await getItem(ctx.db, params.id);
      if (!it) throw notFound();
      return {
        item: { ...toQuestion(it), options: it.options, correctKey: it.correctKey, explanation: it.explanation, reference: it.reference, status: it.status },
        attempts: mine.map((a) => ({ choice: a.choice, correct: a.is_correct, at: new Date(a.created_at).toISOString() })),
      };
    },
  },
  {
    method: "POST", path: "/api/learner/items/:id/report", access: ["learner"],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, reportSchema);
      const seen = await one<{ version: number }>(ctx.db,
        `SELECT version FROM pending_questions WHERE user_id = $1 AND item_id = $2
         UNION ALL SELECT item_version FROM attempts WHERE user_id = $1 AND item_id = $2 LIMIT 1`, [user.id, params.id]);
      if (!seen) throw notFound();
      if (b.reason === "other" && !b.detail) throw bad("detail_required", "กรุณาอธิบายปัญหาที่พบ");
      const dup = await one(ctx.db, `SELECT 1 FROM item_reports WHERE item_id = $1 AND reporter_id = $2 AND status = 'open'`, [params.id, user.id]);
      if (dup) throw conflict("already_reported", "คุณรายงานข้อนี้ไว้แล้ว อาจารย์กำลังตรวจสอบ");
      const it = await getItem(ctx.db, params.id);
      await ctx.db.query(`INSERT INTO item_reports (item_id, version, reporter_id, reason, detail) VALUES ($1,$2,$3,$4,$5)`,
        [params.id, it!.version, user.id, b.reason, b.detail]);
      return { ok: true };
    },
  },
];
