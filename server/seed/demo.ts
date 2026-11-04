import type { Db } from "../db";
import { one } from "../db";
import { hashPassword, tempPassword } from "../auth";
import { RUBRIC } from "../../shared/taxonomy";
import type { Lab, Option } from "../../shared/types";
import demoItems from "./demo-items.json";
import { DEMO_NOTES } from "./demo-notes";

interface DemoItem {
  id: string; topic: string; subtopic: string; level: string; vignette: string; labs: Lab[]; leadIn: string;
  options: Option[]; correctKey: string; explanation: string; reference: string; status: "approved" | "review" | "draft";
}

const DAY = 86_400_000;

const LEARNERS = [
  { key: "l1", name: "นศพ. พิมพ์ชนก อ.", track: "MD ปี 5", lastDaysAgo: 9 },
  { key: "l2", name: "นศพ. ชนิกานต์ ม.", track: "MD ปี 5", lastDaysAgo: 0 },
  { key: "l3", name: "นศพ. กฤษดา บ.", track: "MD ปี 5", lastDaysAgo: 1 },
  { key: "l4", name: "นศพ. ศุภกร ล.", track: "MD ปี 5", lastDaysAgo: 2 },
  { key: "l5", name: "พญ. ณิชาภา ร.", track: "แพทย์ประจำบ้านอายุรศาสตร์ R2", lastDaysAgo: 3 },
  { key: "l6", name: "นพ. กิตติพัฒน์ ส.", track: "แพทย์ประจำบ้านอายุรศาสตร์ R2", lastDaysAgo: 0 },
];

const ANSWERED: Record<string, string[]> = {
  l1: ["HEM-0101", "HEM-0102", "HEM-0142", "HEM-0103", "HEM-0133", "HEM-0136", "HEM-0127", "HEM-0145"],
  l2: ["HEM-0101", "HEM-0102", "HEM-0142", "HEM-0103", "HEM-0133", "HEM-0127", "HEM-0145", "HEM-0112", "HEM-0139", "HEM-0131", "HEM-0132"],
  l3: ["HEM-0101", "HEM-0102", "HEM-0142", "HEM-0103", "HEM-0133", "HEM-0136", "HEM-0127", "HEM-0145", "HEM-0138", "HEM-0112", "HEM-0139", "HEM-0131", "HEM-0132"],
  l4: ["HEM-0101", "HEM-0142", "HEM-0133"],
  l5: ["HEM-0101", "HEM-0102", "HEM-0142", "HEM-0103", "HEM-0127", "HEM-0145", "HEM-0138", "HEM-0112", "HEM-0139", "HEM-0131", "HEM-0132", "HEM-0155"],
  l6: ["HEM-0101", "HEM-0102", "HEM-0142", "HEM-0103", "HEM-0133", "HEM-0136", "HEM-0127", "HEM-0145", "HEM-0138", "HEM-0112", "HEM-0139", "HEM-0131", "HEM-0132", "HEM-0155"],
};
const WRONG: Record<string, string[]> = {
  l1: ["HEM-0127", "HEM-0145", "HEM-0142", "HEM-0103"], l2: ["HEM-0145"], l3: ["HEM-0139"], l4: [], l5: ["HEM-0112", "HEM-0139", "HEM-0138"], l6: ["HEM-0155"],
};

export interface DemoAccount { role: string; name: string; email: string; tempPassword: string }

/**
 * Loads sample content and accounts for a demo or pilot. Every demo account gets a random one-time
 * password that must be changed on first sign-in — nothing is hard-coded.
 */
