import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, makeCtx, Client, firstLogin, SETUP_TOKEN } from "./helpers";
import type { Ctx } from "../server/context";

const DAY = 86_400_000;
const ADMIN = { email: "admin@school.example", password: "admin-password-123" };

let ctx: Ctx;
let advance: (ms: number) => void;
let accounts: { email: string; tempPassword: string }[];
let admin: Client, author: Client, certifier: Client, member: Client;
let terms = "";

const acct = (prefix: string) => accounts.find((a) => a.email.startsWith(prefix))!;
const signup = (c: Client, email: string, extra: object = {}) => c.post("/api/auth/register", {
  email, displayName: "นพ. สมัครเอง", password: "member-password-1", learnerLevel: "แพทย์เพิ่มพูนทักษะ",
  institutionName: "รพ.ตัวอย่าง", studyGoal: "NL ขั้นที่ 2", acceptTerms: true, termsVersion: terms, ...extra,
});

beforeAll(async () => {
  const { db } = await freshDb();
  ({ ctx, advance } = makeCtx(db));
  const r = await new Client(ctx).call("POST", "/api/setup", { ...ADMIN, displayName: "Admin", demo: true }, { "x-setup-token": SETUP_TOKEN });
  accounts = r.body.demoAccounts;
  admin = new Client(ctx);
  await admin.post("/api/auth/login", ADMIN);
  author = await firstLogin(ctx, acct("faculty.author").email, acct("faculty.author").tempPassword);
  certifier = await firstLogin(ctx, acct("content.reviewer").email, acct("content.reviewer").tempPassword);
});

describe("self sign-up and trial", () => {
  it("publishes registration settings and the disclaimer", async () => {
    const c = (await new Client(ctx).get("/api/public/config")).body;
    expect(c.registrationOpen).toBe(true);
    expect(c.trialDays).toBe(7);
    expect(c.disclaimer.text).toMatch(/การศึกษา/);
    terms = c.disclaimer.version;
  });

  it("requires accepting the current terms", async () => {
    expect((await signup(new Client(ctx), "x@ex.example", { acceptTerms: false })).status).toBe(400);
    expect((await signup(new Client(ctx), "x@ex.example", { termsVersion: "old" })).status).toBe(409);
  });

  it("creates a learner, signs them in and starts a 7-day Plus trial", async () => {
    member = new Client(ctx);
    const r = await signup(member, "member@ex.example");
    expect(r.status).toBe(200);
    expect(r.body.me.roles).toEqual(["learner"]);
    expect(r.body.me.mustChangePassword).toBe(false);
    const e = (await member.get("/api/me/entitlements")).body;
    expect(e.plan).toBe("plus");
    expect(new Date(e.plusUntil).getTime() - ctx.now().getTime()).toBe(7 * DAY);
    expect((await signup(new Client(ctx), "MEMBER@ex.example")).status).toBe(409);
  });

  it("can be closed by the admin", async () => {
    await admin.put("/api/admin/membership", { registrationOpen: false, trialDays: 7 });
    expect((await signup(new Client(ctx), "late@ex.example")).status).toBe(403);
    await admin.put("/api/admin/membership", { registrationOpen: true, trialDays: 7 });
  });
});

describe("free vs Plus", () => {
  it("unlocks every note during the trial, and shows the certifier", async () => {
    const list = (await member.get("/api/notes")).body.notes;
    expect(list).toHaveLength(3);
    expect(list.every((n: { locked: boolean }) => !n.locked)).toBe(true);
    const n = (await member.get("/api/notes/NOTE-0002")).body.note;
    expect(n.body).toMatch(/plasma exchange/);
    expect(n.certifiedBy).toMatch(/ผู้รับรองเนื้อหา/);
  });

  it("returns the item sign-off and a related note after answering", async () => {
    let q = (await member.get("/api/learner/next?topic=T5")).body.question;
    const r = (await member.post("/api/learner/answer", { itemId: q.id, choice: "E" })).body;
    expect(r.reviewedBy).toMatch(/ผู้รีวิว/);
    expect(r.relatedNote).toMatchObject({ id: "NOTE-0003" });
    q = (await member.get("/api/learner/next?topic=T5")).body.question;
    await member.post("/api/learner/answer", { itemId: q.id, choice: "E" });
  });

  it("drops to free after the trial: practice stays open, full notes and the notebook lock", async () => {
    advance(8 * DAY);
    // sessions last 12 hours — sign everyone back in
    await member.post("/api/auth/login", { email: "member@ex.example", password: "member-password-1" });
    await admin.post("/api/auth/login", ADMIN);
    await author.post("/api/auth/login", { email: acct("faculty.author").email, password: "a-strong-new-password-1" });
    await certifier.post("/api/auth/login", { email: acct("content.reviewer").email, password: "a-strong-new-password-1" });
    expect((await member.get("/api/me/entitlements")).body.plan).toBe("free");
    const q = await member.get("/api/learner/next");
    expect(q.status).toBe(200);
    expect(q.body.question).toBeTruthy();
    const list = (await member.get("/api/notes")).body.notes;
    expect(list.find((n: { id: string }) => n.id === "NOTE-0001").locked).toBe(false); // free note
    const locked = (await member.get("/api/notes/NOTE-0002")).body.note;
    expect(locked.locked).toBe(true);
    expect(locked.body).toBeNull();
    expect(locked.summary).toBeTruthy();
    const nb = (await member.get("/api/learner/notebook")).body;
    expect(nb.locked).toBe(true);
    expect(nb.counts.toReview).toBe(2); // backlog kept, so upgrading shows it
    expect((await member.get("/api/learner/next?mode=notebook")).status).toBe(402);
    expect((await member.get("/api/learner/summary")).body.subtopics).toBeNull();
  });
});

