import { useEffect, useState } from "react";
import { get, post, put } from "../api";
import { Field, Loading, Stat, errText, fmtDate, useLoad, useToast, loadConfig } from "../ui";

interface MembershipData {
  registrationOpen: boolean; trialDays: number; disclaimer: { version: string; text: string };
  stats: { registered: number; registered30d: number; plusActive: number; trialOnly: number };
}
interface CodeRow { code: string; durationDays: number; maxUses: number; usedCount: number; expiresAt: string | null; campaign: string; disabled: boolean; createdAt: string }

export function MembershipAdmin() {
  const toast = useToast();
  const m = useLoad<MembershipData>(() => get("/api/admin/membership"), []);
  const codes = useLoad<{ codes: CodeRow[] }>(() => get("/api/admin/codes"), []);
  const [f, setF] = useState<{ registrationOpen: boolean; trialDays: number; disclaimerText: string } | null>(null);
  const [batch, setBatch] = useState({ count: 10, durationDays: 30, maxUses: 1, expiresAt: "", campaign: "", prefix: "HEM" });
  const [created, setCreated] = useState<string[] | null>(null);
  useEffect(() => { if (m.data) setF({ registrationOpen: m.data.registrationOpen, trialDays: m.data.trialDays, disclaimerText: m.data.disclaimer.text }); }, [m.data]);
  if (!m.data || !f) return <Loading error={m.error} />;
  const s = m.data.stats;

  async function saveSettings() {
    try { await put("/api/admin/membership", f); toast("บันทึกแล้ว"); loadConfig(true); m.reload(); } catch (e) { toast(errText(e)); }
  }
  async function makeCodes() {
    try {
      const r = await post<{ codes: string[] }>("/api/admin/codes", { ...batch, expiresAt: batch.expiresAt || null });
      setCreated(r.codes); codes.reload();
    } catch (e) { toast(errText(e)); }
  }
  function downloadCsv(list: string[]) {
    const blob = new Blob([["code", ...list].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `codes-${batch.campaign || "batch"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="สมัครเอง (ทั้งหมด)" value={s.registered} sub={`30 วันล่าสุด ${s.registered30d}`} />
        <Stat label="มีสิทธิ์ Plus อยู่" value={s.plusActive} sub={`ในจำนวนนี้ทดลองใช้อย่างเดียว ${s.trialOnly}`} />
      </div>
      <div className="grid">
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>สร้างโค้ดแลกสิทธิ์ Plus</h2>
          <div className="two">
            <Field label="จำนวนโค้ด"><input type="number" min={1} max={500} value={batch.count} onChange={(e) => setBatch({ ...batch, count: Number(e.target.value) })} /></Field>
            <Field label="สิทธิ์ (วัน)"><input type="number" min={1} max={3650} value={batch.durationDays} onChange={(e) => setBatch({ ...batch, durationDays: Number(e.target.value) })} /></Field>
            <Field label="ใช้ได้กี่ครั้งต่อโค้ด" hint="1 = โค้ดรายคน, มากกว่า 1 = โค้ดแคมเปญ"><input type="number" min={1} value={batch.maxUses} onChange={(e) => setBatch({ ...batch, maxUses: Number(e.target.value) })} /></Field>
            <Field label="หมดอายุ (ไม่บังคับ)"><input type="date" value={batch.expiresAt} onChange={(e) => setBatch({ ...batch, expiresAt: e.target.value })} /></Field>
            <Field label="ชื่อแคมเปญ"><input type="text" value={batch.campaign} onChange={(e) => setBatch({ ...batch, campaign: e.target.value })} placeholder="เช่น NL2-2026" /></Field>
            <Field label="คำนำหน้าโค้ด"><input type="text" maxLength={8} value={batch.prefix} onChange={(e) => setBatch({ ...batch, prefix: e.target.value })} /></Field>
          </div>
          <div><button type="button" className="btn primary" onClick={makeCodes}>สร้างโค้ด</button></div>
          {created && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row-between"><strong className="small">สร้างแล้ว {created.length} โค้ด</strong>
                <div className="row"><button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(created.join("\n"))}>คัดลอก</button><button type="button" className="btn small" onClick={() => downloadCsv(created)}>ดาวน์โหลด CSV</button></div></div>
              <div className="codes">{created.join("\n")}</div>
            </div>
          )}
          <h3 style={{ fontSize: 15 }}>โค้ดล่าสุด</h3>
          {!codes.data ? <Loading error={codes.error} /> : !codes.data.codes.length ? <p className="small muted" style={{ margin: 0 }}>ยังไม่มีโค้ด</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>โค้ด</th><th>แคมเปญ</th><th>วัน</th><th>ใช้แล้ว</th><th>หมดอายุ</th><th></th></tr></thead>
              <tbody>{codes.data.codes.slice(0, 100).map((c) => (
                <tr key={c.code}><td className="mono small">{c.code}</td><td className="small">{c.campaign || "—"}</td><td className="mono small">{c.durationDays}</td>
                  <td className="mono small">{c.usedCount}/{c.maxUses}</td><td className="small">{c.expiresAt ? fmtDate(c.expiresAt) : "—"}</td>
                  <td>{c.disabled ? <span className="pill st-retired">ปิดแล้ว</span> : <button type="button" className="btn ghost small" onClick={async () => { try { await post(`/api/admin/codes/${c.code}/disable`); codes.reload(); } catch (e) { toast(errText(e)); } }}>ปิดใช้</button>}</td></tr>))}</tbody></table></div>
          )}
        </section>
        <aside className="panel stack">
          <h2 style={{ fontSize: 16 }}>การสมัครสมาชิก</h2>
          <label className="check"><input type="checkbox" checked={f.registrationOpen} onChange={(e) => setF({ ...f, registrationOpen: e.target.checked })} /> เปิดให้บุคคลทั่วไปสมัครเอง</label>
          <Field label="ทดลองใช้ Plus หลังสมัคร (วัน)" hint="0 = ไม่มีช่วงทดลอง"><input type="number" min={0} max={60} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) })} /></Field>
          <Field label="ข้อจำกัดความรับผิดชอบ" hint={`ฉบับปัจจุบัน ${m.data.disclaimer.version} · แก้ข้อความแล้วผู้สมัครใหม่จะยอมรับฉบับใหม่`}>
            <textarea rows={8} value={f.disclaimerText} onChange={(e) => setF({ ...f, disclaimerText: e.target.value })} />
          </Field>
          <div><button type="button" className="btn primary" onClick={saveSettings}>บันทึก</button></div>
          <p className="small muted" style={{ margin: 0 }}>การรับชำระเงินออนไลน์จะเปิดในรอบถัดไป เมื่อเลือกผู้ให้บริการ (Opn Payments หรือ Stripe) และได้ API key</p>
        </aside>
      </div>
    </div>
  );
}

export function UserGrants({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const toast = useToast();
  const g = useLoad<{ entitlements: { plan: string; plusUntil: string | null }; grants: { id: string; source: string; startsAt: string; endsAt: string | null; revokedAt: string | null; ref: string }[] }>(
    () => get(`/api/admin/users/${userId}/grants`), [userId]);
  const [days, setDays] = useState("30");
  if (!g.data) return <Loading error={g.error} />;
  const label: Record<string, string> = { trial: "ทดลอง", redeem: "โค้ด", purchase: "ซื้อ", institution: "สถาบัน", admin: "ผู้ดูแล" };
  async function grant() {
    try { await post("/api/admin/grants", { userId, days: days === "" ? null : Number(days), note: "" }); toast("ให้สิทธิ์แล้ว"); g.reload(); onChanged(); } catch (e) { toast(errText(e)); }
  }
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <h3 style={{ fontSize: 15 }}>สิทธิ์สมาชิก: {g.data.entitlements.plan === "plus" ? `Plus${g.data.entitlements.plusUntil ? ` ถึง ${fmtDate(g.data.entitlements.plusUntil)}` : " (ไม่มีวันหมดอายุ)"}` : "ฟรี"}</h3>
      {g.data.grants.length > 0 && (
        <ul className="list-plain small">{g.data.grants.map((x) => (
          <li key={x.id} className="row-between">
            <span style={x.revokedAt ? { textDecoration: "line-through", color: "var(--fg-3)" } : undefined}>{label[x.source] ?? x.source} · {fmtDate(x.startsAt)} – {x.endsAt ? fmtDate(x.endsAt) : "ไม่กำหนด"}{x.ref ? ` · ${x.ref.length > 20 ? x.ref.slice(0, 8) + "…" : x.ref}` : ""}</span>
            {!x.revokedAt && <button type="button" className="btn ghost small" onClick={async () => { if (!confirm("ยกเลิกสิทธิ์นี้?")) return; try { await post(`/api/admin/grants/${x.id}/revoke`); g.reload(); onChanged(); } catch (e) { toast(errText(e)); } }}>ยกเลิก</button>}
          </li>))}</ul>
      )}
      <div className="row">
        <input type="number" min={1} aria-label="จำนวนวัน" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 110 }} />
        <button type="button" className="btn small" onClick={grant}>ให้สิทธิ์ Plus (วัน)</button>
      </div>
    </div>
  );
}
