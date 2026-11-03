import type { Db } from "./db";
import { TOPICS } from "../shared/taxonomy";
import type { Settings, TopicMastery } from "../shared/types";

interface LatestRow { user_id: string; item_id: string; topic: string; subtopic: string; is_correct: boolean }

/** Latest attempt per (learner, item) for non-retired items — mastery counts each item once, by its most recent answer. */
export async function latestAttempts(db: Db, userIds: string[]): Promise<LatestRow[]> {
  if (!userIds.length) return [];
  return db.query<LatestRow>(
    `SELECT DISTINCT ON (a.user_id, a.item_id) a.user_id, a.item_id, i.topic, i.subtopic, a.is_correct
       FROM attempts a JOIN items i ON i.id = a.item_id
      WHERE a.user_id = ANY($1::uuid[]) AND i.status <> 'retired'
      ORDER BY a.user_id, a.item_id, a.created_at DESC, a.id DESC`, [userIds]);
}

export function masteryFrom(rows: LatestRow[], s: Settings): TopicMastery[] {
  return TOPICS.map((t) => {
    const r = rows.filter((x) => x.topic === t.code);
    const c = r.filter((x) => x.is_correct).length;
    return { code: t.code, n: r.length, c, pct: r.length ? Math.round((c / r.length) * 100) : null, enough: r.length >= s.minAnswersPerTopic };
  });
}

export function subtopicMastery(rows: LatestRow[]) {
  const m = new Map<string, { n: number; c: number }>();
  for (const r of rows) {
    const v = m.get(r.subtopic) ?? { n: 0, c: 0 };
    v.n++; if (r.is_correct) v.c++;
    m.set(r.subtopic, v);
  }
  return [...m.entries()].map(([code, v]) => ({ code, n: v.n, c: v.c, pct: Math.round((v.c / v.n) * 100) }));
}

export function overallPct(rows: LatestRow[]): number | null {
  return rows.length ? Math.round((rows.filter((r) => r.is_correct).length / rows.length) * 100) : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function groupMedian(perLearner: TopicMastery[][]): Record<string, number | null> {
  return Object.fromEntries(TOPICS.map((t) => [t.code,
    median(perLearner.map((m) => m.find((x) => x.code === t.code)!).filter((x) => x.enough && x.pct != null).map((x) => x.pct!))]));
}

export function flagsFor(mastery: TopicMastery[], lastActive: Date | null, s: Settings, now: Date): string[] {
  const out: string[] = [];
  const low = mastery.filter((m) => m.enough && m.pct != null && m.pct < s.lowMastery).map((m) => m.code);
  if (low.length) out.push(`Mastery ต่ำ: ${low.join(", ")}`);
  if (!lastActive || now.getTime() - lastActive.getTime() > s.inactiveDays * 86_400_000) out.push(`ไม่เข้าใช้เกิน ${s.inactiveDays} วัน`);
  return out;
}

/** Thailand has no DST: a fixed +07:00 offset gives the local calendar day. */
const bkkDay = (d: Date) => Math.floor((d.getTime() + 7 * 3_600_000) / 86_400_000);

/** Consecutive local days with at least one answer, ending today or yesterday. */
export function streakDays(days: Date[], now: Date): number {
  const set = new Set(days.map(bkkDay));
  let d = bkkDay(now);
  if (!set.has(d)) d -= 1;
  let n = 0;
  while (set.has(d)) { n++; d--; }
  return n;
}

export async function lastActiveMap(db: Db, userIds: string[]): Promise<Map<string, Date>> {
  if (!userIds.length) return new Map();
  const rows = await db.query<{ user_id: string; last: Date }>(
    `SELECT user_id, max(created_at) AS last FROM attempts WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`, [userIds]);
  return new Map(rows.map((r) => [r.user_id, new Date(r.last)]));
}