export async function seedDemo(db: Db, now: Date, emailDomain = "demo.example.org"): Promise<DemoAccount[]> {
  const accounts: DemoAccount[] = [];
  const mkUser = async (local: string, name: string, roles: string[]) => {
    const pw = tempPassword();
    const email = `${local}@${emailDomain}`;
    const u = await one<{ id: string }>(db,
      `INSERT INTO users (email, display_name, password_hash, must_change_password) VALUES ($1,$2,$3,true) RETURNING id`,
      [email, name, await hashPassword(pw)]);
    for (const r of roles) await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [u!.id, r]);
    accounts.push({ role: roles.join("+"), name, email, tempPassword: pw });
    return u!.id;
  };

  const author = await mkUser("faculty.author", "อ.นพ. ธนกร ว. (ผู้ออกข้อสอบ)", ["faculty"]);
  const reviewer = await mkUser("faculty.reviewer", "อ.พญ. วรรณา ศ. (ผู้รีวิว)", ["faculty"]);
  const advisor = await mkUser("advisor", "อ.พญ. สุภาวดี ก. (อาจารย์ผู้ดูแล)", ["advisor"]);
  const certifier = await mkUser("content.reviewer", "ศ.นพ. ประเสริฐ ล. (ผู้รับรองเนื้อหา)", ["content_reviewer"]);
  const learnerIds: Record<string, string> = {};
  for (const [i, l] of LEARNERS.entries()) learnerIds[l.key] = await mkUser(`learner${i + 1}`, l.name, ["learner"]);

  const cohort = await one<{ id: string }>(db,
    `INSERT INTO cohorts (name, program, starts_on, ends_on) VALUES ($1,$2,$3,$4) RETURNING id`,
    ["Hematology rotation รอบ 3", "นักศึกษาแพทย์ปี 5 และแพทย์ประจำบ้านอายุรศาสตร์",
      new Date(now.getTime() - 21 * DAY).toISOString().slice(0, 10), new Date(now.getTime() + 7 * DAY).toISOString().slice(0, 10)]);
  for (const l of LEARNERS) {
    await db.query(`INSERT INTO cohort_members (cohort_id, user_id, track) VALUES ($1,$2,$3)`, [cohort!.id, learnerIds[l.key], l.track]);
    await db.query(`INSERT INTO advisor_assignments (advisor_id, learner_id) VALUES ($1,$2)`, [advisor, learnerIds[l.key]]);
  }

  const key: Record<string, string> = {};
  for (const it of demoItems as DemoItem[]) {
    key[it.id] = it.correctKey;
    const created = new Date(now.getTime() - (it.status === "approved" ? 30 : it.status === "review" ? 2 : 1) * DAY).toISOString();
    await db.query(
      `INSERT INTO items (id, topic, subtopic, level, vignette, labs, lead_in, options, correct_key, explanation, reference, status, version,
                          author_id, last_edited_by, created_at, updated_at, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,1,$13,$13,$14,$14,$15)`,
      [it.id, it.topic, it.subtopic, it.level, it.vignette, JSON.stringify(it.labs), it.leadIn, JSON.stringify(it.options), it.correctKey,
        it.explanation, it.reference, it.status, author, created, it.status === "approved" ? created : null]);
    if (it.status === "approved") {
      await db.query(`INSERT INTO item_reviews (item_id, version, reviewer_id, decision, checks, comment, created_at) VALUES ($1,1,$2,'approve',$3::jsonb,'',$4)`,
        [it.id, reviewer, JSON.stringify(RUBRIC.map(() => true)), created]);
    }
  }

  for (const l of LEARNERS) {
    const ids = ANSWERED[l.key];
    for (const [k, itemId] of ids.entries()) {
      const right = key[itemId];
      const choice = WRONG[l.key].includes(itemId) ? (right === "A" ? "B" : "A") : right;
      // Most recent answer lands `lastDaysAgo` days back; earlier ones are spaced half a day apart.
      const at = new Date(now.getTime() - l.lastDaysAgo * DAY - ((ids.length - 1 - k) * DAY) / 2 - 3_600_000).toISOString();
      await db.query(
        `INSERT INTO attempts (user_id, item_id, item_version, choice, is_correct, time_ms, created_at) VALUES ($1,$2,1,$3,$4,$5,$6)`,
        [learnerIds[l.key], itemId, choice, choice === right, 45_000 + ((k * 7919) % 60_000), at]);
    }
  }

  await db.query(`INSERT INTO feedback_notes (learner_id, author_id, visibility, body, created_at) VALUES ($1,$2,'learner',$3,$4)`,
    [learnerIds.l1, advisor, "อ่าน smear ได้เป็นระบบดี ควรทบทวนเกณฑ์วินิจฉัย acute leukemia ก่อน case conference วันศุกร์", new Date(now.getTime() - 5 * DAY).toISOString()]);
  await db.query(`INSERT INTO feedback_notes (learner_id, author_id, visibility, body, created_at) VALUES ($1,$2,'staff',$3,$4)`,
    [learnerIds.l1, advisor, "บันทึกภายในทีม: นัดพบรายบุคคลสัปดาห์หน้า", new Date(now.getTime() - 4 * DAY).toISOString()]);
  for (const [i, n] of DEMO_NOTES.entries()) {
    const at = new Date(now.getTime() - (10 - i) * DAY).toISOString();
    await db.query(
      `INSERT INTO review_notes (id, topic, subtopic, title, summary, body, refs, free_access, status, author_id, last_edited_by, certified_by, certified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,$9,$10,$11,$11,$11)`,
      [`NOTE-${String(i + 1).padStart(4, "0")}`, n.topic, n.subtopic, n.title, n.summary, n.body, n.refs, n.freeAccess, author, certifier, at]);
    await db.query(`INSERT INTO note_reviews (note_id, version, reviewer_id, decision, comment, created_at) VALUES ($1,1,$2,'certify','',$3)`,
      [`NOTE-${String(i + 1).padStart(4, "0")}`, certifier, at]);
  }
  await db.query(`SELECT setval('note_number_seq', $1)`, [DEMO_NOTES.length]);
  return accounts;
}
