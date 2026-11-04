import { useState, type FormEvent, type ReactNode } from "react";
import { get, post } from "../api";
import { TOPICS } from "../../shared/taxonomy";
import type { Entitlements } from "../../shared/plans";
import { FEATURES } from "../../shared/plans";
import { Markdown } from "../markdown";
import { Loading, PlusBadge, errText, fmtDate, subName, useLoad, useToast, usePublicConfig, Field } from "../ui";

interface NoteMeta {
  id: string; topic: string; subtopic: string; title: string; summary: string; body: string | null; refs: string | null;
  freeAccess: boolean; locked: boolean; version: number; authorName: string | null; certifiedBy: string | null; certifiedAt: string | null;
}

export function UpsellCard({ text, onUpgrade }: { text: string; onUpgrade: () => void }) {
  return (
    <div className="upsell">
      <span className="small"><PlusBadge plus /> {text}</span>
      <div><button type="button" className="btn primary small" onClick={onUpgrade}>ดูสิทธิ์สมาชิก Plus</button></div>
    </div>
  );
}

export function Certification({ n }: { n: { certifiedBy: string | null; certifiedAt: string | null; authorName: string | null; version: number } }) {
  if (!n.certifiedBy) return null;
  return (
    <div className="cert" role="note">
      <span aria-hidden="true">✓</span>
      <span>รับรองเนื้อหาโดย <strong>{n.certifiedBy}</strong></span>
      {n.certifiedAt && <span>เมื่อ {fmtDate(n.certifiedAt)}</span>}
      <span>· เรียบเรียงโดย {n.authorName ?? "—"} · ฉบับที่ {n.version}</span>
    </div>
  );
}

export function NotesLibrary({ openId, setOpenId, onUpgrade }: { openId: string | null; setOpenId: (id: string | null) => void; onUpgrade: () => void }) {
  const list = useLoad<{ notes: NoteMeta[] }>(() => get("/api/notes"), []);
  const [topic, setTopic] = useState("all");
  if (openId) return <NoteReader id={openId} onBack={() => setOpenId(null)} onUpgrade={onUpgrade} />;
  if (!list.data) return <Loading error={list.error} />;
  const notes = list.data.notes.filter((n) => topic === "all" || n.topic === topic);
  return (
    <section className="panel stack">
      <div className="row-between">
        <div><h2 style={{ fontSize: 18 }}>สรุปเนื้อหาสำหรับทบทวน</h2>
          <p className="small muted" style={{ margin: "2px 0 0" }}>ทุกเรื่องผ่านการรับรองโดยอาจารย์ผู้เชี่ยวชาญก่อนเผยแพร่ · เรื่องที่มีป้าย “ฟรี” อ่านได้ทุกคน</p></div>
      </div>
      <div className="row" role="group" aria-label="เลือก Topic">
        <button type="button" className="chip" aria-pressed={topic === "all"} onClick={() => setTopic("all")}>ทั้งหมด</button>
        {TOPICS.map((t) => <button key={t.code} type="button" className="chip" aria-pressed={topic === t.code} onClick={() => setTopic(t.code)} title={t.name}>{t.code}</button>)}
      </div>
      {!notes.length ? <div className="empty">ยังไม่มีสรุปเนื้อหาในหมวดนี้</div> : (
        <ul className="list-plain">{notes.map((n) => (
          <li key={n.id}>
            <button type="button" className="note-card" onClick={() => setOpenId(n.id)}>
              <span className="row"><span className="code">{n.topic}</span><span className="small muted">{subName(n.subtopic)}</span>
                {n.freeAccess ? <span className="pill st-approved">ฟรี</span> : n.locked ? <span className="pill plus-pill">Plus</span> : null}</span>
              <strong>{n.title}</strong>
              <span className="small">{n.summary}</span>
              {n.certifiedBy && <span className="small muted">✓ รับรองโดย {n.certifiedBy}{n.certifiedAt ? ` · ${fmtDate(n.certifiedAt)}` : ""}</span>}
            </button>
          </li>))}</ul>
      )}
    </section>
  );
}

