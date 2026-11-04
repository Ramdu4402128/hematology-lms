import { useEffect, useState } from "react";
import { get, post, patch } from "../api";
import { TOPICS, REPORT_REASONS } from "../../shared/taxonomy";
import type { AnswerResult, LearnerQuestion, Me, TopicMastery, Settings } from "../../shared/types";
import { ItemPreview, ItemTags, LabsTable, Loading, MasteryBars, Tabs, errText, useLoad, useToast, topicName, subName, ago, fmtDate, Field } from "../ui";

type MeX = Me & { leaderboardAlias: string | null };
interface Summary {
  settings: Settings; mastery: TopicMastery[]; subtopics: { code: string; n: number; c: number; pct: number }[]; overall: number | null;
  answeredItems: number; totalAttempts: number; poolSize: number; streak: number;
  notes: { id: string; body: string; author: string | null; at: string }[];
  leaderboard: { optedIn: boolean; cohortName?: string | null; windowDays?: number; participants?: number; entries?: { rank: number; name: string; activeDays: number; answered: number; isMe: boolean }[] };
}

export function LearnerApp({ me, setMe }: { me: MeX; setMe: (m: MeX) => void }) {
  const [tab, setTab] = useState<"practice" | "progress" | "history" | "settings">("practice");
  const summary = useLoad<Summary>(() => get("/api/learner/summary"), []);
  return (
    <>
      <Tabs label="ส่วนของผู้เรียน" value={tab} onChange={setTab} items={[
        { id: "practice", label: "ฝึกทำข้อสอบ" }, { id: "progress", label: "ความก้าวหน้า" },
        { id: "history", label: "ทบทวนข้อที่ทำแล้ว" }, { id: "settings", label: "ตั้งค่า" },
      ]} />
      {tab === "practice" && <Practice summary={summary.data} onAnswered={summary.reload} />}
      {tab === "progress" && (summary.data ? <Progress s={summary.data} /> : <Loading error={summary.error} />)}
      {tab === "history" && <History />}
      {tab === "settings" && <LearnerSettings me={me} setMe={(m) => { setMe(m); summary.reload(); }} />}
    </>
  );
}

