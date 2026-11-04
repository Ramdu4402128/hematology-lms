import { useEffect, useState, type FormEvent } from "react";
import { api, get, post, onAuthProblem } from "./api";
import { ROLE_LABEL, type Role } from "../shared/taxonomy";
import type { Me } from "../shared/types";
import { errText, Field, Loading, usePublicConfig, loadConfig } from "./ui";
import { CertifierApp } from "./pages/Certifier";
import { LearnerApp } from "./pages/Learner";
import { FacultyApp } from "./pages/Faculty";
import { AdvisorApp } from "./pages/Advisor";
import { AdminApp } from "./pages/Admin";

type MeX = Me & { leaderboardAlias: string | null };
const ROLE_ORDER: Role[] = ["learner", "faculty", "content_reviewer", "advisor", "school_admin"];

function Brand() {
  return (
    <div className="brand">
      <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 3c4 5.5 7.5 9.6 7.5 13.7A7.5 7.5 0 0 1 6.5 16.7C6.5 12.6 10 8.5 14 3z" fill="var(--accent)" /></svg>
      Hematology LMS
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<MeX | null | undefined>(undefined);
  const [setup, setSetup] = useState<{ needsSetup: boolean; setupEnabled: boolean } | null>(null);

  useEffect(() => {
    get<{ me: MeX }>("/api/auth/me").then((r) => setMe(r.me)).catch(() => {
      setMe(null);
      get("/api/setup/status").then(setSetup).catch(() => {});
    });
    return onAuthProblem((code) => {
      if (code === "unauthenticated") setMe(null);
      else get<{ me: MeX }>("/api/auth/me").then((r) => setMe(r.me)).catch(() => setMe(null));
    });
  }, []);

  if (me === undefined) return <main className="wrap"><Loading /></main>;
  if (!me) {
    if (setup?.needsSetup) return <SetupScreen onDone={() => setSetup({ needsSetup: false, setupEnabled: true })} enabled={setup.setupEnabled} />;
    return <PublicScreens onLogin={setMe} />;
  }
  if (me.mustChangePassword) return <PasswordScreen me={me} onDone={setMe} forced />;
  return <Shell me={me} setMe={setMe} />;
}

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}>
      <section className="panel stack auth-card">
        <Brand />
        <h1 style={{ fontSize: 20 }}>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function PublicScreens({ onLogin }: { onLogin: (m: MeX) => void }) {
  const [mode, setMode] = useState<"login" | "register">(() => (location.hash === "#register" ? "register" : "login"));
  const go = (m: "login" | "register") => { setMode(m); history.replaceState(null, "", m === "register" ? "#register" : location.pathname); };
  return mode === "register" ? <RegisterScreen onLogin={onLogin} onLoginInstead={() => go("login")} /> : <LoginScreen onLogin={onLogin} onRegister={() => go("register")} />;
}

function RegisterScreen({ onLogin, onLoginInstead }: { onLogin: (m: MeX) => void; onLoginInstead: () => void }) {
  const cfg = usePublicConfig();
  const [f, setF] = useState({ displayName: "", email: "", password: "", confirm: "", learnerLevel: "", institutionName: "", studyGoal: "", acceptTerms: false, marketingOptIn: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  if (!cfg) return <main className="wrap"><Loading /></main>;
  if (!cfg.registrationOpen) return <Centered title="ยังไม่เปิดรับสมัคร"><p style={{ margin: 0 }}>ขณะนี้ระบบเปิดใช้งานเฉพาะบัญชีที่สถาบันสร้างให้</p><button className="btn" onClick={onLoginInstead}>ไปหน้าเข้าสู่ระบบ</button></Centered>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) { setErr("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<{ me: MeX }>("/api/auth/register", {
        email: f.email, displayName: f.displayName, password: f.password, learnerLevel: f.learnerLevel, institutionName: f.institutionName,
        studyGoal: f.studyGoal, acceptTerms: f.acceptTerms, termsVersion: cfg!.disclaimer.version, marketingOptIn: f.marketingOptIn,
      });
      onLogin(r.me);
    } catch (x) {
      setErr(errText(x));
      if ((x as { code?: string }).code === "terms_changed") loadConfig(true);
    } finally { setBusy(false); }
  }
  return (
    <Centered title="สมัครสมาชิก">
      <p className="small" style={{ margin: 0 }}>ฝึกข้อสอบโลหิตวิทยาได้ฟรีไม่จำกัด{cfg.trialDays > 0 ? ` และทดลองใช้ Plus (สรุปเนื้อหา + สมุดทบทวน) ${cfg.trialDays} วัน` : ""}</p>
      <form className="stack" onSubmit={submit}>
        <Field label="ชื่อที่แสดง"><input type="text" required minLength={2} value={f.displayName} onChange={set("displayName")} placeholder="เช่น นพ. สมชาย ก." /></Field>
        <Field label="อีเมล"><input type="email" required autoComplete="username" value={f.email} onChange={set("email")} /></Field>
        <div className="two">
          <Field label="รหัสผ่าน" hint="อย่างน้อย 10 ตัวอักษร"><input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
          <Field label="ยืนยันรหัสผ่าน"><input type="password" required minLength={10} autoComplete="new-password" value={f.confirm} onChange={set("confirm")} /></Field>
        </div>
        <div className="two">
          <Field label="สถานะ"><select required value={f.learnerLevel} onChange={set("learnerLevel")}><option value="">— เลือก —</option>{cfg.learnerLevels.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="เป้าหมาย"><select required value={f.studyGoal} onChange={set("studyGoal")}><option value="">— เลือก —</option>{cfg.studyGoals.map((l) => <option key={l}>{l}</option>)}</select></Field>
        </div>
        <Field label="สถาบัน / โรงพยาบาล (ไม่บังคับ)"><input type="text" value={f.institutionName} onChange={set("institutionName")} /></Field>
        <div className="note small" style={{ maxHeight: 160, overflow: "auto" }}><strong>ข้อจำกัดความรับผิดชอบและเงื่อนไขการใช้งาน</strong><p style={{ margin: "4px 0 0" }}>{cfg.disclaimer.text}</p></div>
        <label className="check"><input type="checkbox" required checked={f.acceptTerms} onChange={set("acceptTerms")} /> ข้าพเจ้าได้อ่านและยอมรับข้อจำกัดความรับผิดชอบและเงื่อนไขการใช้งาน</label>
        <label className="check"><input type="checkbox" checked={f.marketingOptIn} onChange={set("marketingOptIn")} /> รับข่าวสารเนื้อหาใหม่และกิจกรรมทางอีเมล (ไม่บังคับ)</label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "กำลังสมัคร…" : "สมัครสมาชิก"}</button>
        <p className="small" style={{ margin: 0 }}>มีบัญชีแล้ว? <button type="button" className="btn ghost small" onClick={onLoginInstead}>เข้าสู่ระบบ</button></p>
      </form>
    </Centered>
  );
}

