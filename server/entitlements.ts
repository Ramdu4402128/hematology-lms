import type { Db } from "./db";
import { one } from "./db";
import { HttpError } from "./http";
import { PLAN_FEATURES, REVIEW_INTERVALS, type Entitlements, type Feature } from "../shared/plans";

const DAY = 86_400_000;

export async function getEntitlements(db: Db, userId: string, now: Date): Promise<Entitlements> {
  const grants = await db.query<{ source: string; starts_at: Date; ends_at: Date | null }>(
    `SELECT source, starts_at, ends_at FROM entitlement_grants
      WHERE user_id = $1 AND plan = 'plus' AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at > $2)
      ORDER BY starts_at`, [userId, now.toISOString()]);
  const active = grants.filter((g) => new Date(g.starts_at) <= now);
  if (!active.length) return { plan: "free", features: PLAN_FEATURES.free, plusUntil: null, sources: [] };
  const openEnded = grants.some((g) => g.ends_at == null);
  // grantPlus chains new grants onto the current end date, so the latest end is the real end of Plus.
  const latest = Math.max(...grants.filter((g) => g.ends_at).map((g) => new Date(g.ends_at!).getTime()));
  return {
    plan: "plus",
    features: PLAN_FEATURES.plus,
    plusUntil: openEnded || !Number.isFinite(latest) ? null : new Date(latest).toISOString(),
    sources: grants.map((g) => ({ source: g.source, endsAt: g.ends_at ? new Date(g.ends_at).toISOString() : null })),
  };
}

export async function hasFeature(db: Db, userId: string, feature: Feature, now: Date) {
  return (await getEntitlements(db, userId, now)).features.includes(feature);
}

export async function requireFeature(db: Db, userId: string, feature: Feature, now: Date) {
  if (!(await hasFeature(db, userId, feature, now))) throw new HttpError(402, "plus_required", "ส่วนนี้สำหรับสมาชิก Plus");
}

/**
 * Extends Plus from the later of now or the current end date, so buying or redeeming
 * while already a member adds time instead of overlapping it.
 */
export async function grantPlus(db: Db, opts: { userId: string; days: number | null; source: string; ref?: string; grantedBy?: string | null; now: Date }) {
  const cur = await one<{ until: Date | null }>(db,
    `SELECT max(ends_at) AS until FROM entitlement_grants
      WHERE user_id = $1 AND revoked_at IS NULL AND ends_at > $2`, [opts.userId, opts.now.toISOString()]);
  const start = cur?.until && new Date(cur.until) > opts.now ? new Date(cur.until) : opts.now;
  const ends = opts.days == null ? null : new Date(start.getTime() + opts.days * DAY).toISOString();
  const g = await one<{ id: string }>(db,
    `INSERT INTO entitlement_grants (user_id, plan, source, starts_at, ends_at, ref, granted_by) VALUES ($1,'plus',$2,$3,$4,$5,$6) RETURNING id`,
    [opts.userId, opts.source, start.toISOString(), ends, opts.ref ?? "", opts.grantedBy ?? null]);
  return { id: g!.id, startsAt: start.toISOString(), endsAt: ends };
}

/** Updates the spaced-repetition card after an answer. Runs for everyone; only Plus can browse the queue. */
export async function updateReviewCard(db: Db, userId: string, itemId: string, correct: boolean, now: Date) {
  const card = await one<{ state: string }>(db, `SELECT state FROM review_cards WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
  const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
  if (!correct) {
    await db.query(
      `INSERT INTO review_cards (user_id, item_id, state, due_at, lapses, last_reviewed_at) VALUES ($1,$2,'to_review',$3,0,$4)
       ON CONFLICT (user_id, item_id) DO UPDATE SET state = 'to_review', due_at = EXCLUDED.due_at,
         lapses = review_cards.lapses + 1, last_reviewed_at = EXCLUDED.last_reviewed_at`,
      [userId, itemId, at(REVIEW_INTERVALS.firstRetry), now.toISOString()]);
    return;
  }
  if (!card || card.state === "mastered") return;
  const next = card.state === "to_review" ? { state: "recall_check", due: at(REVIEW_INTERVALS.recallCheck) } : { state: "mastered", due: now.toISOString() };
  await db.query(`UPDATE review_cards SET state = $3, due_at = $4, last_reviewed_at = $5 WHERE user_id = $1 AND item_id = $2`,
    [userId, itemId, next.state, next.due, now.toISOString()]);
}
