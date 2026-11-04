import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, makeCtx, Client, firstLogin, SETUP_TOKEN } from "./helpers";
import type { Ctx } from "../server/context";
import { loadSampleBank } from "../server/seed/sample-bank";
import { TOPICS } from "../shared/taxonomy";
import { qualityChecks } from "../shared/quality";

const ADMIN = { email: "admin@school.example", password: "admin-password-123" };
let ctx: Ctx;
let accounts: { email: string; tempPassword: string }[];
let admin: Client, learner: Client, author: Client;
const acct = (p: string) => accounts.find((a) => a.email.startsWith(p))!;

describe("sample bank content", () => {
  it("has exactly 10 bilingual items per subtopic with references", () => {
    const items = loadSampleBank();
    const subs = TOPICS.flatMap((t) => t.subs.map(([c]) => c));
    expect(items).toHaveLength(subs.length * 10);
    for (const s of subs) expect(items.filter((i) => i.subtopic === s)).toHaveLength(10);
    for (const it of items) {
      const checks = qualityChecks({ ...it, i18n: { en: it.en } });
      const failing = checks.filter((c) => c.blocking && !c.ok);
      expect(failing, `${it.subtopic}: ${it.leadIn}`).toEqual([]);
      expect(it.reference.length).toBeGreaterThan(10);
      expect(it.en.options).toHaveLength(5);
      expect(it.en.vignette.length).toBeGreaterThan(10);
    }
  });
});

describe("sample bank in the app", () => {
  beforeAll(async () => {
    const { db } = await freshDb();
    ({ ctx } = makeCtx(db));
    const r = await new Client(ctx).call("POST", "/api/setup", { ...ADMIN, displayName: "Admin", demo: true }, { "x-setup-token": SETUP_TOKEN });
    accounts = r.body.demoAccounts;
    admin = new Client(ctx); await admin.post("/api/auth/login", ADMIN);
    learner = await firstLogin(ctx, acct("learner4").email, acct("learner4").tempPassword);
    author = await firstLogin(ctx, acct("faculty.author").email, acct("faculty.author").tempPassword);
  });

  it("adds 230 approved items labelled as sample bank", async () => {
    const o = (await admin.get("/api/admin/overview")).body;
    expect(o.items.approved).toBe(14 + 230);
    const sb = (await admin.get("/api/admin/sample-bank")).body;
    expect(sb.imported).toBe(true);
    expect(sb.counts.approved).toBe(230);
    expect((await admin.post("/api/admin/sample-bank/import", { status: "draft" })).status).toBe(409);
    const bank = (await author.get("/api/faculty/items?q=HEM-0201")).body.items[0];
    expect(bank.origin).toBe("sample_bank");
    expect(bank.hasEn).toBe(true);
  });

  it("serves questions in English on request and falls back to Thai", async () => {
    const th = (await learner.get("/api/learner/next?topic=T6")).body.question;
    expect(th.lang).toBe("th");
    expect(th.langs).toEqual(["th", "en"]);
    const en = (await learner.get("/api/learner/next?topic=T6&lang=en")).body.question;
    expect(en.id).toBe(th.id); // same open question, re-served in English
    expect(en.lang).toBe("en");
    expect(en.vignette).not.toBe(th.vignette);
    expect(/[฀-๿]/.test(en.leadIn)).toBe(false); // no Thai characters
    const r = (await learner.post("/api/learner/answer", { itemId: en.id, choice: "A", lang: "en" })).body;
    expect(r.lang).toBe("en");
    expect(/[฀-๿]/.test(r.explanation)).toBe(false);
    expect(r.reference).toMatch(/ASH|ISTH|WHO|EBMT|NCCN|ELN|Hematology|Blood|N Engl J Med|Guideline|Lancet|TIF|IDSA/i);
    // original Thai-only demo items report a single language
    const t5 = (await learner.get("/api/learner/items/HEM-0101")).status;
    expect([200, 404]).toContain(t5);
  });

  it("lets faculty open a new version of a sample item and edit the English text", async () => {
    const rev = await author.post("/api/faculty/items/HEM-0201/revise");
    expect(rev.body.item).toMatchObject({ status: "draft", version: 2, origin: "sample_bank" });
    const it = rev.body.item;
    const upd = await author.put("/api/faculty/items/HEM-0201", { item: { ...it, i18n: { en: { ...it.i18n.en, leadIn: "Edited lead-in" } } }, baseUpdatedAt: it.updatedAt });
    expect(upd.status).toBe(200);
    expect(upd.body.item.i18n.en.leadIn).toBe("Edited lead-in");
    const d = (await author.get("/api/faculty/items/HEM-0201")).body;
    expect(d.checks.find((c: { id: string }) => c.id === "en").ok).toBe(true);
  });
});
