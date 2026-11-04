/**
 * Simulated question bank: 10 bilingual single-best-answer items per subtopic (230 items), each citing
 * guideline-level references (ASH, ISTH, WHO, EBMT, NCCN, ELN, standard textbooks).
 *
 * These are machine-drafted teaching items. They are loaded with origin = 'sample_bank' so faculty can see,
 * edit ("แก้ไขเป็นเวอร์ชันใหม่"), retire or re-review them, and every item must be checked by a hematologist
 * before real use. Reference strings are guideline/edition-level pointers for faculty to verify and complete.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "../db";
import { KEYS, RUBRIC, SUB_TOPIC } from "../../shared/taxonomy";
import type { ItemEn, Lab, Option } from "../../shared/types";

type GenLab = [string, string, string, string, string];
type GenOption = [string, string, string, string]; // th text, th rationale, en text, en rationale
interface GenItem { s: string; l: string; v: string; ve: string; labs: GenLab[]; q: string; qe: string; o: GenOption[]; k: string; x: string; xe: string; r: string }

const DIR = fileURLToPath(new URL("./gen/", import.meta.url));
const PER_SUBTOPIC = 10;

export function loadSampleBank(): { subtopic: string; topic: string; level: string; vignette: string; labs: Lab[]; leadIn: string; options: Option[]; correctKey: string; explanation: string; reference: string; en: ItemEn }[] {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const raw: GenItem[] = files.flatMap((f) => JSON.parse(readFileSync(DIR + f, "utf8")) as GenItem[]);
  const perSub = new Map<string, number>();
  const out = [];
  for (const g of raw) {
    const topic = SUB_TOPIC[g.s];
    if (!topic) continue;
    const n = perSub.get(g.s) ?? 0;
    if (n >= PER_SUBTOPIC) continue; // keep exactly 10 per subtopic
    perSub.set(g.s, n + 1);
    const options: Option[] = g.o.map((o, i) => ({ key: KEYS[i], text: o[0], rationale: o[1] }));
    const enOptions: Option[] = g.o.map((o, i) => ({ key: KEYS[i], text: o[2], rationale: o[3] }));
    out.push({
      subtopic: g.s, topic, level: g.l, vignette: g.v, leadIn: g.q, options, correctKey: g.k, explanation: g.x, reference: g.r,
      labs: g.labs.map(([test, value, unit, range, flag]) => ({ test, value, unit, range, flag: flag as Lab["flag"] })),
      en: { vignette: g.ve, leadIn: g.qe, options: enOptions, explanation: g.xe },
    });
  }
  return out;
}

/**
 * Inserts the sample bank. `status` is 'approved' for demo/pilot installs (so learners have a full pool) or
 * 'draft' when faculty prefer to review everything before release. Returns the number inserted.
 */
export async function seedSampleBank(db: Db, now: Date, opts: { authorId: string | null; reviewerId: string | null; status: "approved" | "draft"; startNumber?: number }) {
  const items = loadSampleBank();
  const start = opts.startNumber ?? 201;
  const created = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  for (const [i, it] of items.entries()) {
    const id = `HEM-${String(start + i).padStart(4, "0")}`;
    await db.query(
      `INSERT INTO items (id, topic, subtopic, level, vignette, labs, lead_in, options, correct_key, explanation, reference, status, version,
                          author_id, last_edited_by, created_at, updated_at, approved_at, i18n, origin)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,1,$13,$13,$14,$14,$15,$16::jsonb,'sample_bank')`,
      [id, it.topic, it.subtopic, it.level, it.vignette, JSON.stringify(it.labs), it.leadIn, JSON.stringify(it.options), it.correctKey,
        it.explanation, it.reference, opts.status, opts.authorId, created, opts.status === "approved" ? created : null, JSON.stringify({ en: it.en })]);
    if (opts.status === "approved" && opts.reviewerId) {
      await db.query(`INSERT INTO item_reviews (item_id, version, reviewer_id, decision, checks, comment, created_at) VALUES ($1,1,$2,'approve',$3::jsonb,$4,$5)`,
        [id, opts.reviewerId, JSON.stringify(RUBRIC.map(() => true)), "อนุมัติเพื่อการทดลองระบบ — โจทย์ร่างอัตโนมัติ ต้องตรวจซ้ำก่อนใช้จริง", created]);
    }
  }
  await db.query(`SELECT setval('item_number_seq', GREATEST((SELECT last_value FROM item_number_seq), $1))`, [start + items.length]);
  return items.length;
}
