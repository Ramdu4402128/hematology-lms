import { useState } from "react";
import { get, post } from "../api";
import { Markdown } from "../markdown";
import { Field, Loading, StatusPill, Tabs, errText, useLoad, useToast, subName, ago, fmtDate } from "../ui";
import type { NoteFull } from "./NotesAuthoring";

/** ผู้รับรองเนื้อหา: certifies review notes before they reach learners. */
export function CertifierApp() {
  const [tab, setTab] = useState<"queue" | "all">("queue");
  return (
    <>
      <Tabs label="ส่วนของผู้รับรองเนื้อหา" value={tab} onChange={setTab} items={[{ id: "queue", label: "รอรับรอง" }, { id: "all", label: "เนื้อหาทั้งหมด" }]} />
      {tab === "queue" ? <Queue /> : <AllNotes />}
    </>
  );
}

function Queue() {
  const toast = useToast();
  const q = useLoad<{ notes: (NoteFull & { canCertify: boolean })[] }>(() => get("/api/certify/queue"), []);
  const [sel, setSel] = useState<string | null>(null);
  const d = useLoad<{ note: NoteFull; checks: { id: string; label: string; ok: boolean }[] } | null>(() => (sel ? get(`/api/faculty/notes/${sel}`) : Promise.resolve(null)), [sel]);
  const [confirmed, setConfirmed] = useState(false);
  const [comment, setComment] = useState("");
  const pick = (id: string) => { setSel(id); setConfirmed(false); setComment(""); };
  async function decide(decision: "certify" | "revise") {
    try {
      await post(`/api/certify/notes/${sel}`, { decision, comment, confirm: confirmed });
      toast(decision === "certify" ? "รับรองและเผยแพร่แล้ว" : "ส่งกลับให้ผู้เขียนแก้ไขแล้ว");
      setSel(null); q.reload();
    } catch (e) { toast(errText(e)); }
  }
  const item = q.data?.notes.find((n) => n.id === sel);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,.7fr) minmax(0,1.3fr)" }}>
      <section className="panel stack">
        <h2 style={{ fontSize: 16 }}>รอรับรอง</h2>
        {!q.data ? <Loading error={q.error} /> : !q.data.notes.length ? <div className="empty">ไม่มีเนื้อหารอรับรอง</div> : (
          <ul className="list-plain">{q.data.notes.map((n) => (
            <li key={n.id}><button type="button" className="note-card" onClick={() => pick(n.id)} style={sel === n.id ? { borderColor: "var(--accent)", borderWidth: 2 } : undefined}>
              <span className="row"><span className="mono small">{n.id}</span><span className="code">{n.topic}</span><span className="small muted">v{n.version}</span></span>
              <strong>{n.title}</strong>
              <span className="small muted">{subName(n.subtopic)} · {n.authorName} · ส่งเมื่อ {ago(n.updatedAt)}{!n.canCertify && " · เนื้อหาของคุณ"}</span>
            </button></li>))}</ul>
        )}
      </section>
      <section className="panel stack">
        {!sel ? <p className="small muted" style={{ margin: 0 }}>เลือกเรื่องทางซ้ายเพื่ออ่านและรับรอง</p> : !d.data ? <Loading error={d.error} /> : (
          <>
            <div className="row"><span className="code">{d.data.note.topic}</span><span className="small muted">{subName(d.data.note.subtopic)}</span>{d.data.note.freeAccess && <span className="pill st-approved">เปิดฟรี</span>}</div>
            <h2 style={{ fontSize: 20 }}>{d.data.note.title}</h2>
            <p style={{ margin: 0, fontWeight: 500 }}>{d.data.note.summary}</p>
            <Markdown source={d.data.note.body} />
            <div className="note small"><div className="eyebrow">เอกสารอ้างอิง</div><p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{d.data.note.refs}</p></div>
            {!item?.canCertify ? <p className="small muted">ผู้เขียนหรือผู้แก้ไขล่าสุดรับรองเนื้อหาของตนเองไม่ได้</p> : (
              <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  ข้าพเจ้าได้ตรวจความถูกต้องทางวิชาการ ความเป็นปัจจุบันตามแนวทางเวชปฏิบัติ และเอกสารอ้างอิงของเนื้อหานี้แล้ว และยินยอมให้แสดงชื่อเป็นผู้รับรอง</label>
                <Field label="ความเห็น (จำเป็นเมื่อส่งกลับแก้ไข)"><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <div className="row">
                  <button type="button" className="btn primary" disabled={!confirmed} onClick={() => decide("certify")}>รับรองและเผยแพร่</button>
                  <button type="button" className="btn" disabled={!comment.trim()} onClick={() => decide("revise")}>ส่งกลับแก้ไข</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function AllNotes() {
  const toast = useToast();
  const l = useLoad<{ notes: NoteFull[] }>(() => get("/api/faculty/notes"), []);
  if (!l.data) return <Loading error={l.error} />;
  return (
    <section className="panel stack">
      <p className="small muted" style={{ margin: 0 }}>ผู้รับรองถอนเนื้อหาที่ล้าสมัยออกได้ทันที ผู้เขียนจะแก้เป็นฉบับใหม่แล้วส่งรับรองอีกครั้ง</p>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>รหัส</th><th>เรื่อง</th><th>สถานะ</th><th>รับรองโดย</th><th></th></tr></thead>
        <tbody>{l.data.notes.map((n) => (
          <tr key={n.id}><td className="mono small">{n.id}</td><td>{n.title}<div className="small muted">{subName(n.subtopic)}</div></td><td><StatusPill status={n.status} /></td>
            <td className="small">{n.certifiedBy ? `${n.certifiedBy} · ${fmtDate(n.certifiedAt!)}` : "—"}</td>
            <td>{n.status === "published" && <button type="button" className="btn ghost small" onClick={async () => { if (!confirm(`ถอน ${n.title}?`)) return; try { await post(`/api/faculty/notes/${n.id}/retire`); toast("ถอนแล้ว"); l.reload(); } catch (e) { toast(errText(e)); } }}>ถอน</button>}</td></tr>))}</tbody></table></div>
    </section>
  );
}
