import { useMemo, useState } from "react";
import { get, post, put, del } from "../api";
import { TOPICS, LEVELS, KEYS, RUBRIC, REPORT_REASONS, STATUS_LABEL } from "../../shared/taxonomy";
import { qualityChecks } from "../../shared/quality";
import type { Item, ItemInput, Lab, Me } from "../../shared/types";
import { NotesAuthoring } from "./NotesAuthoring";
import { Field, ItemPreview, Loading, StatusPill, Tabs, errText, useLoad, useToast, subName, ago, fmtDate } from "../ui";

type Tab = "bank" | "edit" | "review" | "reports" | "coverage" | "notes";
interface Row { id: string; topic: string; subtopic: string; level: string; leadIn: string; status: string; version: number; authorName: string | null; updatedAt: string; n: number; p: number | null; openReports: number }

export function FacultyApp({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>("bank");
  const [editing, setEditing] = useState<Item | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const queue = useLoad<{ items: { id: string; canReview: boolean }[] }>(() => get("/api/faculty/review-queue"), [tab]);
  const reports = useLoad<{ reports: unknown[] }>(() => get("/api/faculty/reports"), [tab]);
  const reviewable = queue.data?.items.filter((i) => i.canReview).length ?? 0;
  const openEditor = (it: Item | null) => { setEditing(it); setTab("edit"); };
  return (
    <>
      <Tabs label="ส่วนของอาจารย์รายวิชา" value={tab} onChange={(t) => { if (t === "edit") setEditing(null); setTab(t); }} items={[
        { id: "bank", label: "คลังข้อสอบ" },
        { id: "edit", label: editing ? `แก้ไข ${editing.id}` : "เขียนข้อใหม่" },
        { id: "review", label: <>รอรีวิว{reviewable > 0 && <span className="count">{reviewable}</span>}</> },
        { id: "reports", label: <>รายงานจากผู้เรียน{!!reports.data?.reports.length && <span className="count">{reports.data.reports.length}</span>}</> },
        { id: "notes", label: "สรุปเนื้อหา" },
        { id: "coverage", label: "ความครอบคลุม" },
      ]} />
      {tab === "bank" && <Bank me={me} selected={selected} setSelected={setSelected} onEdit={openEditor} />}
      {tab === "edit" && <Editor key={editing?.id ?? "new"} initial={editing} onSaved={(it, submitted) => { setSelected(it.id); if (submitted) setTab("bank"); else setEditing(it); }} />}
      {tab === "review" && <ReviewQueue onDone={queue.reload} />}
      {tab === "reports" && <Reports onOpen={(id) => { setSelected(id); setTab("bank"); }} onChange={reports.reload} />}
      {tab === "coverage" && <Coverage />}
      {tab === "notes" && <NotesAuthoring />}
    </>
  );
}

function Bank({ me, selected, setSelected, onEdit }: { me: Me; selected: string | null; setSelected: (id: string | null) => void; onEdit: (it: Item) => void }) {
  const [status, setStatus] = useState("");
  const [topic, setTopic] = useState("");
  const [q, setQ] = useState("");
  const list = useLoad<{ items: Row[]; counts: Record<string, number> }>(
    () => get(`/api/faculty/items?${new URLSearchParams({ ...(status && { status }), ...(topic && { topic }), ...(q && { q }) })}`), [status, topic, q]);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)" }}>
      <section className="panel stack">
        <div className="toolbar">
          <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}{list.data?.counts[k] != null ? ` (${list.data.counts[k]})` : ""}</option>)}
          </select>
          <select aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">ทุก Topic</option>
            {TOPICS.map((t) => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}
          </select>
          <input type="search" aria-label="ค้นหา" placeholder="ค้นหารหัสหรือข้อความ" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!list.data ? <Loading error={list.error} /> : !list.data.items.length ? <div className="empty">ไม่พบข้อสอบ</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>รหัส</th><th>Topic</th><th>คำถาม</th><th>สถานะ</th><th title="สัดส่วนตอบถูก (เวอร์ชันปัจจุบัน)">p</th></tr></thead>
            <tbody>{list.data.items.map((r) => (
              <tr key={r.id} className={selected === r.id ? "sel" : ""}>
                <td><button type="button" className="linkbtn mono" onClick={() => setSelected(r.id)}>{r.id}</button>{r.version > 1 && <span className="small muted"> v{r.version}</span>}</td>
                <td><span className="code">{r.topic}</span></td>
                <td className="small">{r.leadIn || <span className="muted">(ยังไม่มี lead-in)</span>}{r.openReports > 0 && <span className="flag" style={{ marginLeft: 6 }}>รายงาน {r.openReports}</span>}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="mono small">{r.p == null ? "—" : r.p.toFixed(2)}<span className="muted"> ({r.n})</span></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel stack">
        {selected ? <ItemDetail key={selected} id={selected} me={me} onEdit={onEdit} onChanged={list.reload} onDeleted={() => { setSelected(null); list.reload(); }} />
          : <p className="muted small" style={{ margin: 0 }}>เลือกข้อสอบเพื่อดูรายละเอียด สถิติ และประวัติการรีวิว</p>}
      </section>
    </div>
  );
}

function ItemDetail({ id, me, onEdit, onChanged, onDeleted }: { id: string; me: Me; onEdit: (it: Item) => void; onChanged: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const d = useLoad<any>(() => get(`/api/faculty/items/${id}`), [id]);
  if (!d.data) return <Loading error={d.error} />;
  const { item, checks, stats, reviews, reports } = d.data;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); d.reload(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  const blocking = checks.filter((c: any) => c.blocking && !c.ok);
  const mine = item.authorId === me.id || item.lastEditedBy === me.id;
  return (
    <>
      <div className="row-between">
        <div className="row"><h2 style={{ fontSize: 18 }} className="mono">{item.id}</h2><StatusPill status={item.status} /><span className="small muted">v{item.version}</span></div>
        <div className="row">
          {item.status === "draft" && <button className="btn" onClick={() => onEdit(item)}>แก้ไข</button>}
          {item.status === "draft" && <button className="btn primary" disabled={blocking.length > 0} title={blocking.length ? "ยังไม่ผ่าน quality checks" : undefined}
            onClick={() => act(() => post(`/api/faculty/items/${id}/submit`), "ส่งรีวิวแล้ว")}>ส่งรีวิว</button>}
          {item.status === "review" && mine && <button className="btn" onClick={() => act(() => post(`/api/faculty/items/${id}/withdraw`), "ดึงกลับเป็น Draft แล้ว")}>ดึงกลับมาแก้</button>}
          {(item.status === "approved" || item.status === "retired") && <button className="btn" onClick={() => act(() => post(`/api/faculty/items/${id}/revise`), `เปิดเวอร์ชัน ${item.version + 1} เป็น Draft แล้ว — ข้อนี้จะไม่ถูกสุ่มให้ผู้เรียนจนกว่าจะอนุมัติอีกครั้ง`)}>แก้ไขเป็นเวอร์ชันใหม่</button>}
          {item.status === "approved" && <button className="btn ghost" onClick={() => {
            const reason = window.prompt("เหตุผลที่ถอนข้อนี้ออกจากคลัง");
            if (reason) act(() => post(`/api/faculty/items/${id}/retire`, { reason }), "ถอนข้อสอบแล้ว");
          }}>ถอน</button>}
          {item.status === "retired" && <button className="btn ghost" onClick={() => act(() => post(`/api/faculty/items/${id}/restore`), "นำกลับเข้าคลังแล้ว")}>นำกลับ</button>}
          {item.status === "draft" && item.authorId === me.id && item.version === 1 && stats.n === 0 && (
            <button className="btn ghost" onClick={async () => { if (!window.confirm(`ลบ ${id} ถาวร?`)) return; try { await del(`/api/faculty/items/${id}`); toast("ลบแล้ว"); onDeleted(); } catch (e) { toast(errText(e)); } }}>ลบ</button>
          )}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>ผู้เขียน {item.authorName ?? "—"}{item.lastEditedByName && item.lastEditedByName !== item.authorName ? ` · แก้ไขล่าสุดโดย ${item.lastEditedByName}` : ""} · ปรับปรุง {ago(item.updatedAt)}</p>
      <ItemPreview item={item} />
      {item.status === "draft" && <Checks checks={checks} />}
      <section className="stack" aria-label="สถิติ">
        <h3 style={{ fontSize: 15 }}>สถิติเวอร์ชันปัจจุบัน (ครั้งแรกของผู้เรียนแต่ละคน)</h3>
        {stats.n === 0 ? <p className="small muted" style={{ margin: 0 }}>ยังไม่มีผู้ตอบ</p> : (
          <>
            <dl className="kv">
              <dt>ผู้ตอบ</dt><dd className="mono">{stats.n}</dd>
              <dt>ความยาก (p)</dt><dd className="mono">{stats.p?.toFixed(2)} {stats.p != null && (stats.p > 0.9 ? <span className="small muted">— ง่ายมาก</span> : stats.p < 0.3 ? <span className="small muted">— ยากมาก ตรวจเฉลย</span> : null)}</dd>
              <dt>อำนาจจำแนก (D)</dt><dd className="mono">{stats.d == null ? <span className="small muted">ต้องมีผู้ตอบ ≥ 10 คน</span> : stats.d.toFixed(2)}{stats.d != null && stats.d < 0.2 && <span className="small muted"> — ต่ำ ควรทบทวน</span>}</dd>
              <dt>เวลาเฉลี่ย</dt><dd className="mono">{stats.medianSeconds == null ? "—" : `${stats.medianSeconds} วินาที (มัธยฐาน)`}</dd>
            </dl>
            <div className="dist">
              {KEYS.map((k) => {
                const n = stats.distribution[k] ?? 0;
                return [<span key={k + "k"} className="mono">{k}</span>,
                  <div key={k + "b"} className="bar"><span className={k === item.correctKey ? "key" : ""} style={{ width: `${(n / stats.n) * 100}%` }} /></div>,
                  <span key={k + "n"} className="mono">{n}</span>];
              })}
            </div>
          </>
        )}
      </section>
      {reports.length > 0 && (
        <section className="stack">
          <h3 style={{ fontSize: 15 }}>รายงานจากผู้เรียน</h3>
          <ul className="list-plain">{reports.map((r: any) => (
            <li key={r.id} className="note"><div className="meta"><span>{REPORT_REASONS[r.reason]}</span><span>v{r.version}</span><span>{fmtDate(r.at)}</span><span>{r.status === "open" ? "เปิดอยู่" : "ปิดแล้ว"}</span></div>
              {r.detail && <p style={{ margin: "4px 0 0" }}>{r.detail}</p>}{r.resolution && <p className="small muted" style={{ margin: "4px 0 0" }}>ผลการตรวจ: {r.resolution}</p>}</li>))}</ul>
        </section>
      )}
      <section className="stack">
        <h3 style={{ fontSize: 15 }}>ประวัติการรีวิว</h3>
        {reviews.length ? <ul className="list-plain">{reviews.map((r: any) => (
          <li key={r.id} className="note"><div className="meta"><span>{r.decision === "approve" ? "อนุมัติ" : "ส่งกลับแก้ไข"}</span><span>v{r.version}</span><span>{r.reviewer}</span><span>{fmtDate(r.at)}</span><span>rubric {r.checks.filter(Boolean).length}/7</span></div>
            {r.comment && <p style={{ margin: "4px 0 0" }}>{r.comment}</p>}</li>))}</ul> : <p className="small muted" style={{ margin: 0 }}>ยังไม่มี</p>}
      </section>
    </>
  );
}

function Checks({ checks }: { checks: { id: string; label: string; ok: boolean; blocking: boolean }[] }) {
  return (
    <ul className="checks" aria-label="Quality checks">
      {checks.map((c) => (
        <li key={c.id}><span className={`dot ${c.ok ? "ok" : c.blocking ? "no" : "warn"}`} aria-hidden="true">{c.ok ? "✓" : c.blocking ? "✕" : "!"}</span>
          <span>{c.label}<span className="sr-only">{c.ok ? " ผ่าน" : c.blocking ? " ยังไม่ผ่าน (จำเป็น)" : " คำเตือน"}</span>{!c.ok && !c.blocking && <span className="small muted"> (คำเตือน)</span>}</span></li>
      ))}
    </ul>
  );
}

const emptyItem = (): ItemInput => ({
  topic: "T1", subtopic: "t1.hematopoiesis", level: "Clinical", vignette: "", labs: [], leadIn: "",
  options: KEYS.map((key) => ({ key, text: "", rationale: "" })), correctKey: "", explanation: "", reference: "",
});

function Editor({ initial, onSaved }: { initial: Item | null; onSaved: (it: Item, submitted: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState<ItemInput>(() => initial ? {
    topic: initial.topic, subtopic: initial.subtopic, level: initial.level, vignette: initial.vignette, labs: initial.labs, leadIn: initial.leadIn,
    options: KEYS.map((k) => initial.options.find((o) => o.key === k) ?? { key: k, text: "", rationale: "" }), correctKey: initial.correctKey,
    explanation: initial.explanation, reference: initial.reference,
  } : emptyItem());
  const [base, setBase] = useState<Item | null>(initial);
  const [busy, setBusy] = useState(false);
  const checks = useMemo(() => qualityChecks(f), [f]);
  const blocking = checks.filter((c) => c.blocking && !c.ok);
  const subs = TOPICS.find((t) => t.code === f.topic)!.subs;
  const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setOpt = (i: number, k: "text" | "rationale", v: string) => setF((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));
  const setLab = (i: number, k: keyof Lab, v: string) => setF((x) => ({ ...x, labs: x.labs.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  async function save(submit: boolean) {
    setBusy(true);
    try {
      const r = base ? await put<{ item: Item }>(`/api/faculty/items/${base.id}`, { item: f, baseUpdatedAt: base.updatedAt })
        : await post<{ item: Item }>("/api/faculty/items", { item: f });
      setBase(r.item);
      if (submit) { await post(`/api/faculty/items/${r.item.id}/submit`); toast(`${r.item.id} ส่งรีวิวแล้ว`); }
      else toast(`บันทึก ${r.item.id} แล้ว`);
      onSaved(r.item, submit);
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="form">
      <section className="panel stack">
        <div className="two">
          <Field label="Topic">
            <select value={f.topic} onChange={(e) => { const t = TOPICS.find((x) => x.code === e.target.value)!; setF((x) => ({ ...x, topic: t.code, subtopic: t.subs[0][0] })); }}>
              {TOPICS.map((t) => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}
            </select>
          </Field>
          <Field label="Subtopic">
            <select value={f.subtopic} onChange={(e) => set("subtopic", e.target.value)}>{subs.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </Field>
          <Field label="ระดับผู้เรียน">
            <select value={f.level} onChange={(e) => set("level", e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          </Field>
          <Field label="ชนิดข้อสอบ"><input type="text" value="Single best answer (SBA)" readOnly /></Field>
        </div>
        <Field label="Clinical vignette"><textarea rows={4} value={f.vignette} onChange={(e) => set("vignette", e.target.value)} /></Field>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row-between"><span className="small muted">ผลตรวจทางห้องปฏิบัติการ</span>
            <button type="button" className="btn small" onClick={() => set("labs", [...f.labs, { test: "", value: "", unit: "", range: "", flag: "ปกติ" }])}>+ เพิ่มแถว</button></div>
          {f.labs.map((l, i) => (
            <div key={i} className="labrow">
              <input type="text" aria-label="รายการตรวจ" placeholder="รายการ" value={l.test} onChange={(e) => setLab(i, "test", e.target.value)} />
              <input type="text" aria-label="ค่า" placeholder="ค่า" value={l.value} onChange={(e) => setLab(i, "value", e.target.value)} />
              <input type="text" aria-label="หน่วย" placeholder="หน่วย" value={l.unit} onChange={(e) => setLab(i, "unit", e.target.value)} />
              <input type="text" aria-label="ค่าอ้างอิง" placeholder="ค่าอ้างอิง" value={l.range} onChange={(e) => setLab(i, "range", e.target.value)} />
              <select aria-label="แปลผล" value={l.flag} onChange={(e) => setLab(i, "flag", e.target.value)}><option>ปกติ</option><option>สูง</option><option>ต่ำ</option></select>
              <button type="button" className="btn ghost small" aria-label={`ลบแถว ${i + 1}`} onClick={() => set("labs", f.labs.filter((_, j) => j !== i))}>ลบ</button>
            </div>
          ))}
        </div>
        <Field label="Lead-in (คำถาม)"><input type="text" value={f.leadIn} onChange={(e) => set("leadIn", e.target.value)} /></Field>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 8 }}>ตัวเลือกและเหตุผล — เลือกปุ่มทางซ้ายเพื่อกำหนดคำตอบที่ถูก</legend>
          {f.options.map((o, i) => (
            <div key={o.key} className={`optedit${f.correctKey === o.key ? " isright" : ""}`}>
              <label className="radio"><input type="radio" name="correct" checked={f.correctKey === o.key} onChange={() => set("correctKey", o.key)} />{o.key}</label>
              <input type="text" aria-label={`ตัวเลือก ${o.key}`} placeholder={`ตัวเลือก ${o.key}`} value={o.text} onChange={(e) => setOpt(i, "text", e.target.value)} />
              <span />
              <input type="text" aria-label={`เหตุผลตัวเลือก ${o.key}`} placeholder="เหตุผล: ทำไมถูก/ผิด" value={o.rationale} onChange={(e) => setOpt(i, "rationale", e.target.value)} />
            </div>
          ))}
        </fieldset>
        <Field label="คำอธิบายเฉลย"><textarea rows={3} value={f.explanation} onChange={(e) => set("explanation", e.target.value)} /></Field>
        <Field label="เอกสารอ้างอิง"><input type="text" value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
      </section>
      <aside className="stack" style={{ position: "sticky", top: 76 }}>
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>Quality checks</h2>
          <Checks checks={checks} />
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>บันทึก Draft</button>
            <button type="button" className="btn primary" disabled={busy || blocking.length > 0} onClick={() => save(true)}>บันทึกและส่งรีวิว</button>
          </div>
          {base && <p className="small muted" style={{ margin: 0 }}>{base.id} · v{base.version} · บันทึกล่าสุด {ago(base.updatedAt)}</p>}
        </section>
      </aside>
    </div>
  );
}

function ReviewQueue({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const q = useLoad<{ items: { id: string; topic: string; subtopic: string; level: string; leadIn: string; version: number; authorName: string | null; submittedAt: string; canReview: boolean }[] }>(() => get("/api/faculty/review-queue"), []);
  const [sel, setSel] = useState<string | null>(null);
  const d = useLoad<any>(() => (sel ? get(`/api/faculty/items/${sel}`) : Promise.resolve(null)), [sel]);
  const [checks, setChecks] = useState<boolean[]>(RUBRIC.map(() => false));
  const [decision, setDecision] = useState<"approve" | "revise" | "">("");
  const [comment, setComment] = useState("");
  const pick = (id: string) => { setSel(id); setChecks(RUBRIC.map(() => false)); setDecision(""); setComment(""); };
  async function send() {
    try {
      await post(`/api/faculty/items/${sel}/review`, { decision, checks, comment });
      toast(decision === "approve" ? `${sel} อนุมัติแล้ว เข้าคลังสำหรับผู้เรียน` : `ส่ง ${sel} กลับให้ผู้เขียนแก้ไขแล้ว`);
      setSel(null); q.reload(); onDone();
    } catch (e) { toast(errText(e)); }
  }
  const all = checks.every(Boolean);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,.8fr) minmax(0,1.2fr)" }}>
      <section className="panel stack">
        <h2 style={{ fontSize: 16 }}>ข้อที่รอรีวิว</h2>
        {!q.data ? <Loading error={q.error} /> : !q.data.items.length ? <div className="empty">ไม่มีข้อที่รอรีวิว</div> : (
          <ul className="list-plain">{q.data.items.map((it) => (
            <li key={it.id}>
              <button type="button" className="opt" onClick={() => pick(it.id)} style={sel === it.id ? { borderColor: "var(--accent)", borderWidth: 2 } : undefined}>
                <span className="stack" style={{ gap: 2 }}>
                  <span className="row"><span className="mono">{it.id}</span><span className="code">{it.topic}</span><span className="small muted">v{it.version}</span></span>
                  <span className="small">{it.leadIn}</span>
                  <span className="small muted">{it.authorName} · ส่งเมื่อ {ago(it.submittedAt)}{!it.canReview && " · ข้อของคุณ (รอผู้อื่นรีวิว)"}</span>
                </span>
              </button>
            </li>))}</ul>
        )}
      </section>
      <section className="panel stack">
        {!sel ? <p className="muted small" style={{ margin: 0 }}>เลือกข้อทางซ้ายเพื่อรีวิว</p> : !d.data ? <Loading error={d.error} /> : (
          <>
            <ItemPreview item={d.data.item} />
            {d.data.reviews.length > 0 && <div className="note small"><strong>ความเห็นรอบก่อน:</strong> {d.data.reviews[0].comment || "—"}</div>}
            {!q.data?.items.find((i) => i.id === sel)?.canReview ? <p className="small muted">ผู้เขียนหรือผู้แก้ไขล่าสุดรีวิวข้อของตนเองไม่ได้</p> : (
              <>
                <h3 style={{ fontSize: 15 }}>Rubric ({checks.filter(Boolean).length}/7)</h3>
                <div className="rubric">{RUBRIC.map((r, i) => (
                  <label key={i}><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))} /><span>{r}</span></label>
                ))}</div>
                <div className="decide" role="group" aria-label="ผลการรีวิว" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                  <button type="button" aria-pressed={decision === "approve"} disabled={!all} onClick={() => setDecision("approve")}><strong>อนุมัติ</strong><br /><span className="small muted">{all ? "เข้าคลังสำหรับผู้เรียนทันที" : "ต้องผ่าน rubric ครบ 7 ข้อ"}</span></button>
                  <button type="button" aria-pressed={decision === "revise"} onClick={() => setDecision("revise")}><strong>ส่งกลับแก้ไข</strong><br /><span className="small muted">ต้องระบุสิ่งที่ต้องแก้</span></button>
                </div>
                <Field label={decision === "revise" ? "สิ่งที่ต้องแก้ไข (จำเป็น)" : "ความเห็นถึงผู้เขียน"}><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <div><button type="button" className="btn primary" disabled={!decision || (decision === "approve" && !all) || (decision === "revise" && !comment.trim())} onClick={send}>ยืนยันผลรีวิว</button></div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Reports({ onOpen, onChange }: { onOpen: (id: string) => void; onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const r = useLoad<{ reports: any[] }>(() => get(`/api/faculty/reports?status=${status}`), [status]);
  const [closing, setClosing] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  async function close(id: string) {
    try { await post(`/api/faculty/reports/${id}/close`, { resolution }); toast("ปิดรายงานแล้ว"); setClosing(null); setResolution(""); r.reload(); onChange(); }
    catch (e) { toast(errText(e)); }
  }
  return (
    <section className="panel stack">
      <div className="row" role="group" aria-label="สถานะรายงาน">
        <button type="button" className="chip" aria-pressed={status === "open"} onClick={() => setStatus("open")}>เปิดอยู่</button>
        <button type="button" className="chip" aria-pressed={status === "closed"} onClick={() => setStatus("closed")}>ปิดแล้ว</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>ผู้เรียนรายงานแบบไม่ระบุตัวตน ถ้าต้องแก้โจทย์ ให้เปิดข้อแล้วกด “แก้ไขเป็นเวอร์ชันใหม่” ก่อนปิดรายงาน</p>
      {!r.data ? <Loading error={r.error} /> : !r.data.reports.length ? <div className="empty">ไม่มีรายงาน</div> : (
        <ul className="list-plain">{r.data.reports.map((x) => (
          <li key={x.id} className="note stack" style={{ gap: 6 }}>
            <div className="row-between">
              <div className="row"><button type="button" className="linkbtn mono" onClick={() => onOpen(x.itemId)}>{x.itemId}</button><span className="code">{x.topic}</span><StatusPill status={x.itemStatus} />
                <span className="small muted">รายงานบน v{x.version}{x.itemVersion !== x.version ? ` (ปัจจุบัน v${x.itemVersion})` : ""} · {fmtDate(x.at)}</span></div>
              <strong className="small">{REPORT_REASONS[x.reason]}</strong>
            </div>
            <p className="small" style={{ margin: 0 }}>{x.leadIn}</p>
            {x.detail && <p style={{ margin: 0 }}>“{x.detail}”</p>}
            {x.status === "closed" ? <p className="small muted" style={{ margin: 0 }}>ผลการตรวจ: {x.resolution}</p>
              : closing === x.id ? (
                <div className="stack" style={{ gap: 6 }}>
                  <Field label="ผลการตรวจสอบ"><textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
                  <div className="row"><button type="button" className="btn ink" disabled={!resolution.trim()} onClick={() => close(x.id)}>ปิดรายงาน</button><button type="button" className="btn ghost" onClick={() => setClosing(null)}>ยกเลิก</button></div>
                </div>
              ) : <div><button type="button" className="btn small" onClick={() => { setClosing(x.id); setResolution(""); }}>บันทึกผลและปิด</button></div>}
          </li>))}</ul>
      )}
    </section>
  );
}

function Coverage() {
  const c = useLoad<{ topics: { code: string; name: string; subs: { code: string; name: string; approved: number; review: number; draft: number }[] }[] }>(() => get("/api/faculty/coverage"), []);
  if (!c.data) return <Loading error={c.error} />;
  const cls = (n: number) => (n === 0 ? "c0" : n < 5 ? "c1" : "c2");
  return (
    <section className="panel stack">
      <div><h2 style={{ fontSize: 16 }}>ความครอบคลุมของคลังข้อสอบ</h2><p className="small muted" style={{ margin: "2px 0 0" }}>จำนวนข้อที่อนุมัติแล้วต่อ subtopic · แดง = ยังไม่มี · เหลือง = น้อยกว่า 5 ข้อ</p></div>
      <div className="tbl-wrap"><table className="tbl heat">
        <thead><tr><th>Topic</th><th>Subtopic</th><th>Approved</th><th>รอรีวิว</th><th>Draft</th></tr></thead>
        <tbody>{c.data.topics.flatMap((t) => t.subs.map((s, i) => (
          <tr key={s.code}>
            {i === 0 && <td rowSpan={t.subs.length}><span className="code">{t.code}</span> <span className="small">{t.name}</span></td>}
            <td className="small">{subName(s.code)}</td>
            <td className={`cell ${cls(s.approved)}`}>{s.approved}</td>
            <td className="cell">{s.review || ""}</td>
            <td className="cell">{s.draft || ""}</td>
          </tr>)))}</tbody>
      </table></div>
    </section>
  );
}