function NoteReader({ id, onBack, onUpgrade }: { id: string; onBack: () => void; onUpgrade: () => void }) {
  const d = useLoad<{ note: NoteMeta }>(() => get(`/api/notes/${id}`), [id]);
  if (!d.data) return <Loading error={d.error} />;
  const n = d.data.note;
  return (
    <article className="panel stack" style={{ maxWidth: 860 }}>
      <div><button type="button" className="btn ghost small" onClick={onBack}>← กลับไปคลังสรุป</button></div>
      <div className="row"><span className="code">{n.topic}</span><span className="small muted">{subName(n.subtopic)}</span>{n.freeAccess && <span className="pill st-approved">ฟรี</span>}</div>
      <h1 style={{ fontSize: 22 }}>{n.title}</h1>
      <Certification n={n} />
      <p className="lead" style={{ fontWeight: 500 }}>{n.summary}</p>
      {n.locked ? <UpsellCard text="เนื้อหาฉบับเต็ม ตารางเปรียบเทียบ และเอกสารอ้างอิงของเรื่องนี้สำหรับสมาชิก Plus" onUpgrade={onUpgrade} /> : (
        <>
          <Markdown source={n.body ?? ""} />
          {n.refs && <div className="note small"><div className="eyebrow">เอกสารอ้างอิง</div><p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{n.refs}</p></div>}
        </>
      )}
    </article>
  );
}

const STATE_LABEL: Record<string, string> = { to_review: "ควรกลับมาดู", recall_check: "รอตรวจความจำ", mastered: "จำได้แล้ว" };

export function Notebook({ onUpgrade, onChanged, renderPractice }: { onUpgrade: () => void; onChanged: () => void; renderPractice: (onDone: () => void) => ReactNode }) {
  const nb = useLoad<{ locked: boolean; counts: { toReview: number; recallCheck: number; mastered: number; due: number }; cards: { itemId: string; topic: string; subtopic: string; leadIn: string; state: string; dueAt: string; due: boolean; lapses: number }[] }>(
    () => get("/api/learner/notebook"), []);
  const [practising, setPractising] = useState(false);
  if (!nb.data) return <Loading error={nb.error} />;
  const { counts, locked, cards } = nb.data;
  if (practising) return (
    <div className="stack">
      <div><button type="button" className="btn ghost small" onClick={() => { setPractising(false); nb.reload(); onChanged(); }}>← กลับไปสมุดทบทวน</button></div>
      {renderPractice(() => nb.reload())}
    </div>
  );
  return (
    <section className="panel stack">
      <div><h2 style={{ fontSize: 18 }}>สมุดทบทวน <PlusBadge plus /></h2>
        <p className="small muted" style={{ margin: "2px 0 0" }}>ข้อที่ตอบผิดจะวนกลับมาใน 1 วัน ถ้าตอบถูกจะเลื่อนไปตรวจความจำอีกครั้งใน 3 วัน ตอบถูกอีกครั้งถือว่าจำได้แล้ว</p></div>
      <div className="stats">
        <div className="stat"><div className="eyebrow">ถึงรอบวันนี้</div><div className="stat-v mono">{counts.due}</div></div>
        <div className="stat"><div className="eyebrow">ควรกลับมาดู</div><div className="stat-v mono">{counts.toReview}</div></div>
        <div className="stat"><div className="eyebrow">รอตรวจความจำ</div><div className="stat-v mono">{counts.recallCheck}</div></div>
        <div className="stat"><div className="eyebrow">จำได้แล้ว</div><div className="stat-v mono">{counts.mastered}</div></div>
      </div>
      {locked ? <UpsellCard text={`มี ${counts.toReview + counts.recallCheck} ข้อรออยู่ในสมุดทบทวนของคุณ สมัคร Plus เพื่อทบทวนตามรอบ`} onUpgrade={onUpgrade} /> : (
        <>
          <div><button type="button" className="btn primary" disabled={counts.due === 0} onClick={() => setPractising(true)}>{counts.due ? `เริ่มทบทวน ${counts.due} ข้อที่ถึงรอบ` : "ยังไม่มีข้อที่ถึงรอบ"}</button></div>
          {cards.length > 0 && (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>ข้อ</th><th>Subtopic</th><th>สถานะ</th><th>รอบถัดไป</th><th>พลาด</th></tr></thead>
              <tbody>{cards.map((c) => (
                <tr key={c.itemId}><td className="mono small">{c.itemId}</td><td className="small">{subName(c.subtopic)}</td>
                  <td className="small">{STATE_LABEL[c.state]}</td>
                  <td className="small">{c.state === "mastered" ? "—" : c.due ? <strong>ถึงรอบแล้ว</strong> : fmtDate(c.dueAt)}</td>
                  <td className="mono small">{c.lapses}</td></tr>))}</tbody></table></div>
          )}
        </>
      )}
    </section>
  );
}