function LoginScreen({ onLogin, onRegister }: { onLogin: (m: MeX) => void; onRegister: () => void }) {
  const cfg = usePublicConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onLogin((await post<{ me: MeX }>("/api/auth/login", { email, password })).me); }
    catch (x) { setErr(errText(x)); }
    finally { setBusy(false); }
  }
  return (
    <Centered title="เข้าสู่ระบบ">
      <form className="stack" onSubmit={submit}>
        <Field label="อีเมล"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="รหัสผ่าน"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}</button>
        {cfg?.registrationOpen && <p className="small" style={{ margin: 0 }}>ยังไม่มีบัญชี? <button type="button" className="btn ghost small" onClick={onRegister}>สมัครสมาชิก — ฝึกข้อสอบฟรี</button></p>}
        <p className="small muted" style={{ margin: 0 }}>ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบเพื่อออกรหัสชั่วคราวใหม่</p>
      </form>
    </Centered>
  );
}

function PasswordScreen({ me, onDone, forced, onCancel }: { me: MeX; onDone: (m: MeX) => void; forced?: boolean; onCancel?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setErr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    setBusy(true); setErr(null);
    try { onDone((await post<{ me: MeX }>("/api/auth/password", { current, next })).me); }
    catch (x) { setErr(errText(x)); }
    finally { setBusy(false); }
  }
  const body = (
    <form className="stack" onSubmit={submit}>
      {forced && <p className="small" style={{ margin: 0 }}>สวัสดี {me.displayName} — บัญชีนี้ใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านของคุณเองก่อนเริ่มใช้งาน</p>}
      <input type="email" autoComplete="username" value={me.email} readOnly hidden />
      <Field label={forced ? "รหัสผ่านชั่วคราว" : "รหัสผ่านปัจจุบัน"}><input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัวอักษร"><input type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="ยืนยันรหัสผ่านใหม่"><input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>บันทึกรหัสผ่าน</button>
        {forced ? <button type="button" className="btn ghost" onClick={() => api("POST", "/api/auth/logout").finally(() => location.reload())}>ออกจากระบบ</button>
          : <button type="button" className="btn ghost" onClick={onCancel}>ยกเลิก</button>}
      </div>
    </form>
  );
  return forced ? <Centered title="ตั้งรหัสผ่านใหม่">{body}</Centered> : <section className="panel stack" style={{ maxWidth: 480 }}><h2 style={{ fontSize: 18 }}>เปลี่ยนรหัสผ่าน</h2>{body}</section>;
}