function Practice({ summary, onAnswered }: { summary: Summary | null; onAnswered: () => void }) {
  const toast = useToast();
  const [topic, setTopic] = useState<string>(() => { try { return localStorage.getItem("hlms.topic") ?? "all"; } catch { return "all"; } });
  const [q, setQ] = useState<{ question: LearnerQuestion | null; mode: string; remainingNew?: number } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  async function load(skip = false, t = topic) {
    setBusy(true); setErr(null); setResult(null); setChoice(null); setReporting(false);
    try { setQ(await get(`/api/learner/next?${new URLSearchParams({ ...(t !== "all" ? { topic: t } : {}), ...(skip ? { skip: "1" } : {}) })}`)); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function pickTopic(t: string) {
    setTopic(t);
    try { localStorage.setItem("hlms.topic", t); } catch { /* ignore */ }
    load(true, t);
  }
  async function submit() {
    if (!q?.question || !choice) return;
    setBusy(true);
    try { setResult(await post("/api/learner/answer", { itemId: q.question.id, choice })); onAnswered(); }
    catch (e) { toast(errText(e)); load(); } finally { setBusy(false); }
  }

  const weakest = summary?.mastery.filter((m) => m.enough).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0];
  const question = q?.question;
  return (
    <div className="grid">
      <section className="panel stack" aria-labelledby="qh">
        <div className="row" role="group" aria-label="เลือก Topic">
          <button type="button" className="chip" aria-pressed={topic === "all"} onClick={() => pickTopic("all")}>ปรับตามจุดอ่อน</button>
          {TOPICS.map((t) => <button key={t.code} type="button" className="chip" aria-pressed={topic === t.code} onClick={() => pickTopic(t.code)} title={t.name}>{t.code}</button>)}
        </div>
        <h2 id="qh" className="sr-only">โจทย์</h2>
        {err ? <Loading error={err} /> : !q ? <Loading /> : !question ? (
          <div className="empty">{topic === "all" ? "ยังไม่มีโจทย์ที่อนุมัติในคลัง" : `ยังไม่มีโจทย์ที่อนุมัติใน ${topic} ${topicName(topic)}`}</div>
        ) : result ? (
          <>
            <div className={`result ${result.correct ? "ok" : "no"}`} role="status">
              <strong>{result.correct ? "ถูกต้อง" : `ยังไม่ถูก — คำตอบที่ดีที่สุดคือ ${result.correctKey}`}</strong>
            </div>
            <ItemPreview item={{ ...question, options: result.options, correctKey: result.correctKey, explanation: result.explanation, reference: result.reference }} choice={result.choice} />
            <div className="row-between">
              <button type="button" className="btn ghost" onClick={() => setReporting(!reporting)}>แจ้งปัญหาข้อนี้</button>
              <button type="button" className="btn primary" onClick={() => load()} disabled={busy}>ข้อต่อไป</button>
            </div>
            {reporting && <ReportForm itemId={question.id} onDone={() => setReporting(false)} />}
          </>
        ) : (
          <>
            <div className="row-between">
              <ItemTags topic={question.topic} subtopic={question.subtopic} level={question.level} />
              <span className="small muted">{q.mode === "review" ? "ทบทวนข้อที่เคยตอบผิด" : q.mode === "repeat" ? "ทำครบทุกข้อแล้ว — สุ่มทบทวน" : q.remainingNew != null ? `เหลือข้อใหม่ ${q.remainingNew} ข้อ` : ""}</span>
            </div>
            <p className="vignette">{question.vignette}</p>
            <LabsTable labs={question.labs} />
            <p className="lead" id="lead">{question.leadIn}</p>
            <ul className="opts" role="radiogroup" aria-labelledby="lead">
              {question.options.map((o) => (
                <li key={o.key}>
                  <button type="button" role="radio" aria-checked={choice === o.key} className="opt" onClick={() => setChoice(o.key)}
                    style={choice === o.key ? { borderColor: "var(--accent)", borderWidth: 2, background: "var(--accent-soft)" } : undefined}>
                    <span className="k">{o.key}</span><span>{o.text}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="row-between">
              <button type="button" className="btn ghost" onClick={() => load(true)} disabled={busy}>ข้ามข้อนี้</button>
              <button type="button" className="btn primary" onClick={submit} disabled={!choice || busy}>ส่งคำตอบ</button>
            </div>
          </>
        )}
      </section>
      <aside className="stack">
        <section className="panel stack" aria-labelledby="mh">
          <div>
            <h2 id="mh" style={{ fontSize: 16 }}>Mastery ราย Topic</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>นับคำตอบล่าสุดของแต่ละข้อ · ต้องตอบอย่างน้อย {summary?.settings.minAnswersPerTopic ?? 2} ข้อต่อ Topic</p>
          </div>
          {summary ? <MasteryBars mastery={summary.mastery} low={summary.settings.lowMastery} /> : <Loading />}
          {weakest && topic !== weakest.code && (
            <p className="small" style={{ margin: 0 }}>ควรเสริม: <strong>{weakest.code} {topicName(weakest.code)}</strong>{" "}
              <button type="button" className="btn ghost small" onClick={() => pickTopic(weakest.code)}>ฝึก Topic นี้</button></p>
          )}
        </section>
        {summary && (
          <section className="panel">
            <dl className="kv">
              <dt>ทำแล้ว</dt><dd className="mono">{summary.answeredItems} / {summary.poolSize} ข้อ</dd>
              <dt>ความถูกต้องรวม</dt><dd className="mono">{summary.overall == null ? "—" : `${summary.overall}%`}</dd>
              <dt>ต่อเนื่อง</dt><dd className="mono">{summary.streak} วัน</dd>
            </dl>
          </section>
        )}
      </aside>
    </div>
  );
}

function ReportForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("wrong_key");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await post(`/api/learner/items/${itemId}/report`, { reason, detail }); toast("ส่งรายงานแล้ว อาจารย์รายวิชาจะตรวจสอบ"); onDone(); }
    catch (e) { toast(errText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="note stack">
      <Field label="ปัญหาที่พบ">
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="รายละเอียด (ไม่ระบุชื่อผู้รายงานให้อาจารย์เห็น)"><textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} /></Field>
      <div className="row"><button type="button" className="btn ink" onClick={send} disabled={busy}>ส่งรายงาน</button><button type="button" className="btn ghost" onClick={onDone}>ยกเลิก</button></div>
    </div>
  );
}

function Progress({ s }: { s: Summary }) {
  const weakSubs = [...s.subtopics].filter((x) => x.n >= 1).sort((a, b) => a.pct - b.pct).slice(0, 6);
  const lb = s.leaderboard;
  return (
    <div className="grid">
      <div className="stack">
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>Mastery ราย Topic</h2>
          <MasteryBars mastery={s.mastery} low={s.settings.lowMastery} />
        </section>
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>Subtopic ที่ควรทบทวน</h2>
          {weakSubs.length ? (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Subtopic</th><th>ถูก</th><th>ข้อ</th></tr></thead>
              <tbody>{weakSubs.map((x) => <tr key={x.code}><td>{subName(x.code)}</td><td className="mono">{x.pct}%</td><td className="mono">{x.n}</td></tr>)}</tbody></table></div>
          ) : <p className="muted small" style={{ margin: 0 }}>ยังไม่มีข้อมูล</p>}
        </section>
      </div>
      <aside className="stack">
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>ข้อเสนอแนะจากอาจารย์ผู้ดูแล</h2>
          {s.notes.length ? <ul className="list-plain">{s.notes.map((n) => (
            <li key={n.id} className="note"><div className="meta"><span>{n.author ?? "อาจารย์"}</span><span>{fmtDate(n.at)}</span></div><p style={{ margin: "4px 0 0" }}>{n.body}</p></li>
          ))}</ul> : <p className="muted small" style={{ margin: 0 }}>ยังไม่มีข้อเสนอแนะ</p>}
        </section>
        <section className="panel stack">
          <h2 style={{ fontSize: 16 }}>ความสม่ำเสมอในรุ่น</h2>
          {!lb.optedIn ? <p className="small muted" style={{ margin: 0 }}>ไม่ได้เข้าร่วม — เปิดได้ที่แท็บ “ตั้งค่า” จะเห็นเฉพาะเพื่อนร่วมรุ่นที่เลือกเข้าร่วมเช่นกัน</p>
            : !lb.cohortName ? <p className="small muted" style={{ margin: 0 }}>คุณยังไม่ได้อยู่ในรุ่นใด</p>
            : (
              <>
                <p className="small muted" style={{ margin: 0 }}>{lb.cohortName} · ผู้เข้าร่วม {lb.participants} คน · นับวันที่ฝึกใน {lb.windowDays} วันล่าสุด ไม่ใช่คะแนน</p>
                {lb.entries?.length ? <ol className="list-plain">{lb.entries.map((e) => (
                  <li key={e.rank + e.name} className="row-between" style={e.isMe ? { fontWeight: 600 } : undefined}>
                    <span><span className="mono">{e.rank}.</span> {e.name}{e.isMe ? " (คุณ)" : ""}</span><span className="mono small">{e.activeDays} วัน · {e.answered} ข้อ</span>
                  </li>))}</ol> : <p className="small muted" style={{ margin: 0 }}>ยังไม่มีผู้เข้าร่วมที่ฝึกในช่วงนี้</p>}
              </>
            )}
        </section>
      </aside>
    </div>
  );
}

function History() {
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [open, setOpen] = useState<string | null>(null);
  const h = useLoad<{ rows: { itemId: string; topic: string; subtopic: string; leadIn: string; correct: boolean; choice: string; tries: number; at: string }[] }>(
    () => get(`/api/learner/history${filter === "wrong" ? "?filter=wrong" : ""}`), [filter]);
  const detail = useLoad<any>(() => (open ? get(`/api/learner/items/${open}`) : Promise.resolve(null)), [open]);
  return (
    <div className="grid">
      <section className="panel stack">
        <div className="row" role="group" aria-label="ตัวกรอง">
          <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>ทั้งหมด</button>
          <button type="button" className="chip" aria-pressed={filter === "wrong"} onClick={() => setFilter("wrong")}>เฉพาะที่ตอบผิดล่าสุด</button>
        </div>
        {!h.data ? <Loading error={h.error} /> : !h.data.rows.length ? <div className="empty">ยังไม่มีข้อที่ทำ</div> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>ข้อ</th><th>Topic</th><th>คำถาม</th><th>ผลล่าสุด</th><th>เมื่อ</th></tr></thead>
            <tbody>{h.data.rows.map((r) => (
              <tr key={r.itemId} className={open === r.itemId ? "sel" : ""}>
                <td><button type="button" className="linkbtn mono" onClick={() => setOpen(r.itemId)}>{r.itemId}</button></td>
                <td><span className="code">{r.topic}</span></td>
                <td className="small">{r.leadIn}</td>
                <td>{r.correct ? <span className="pill st-approved">ถูก</span> : <span className="pill st-review">ผิด</span>}{r.tries > 1 && <span className="small muted"> · {r.tries} ครั้ง</span>}</td>
                <td className="small muted">{ago(r.at)}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>
      <aside className="panel stack">
        {!open ? <p className="muted small" style={{ margin: 0 }}>เลือกข้อเพื่อดูเฉลยและคำอธิบาย</p> : !detail.data ? <Loading error={detail.error} /> : (
          <>
            <ItemPreview item={detail.data.item} choice={detail.data.attempts[0]?.choice} />
            {detail.data.item.status === "retired" && <p className="small muted">ข้อนี้ถูกถอนออกจากคลังแล้ว</p>}
          </>
        )}
      </aside>
    </div>
  );
}

function LearnerSettings({ me, setMe }: { me: MeX; setMe: (m: MeX) => void }) {
  const toast = useToast();
  const [optIn, setOptIn] = useState(me.leaderboardOptIn);
  const [alias, setAlias] = useState(me.leaderboardAlias ?? "");
  async function save() {
    try { setMe((await patch<{ me: MeX }>("/api/me/preferences", { leaderboardOptIn: optIn, leaderboardAlias: alias })).me); toast("บันทึกแล้ว"); }
    catch (e) { toast(errText(e)); }
  }
  return (
    <section className="panel stack" style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18 }}>ตารางความสม่ำเสมอในรุ่น (สมัครใจ)</h2>
      <p className="small muted" style={{ margin: 0 }}>เมื่อเข้าร่วม ระบบจะเรียงจำนวนวันที่ฝึกใน 28 วันล่าสุด (ไม่ใช่คะแนน) เทียบกับเพื่อนร่วมรุ่นที่เข้าร่วมเท่านั้น อาจารย์ไม่เห็นตารางนี้</p>
      <label className="check"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> เข้าร่วมตารางความสม่ำเสมอในรุ่น</label>
      <Field label="ชื่อที่แสดงในตาราง (เว้นว่างเพื่อใช้ชื่อจริง)"><input type="text" maxLength={40} value={alias} onChange={(e) => setAlias(e.target.value)} disabled={!optIn} /></Field>
      <div><button type="button" className="btn primary" onClick={save}>บันทึก</button></div>
    </section>
  );
}
