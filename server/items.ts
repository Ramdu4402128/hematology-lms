import { z } from "zod";
import type { Db } from "./db";
import type { Item, ItemInput, ItemEn, Lab, Lang, Option } from "../shared/types";
import { KEYS, LEVELS, SUB_TOPIC } from "../shared/taxonomy";

export interface ItemRow {
  id: string; topic: string; subtopic: string; level: string; vignette: string; labs: Lab[]; lead_in: string;
  options: Option[]; correct_key: string; explanation: string; reference: string; status: Item["status"]; version: number;
  author_id: string | null; last_edited_by: string | null; author_name?: string | null; updated_at: Date | string;
  i18n: { en?: ItemEn } | null; origin: "faculty" | "sample_bank";
}

export const toItem = (r: ItemRow): Item & { lastEditedBy: string | null } => ({
  id: r.id, topic: r.topic, subtopic: r.subtopic, level: r.level, vignette: r.vignette, labs: r.labs ?? [], leadIn: r.lead_in,
  options: r.options ?? [], correctKey: r.correct_key, explanation: r.explanation, reference: r.reference, status: r.status,
  version: r.version, authorId: r.author_id, authorName: r.author_name ?? null, lastEditedBy: r.last_edited_by,
  updatedAt: new Date(r.updated_at).toISOString(), i18n: r.i18n ?? {}, origin: r.origin,
});

export const langsOf = (it: { i18n?: { en?: ItemEn } }): Lang[] => (it.i18n?.en && enComplete(it.i18n.en) ? ["th", "en"] : ["th"]);
export const enComplete = (en: ItemEn) =>
  !!en.vignette.trim() && !!en.leadIn.trim() && en.options.length === 5 && en.options.every((o) => o.text.trim() && o.rationale.trim()) && !!en.explanation.trim();
/** Any English field filled at all — used to warn about half-done translations. */
export const enStarted = (en?: ItemEn) => !!en && (!!en.vignette.trim() || !!en.leadIn.trim() || !!en.explanation.trim() || en.options.some((o) => o.text.trim() || o.rationale.trim()));

/** Text fields in the requested language, falling back to Thai. */
export function localized(it: Item, lang: Lang): { lang: Lang; vignette: string; leadIn: string; options: Option[]; explanation: string } {
  const en = it.i18n?.en;
  if (lang === "en" && en && enComplete(en)) return { lang: "en", vignette: en.vignette, leadIn: en.leadIn, options: en.options, explanation: en.explanation };
  return { lang: "th", vignette: it.vignette, leadIn: it.leadIn, options: it.options, explanation: it.explanation };
}

export const ITEM_COLS = `i.id, i.topic, i.subtopic, i.level, i.vignette, i.labs, i.lead_in, i.options, i.correct_key, i.explanation,
  i.reference, i.status, i.version, i.author_id, i.last_edited_by, i.updated_at, i.i18n, i.origin, au.display_name AS author_name`;

export async function getItem(db: Db, id: string) {
  const rows = await db.query<ItemRow>(`SELECT ${ITEM_COLS} FROM items i LEFT JOIN users au ON au.id = i.author_id WHERE i.id = $1`, [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

const s = (max: number) => z.string().max(max).default("");

export const labSchema = z.object({
  test: z.string().max(120), value: z.string().max(60), unit: z.string().max(40).default(""),
  range: z.string().max(60).default(""), flag: z.enum(["ปกติ", "สูง", "ต่ำ"]).default("ปกติ"),
});
export const optionSchema = z.object({ key: z.enum(KEYS), text: s(600), rationale: s(1200) });
export const itemEnSchema = z.object({ vignette: s(4000), leadIn: s(600), options: z.array(optionSchema).max(5).default([]), explanation: s(4000) });

/** Shape check only — completeness is enforced on submit by the quality checks. */
export const itemInputSchema = z.object({
  topic: z.string(),
  subtopic: z.string(),
  level: z.enum(LEVELS),
  vignette: s(4000),
  labs: z.array(labSchema).max(30).default([]),
  leadIn: s(600),
  options: z.array(optionSchema).max(5).default([]),
  correctKey: z.union([z.enum(KEYS), z.literal("")]).default(""),
  explanation: s(4000),
  reference: s(1000),
  i18n: z.object({ en: itemEnSchema.optional() }).default({}),
}).refine((v) => SUB_TOPIC[v.subtopic] === v.topic, { message: "subtopic ไม่อยู่ใน Topic ที่เลือก", path: ["subtopic"] });

export function normalizeOptions(opts: Option[]): Option[] {
  return KEYS.map((k) => {
    const o = opts.find((x) => x.key === k);
    return { key: k, text: o?.text ?? "", rationale: o?.rationale ?? "" };
  });
}

export function inputOf(it: Item): ItemInput {
  return {
    topic: it.topic, subtopic: it.subtopic, level: it.level, vignette: it.vignette, labs: it.labs, leadIn: it.leadIn,
    options: it.options, correctKey: it.correctKey, explanation: it.explanation, reference: it.reference, i18n: it.i18n ?? {},
  };
}

/** Normalises the English block: drops it entirely when nothing was entered. */
export function normalizeI18n(i18n: ItemInput["i18n"]): { en?: ItemEn } {
  const en = i18n?.en;
  if (!en || !enStarted(en)) return {};
  return { en: { vignette: en.vignette, leadIn: en.leadIn, options: normalizeOptions(en.options), explanation: en.explanation } };
}
