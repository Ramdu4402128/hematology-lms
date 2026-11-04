import { describe, it, expect, beforeAll } from "vitest";
import { handle } from "../server/app";
import { freshDb, makeCtx, Client, firstLogin, SETUP_TOKEN } from "./helpers";
import type { Ctx } from "../server/context";
import { RUBRIC } from "../shared/taxonomy";

const ADMIN = { email: "admin@school.example", password: "admin-password-123" };

let ctx: Ctx;
let advance: (ms: number) => void;
let accounts: { role: string; name: string; email: string; tempPassword: string }[];
let admin: Client, author: Client, reviewer: Client, advisor: Client, l1: Client, l2: Client;

const acct = (prefix: string) => accounts.find((a) => a.email.startsWith(prefix))!;

const completeItem = {
  topic: "T4", subtopic: "t4.primary-hemostasis", level: "Clinical",
  vignette: "หญิงอายุ 28 ปี มีจ้ำเลือดตามตัว 1 สัปดาห์ ไม่มีไข้ ตับม้ามไม่โต smear พบเกล็ดเลือดขนาดใหญ่ ไม่มี schistocytes",
  labs: [{ test: "Platelet", value: "12", unit: "×10⁹/L", range: "150–450", flag: "ต่ำ" }],
  leadIn: "การวินิจฉัยที่เป็นไปได้มากที่สุด",
  options: [
    { key: "A", text: "Immune thrombocytopenia", rationale: "isolated thrombocytopenia ไม่มีสาเหตุอื่น" },
    { key: "B", text: "TTP", rationale: "ไม่มี MAHA" },
    { key: "C", text: "DIC", rationale: "ไม่มี coagulopathy" },
    { key: "D", text: "Aplastic anemia", rationale: "ไม่มี cytopenia สายอื่น" },
    { key: "E", text: "Pseudothrombocytopenia", rationale: "smear ไม่พบ platelet clumping" },
  ],
  correctKey: "A",
  explanation: "Isolated thrombocytopenia ร่วมกับ smear ปกติยกเว้นเกล็ดเลือดขนาดใหญ่ เข้าได้กับ ITP",
  reference: "แนวทางเวชปฏิบัติ ITP (ระบุฉบับ)",
};

beforeAll(async () => {
  const { db } = await freshDb();
  ({ ctx, advance } = makeCtx(db));
});

describe("setup", () => {
  it("reports that setup is needed and rejects a wrong token", async () => {
    const c = new Client(ctx);
    expect((await c.get("/api/setup/status")).body).toEqual({ needsSetup: true, setupEnabled: true });
    const bad = await c.call("POST", "/api/setup", { ...ADMIN, displayName: "Admin", demo: true }, { "x-setup-token": "nope" });
    expect(bad.status).toBe(403);
  });

  it("creates the first admin and demo data exactly once", async () => {
    const c = new Client(ctx);
    const r = await c.call("POST", "/api/setup", { ...ADMIN, displayName: "ผู้ดูแลระบบ", demo: true }, { "x-setup-token": SETUP_TOKEN });
    expect(r.status).toBe(200);
    accounts = r.body.demoAccounts;
    expect(accounts).toHaveLength(10);
    expect(new Set(accounts.map((a) => a.tempPassword)).size).toBe(10);
    const again = await c.call("POST", "/api/setup", { ...ADMIN, displayName: "x", demo: false }, { "x-setup-token": SETUP_TOKEN });
    expect(again.status).toBe(409);
  });
});

