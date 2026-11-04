import { useMemo, useState } from "react";
import { get, post, put } from "../api";
import { TOPICS } from "../../shared/taxonomy";
import { Markdown } from "../markdown";
import { Field, Loading, StatusPill, errText, useLoad, useToast, subName, ago, fmtDate } from "../ui";
import { Certification } from "./LearnerPlus";

export interface NoteFull {
  id: string; topic: string; subtopic: string; title: string; summary: string; body: string; refs: string; freeAccess: boolean;
  status: string; version: number; authorName: string | null; certifiedBy: string | null; certifiedAt: string | null; updatedAt: string;
}
type NoteInput = Pick<NoteFull, "topic" | "subtopic" | "title" | "summary" | "body" | "refs" | "freeAccess">;

const checksOf = (n: NoteInput) => [
  { id: "title", label: "มีชื่อเรื่อง", ok: n.title.trim().length > 0 },
  { id: "summary", label: "มีบทนำ/สรุปสั้น ≥ 20 ตัวอักษร (ผู้ใช้ฟรีเห็นส่วนนี้)", ok: n.summary.trim().length >= 20 },
  { id: "body", label: "มีเนื้อหาอย่างน้อย 200 ตัวอักษร", ok: n.body.trim().length >= 200 },
  { id: "refs", label: "มีเอกสารอ้างอิง", ok: n.refs.trim().length > 0 },
];

export function NotesAuthoring() {
  const toast = useToast();
  const list = useLoad<{ notes: NoteFull[] }>(() => get("/api/faculty/notes"), []);
  const [sel, setSel] = useState<string | "new" | null>(null);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,.8fr) minmax(0,1.4fr)" }}>
      <section className="panel stack">
        <div className="row-between"><h2 style={{ fontSize: 16 }}>สรุปเนื้อหา</h2><button type="button" className="btn primary small" onClick={() => setSel("new")}>+ เขียนสรุปใหม่</button></div>
        <p className="small muted" style={{ margin: 0 }}>ทุกเรื่องต้องผ่าน “ผู้รับรองเนื้อหา” ก่อนเผยแพร่ ติ๊ก “เปิดฟรี” เพื่อใช้เป็นตัวอย่างให้ผู้ใช้ฟรี</p>
        {!list.data ? <Loading error={list.error} /> : !list.data.notes.length ? <div className="empty">ยังไม่มีสรุปเนื้อหา</div> : (
          <ul className="list-plain">{list.data.notes.map((n) => (
            <li key={n.id}><button type="button" className="note-card" onClick={() => setSel(n.id)} style={sel === n.id ? { borderColor: "var(--accent)", borderWidth: 2 } : undefined}>
              <span className="row"><span className="mono small">{n.id}</span><span className="code">{n.topic}</span><StatusPill status={n.status} />{n.freeAccess && <span className="pill st-approved">ฟรี</span>}<span className="small muted">v{n.version}</span></span>
              <strong>{n.title || <span className="muted">(ยังไม่มีชื่อ)</span>}</strong>
              <span className="small muted">{subName(n.subtopic)} · ปรับปรุง {ago(n.updatedAt)}</span>
            </button></li>))}</ul>
        )}
      </section>
      <section className="panel stack">
        {sel === null ? <p className="small muted" style={{ margin: 0 }}>เลือกเรื่องทางซ้าย หรือกด “เขียนสรุปใหม่”</p>
          : sel === "new" ? <NoteEditor key="new" initial={null} onSaved={(n) => { list.reload(); setSel(n.id); }} />
          : <NoteDetail key={sel} id={sel} onChanged={list.reload} toast={toast} />}
      </section>
    </div>
  );
}

