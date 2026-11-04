import type { ItemInput } from "./types";
import { KEYS, SUB_TOPIC, LEVELS } from "./taxonomy";

export interface QualityCheck { id: string; label: string; ok: boolean; blocking: boolean }

const filled = (s: string | undefined | null) => !!s && s.trim().length > 0;

/** An English version is fine when absent, or when every field is filled. Half-translated items warn. */
function enOk(en: ItemInput["i18n"] extends { en?: infer E } | undefined ? E | undefined : never): boolean {
  if (!en) return true;
  const started = filled(en.vignette) || filled(en.leadIn) || filled(en.explanation) || (en.options ?? []).some((o) => filled(o.text) || filled(o.rationale));
  if (!started) return true;
  return filled(en.vignette) && filled(en.leadIn) && filled(en.explanation) && (en.options ?? []).length === 5 && en.options.every((o) => filled(o.text) && filled(o.rationale));
}

/** Same checks run in the editor (live) and on the server (on submit). */
export function qualityChecks(it: ItemInput): QualityCheck[] {
  const opts = it.options ?? [];
  const texts = opts.map((o) => (o.text ?? "").trim());
  const correct = opts.find((o) => o.key === it.correctKey);
  const longest = Math.max(0, ...texts.map((t) => t.length));
  const nonEmpty = texts.filter(Boolean).map((t) => t.toLowerCase());
  return [
    { id: "stem", label: "มี vignette และ lead-in", ok: filled(it.vignette) && filled(it.leadIn), blocking: true },
    { id: "tags", label: "แท็ก Topic, subtopic และระดับครบและสอดคล้องกัน", ok: SUB_TOPIC[it.subtopic] === it.topic && (LEVELS as readonly string[]).includes(it.level), blocking: true },
    { id: "five", label: "มีตัวเลือกครบ 5 ข้อ (A–E)", ok: opts.length === 5 && opts.every((o, i) => o.key === KEYS[i] && filled(o.text)), blocking: true },
    { id: "key", label: "เลือกคำตอบที่ถูกแล้ว", ok: (KEYS as readonly string[]).includes(it.correctKey) && !!correct, blocking: true },
    { id: "rationale", label: "มีเหตุผลประกอบทุกตัวเลือก", ok: opts.length === 5 && opts.every((o) => filled(o.rationale)), blocking: true },
    { id: "explanation", label: "มีคำอธิบายเฉลย", ok: filled(it.explanation), blocking: true },
    { id: "reference", label: "มีเอกสารอ้างอิง", ok: filled(it.reference), blocking: true },
    { id: "notlongest", label: "คำตอบที่ถูกไม่ใช่ตัวเลือกที่ยาวที่สุดอย่างเห็นได้ชัด", ok: !correct || texts.length < 5 || correct.text.trim().length < longest || texts.filter((t) => t.length === longest).length > 1, blocking: false },
    { id: "nodup", label: "ไม่มีตัวเลือกซ้ำกัน", ok: new Set(nonEmpty).size === nonEmpty.length, blocking: false },
    { id: "en", label: "ฉบับภาษาอังกฤษครบ (ถ้าเริ่มแปลแล้ว)", ok: enOk(it.i18n?.en), blocking: false },
  ];
}

export const blockingFailures = (it: ItemInput) => qualityChecks(it).filter((c) => c.blocking && !c.ok);