describe("auth", () => {
  it("signs the admin in and out", async () => {
    admin = new Client(ctx);
    const r = await admin.post("/api/auth/login", ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.me.roles).toEqual(["school_admin"]);
    expect((await admin.get("/api/auth/me")).status).toBe(200);
  });

  it("requires a password change before anything else on a temporary password", async () => {
    const a = acct("learner1");
    const c = new Client(ctx);
    const r = await c.post("/api/auth/login", { email: a.email, password: a.tempPassword });
    expect(r.body.me.mustChangePassword).toBe(true);
    expect((await c.get("/api/learner/summary")).body.error).toBe("password_change_required");
    expect((await c.post("/api/auth/password", { current: a.tempPassword, next: "short" })).status).toBe(400);
    const ok = await c.post("/api/auth/password", { current: a.tempPassword, next: "learner-one-password" });
    expect(ok.status).toBe(200);
    expect((await c.get("/api/learner/summary")).status).toBe(200);
    l1 = c;
  });

  it("rejects mutating requests without the CSRF header", async () => {
    const res = await handle(new Request("https://lms.test/api/auth/login", { method: "POST", body: JSON.stringify(ADMIN), headers: { "content-type": "application/json" } }), ctx);
    expect(res.status).toBe(403);
  });

  it("locks an account after repeated wrong passwords, and the admin can unlock it", async () => {
    const a = acct("learner6");
    const c = new Client(ctx);
    for (let i = 0; i < 5; i++) expect((await c.post("/api/auth/login", { email: a.email, password: "wrong-password" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { email: a.email, password: a.tempPassword })).status).toBe(429);
    const users = (await admin.get("/api/admin/users")).body.users;
    const u = users.find((x: { email: string }) => x.email === a.email);
    expect(u.locked).toBe(true);
    const reset = await admin.post(`/api/admin/users/${u.id}/reset-password`);
    expect((await c.post("/api/auth/login", { email: a.email, password: reset.body.tempPassword })).status).toBe(200);
  });

  it("gives the same answer for unknown e-mails and wrong passwords", async () => {
    const c = new Client(ctx);
    const r1 = await c.post("/api/auth/login", { email: "nobody@x.example", password: "whatever-123" });
    const r2 = await c.post("/api/auth/login", { email: ADMIN.email, password: "whatever-123" });
    expect(r1).toEqual(r2);
  });
});

describe("learner loop", () => {
  let qid = "";
  it("serves a question without the key, rationales or explanation", async () => {
    const r = await l1.get("/api/learner/next");
    expect(r.status).toBe(200);
    const q = r.body.question;
    qid = q.id;
    expect(q.options).toHaveLength(5);
    expect(JSON.stringify(q)).not.toMatch(/correctKey|rationale|explanation|reference/);
    expect(r.body.mode).toBe("new");
    // refresh returns the same open question
    expect((await l1.get("/api/learner/next")).body.question.id).toBe(qid);
  });

  it("does not release an unanswered item's key", async () => {
    expect((await l1.get(`/api/learner/items/${qid}`)).status).toBe(404);
    expect((await l1.post("/api/learner/answer", { itemId: "HEM-0158", choice: "A" })).status).toBe(409);
  });

  it("grades the answer and returns the explanation", async () => {
    advance(40_000);
    const r = await l1.post("/api/learner/answer", { itemId: qid, choice: "A" });
    expect(r.status).toBe(200);
    expect(["A", "B", "C", "D", "E"]).toContain(r.body.correctKey);
    expect(r.body.options[0].rationale).toBeTruthy();
    expect(r.body.correct).toBe(r.body.correctKey === "A");
    // can't answer twice
    expect((await l1.post("/api/learner/answer", { itemId: qid, choice: "A" })).status).toBe(409);
    expect((await l1.get(`/api/learner/items/${qid}`)).status).toBe(200);
  });

  it("summarises mastery per topic and shows only learner-visible notes", async () => {
    const s = (await l1.get("/api/learner/summary")).body;
    expect(s.mastery).toHaveLength(6);
    expect(s.answeredItems).toBe(9);
    expect(s.poolSize).toBe(14);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].body).toMatch(/smear/);
    expect(JSON.stringify(s)).not.toMatch(/บันทึกภายในทีม/);
  });

  it("lets a learner report an item they answered", async () => {
    const r = await l1.post(`/api/learner/items/${qid}/report`, { reason: "ambiguous", detail: "ตัวเลือก B และ C ใกล้กันมาก" });
    expect(r.status).toBe(200);
    expect((await l1.post(`/api/learner/items/${qid}/report`, { reason: "typo" })).status).toBe(409);
    const unseen = qid === "HEM-0131" ? "HEM-0132" : "HEM-0131";
    expect((await l1.post(`/api/learner/items/${unseen}/report`, { reason: "typo" })).status).toBe(404);
  });

  it("keeps the leaderboard opt-in and cohort-scoped", async () => {
    expect((await l1.get("/api/learner/summary")).body.leaderboard).toEqual({ optedIn: false });
    await l1.patch("/api/me/preferences", { leaderboardOptIn: true, leaderboardAlias: "Pim" });
    const lb = (await l1.get("/api/learner/summary")).body.leaderboard;
    expect(lb.optedIn).toBe(true);
    expect(lb.cohortName).toMatch(/รอบ 3/);
    expect(lb.participants).toBe(1);
    expect(lb.entries).toHaveLength(1);
    expect(lb.entries[0]).toMatchObject({ name: "Pim", isMe: true, rank: 1 });
    expect(lb.entries[0].activeDays).toBeGreaterThan(1);
    expect(JSON.stringify(lb)).not.toMatch(/pct/); // ranks consistency, not scores
  });

  it("blocks learners from staff areas", async () => {
    expect((await l1.get("/api/faculty/items")).status).toBe(403);
    expect((await l1.get("/api/advisor/learners")).status).toBe(403);
    expect((await l1.get("/api/admin/users")).status).toBe(403);
  });
});

