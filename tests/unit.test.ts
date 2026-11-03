import { describe, it, expect } from "vitest";
import { streakDays, median, masteryFrom, flagsFor } from "../server/analytics";
import { qualityChecks, blockingFailures } from "../shared/quality";
import { hashPassword, verifyPassword, tempPassword } from "../server/auth";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("analytics", () => {
  const now = new Date("2026-11-03T03:00:00Z"); // 10:00 Bangkok
  it("counts streaks in Bangkok days", () => {
    const d = (iso: string) => new Date(iso);
    expect(streakDays([d("2026-11-03T01:00:00Z"), d("2026-11-02T10:00:00Z"), d("2026-11-01T16:30:00Z")], now)).toBe(3);
    expect(streakDays([d("2026-11-02T10:00:00Z")], now)).toBe(1); // yesterday still counts
    expect(streakDays([d("2026-10-31T10:00:00Z")], now)).toBe(0);
    // 2026-11-01T17:30Z is already 2 Nov in Bangkok
    expect(streakDays([d("2026-11-01T17:30:00Z")], now)).toBe(1);
  });
  it("medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
  it("flags low mastery only once there are enough answers", () => {
    const rows = [
      { user_id: "u", item_id: "1", topic: "T2", subtopic: "t2.microcytic", is_correct: false },
      { user_id: "u", item_id: "2", topic: "T2", subtopic: "t2.macrocytic", is_correct: false },
      { user_id: "u", item_id: "3", topic: "T3", subtopic: "t3.mpn", is_correct: false },
    ];
    const m = masteryFrom(rows, DEFAULT_SETTINGS);
    expect(m.find((x) => x.code === "T2")).toMatchObject({ n: 2, pct: 0, enough: true });
    expect(m.find((x) => x.code === "T3")).toMatchObject({ n: 1, enough: false });
    expect(flagsFor(m, now, DEFAULT_SETTINGS, now)).toEqual(["Mastery ต่ำ: T2"]);
    expect(flagsFor(m, null, DEFAULT_SETTINGS, now)).toHaveLength(2);
  });
});

describe("quality checks", () => {
  const base = {
    topic: "T5", subtopic: "t5.transfusion", level: "Intern", vignette: "v", labs: [], leadIn: "q",
    options: ["A", "B", "C", "D", "E"].map((key) => ({ key, text: `opt ${key}`, rationale: "r" })),
    correctKey: "B", explanation: "e", reference: "ref",
  };
  it("passes a complete item", () => expect(blockingFailures(base)).toEqual([]));
  it("catches a mismatched subtopic and missing rationale", () => {
    const f = blockingFailures({ ...base, subtopic: "t2.microcytic", options: base.options.map((o, i) => (i === 2 ? { ...o, rationale: " " } : o)) });
    expect(f.map((x) => x.id).sort()).toEqual(["rationale", "tags"]);
  });
  it("warns when the key is the longest option", () => {
    const opts = base.options.map((o) => (o.key === "B" ? { ...o, text: "a much longer correct answer than the rest" } : o));
    const c = qualityChecks({ ...base, options: opts });
    expect(c.find((x) => x.id === "notlongest")).toMatchObject({ ok: false, blocking: false });
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("makes readable temporary passwords", () => {
    expect(tempPassword()).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
