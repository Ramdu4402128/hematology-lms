import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

export const bad = (code: string, message?: string) => new HttpError(400, code, message);
export const forbidden = (code = "forbidden", message?: string) => new HttpError(403, code, message);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);

export function json(body: unknown, status = 200, headers: Record<string, string> | Headers = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export async function readBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw bad("invalid_json", "ส่งข้อมูลไม่ถูกรูปแบบ"); }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw bad("invalid_input", first ? `${first.path.join(".") || "body"}: ${first.message}` : "ข้อมูลไม่ถูกต้อง");
  }
  return r.data as z.output<S>;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