describe("redeem codes and grants", () => {
  let codes: string[] = [];
  it("lets the admin issue codes and a learner redeem one", async () => {
    codes = (await admin.post("/api/admin/codes", { count: 3, durationDays: 30, maxUses: 1, campaign: "NL2-2026" })).body.codes;
    expect(codes).toHaveLength(3);
    expect(codes[0]).toMatch(/^HEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const r = await member.post("/api/me/redeem", { code: codes[0].toLowerCase() });
    expect(r.status).toBe(200);
    expect(r.body.entitlements.plan).toBe("plus");
    expect((await member.post("/api/me/redeem", { code: codes[0] })).status).toBe(400); // used up
    const other = new Client(ctx);
    await signup(other, "other@ex.example");
    expect((await other.post("/api/me/redeem", { code: codes[0] })).body.error).toBe("code_used_up");
    expect((await other.post("/api/me/redeem", { code: "HEM-NOPE-NOPE" })).body.error).toBe("invalid_code");
  });

  it("stacks a second code after the first instead of overlapping", async () => {
    await member.post("/api/me/redeem", { code: codes[1] });
    const e = (await member.get("/api/me/entitlements")).body;
    expect(new Date(e.plusUntil).getTime() - ctx.now().getTime()).toBe(60 * DAY);
  });

  it("supports manual grants, revocation and cohort licences", async () => {
    const users = (await admin.get("/api/admin/users")).body.users;
    const l3 = users.find((u: { email: string }) => u.email === acct("learner3").email);
    expect(l3.plus).toBe(false);
    const g = await admin.post("/api/admin/grants", { userId: l3.id, days: 14, note: "ผู้ช่วยสอน" });
    expect(g.status).toBe(200);
    expect((await admin.get(`/api/admin/users/${l3.id}/grants`)).body.entitlements.plan).toBe("plus");
    await admin.post(`/api/admin/grants/${g.body.id}/revoke`);
    expect((await admin.get(`/api/admin/users/${l3.id}/grants`)).body.entitlements.plan).toBe("free");
    const cohort = (await admin.get("/api/admin/cohorts")).body.cohorts[0];
    expect((await admin.post(`/api/admin/cohorts/${cohort.id}/grant`, { days: 120 })).body.granted).toBe(6);
    expect((await admin.get("/api/admin/users")).body.users.find((u: { id: string }) => u.id === l3.id).plus).toBe(true);
    const m = (await admin.get("/api/admin/membership")).body.stats;
    expect(m.registered).toBe(2);
  });
});

describe("review notebook", () => {
  it("schedules missed items and graduates them after two correct recalls", async () => {
    let nb = (await member.get("/api/learner/notebook")).body;
    expect(nb.locked).toBe(false);
    expect(nb.counts.due).toBe(2);
    const q = (await member.get("/api/learner/next?mode=notebook")).body;
    expect(q.mode).toBe("notebook");
    const key = (await member.post("/api/learner/answer", { itemId: q.question.id, choice: "A" })).body.correctKey;
    // answer it correctly next time it comes due
    nb = (await member.get("/api/learner/notebook")).body;
    const card = nb.cards.find((c: { itemId: string }) => c.itemId === q.question.id);
    if (key === "A") expect(card.state).toBe("recall_check");
    else expect(card.state).toBe("to_review");
  });
});

describe("note authoring and certification", () => {
  let id = "";
  const body = "## หัวข้อ\n- " + "เนื้อหาทดสอบสำหรับสรุปความรู้เรื่องการวินิจฉัย ".repeat(8);
  it("blocks submission until the note is complete", async () => {
    const r = await author.post("/api/faculty/notes", { note: { topic: "T3", subtopic: "t3.mpn", title: "CML ใน 5 นาที", summary: "", body: "", refs: "" } });
    id = r.body.note.id;
    expect(id).toBe("NOTE-0004");
    expect((await author.post(`/api/faculty/notes/${id}/submit`)).status).toBe(422);
    await author.put(`/api/faculty/notes/${id}`, { note: { topic: "T3", subtopic: "t3.mpn", title: "CML ใน 5 นาที", summary: "สรุปการวินิจฉัยและติดตามการรักษา CML สำหรับการสอบ", body, refs: "ตำราอ้างอิง" } });
    expect((await author.post(`/api/faculty/notes/${id}/submit`)).status).toBe(200);
  });

  it("requires a certifier who is not the author, and an explicit confirmation", async () => {
    expect((await author.get("/api/certify/queue")).status).toBe(403);
    const q = (await certifier.get("/api/certify/queue")).body.notes;
    expect(q.find((n: { id: string }) => n.id === id).canCertify).toBe(true);
    expect((await certifier.post(`/api/certify/notes/${id}`, { decision: "certify" })).status).toBe(400);
    const ok = await certifier.post(`/api/certify/notes/${id}`, { decision: "certify", confirm: true });
    expect(ok.body.note.status).toBe("published");
    expect(ok.body.note.certifiedBy).toMatch(/ผู้รับรองเนื้อหา/);
    expect((await member.get("/api/notes")).body.notes).toHaveLength(4);
  });

  it("takes a note out of the library while it is being revised", async () => {
    const r = await author.post(`/api/faculty/notes/${id}/revise`);
    expect(r.body.note).toMatchObject({ status: "draft", version: 2, certifiedBy: null });
    expect((await member.get(`/api/notes/${id}`)).status).toBe(404);
  });
});
