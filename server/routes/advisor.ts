import { z } from "zod";
import type { Route, Ctx } from "../context";
import { getThresholds, audit } from "../context";
import { one } from "../db";
import { readBody, notFound } from "../http";
import { flagsFor, groupMedian, lastActiveMap, latestAttempts, masteryFrom, overallPct, subtopicMastery } from "../analytics";

const noteSchema = z.object({ visibility: z.enum(["learner", "staff"]), body: z.string().trim().min(1).max(4000) });

interface LearnerRow { id: string; display_name: string; email: string; track: string | null; cohort_id: string | null; cohort_name: string | null }

async function assignedLearners(ctx: Ctx, advisorId: string): Promise<LearnerRow[]> {
  return ctx.db.query<LearnerRow>(
    `SELECT u.id, u.display_name, u.email, cm.track, c.id AS cohort_id, c.name AS cohort_name
       FROM advisor_assignments a JOIN users u ON u.id = a.learner_id
       LEFT JOIN LATERAL (
         SELECT m.cohort_id, m.track FROM cohort_members m JOIN cohorts cc ON cc.id = m.cohort_id
          WHERE m.user_id = u.id AND NOT cc.archived ORDER BY cc.starts_on DESC NULLS LAST, cc.created_at DESC LIMIT 1) cm ON true
       LEFT JOIN cohorts c ON c.id = cm.cohort_id
      WHERE a.advisor_id = $1 AND u.active ORDER BY u.display_name`, [advisorId]);
}

/** Cohort medians come from every active learner in those cohorts — aggregate only, never individual peers. */
async function cohortMedians(ctx: Ctx, cohortIds: string[], s: Awaited<ReturnType<typeof getThresholds>>) {
  const out: Record<string, Record<string, number | null>> = {};
  for (const cid of [...new Set(cohortIds)]) {
    const members = await ctx.db.query<{ user_id: string }>(
      `SELECT m.user_id FROM cohort_members m JOIN users u ON u.id = m.user_id
         JOIN user_roles r ON r.user_id = u.id AND r.role = 'learner' WHERE m.cohort_id = $1 AND u.active`, [cid]);
    const ids = members.map((m) => m.user_id);
    const rows = await latestAttempts(ctx.db, ids);
    out[cid] = groupMedian(ids.map((id) => masteryFrom(rows.filter((r) => r.user_id === id), s)));
  }
  return out;
}

export const advisorRoutes: Route[] = [
  {
    method: "GET", path: "/api/advisor/learners", access: ["advisor"],
    async handler({ ctx, user }) {
      const s = await getThresholds(ctx.db);
      const learners = await assignedLearners(ctx, user.id);
      const ids = learners.map((l) => l.id);
      const rows = await latestAttempts(ctx.db, ids);
      const last = await lastActiveMap(ctx.db, ids);
      const now = ctx.now();
      const medians = await cohortMedians(ctx, learners.map((l) => l.cohort_id).filter((x): x is string => !!x), s);
      return {
        settings: s,
        medians,
        learners: learners.map((l) => {
          const mine = rows.filter((r) => r.user_id === l.id);
          const mastery = masteryFrom(mine, s);
          const la = last.get(l.id) ?? null;
          return {
            id: l.id, name: l.display_name, track: l.track ?? "", cohortId: l.cohort_id, cohortName: l.cohort_name,
            answered: mine.length, overall: overallPct(mine), lastActive: la?.toISOString() ?? null, mastery, flags: flagsFor(mastery, la, s, now),
          };
        }),
      };
    },
  },
  {
    method: "GET", path: "/api/advisor/learners/:id", access: ["advisor"],
    async handler({ params, ctx, user }) {
      const learner = (await assignedLearners(ctx, user.id)).find((l) => l.id === params.id);
      if (!learner) throw notFound(); // not assigned → indistinguishable from nonexistent
      const s = await getThresholds(ctx.db);
      const rows = await latestAttempts(ctx.db, [learner.id]);
      const mastery = masteryFrom(rows, s);
      const la = (await lastActiveMap(ctx.db, [learner.id])).get(learner.id) ?? null;
      const activity = await ctx.db.query<{ day: string; n: string }>(
        `SELECT to_char((created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') AS day, count(*) AS n
           FROM attempts WHERE user_id = $1 AND created_at > $2::timestamptz - interval '28 days' GROUP BY 1 ORDER BY 1`, [learner.id, ctx.now().toISOString()]);
      const notes = await ctx.db.query<{ id: string; visibility: string; body: string; created_at: Date; author: string | null; author_id: string | null }>(
        `SELECT n.id, n.visibility, n.body, n.created_at, u.display_name AS author, n.author_id
           FROM feedback_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.learner_id = $1 ORDER BY n.created_at DESC`, [learner.id]);
      const medians = learner.cohort_id ? (await cohortMedians(ctx, [learner.cohort_id], s))[learner.cohort_id] : null;
      // Advisors see summaries by topic/subtopic only, never individual item responses (design decision).
      return {
        settings: s,
        learner: { id: learner.id, name: learner.display_name, email: learner.email, track: learner.track ?? "", cohortName: learner.cohort_name },
        mastery, cohortMedian: medians, subtopics: subtopicMastery(rows), overall: overallPct(rows), answered: rows.length,
        lastActive: la?.toISOString() ?? null, flags: flagsFor(mastery, la, s, ctx.now()),
        activity: activity.map((a) => ({ day: a.day, n: Number(a.n) })),
        notes: notes.map((n) => ({ id: String(n.id), visibility: n.visibility, body: n.body, author: n.author, mine: n.author_id === user.id, at: new Date(n.created_at).toISOString() })),
      };
    },
  },
  {
    method: "POST", path: "/api/advisor/learners/:id/notes", access: ["advisor"],
    async handler({ req, params, ctx, user }) {
      const b = await readBody(req, noteSchema);
      const ok = await one(ctx.db, `SELECT 1 FROM advisor_assignments WHERE advisor_id = $1 AND learner_id = $2`, [user.id, params.id]);
      if (!ok) throw notFound();
      await ctx.db.query(`INSERT INTO feedback_notes (learner_id, author_id, visibility, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [params.id, user.id, b.visibility, b.body, ctx.now().toISOString()]);
      await audit(ctx.db, user.id, "note.create", params.id, { visibility: b.visibility });
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/api/advisor/notes/:id", access: ["advisor"],
    async handler({ params, ctx, user }) {
      if (!/^\d+$/.test(params.id)) throw notFound();
      const r = await one(ctx.db, `DELETE FROM feedback_notes WHERE id = $1 AND author_id = $2 RETURNING id`, [params.id, user.id]);
      if (!r) throw notFound();
      return { ok: true };
    },
  },
];
