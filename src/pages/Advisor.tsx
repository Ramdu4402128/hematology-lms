import { useState } from "react";
import { get, post, del } from "../api";
import { TOPICS } from "../../shared/taxonomy";
import type { Settings, TopicMastery } from "../../shared/types";
import { Field, Loading, MasteryBars, errText, useLoad, useToast, ago, fmtDate, subName } from "../ui";

interface LearnerRow { id: string; name: string; track: string; cohortId: string | null; cohortName: string | null; answered: number; overall: number | null; lastActive: string | null; mastery: TopicMastery[]; flags: string[] }

export function AdvisorApp() {
  const list = useLoad<{ settings: Settings; medians: Record<string, Record<string, number | null>>; learners: LearnerRow[] }>(() => get("/api/advisor/learners"), []);
  const [sel, setSel] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  if (!list.data) return <Loading error={list.error} />;
  const { learners, settings } = list.data;
  const shown = onlyFlagged ? learners.filter((l) => l.flags.length) : learners;
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row-between">
          <div><h2 style={{ fontSize: 16 }}>ผู้เรียนในความดูแล ({learners.length})</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>ธงเสี่ยง: Topic ต่ำกว่า {settings.lowMastery}% (หลังตอบ ≥ {settings.minAnswersPerTopic} ข้อ) · ไม่เข้าใช้เกิน {settings.inactiveDays} วัน</p></div>
          <label className="check"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> เฉพาะที่มีธง ({learners.filter((l) => l.flags.length).length})</label>
        </div>
        {!learners.length ? <div className="empty">ยังไม่มีผู้เรียนที่มอบหมายให้คุณ — ติดต่อผู้ดูแลระบบของโรงเรียนแพทย์</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>ผู้เรียน</th>{TOPICS.map((t) => <th key={t.code} title={t.name}>{t.code}</th>)}<th>รวม</th><th>ข้อ</th><th>ล่าสุด</th><th>ธง</th></tr></thead>
            <tbody>{shown.map((l) => (
              <tr key={l.id} className={sel === l.id ? "sel" : ""}>
                <td><button type="button" className="linkbtn" onClick={() => setSel(l.id)}>{l.name}</button><div className="small muted">{l.track}</div></td>
                {l.mastery.map((m) => {
                  const low = m.enough && m.pct != null && m.pct < settings.lowMastery;
                  return <td key={m.code} className="mono small" style={low ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{m.enough ? `${m.pct}%` : <span className="muted">{m.n ? `(${m.n})` : "—"}</span>}</td>;
                })}
                <td className="mono small">{l.overall == null ? "—" : `${l.overall}%`}</td>
                <td className="mono small">{l.answered}</td>
                <td className="small">{ago(l.lastActive)}</td>
                <td>{l.flags.map((f) => <span key={f} className="flag">{f}</span>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {sel && <LearnerDetail key={sel} id={sel} onChange={list.reload} />}
    </div>
  );
}

function LearnerDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const toast = useToast();
  const d = useLoad<any>(() => get(`/api/advisor/learners/${id}`), [id]);
  const [vis, setVis] = useState<"learner" | "staff">("learner");
  const [body, setBody] = useState("");
  if (!d.data) return <Loading error={d.error} />;
  const x = d.data;
  async function addNote() {
    try { await post(`/api/advisor/learners/${id}/notes`, { visibility: vis, body }); setBody(""); toast(vis === "learner" ? "บันทึกแล้ว ผู้เรียนจะเห็นข้อความนี้" : "บันทึกภายในทีมแล้ว"); d.reload(); onChange(); }
    catch (e) { toast(errText(e)); }
  }
  const weak = [...x.subtopics].filter((s: any) => s.n >= 2).sort((a: any, b: any) => a.pct - b.pct).slice(0, 5);
  const maxDay = Math.max(1, ...x.activity.map((a: any) => a.n));
  const days = Array.from({ length: 28 }, (_, i) => {
    const dt = new Date(Date.now() + 7 * 3600_000 - (27 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: dt, n: x.activity.find((a: any) => a.day === dt)?.n ?? 0 };
  });
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" }}>
      <section className="panel stack">
        <div><h2 style={{ fontSize: 18 }}>{x.learner.name}</h2><p className="small muted" style={{ margin: 0 }}>{x.learner.track}{x.learner.cohortName ? ` · ${x.learner.cohortName}` : ""} · ทำแล้ว {x.answered} ข้อ · ล่าสุด {ago(x.lastActive)}</p></div>
        {x.flags.length > 0 && <div>{x.flags.map((f: string) => <span key={f} className="flag">{f}</span>)}</div>}
        <MasteryBars mastery={x.mastery} low={x.settings.lowMastery} median={x.cohortMedian} />
        <p className="small muted" style={{ margin: 0 }}>เส้นตั้งบนแถบ = ค่ากลางของรุ่น (เฉพาะผู้ที่ตอบครบเกณฑ์)</p>
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ fontSize: 15 }}>กิจกรรม 28 วันล่าสุด</h3>
          <div className="spark" role="img" aria-label={`ตอบรวม ${x.activity.reduce((a: number, b: any) => a + b.n, 0)} ข้อใน 28 วัน`}>
            {days.map((dd) => <span key={dd.day} title={`${dd.day}: ${dd.n} ข้อ`} style={{ height: `${(dd.n / maxDay) * 100}%`, opacity: dd.n ? 1 : 0.25 }} />)}
          </div>
        </div>
        {weak.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ fontSize: 15 }}>Subtopic ที่อ่อนที่สุด</h3>
            <ul className="list-plain small">{weak.map((s: any) => <li key={s.code} className="row-between"><span>{subName(s.code)}</span><span className="mono">{s.pct}% ({s.c}/{s.n})</span></li>)}</ul>
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ fontSize: 15 }}>คำตอบล่าสุด</h3>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>ข้อ</th><th>Subtopic</th><th>ตอบ</th><th>เมื่อ</th></tr></thead>
            <tbody>{x.recent.slice(0, 12).map((r: any, i: number) => (
              <tr key={i}><td className="mono small">{r.itemId}</td><td className="small">{subName(r.subtopic)}</td>
                <td className="mono small" style={{ color: r.correct ? "var(--good)" : "var(--bad)" }}>{r.choice}{r.correct ? " ✓" : ` ✕ (${r.correctKey})`}</td><td className="small muted">{ago(r.at)}</td></tr>))}</tbody></table></div>
        </div>
      </section>
      <section className="panel stack">
        <h2 style={{ fontSize: 16 }}>บันทึกและข้อเสนอแนะ</h2>
        <div className="row" role="group" aria-label="ผู้ที่เห็นบันทึก">
          <button type="button" className="chip" aria-pressed={vis === "learner"} onClick={() => setVis("learner")}>ผู้เรียนเห็น</button>
          <button type="button" className="chip" aria-pressed={vis === "staff"} onClick={() => setVis("staff")}>เฉพาะทีมอาจารย์</button>
        </div>
        <Field label={vis === "learner" ? "ข้อเสนอแนะถึงผู้เรียน" : "บันทึกภายใน (ผู้เรียนไม่เห็น)"}><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        <div><button type="button" className="btn primary" disabled={!body.trim()} onClick={addNote}>บันทึก</button></div>
        <ul className="list-plain">{x.notes.map((n: any) => (
          <li key={n.id} className="note">
            <div className="meta"><span>{n.visibility === "learner" ? "ผู้เรียนเห็น" : "เฉพาะทีม"}</span><span>{n.author}</span><span>{fmtDate(n.at)}</span>
              {n.mine && <button type="button" className="btn ghost small" style={{ minHeight: 0 }} onClick={async () => { if (!confirm("ลบบันทึกนี้?")) return; try { await del(`/api/advisor/notes/${n.id}`); d.reload(); } catch (e) { toast(errText(e)); } }}>ลบ</button>}</div>
            <p style={{ margin: "4px 0 0" }}>{n.body}</p>
          </li>))}</ul>
      </section>
    </div>
  );
}