function NoteDetail({ id, onChanged, toast }: { id: string; onChanged: () => void; toast: (m: string) => void }) {
  const d = useLoad<{ note: NoteFull; reviews: { id: string; version: number; decision: string; comment: string; reviewer: string | null; at: string }[] }>(() => get(`/api/faculty/notes/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  if (!d.data) return <Loading error={d.error} />;
  const n = d.data.note;
  const act = async (path: string, msg: string) => { try { await post(path); toast(msg); d.reload(); onChanged(); } catch (e) { toast(errText(e)); } };
  if (editing) return <NoteEditor initial={n} onSaved={() => { setEditing(false); d.reload(); onChanged(); }} onCancel={() => setEditing(false)} />;
  const last = d.data.reviews[0];
  return (
    <>
      <div className="row-between">
        <div className="row"><span className="mono">{n.id}</span><StatusPill status={n.status} /><span className="small muted">v{n.version}</span></div>
        <div className="row">
          {n.status === "draft" && <button className="btn" onClick={() => setEditing(true)}>แก้ไข</button>}
          {n.status === "draft" && <button className="btn primary" disabled={checksOf(n).some((c) => !c.ok)} onClick={() => act(`/api/faculty/notes/${id}/submit`, "ส่งให้ผู้รับรองเนื้อหาแล้ว")}>ส่งรับรอง</button>}
          {(n.status === "published" || n.status === "retired") && <button className="btn" onClick={() => act(`/api/faculty/notes/${id}/revise`, `เปิดฉบับที่ ${n.version + 1} เป็น Draft แล้ว เรื่องนี้จะไม่แสดงให้ผู้เรียนจนกว่าจะรับรองอีกครั้ง`)}>แก้ไขเป็นฉบับใหม่</button>}
          {n.status === "published" && <button className="btn ghost" onClick={() => { if (confirm("ถอนเรื่องนี้ออกจากคลังสรุป?")) act(`/api/faculty/notes/${id}/retire`, "ถอนแล้ว"); }}>ถอน</button>}
        </div>
      </div>
      {last?.decision === "revise" && n.status === "draft" && <div className="note small"><strong>ผู้รับรองขอให้แก้ไข ({last.reviewer}):</strong> {last.comment}</div>}
      <h2 style={{ fontSize: 20 }}>{n.title}</h2>
      <Certification n={n} />
      <p style={{ margin: 0, fontWeight: 500 }}>{n.summary}</p>
      <Markdown source={n.body} />
      {n.refs && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>อ้างอิง: {n.refs}</p>}
      {d.data.reviews.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ fontSize: 15 }}>ประวัติการรับรอง</h3>
          <ul className="list-plain">{d.data.reviews.map((r) => <li key={r.id} className="note small"><div className="meta"><span>{r.decision === "certify" ? "รับรอง" : "ส่งกลับแก้ไข"}</span><span>v{r.version}</span><span>{r.reviewer}</span><span>{fmtDate(r.at)}</span></div>{r.comment && <p style={{ margin: "4px 0 0" }}>{r.comment}</p>}</li>)}</ul>
        </div>
      )}
    </>
  );
}

function NoteEditor({ initial, onSaved, onCancel }: { initial: NoteFull | null; onSaved: (n: NoteFull) => void; onCancel?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<NoteInput>(() => initial
    ? { topic: initial.topic, subtopic: initial.subtopic, title: initial.title, summary: initial.summary, body: initial.body, refs: initial.refs, freeAccess: initial.freeAccess }
    : { topic: "T1", subtopic: "t1.hematopoiesis", title: "", summary: "", body: "## หัวข้อ\n- ประเด็นสำคัญ\n\n| ลักษณะ | โรค A | โรค B |\n|---|---|---|\n| ... | ... | ... |", refs: "", freeAccess: false });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const checks = useMemo(() => checksOf(f), [f]);
  const subs = TOPICS.find((t) => t.code === f.topic)!.subs;
  const set = <K extends keyof NoteInput>(k: K, v: NoteInput[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save(submit: boolean) {
    setBusy(true);
    try {
      const r = initial ? await put<{ note: NoteFull }>(`/api/faculty/notes/${initial.id}`, { note: f, baseUpdatedAt: initial.updatedAt })
        : await post<{ note: NoteFull }>("/api/faculty/notes", { note: f });
      if (submit) await post(`/api/faculty/notes/${r.note.id}/submit`);
      toast(submit ? `${r.note.id} ส่งให้ผู้รับรองแล้ว` : `บันทึก ${r.note.id} แล้ว`);
      onSaved(r.note);
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div className="two">
        <Field label="Topic"><select value={f.topic} onChange={(e) => { const t = TOPICS.find((x) => x.code === e.target.value)!; setF((x) => ({ ...x, topic: t.code, subtopic: t.subs[0][0] })); }}>
          {TOPICS.map((t) => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}</select></Field>
        <Field label="Subtopic"><select value={f.subtopic} onChange={(e) => set("subtopic", e.target.value)}>{subs.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
      </div>
      <Field label="ชื่อเรื่อง"><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field label="บทนำ / สรุปสั้น" hint="ผู้ใช้ฟรีเห็นส่วนนี้ในทุกเรื่อง"><textarea rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
      <div className="row-between"><span className="small muted">เนื้อหา — รองรับ ## หัวข้อ, - รายการ, 1. ลำดับ, **ตัวหนา**, ตาราง | a | b |</span>
        <button type="button" className="btn small" onClick={() => setPreview(!preview)}>{preview ? "กลับไปแก้ไข" : "ดูตัวอย่าง"}</button></div>
      {preview ? <div className="note"><Markdown source={f.body} /></div>
        : <textarea aria-label="เนื้อหา" rows={16} value={f.body} onChange={(e) => set("body", e.target.value)} style={{ fontFamily: "var(--mono)", fontSize: 13 }} />}
      <Field label="เอกสารอ้างอิง"><textarea rows={2} value={f.refs} onChange={(e) => set("refs", e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={f.freeAccess} onChange={(e) => set("freeAccess", e.target.checked)} /> เปิดให้ผู้ใช้ฟรีอ่านฉบับเต็ม (ใช้เป็นตัวอย่าง)</label>
      <ul className="checks" aria-label="ตรวจความครบถ้วน">{checks.map((c) => <li key={c.id}><span className={`dot ${c.ok ? "ok" : "no"}`} aria-hidden="true">{c.ok ? "✓" : "✕"}</span><span>{c.label}</span></li>)}</ul>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>บันทึก Draft</button>
        <button type="button" className="btn primary" disabled={busy || checks.some((c) => !c.ok)} onClick={() => save(true)}>บันทึกและส่งรับรอง</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>ยกเลิก</button>}
      </div>
    </div>
  );
}
