import { z } from "zod";
import type { Db } from "./db";
import type { Item, ItemInput, Lab, Option } from "../shared/types";
import { KEYS, LEVELS, SUB_TOPIC } from "../shared/taxonomy";

export interface ItemRow {
  id: string; topic: string; subtopic: string; level: string; vignette: string; labs: Lab[]; lead_in: string;
  options: Option[]; correct_key: string; explanation: string; reference: string; status: Item["status"]; version: number;
  author_id: string | null; last_edited_by: string | null; author_name?: string | null; updated_at: Date | string;
}

export const toItem = (r: ItemRow): Item & { lastEditedBy: string | null } => ({
  id: r.id, topic: r.topic, subtopic: r.subtopic, level: r.level, vignette: r.vignette, labs: r.labs ?? [], leadIn: r.lead_in,
  options: r.options ?? [], correctKey: r.correct_key, explanation: r.explanation, reference: r.reference, status: r.status,
  version: r.version, authorId: r.author_id, authorName: r.author_name ?? null, lastEditedBy: r.last_edited_by,
  updatedAt: new Date(r.updated_at).toISOString(),
});

export const ITEM_COLS = `i.id, i.topic, i.subtopic, i.level, i.vignette, i.labs, i.lead_in, i.options, i.correct_key, i.explanation,
  i.reference, i.status, i.version, i.author_id, i.last_edited_by, i.updated_at, au.display_name AS author_name`;

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
    options: it.options, correctKey: it.correctKey, explanation: it.explanation, reference: it.reference,
  };
}