function SetupScreen({ onDone, enabled }: { onDone: () => void; enabled: boolean }) {
  const [f, setF] = useState({ token: "", schoolName: "", displayName: "", email: "", password: "", demo: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ role: string; name: string; email: string; tempPassword: string }[] | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ demoAccounts: typeof demo }>("POST", "/api/setup",
        { email: f.email, displayName: f.displayName, password: f.password, schoolName: f.schoolName || undefined, demo: f.demo }, { "x-setup-token": f.token });
      if (r.demoAccounts?.length) setDemo(r.demoAccounts); else onDone();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  if (!enabled) return <Centered title="ระบบยังไม่ได้ตั้งค่า"><p>ผู้ดูแลระบบต้องตั้งค่า <code>SETUP_TOKEN</code> ใน Netlify environment variables แล้ว deploy ใหม่ จากนั้นเปิดหน้านี้อีกครั้งเพื่อสร้างบัญชีผู้ดูแลคนแรก</p></Centered>;
  if (demo) return (
    <Centered title="สร้างบัญชีตัวอย่างแล้ว">
      <p className="small" style={{ margin: 0 }}>รหัสผ่านชั่วคราวด้านล่างแสดงครั้งเดียวเท่านั้น คัดลอกเก็บไว้ ทุกบัญชีต้องตั้งรหัสใหม่เมื่อเข้าใช้ครั้งแรก</p>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>บทบาท</th><th>ชื่อ</th><th>อีเมล</th><th>รหัสชั่วคราว</th></tr></thead>
        <tbody>{demo.map((a) => <tr key={a.email}><td>{a.role}</td><td>{a.name}</td><td className="mono small">{a.email}</td><td className="mono">{a.tempPassword}</td></tr>)}</tbody></table></div>
      <button className="btn primary" onClick={onDone}>ไปหน้าเข้าสู่ระบบ</button>
    </Centered>
  );
  return (
    <Centered title="ตั้งค่าระบบครั้งแรก">
      <form className="stack" onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>สร้างบัญชีผู้ดูแลระบบ (โรงเรียนแพทย์) คนแรก หน้านี้ใช้ได้ครั้งเดียวและต้องใช้ setup token ที่ตั้งไว้ใน Netlify</p>
        <Field label="Setup token"><input type="password" required value={f.token} onChange={set("token")} autoComplete="off" /></Field>
        <Field label="ชื่อสถาบัน"><input type="text" value={f.schoolName} onChange={set("schoolName")} placeholder="เช่น คณะแพทยศาสตร์…" /></Field>
        <Field label="ชื่อผู้ดูแลระบบ"><input type="text" required value={f.displayName} onChange={set("displayName")} /></Field>
        <Field label="อีเมล"><input type="email" required autoComplete="username" value={f.email} onChange={set("email")} /></Field>
        <Field label="รหัสผ่าน" hint="อย่างน้อย 10 ตัวอักษร"><input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
        <label className="check"><input type="checkbox" checked={f.demo} onChange={set("demo")} /> ใส่ข้อมูลตัวอย่าง (โจทย์ 16 ข้อ อาจารย์ 3 คน ผู้เรียน 6 คน) สำหรับทดลองระบบ</label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "กำลังสร้าง…" : "สร้างระบบ"}</button>
      </form>
    </Centered>
  );
}

function Shell({ me, setMe }: { me: MeX; setMe: (m: MeX | null) => void }) {
  const roles = ROLE_ORDER.filter((r) => me.roles.includes(r));
  const [role, setRole] = useState<Role>(() => {
    try { const saved = localStorage.getItem("hlms.role") as Role | null; if (saved && roles.includes(saved)) return saved; } catch { /* storage blocked */ }
    return roles[0];
  });
  const [pw, setPw] = useState(false);
  const choose = (r: Role) => { setRole(r); setPw(false); try { localStorage.setItem("hlms.role", r); } catch { /* ignore */ } };
  return (
    <>
      <header className="bar">
        <div className="wrap">
          <Brand />
          {roles.length > 1 && (
            <div className="roles" role="group" aria-label="บทบาท">
              {roles.map((r) => <button key={r} type="button" aria-pressed={role === r && !pw} onClick={() => choose(r)}>{ROLE_LABEL[r]}</button>)}
            </div>
          )}
          <div className="spacer" />
          <div className="persona">
            <span>{me.displayName}</span>
            <button type="button" className="btn ghost small" onClick={() => setPw(true)}>เปลี่ยนรหัสผ่าน</button>
            <button type="button" className="btn ghost small" onClick={() => post("/api/auth/logout").finally(() => setMe(null))}>ออกจากระบบ</button>
          </div>
        </div>
      </header>
      <main className="wrap">
        {pw ? <PasswordScreen me={me} onDone={(m) => { setMe(m); setPw(false); }} onCancel={() => setPw(false)} />
          : role === "learner" ? <LearnerApp me={me} setMe={setMe} />
          : role === "faculty" ? <FacultyApp me={me} />
          : role === "content_reviewer" ? <CertifierApp />
          : role === "advisor" ? <AdvisorApp />
          : role === "school_admin" ? <AdminApp me={me} />
          : <div className="empty">บัญชีนี้ยังไม่มีบทบาท กรุณาติดต่อผู้ดูแลระบบ</div>}
      </main>
    </>
  );
}
