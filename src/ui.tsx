import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { SUBNAME, TOPICS, STATUS_LABEL } from "../shared/taxonomy";
import type { Lab, TopicMastery } from "../shared/types";
import { ApiError } from "./api";

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite" hidden={!msg}>{msg}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");

/* ---------- data loading ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then((d) => live && setData(d)).catch((e) => live && setError(errText(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

export function Loading({ error, label = "กำลังโหลด…" }: { error?: string | null; label?: string }) {
  return error ? <div className="empty" role="alert">{error}</div> : <div className="empty">{label}</div>;
}

/* ---------- formatting ---------- */
export const topicName = (code: string) => TOPICS.find((t) => t.code === code)?.name ?? code;
export const subName = (code: string) => SUBNAME[code] ?? code;
export function ago(iso: string | null | undefined) {
  if (!iso) return "ยังไม่เคย";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "วันนี้";
  if (d === 1) return "เมื่อวาน";
  return `${d} วันก่อน`;
}
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill st-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}

/* ---------- item rendering ---------- */
export function LabsTable({ labs }: { labs: Lab[] }) {
  if (!labs?.length) return null;
  return (
    <div className="labs-wrap">
      <table className="labs">
        <tbody>
          {labs.map((l, i) => {
            const cls = l.flag === "สูง" ? "hi" : l.flag === "ต่ำ" ? "lo" : "";
            const arrow = l.flag === "สูง" ? " ↑" : l.flag === "ต่ำ" ? " ↓" : "";
            return (
              <tr key={i}>
                <th scope="row">{l.test}</th>
                <td className={`v ${cls}`}>{l.value}{arrow}<span className="sr-only">{l.flag !== "ปกติ" ? ` (${l.flag})` : ""}</span></td>
                <td className="muted small">{l.unit}</td>
                <td className="muted small mono">{l.range}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ItemTags({ topic, subtopic, level, id }: { topic: string; subtopic: string; level: string; id?: string }) {
  return (
    <div className="row small muted">
      <span className="code">{topic}</span>
      <span>{subName(subtopic)}</span>
      <span aria-hidden="true">·</span>
      <span>{level}</span>
      {id && <><span aria-hidden="true">·</span><span className="mono">{id}</span></>}
    </div>
  );
}

/** Read-only full item with key and rationales (faculty preview, learner review after answering). */
export function ItemPreview({ item, choice }: { item: { topic: string; subtopic: string; level: string; id?: string; vignette: string; labs: Lab[]; leadIn: string; options: { key: string; text: string; rationale: string }[]; correctKey: string; explanation: string; reference: string }; choice?: string }) {
  return (
    <div className="stack">
      <ItemTags {...item} />
      <p className="vignette">{item.vignette || <span className="muted">(ยังไม่มี vignette)</span>}</p>
      <LabsTable labs={item.labs} />
      <p className="lead">{item.leadIn}</p>
      <ul className="opts">
        {item.options.map((o) => {
          const cls = o.key === item.correctKey ? "right" : o.key === choice ? "wrong" : "dim";
          return (
            <li key={o.key}>
              <div className={`opt ${cls}`}>
                <span className="k">{o.key}</span>
                <span>{o.text || <span className="muted">(ว่าง)</span>}
                  {o.key === item.correctKey && <span className="sr-only"> (คำตอบที่ถูก)</span>}
                  {o.rationale && <span className="why">{o.rationale}</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {item.explanation && <div className="note"><div className="eyebrow">คำอธิบาย</div><p style={{ margin: "4px 0 0" }}>{item.explanation}</p></div>}
      {item.reference && <p className="small muted" style={{ margin: 0 }}>อ้างอิง: {item.reference}</p>}
    </div>
  );
}

/* ---------- mastery ---------- */
export function MasteryBars({ mastery, low, median }: { mastery: TopicMastery[]; low: number; median?: Record<string, number | null> | null }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {mastery.map((m) => {
        const isLow = m.enough && m.pct != null && m.pct < low;
        return (
          <div key={m.code} className="mrow">
            <span className="code">{m.code}</span>
            <span className="small">{topicName(m.code)}</span>
            <span className="small mono">{m.enough ? `${m.pct}%` : m.n ? `${m.n} ข้อ` : "—"}</span>
            <div className={`mbar${m.enough ? "" : " none"}`} role="img"
              aria-label={m.enough ? `${m.code} ${m.pct}% จาก ${m.n} ข้อ${median?.[m.code] != null ? ` ค่ากลางกลุ่ม ${median[m.code]}%` : ""}` : `${m.code} ข้อมูลยังไม่พอ (${m.n} ข้อ)`}>
              {m.enough && <span className={isLow ? "low" : ""} style={{ width: `${m.pct}%` }} />}
              {median?.[m.code] != null && <i className="median" style={{ left: `${median[m.code]}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Label + control (+ optional hint wired through aria-describedby, so it doesn't become part of the label). */
export function Field({ label, children, hint }: { label: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }>; hint?: string }) {
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) })}
      {hint && <span id={`${id}-hint`} className="small muted">{hint}</span>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="eyebrow">{label}</div>
      <div className="stat-v mono">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/* ---------- public config (registration, disclaimer) ---------- */
export interface PublicConfig {
  registrationOpen: boolean; trialDays: number; disclaimer: { version: string; text: string }; schoolName: string;
  plus: string[]; free: string[]; learnerLevels: string[]; studyGoals: string[];
}
let configPromise: Promise<PublicConfig> | null = null;
export const loadConfig = (fresh = false) => {
  if (!configPromise || fresh) configPromise = fetch("/api/public/config", { credentials: "same-origin" }).then((r) => r.json());
  return configPromise;
};
export function usePublicConfig() {
  const [c, setC] = useState<PublicConfig | null>(null);
  useEffect(() => { loadConfig().then(setC).catch(() => {}); }, []);
  return c;
}

export function Disclaimer() {
  const c = usePublicConfig();
  if (!c?.disclaimer.text) return null;
  return <footer className="disclaimer" aria-label="ข้อความปฏิเสธความรับผิดชอบ"><strong>ข้อจำกัดความรับผิดชอบ:</strong> {c.disclaimer.text}</footer>;
}

export function PlusBadge({ plus }: { plus: boolean }) {
  return plus ? <span className="pill plus-pill">Plus</span> : <span className="pill st-draft">ฟรี</span>;
}