describe("faculty authoring and review", () => {
  let id = "";
  beforeAll(async () => {
    author = await firstLogin(ctx, acct("faculty.author").email, acct("faculty.author").tempPassword);
    reviewer = await firstLogin(ctx, acct("faculty.reviewer").email, acct("faculty.reviewer").tempPassword);
  });

  it("creates a draft and blocks submission until quality checks pass", async () => {
    const r = await author.post("/api/faculty/items", { item: { ...completeItem, explanation: "", options: completeItem.options.slice(0, 3) } });
    expect(r.status).toBe(200);
    id = r.body.item.id;
    expect(id).toMatch(/^HEM-\d{4}$/);
    expect(r.body.item.options).toHaveLength(5);
    const s = await author.post(`/api/faculty/items/${id}/submit`);
    expect(s.status).toBe(422);
    const bad = await author.put(`/api/faculty/items/${id}`, { item: { ...completeItem, subtopic: "t2.microcytic" } });
    expect(bad.status).toBe(400);
    advance(60_000);
    const upd = await author.put(`/api/faculty/items/${id}`, { item: completeItem, baseUpdatedAt: r.body.item.updatedAt });
    expect(upd.status).toBe(200);
    const stale = await author.put(`/api/faculty/items/${id}`, { item: completeItem, baseUpdatedAt: r.body.item.updatedAt });
    expect(stale.status).toBe(409);
    expect((await author.post(`/api/faculty/items/${id}/submit`)).status).toBe(200);
  });

  it("does not let authors review their own items and requires the full rubric to approve", async () => {
    const q = (await author.get("/api/faculty/review-queue")).body.items.find((x: { id: string }) => x.id === id);
    expect(q.canReview).toBe(false);
    expect((await author.post(`/api/faculty/items/${id}/review`, { decision: "approve", checks: RUBRIC.map(() => true) })).status).toBe(403);
    const partial = RUBRIC.map((_, i) => i !== 3);
    expect((await reviewer.post(`/api/faculty/items/${id}/review`, { decision: "approve", checks: partial })).status).toBe(400);
    expect((await reviewer.post(`/api/faculty/items/${id}/review`, { decision: "revise", checks: partial })).status).toBe(400);
    const rv = await reviewer.post(`/api/faculty/items/${id}/review`, { decision: "revise", checks: partial, comment: "ตัวเลือก A ยาวกว่าข้ออื่นชัดเจน" });
    expect(rv.body.item.status).toBe("draft");
    await author.put(`/api/faculty/items/${id}`, { item: { ...completeItem, options: completeItem.options.map((o) => (o.key === "A" ? { ...o, text: "ITP" } : o)) } });
    await author.post(`/api/faculty/items/${id}/submit`);
    const ok = await reviewer.post(`/api/faculty/items/${id}/review`, { decision: "approve", checks: RUBRIC.map(() => true), comment: "" });
    expect(ok.body.item.status).toBe("approved");
    const detail = (await reviewer.get(`/api/faculty/items/${id}`)).body;
    expect(detail.reviews).toHaveLength(2);
    expect(detail.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("puts approved items in the learner pool, and versions revisions", async () => {
    expect((await l1.get("/api/learner/summary")).body.poolSize).toBe(15);
    const rev = await author.post(`/api/faculty/items/${id}/revise`);
    expect(rev.body.item).toMatchObject({ status: "draft", version: 2 });
    expect((await l1.get("/api/learner/summary")).body.poolSize).toBe(14);
  });

  it("closes learner reports without revealing who reported", async () => {
    const open = (await author.get("/api/faculty/reports")).body.reports;
    expect(open).toHaveLength(1);
    expect(JSON.stringify(open)).not.toMatch(/reporter/);
    expect((await author.post(`/api/faculty/reports/${open[0].id}/close`, { resolution: "ตรวจแล้ว เฉลยถูกต้อง ปรับถ้อยคำตัวเลือก" })).status).toBe(200);
    expect((await author.get("/api/faculty/reports")).body.reports).toHaveLength(0);
  });

  it("retires and restores, and shows coverage", async () => {
    const r = await author.post("/api/faculty/items/HEM-0101/retire", { reason: "ซ้ำซ้อนกับข้อใหม่" });
    expect(r.body.item.status).toBe("retired");
    expect((await author.post("/api/faculty/items/HEM-0101/restore")).body.item.status).toBe("approved");
    const cov = (await author.get("/api/faculty/coverage")).body.topics;
    expect(cov).toHaveLength(6);
    const t1 = cov[0].subs.find((s: { code: string }) => s.code === "t1.hematopoiesis");
    expect(t1.approved).toBe(1);
  });
});

describe("advisor", () => {
  beforeAll(async () => {
    advisor = await firstLogin(ctx, acct("advisor").email, acct("advisor").tempPassword);
    l2 = await firstLogin(ctx, acct("learner2").email, acct("learner2").tempPassword);
  });

  it("lists assigned learners with flags", async () => {
    const r = (await advisor.get("/api/advisor/learners")).body;
    expect(r.learners).toHaveLength(6);
    const pim = r.learners.find((l: { name: string }) => l.name.includes("พิมพ์ชนก"));
    expect(pim.flags.join(" ")).toMatch(/Mastery ต่ำ/);
  });

  it("keeps staff notes away from learners", async () => {
    const list = (await advisor.get("/api/advisor/learners")).body.learners;
    const target = list.find((l: { name: string }) => l.name.includes("ชนิกานต์"));
    await advisor.post(`/api/advisor/learners/${target.id}/notes`, { visibility: "staff", body: "ติดตามเรื่องเวลาเรียน" });
    await advisor.post(`/api/advisor/learners/${target.id}/notes`, { visibility: "learner", body: "ทำได้ดีมาก ลองฝึก T6 เพิ่ม" });
    const detail = (await advisor.get(`/api/advisor/learners/${target.id}`)).body;
    expect(detail.notes).toHaveLength(2);
    expect(detail.recent).toBeUndefined(); // topic-level summaries only
    const seen = (await l2.get("/api/learner/summary")).body.notes;
    expect(seen.map((n: { body: string }) => n.body)).toEqual(["ทำได้ดีมาก ลองฝึก T6 เพิ่ม"]);
  });

  it("cannot see learners who are not assigned", async () => {
    const created = await admin.post("/api/admin/users", { email: "new.learner@school.example", displayName: "นศพ. ใหม่", roles: ["learner"] });
    expect(created.status).toBe(200);
    expect((await advisor.get(`/api/advisor/learners/${created.body.id}`)).status).toBe(404);
    expect((await advisor.post(`/api/advisor/learners/${created.body.id}/notes`, { visibility: "learner", body: "x" })).status).toBe(404);
    const adv = (await admin.get("/api/admin/users")).body.users.find((u: { email: string }) => u.email === acct("advisor").email);
    await admin.post("/api/admin/assignments", { advisorId: adv.id, learnerId: created.body.id });
    expect((await advisor.get(`/api/advisor/learners/${created.body.id}`)).status).toBe(200);
  });
});

describe("school admin", () => {
  it("shows an overview", async () => {
    const o = (await admin.get("/api/admin/overview")).body;
    expect(o.roles.learner).toBe(7);
    expect(o.items.approved).toBe(14);
    expect(o.cohorts).toHaveLength(1);
    expect(o.learnersWithoutAdvisor).toBe(0);
  });

  it("manages users, roles, cohorts and settings", async () => {
    const dup = await admin.post("/api/admin/users", { email: "NEW.LEARNER@school.example", displayName: "dup", roles: ["learner"] });
    expect(dup.status).toBe(409);
    const me = (await admin.get("/api/auth/me")).body.me;
    expect((await admin.patch(`/api/admin/users/${me.id}`, { roles: ["faculty"] })).status).toBe(400);
    const c = await admin.post("/api/admin/cohorts", { name: "รอบ 4", program: "MD ปี 5", startsOn: "2026-12-01", endsOn: "2026-12-28" });
    const users = (await admin.get("/api/admin/users")).body.users;
    const newbie = users.find((u: { email: string }) => u.email === "new.learner@school.example");
    expect((await admin.put(`/api/admin/cohorts/${c.body.id}/members`, { members: [{ userId: newbie.id, track: "MD ปี 5" }] })).body.members).toBe(1);
    expect((await admin.get(`/api/admin/cohorts/${c.body.id}/members`)).body.members[0].displayName).toBe("นศพ. ใหม่");
    expect((await admin.put("/api/admin/settings", { minAnswersPerTopic: 3, lowMastery: 60, inactiveDays: 5, schoolName: "คณะแพทยศาสตร์" })).status).toBe(200);
    expect((await admin.get("/api/admin/settings")).body).toEqual({ minAnswersPerTopic: 3, lowMastery: 60, inactiveDays: 5, schoolName: "คณะแพทยศาสตร์" });
    expect((await admin.get("/api/admin/audit")).body.entries.length).toBeGreaterThan(5);
  });

  it("signs a deactivated user out immediately", async () => {
    const users = (await admin.get("/api/admin/users")).body.users;
    const u = users.find((x: { email: string }) => x.email === acct("learner2").email);
    expect((await l2.get("/api/learner/summary")).status).toBe(200);
    await admin.patch(`/api/admin/users/${u.id}`, { active: false });
    expect((await l2.get("/api/learner/summary")).status).toBe(401);
  });
});

describe("adaptive selection", () => {
  it("works through new items, then wrong ones, then repeats", async () => {
    const seen = new Set<string>();
    let modes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = (await l1.get("/api/learner/next?skip=1")).body;
      modes.push(r.mode);
      if (!r.question) break;
      seen.add(r.question.id);
      await l1.post("/api/learner/answer", { itemId: r.question.id, choice: "A" });
    }
    expect(modes[0]).toBe("new");
    expect(modes).toContain("review");
    const s = (await l1.get("/api/learner/summary")).body;
    expect(s.answeredItems).toBe(14);
    expect(s.streak).toBeGreaterThanOrEqual(1);
    const wrongOnly = (await l1.get("/api/learner/history?filter=wrong")).body.rows;
    expect(wrongOnly.every((r: { correct: boolean }) => !r.correct)).toBe(true);
  });

  it("filters by topic", async () => {
    const r = (await l1.get("/api/learner/next?topic=T5&skip=1")).body;
    expect(r.question.topic).toBe("T5");
  });
});
