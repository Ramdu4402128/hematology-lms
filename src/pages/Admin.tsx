import { useEffect, useState } from "react";
import { get, post, put, patch } from "../api";
import { ROLES, ROLE_LABEL, TOPICS, type Role } from "../../shared/taxonomy";
import type { Me } from "../../shared/types";
import { Field, Loading, Stat, Tabs, errText, useLoad, useToast, ago, fmtDate } from "../ui";

type Tab = "overview" | "users" | "cohorts" | "assign" | "settings" | "audit";
interface UserRow { id: string; email: string; displayName: string; active: boolean; pendingPassword: boolean; lastLoginAt: string | null; locked: boolean; roles: Role[]; cohorts: string[] }

export function AdminApp({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <>
      <Tabs label="ส่วนของโรงเรียนแพทย์" value={tab} onChange={setTab} items={[
        { id: "overview", label: "ภาพรวม" }, { id: "users", label: "ผู้ใช้" }, { id: "cohorts", label: "รุ่น" },
        { id: "assign", label: "อาจารย์ผู้ดูแล" }, { id: "settings", label: "เกณฑ์และการตั้งค่า" }, { id: "audit", label: "บันทึกการใช้งาน" },
      ]} />
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users me={me} />}
      {tab === "cohorts" && <Cohorts />}
      {tab === "assign" && <Assignments />}
      {tab === "settings" && <SettingsForm />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function Overview() {
  const o = useLoad<any>(() => get("/api/admin/overview"), []);
  if (!o.data) return <Loading error={o.error} />;
  const x = o.data;
  return (
    <div className="stack">
      <div className="stats">
        <Stat label="ผู้เรียน" value={x.roles.learner ?? 0} sub={`ใช้งาน 7 วัน: ${x.activeLearners7d}`} />
        <Stat label="คำตอบ 7 วัน" value={x.attempts7d} sub={`30 วัน: ${x.attempts30d}`} />
        <Stat label="ข้อสอบพร้อมใช้" value={x.items.approved ?? 0} sub={`รอรีวิว ${x.items.review ?? 0} · Draft ${x.items.draft ?? 0}`} />
        <Stat label="รายงานที่เปิดอยู่" value={x.openReports} sub={x.avgReviewWaitDays != null ? `รอรีวิวเฉลี่ย ${x.avgReviewWaitDays} วัน` : undefined} />
        <Stat label="ผู้เรียนไม่มีอาจารย์ผู้ดูแล" value={x.learnersWithoutAdvisor} />
        <Stat label="อาจารย์" value={(x.roles.faculty ?? 0) + (x.roles.advisor ?? 0)} sub={`รายวิชา ${x.roles.faculty ?? 0} · ผู้ดูแล ${x.roles.advisor ?? 0}`} />
      </div>
      <section className="panel stack">
        <div><h2 style={{ fontSize: 16 }}>ค่ากลาง Mastery รายรุ่น</h2><p className="small muted" style={{ margin: "2px 0 0" }}>ข้อมูลรวมระดับรุ่นเท่านั้น ไม่แสดงรายบุคคล</p></div>
        {!x.cohorts.length ? <div className="empty">ยังไม่มีรุ่นที่ใช้งานอยู่</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>รุ่น</th><th>สมาชิก</th>{TOPICS.map((t) => <th key={t.code} title={t.name}>{t.code}</th>)}</tr></thead>
            <tbody>{x.cohorts.map((c: any) => (
              <tr key={c.id}><td>{c.name}<div className="small muted">{c.program}</div></td><td className="mono">{c.members}</td>
                {TOPICS.map((t) => <td key={t.code} className="mono small">{c.median[t.code] == null ? "—" : `${c.median[t.code]}%`}</td>)}</tr>))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function TempPassword({ value, who, onClose }: { value: string; who: string; onClose: () => void }) {
  return (
    <div className="note stack" role="alert">
      <strong>รหัสผ่านชั่วคราวของ {who}</strong>
      <span className="temp-pw">{value}</span>
      <span className="small">แสดงครั้งเดียวเท่านั้น ส่งให้ผู้ใช้ทางช่องทางที่ปลอดภัย ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าใช้ครั้งแรก</span>
      <div><button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(value)}>คัดลอก</button> <button type="button" className="btn ghost small" onClick={onClose}>ปิด</button></div>
    </div>
  );
}

function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <div className="roles-edit" role="group" aria-label="บทบาท">
      {ROLES.map((r) => (
        <label key={r} className="check"><input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />{ROLE_LABEL[r]}</label>
      ))}
    </div>
  );
}

function Users({ me }: { me: Me }) {
  const toast = useToast();
  const list = useLoad<{ users: UserRow[] }>(() => get("/api/admin/users"), []);
  const [form, setForm] = useState({ email: "", displayName: "", roles: ["learner"] as Role[] });
  const [shown, setShown] = useState<{ who: string; pw: string } | null>(null);
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [filter, setFilter] = useState<Role | "">("");
  const [q, setQ] = useState("");
  async function create() {
    try {
      const r = await post<{ tempPassword: string }>("/api/admin/users", form);
      setShown({ who: form.displayName, pw: r.tempPassword }); setForm({ email: "", displayName: "", roles: form.roles }); list.reload();
    } catch (e) { toast(errText(e)); }
  }
  async function saveEdit() {
    if (!edit) return;
    try { await patch(`/api/admin/users/${edit.id}`, { displayName: edit.displayName, email: edit.email, roles: edit.roles, active: edit.active }); toast("บันทึกแล้ว"); setEdit(null); list.reload(); }
    catch (e) { toast(errText(e)); }
  }
  async function reset(u: UserRow) {
    if (!confirm(`ออกรหัสผ่านชั่วคราวใหม่ให้ ${u.displayName}? รหัสเดิมจะใช้ไม่ได้และถูกออกจากระบบทุกอุปกรณ์`)) return;
    try { const r = await post<{ tempPassword: string }>(`/api/admin/users/${u.id}/reset-password`); setShown({ who: u.displayName, pw: r.tempPassword }); list.reload(); }
    catch (e) { toast(errText(e)); }
  }
  const users = (list.data?.users ?? []).filter((u) => (!filter || u.roles.includes(filter)) && (!q || `${u.displayName} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid">
      <section className="panel stack">
        <div className="toolbar">
          <select aria-label="กรองตามบทบาท" value={filter} onChange={(e) => setFilter(e.target.value as Role | "")}>
            <option value="">ทุกบทบาท</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input type="search" aria-label="ค้นหาผู้ใช้" placeholder="ค้นหาชื่อหรืออีเมล" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown && <TempPassword value={shown.pw} who={shown.who} onClose={() => setShown(null)} />}
        {!list.data ? <Loading error={list.error} /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>ชื่อ</th><th>บทบาท</th><th>รุ่น</th><th>เข้าใช้ล่าสุด</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id} className={edit?.id === u.id ? "sel" : ""}>
                <td>{u.displayName}<div className="small muted">{u.email}</div></td>
                <td className="small">{u.roles.map((r) => ROLE_LABEL[r]).join(", ")}</td>
                <td className="small">{u.cohorts.join(", ") || "—"}</td>
                <td className="small">{u.lastLoginAt ? ago(u.lastLoginAt) : "ยังไม่เคย"}</td>
                <td className="small">{!u.active ? <span className="pill st-retired">ปิดใช้งาน</span> : u.locked ? <span className="flag">ล็อกชั่วคราว</span> : u.pendingPassword ? <span className="pill st-review">รอตั้งรหัส</span> : <span className="pill st-approved">ใช้งาน</span>}</td>
                <td><div className="row" style={{ flexWrap: "nowrap" }}><button type="button" className="btn small" onClick={() => setEdit({ ...u })}>แก้ไข</button><button type="button" className="btn ghost small" onClick={() => reset(u)}>รีเซ็ตรหัส</button></div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <aside className="stack">
        {edit ? (
          <section className="panel stack">
            <h2 style={{ fontSize: 16 }}>แก้ไขผู้ใช้</h2>
            <Field label="ชื่อที่แสดง"><input type="text" value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></Field>
            <Field label="อีเมล"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <RolePicker value={edit.roles} onChange={(roles) => setEdit({ ...edit, roles })} />
            <label className="check"><input type="checkbox" checked={edit.active} disabled={edit.id === me.id} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> เปิดใช้งานบัญชี</label>
            <div className="row"><button type="button" className="btn primary" disabled={!edit.roles.length} onClick={saveEdit}>บันทึก</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>ยกเลิก</button></div>
          </section>
        ) : (
          <section className="panel stack">
            <h2 style={{ fontSize: 16 }}>เพิ่มผู้ใช้</h2>
            <Field label="ชื่อที่แสดง"><input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="เช่น นศพ. สมชาย ก." /></Field>
            <Field label="อีเมล"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
            <div><button type="button" className="btn primary" disabled={!form.email || !form.displayName || !form.roles.length} onClick={create}>สร้างและออกรหัสชั่วคราว</button></div>
          </section>
        )}
      </aside>
    </div>
  );
}

function Cohorts() {
  const toast = useToast();
  const list = useLoad<{ cohorts: { id: string; name: string; program: string; startsOn: string | null; endsOn: string | null; archived: boolean; members: number }[] }>(() => get("/api/admin/cohorts"), []);
  const users = useLoad<{ users: UserRow[] }>(() => get("/api/admin/users"), []);
  const [form, setForm] = useState({ name: "", program: "", startsOn: "", endsOn: "" });
  const [sel, setSel] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setMembers(null);
    if (sel) get<{ members: { userId: string; track: string }[] }>(`/api/admin/cohorts/${sel}/members`).then((r) => setMembers(Object.fromEntries(r.members.map((m) => [m.userId, m.track])))).catch((e) => toast(errText(e)));
  }, [sel, toast]);
  async function create() {
    try { const r = await post<{ id: string }>("/api/admin/cohorts", { ...form, startsOn: form.startsOn || null, endsOn: form.endsOn || null }); setForm({ name: "", program: "", startsOn: "", endsOn: "" }); list.reload(); setSel(r.id); }
    catch (e) { toast(errText(e)); }
  }
  async function saveMembers() {
    try { await put(`/api/admin/cohorts/${sel}/members`, { members: Object.entries(members!).map(([userId, track]) => ({ userId, track })) }); toast("บันทึกสมาชิกแล้ว"); list.reload(); }
    catch (e) { toast(errText(e)); }
  }
  async function toggleArchive(c: { id: string; name: string; program: string; startsOn: string | null; endsOn: string | null; archived: boolean }) {
    try { await patch(`/api/admin/cohorts/${c.id}`, { name: c.name, program: c.program, startsOn: c.startsOn, endsOn: c.endsOn, archived: !c.archived }); list.reload(); }
    catch (e) { toast(errText(e)); }
  }
  const learners = (users.data?.users ?? []).filter((u) => u.roles.includes("learner") && u.active);
  const cur = list.data?.cohorts.find((c) => c.id === sel);
  return (
    <div className="grid">
      <section className="panel stack">
        {!list.data ? <Loading error={list.error} /> : !list.data.cohorts.length ? <div className="empty">ยังไม่มีรุ่น</div> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>รุ่น</th><th>ช่วงเวลา</th><th>สมาชิก</th><th></th></tr></thead>
            <tbody>{list.data.cohorts.map((c) => (
              <tr key={c.id} className={sel === c.id ? "sel" : ""}>
                <td><button type="button" className="linkbtn" onClick={() => setSel(c.id)}>{c.name}</button>{c.archived && <span className="pill st-retired" style={{ marginLeft: 6 }}>เก็บถาวร</span>}<div className="small muted">{c.program}</div></td>
                <td className="small">{c.startsOn ? fmtDate(c.startsOn) : "—"} – {c.endsOn ? fmtDate(c.endsOn) : "—"}</td>
                <td className="mono">{c.members}</td>
                <td><button type="button" className="btn ghost small" onClick={() => toggleArchive(c)}>{c.archived ? "นำกลับ" : "เก็บถาวร"}</button></td>
              </tr>))}</tbody></table></div>
        )}
        {sel && cur && (
          <div className="stack">
            <h3 style={{ fontSize: 15 }}>สมาชิกของ {cur.name}</h3>
            {!members ? <Loading /> : (
              <>
                <ul className="list-plain">{learners.map((u) => (
                  <li key={u.id} className="row" style={{ flexWrap: "nowrap" }}>
                    <label className="check" style={{ flex: "1 1 auto" }}><input type="checkbox" checked={u.id in members}
                      onChange={(e) => { const m = { ...members }; if (e.target.checked) m[u.id] = ""; else delete m[u.id]; setMembers(m); }} />{u.displayName}</label>
                    {u.id in members && <input type="text" aria-label={`กลุ่มย่อยของ ${u.displayName}`} placeholder="เช่น MD ปี 5 / R2" style={{ maxWidth: 220 }} value={members[u.id]} onChange={(e) => setMembers({ ...members, [u.id]: e.target.value })} />}
                  </li>))}</ul>
                <div><button type="button" className="btn primary" onClick={saveMembers}>บันทึกสมาชิก ({Object.keys(members).length})</button></div>
              </>
            )}
          </div>
        )}
      </section>
      <aside className="panel stack">
        <h2 style={{ fontSize: 16 }}>สร้างรุ่นใหม่</h2>
        <Field label="ชื่อรุ่น"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น Hematology rotation รอบ 4" /></Field>
        <Field label="หลักสูตร / กลุ่มผู้เรียน"><input type="text" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} /></Field>
        <div className="two">
          <Field label="เริ่ม"><input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field>
          <Field label="สิ้นสุด"><input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></Field>
        </div>
        <div><button type="button" className="btn primary" disabled={!form.name.trim()} onClick={create}>สร้างรุ่น</button></div>
      </aside>
    </div>
  );
}

function Assignments() {
  const toast = useToast();
  const users = useLoad<{ users: UserRow[] }>(() => get("/api/admin/users"), []);
  const list = useLoad<{ assignments: { advisorId: string; learnerId: string; advisor: string; learner: string }[] }>(() => get("/api/admin/assignments"), []);
  const [advisor, setAdvisor] = useState("");
  if (!users.data || !list.data) return <Loading error={users.error ?? list.error} />;
  const advisors = users.data.users.filter((u) => u.roles.includes("advisor") && u.active);
  const learners = users.data.users.filter((u) => u.roles.includes("learner") && u.active);
  const assigned = new Set(list.data.assignments.filter((a) => a.advisorId === advisor).map((a) => a.learnerId));
  const countFor = (lid: string) => list.data!.assignments.filter((a) => a.learnerId === lid).length;
  async function toggle(learnerId: string, on: boolean) {
    try { await post(on ? "/api/admin/assignments" : "/api/admin/assignments/remove", { advisorId: advisor, learnerId }); list.reload(); }
    catch (e) { toast(errText(e)); }
  }
  return (
    <section className="panel stack">
      <Field label="อาจารย์ผู้ดูแล">
        <select value={advisor} onChange={(e) => setAdvisor(e.target.value)}>
          <option value="">— เลือกอาจารย์ —</option>
          {advisors.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({list.data!.assignments.filter((x) => x.advisorId === a.id).length} คน)</option>)}
        </select>
      </Field>
      {!advisors.length && <p className="small muted" style={{ margin: 0 }}>ยังไม่มีผู้ใช้ที่มีบทบาทอาจารย์ผู้ดูแล — เพิ่มบทบาทที่แท็บ “ผู้ใช้”</p>}
      {advisor && (
        <ul className="list-plain">{learners.map((l) => (
          <li key={l.id}><label className="check"><input type="checkbox" checked={assigned.has(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} />
            <span>{l.displayName} <span className="small muted">{l.cohorts.join(", ")}{countFor(l.id) === 0 ? " · ยังไม่มีอาจารย์ผู้ดูแล" : ""}</span></span></label></li>))}</ul>
      )}
    </section>
  );
}

function SettingsForm() {
  const toast = useToast();
  const s = useLoad<{ minAnswersPerTopic: number; lowMastery: number; inactiveDays: number; schoolName: string }>(() => get("/api/admin/settings"), []);
  const [f, setF] = useState<typeof s.data>(null);
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  if (!f) return <Loading error={s.error} />;
  const num = (k: "minAnswersPerTopic" | "lowMastery" | "inactiveDays") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  async function save() {
    try { await put("/api/admin/settings", f); toast("บันทึกแล้ว"); } catch (e) { toast(errText(e)); }
  }
  return (
    <section className="panel stack" style={{ maxWidth: 560 }}>
      <Field label="ชื่อสถาบัน"><input type="text" value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} /></Field>
      <Field label="จำนวนข้อขั้นต่ำต่อ Topic ก่อนแสดง mastery" hint="ป้องกันการตัดสินจากข้อมูลน้อยเกินไป"><input type="number" min={1} max={100} value={f.minAnswersPerTopic} onChange={num("minAnswersPerTopic")} /></Field>
      <Field label="เกณฑ์ mastery ต่ำ (%)" hint="ต่ำกว่านี้จะขึ้นธงให้อาจารย์ผู้ดูแล"><input type="number" min={1} max={100} value={f.lowMastery} onChange={num("lowMastery")} /></Field>
      <Field label="ไม่เข้าใช้งานเกิน (วัน)"><input type="number" min={1} max={365} value={f.inactiveDays} onChange={num("inactiveDays")} /></Field>
      <div><button type="button" className="btn primary" onClick={save}>บันทึก</button></div>
    </section>
  );
}

function Audit() {
  const a = useLoad<{ entries: { id: string; action: string; target: string; actor: string | null; at: string; detail: object }[] }>(() => get("/api/admin/audit"), []);
  if (!a.data) return <Loading error={a.error} />;
  return (
    <section className="panel stack">
      <p className="small muted" style={{ margin: 0 }}>200 รายการล่าสุด: การจัดการผู้ใช้ สิทธิ์ ข้อสอบ และการตั้งค่า</p>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>เวลา</th><th>ผู้กระทำ</th><th>การกระทำ</th><th>เป้าหมาย</th></tr></thead>
        <tbody>{a.data.entries.map((e) => (
          <tr key={e.id}><td className="small mono">{new Date(e.at).toLocaleString("th-TH")}</td><td className="small">{e.actor ?? "—"}</td><td className="mono small">{e.action}</td><td className="mono small">{e.target}</td></tr>))}</tbody></table></div>
    </section>
  );
}