export function MembershipPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const cfg = usePublicConfig();
  const ent = useLoad<Entitlements>(() => get("/api/me/entitlements"), []);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function redeem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<{ days: number; endsAt: string | null }>("/api/me/redeem", { code });
      toast(`ใช้โค้ดสำเร็จ ได้สิทธิ์ Plus เพิ่ม ${r.days} วัน`); setCode(""); ent.reload(); onChanged();
    } catch (x) { toast(errText(x)); } finally { setBusy(false); }
  }
  if (!ent.data) return <Loading error={ent.error} />;
  const e = ent.data;
  const label: Record<string, string> = { trial: "ทดลองใช้", redeem: "โค้ด", purchase: "ซื้อ", institution: "สถาบัน", admin: "ผู้ดูแลให้สิทธิ์" };
  return (
    <div className="grid">
      <section className="panel stack">
        <div className="row-between">
          <h2 style={{ fontSize: 18 }}>สถานะสมาชิก <PlusBadge plus={e.plan === "plus"} /></h2>
          {e.plan === "plus" && <span className="small">{e.plusUntil ? `ใช้ได้ถึง ${fmtDate(e.plusUntil)}` : "ไม่มีวันหมดอายุ"}</span>}
        </div>
        {e.plan === "plus" && e.sources.length > 0 && <p className="small muted" style={{ margin: 0 }}>ที่มาของสิทธิ์: {[...new Set(e.sources.map((s) => label[s.source] ?? s.source))].join(", ")}</p>}
        <div className="two">
          <div className="note stack" style={{ gap: 6 }}>
            <strong>ฟรี</strong>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(cfg?.free ?? []).map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
          <div className="note stack" style={{ gap: 6, background: "var(--accent-soft)" }}>
            <strong>Plus — ทุกอย่างในแบบฟรี และ</strong>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.values(FEATURES).map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>ข้อสอบฝึกทุกข้อใช้ได้ฟรีเสมอ สิ่งที่สมาชิก Plus ได้เพิ่มคือเนื้อหาทบทวนและเครื่องมือช่วยจำ</p>
        <div className="note small">การชำระเงินออนไลน์ (PromptPay และบัตร) กำลังเปิดให้บริการ ระหว่างนี้รับสิทธิ์ผ่านโค้ดจากสถาบันหรือกิจกรรม</div>
      </section>
      <aside className="panel stack">
        <h2 style={{ fontSize: 16 }}>ใช้โค้ดแลกสิทธิ์</h2>
        <form className="stack" onSubmit={redeem}>
          <Field label="โค้ด"><input type="text" value={code} onChange={(x) => setCode(x.target.value)} placeholder="HEM-XXXX-XXXX" autoComplete="off" style={{ textTransform: "uppercase" }} /></Field>
          <div><button className="btn primary" disabled={busy || code.trim().length < 4}>ใช้โค้ด</button></div>
        </form>
        <p className="small muted" style={{ margin: 0 }}>ถ้าเป็นสมาชิกอยู่แล้ว วันจากโค้ดจะต่อท้ายวันหมดอายุเดิม</p>
      </aside>
    </div>
  );
}
