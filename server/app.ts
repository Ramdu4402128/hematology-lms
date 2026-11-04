import type { Ctx, Route } from "./context";
import { HttpError, json } from "./http";
import { authenticate } from "./auth";
import { authRoutes } from "./routes/auth";
import { setupRoutes } from "./routes/setup";
import { learnerRoutes } from "./routes/learner";
import { facultyRoutes } from "./routes/faculty";
import { advisorRoutes } from "./routes/advisor";
import { adminRoutes } from "./routes/admin";
import { membershipRoutes, membershipAdminRoutes } from "./routes/membership";
import { noteRoutes } from "./routes/notes";

const routes: Route[] = [...setupRoutes, ...authRoutes, ...membershipRoutes, ...learnerRoutes, ...facultyRoutes, ...advisorRoutes, ...adminRoutes, ...membershipAdminRoutes, ...noteRoutes];

interface Compiled { route: Route; re: RegExp; keys: string[] }
const compiled: Compiled[] = routes.map((route) => {
  const keys: string[] = [];
  const re = new RegExp("^" + route.path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { route, re, keys };
});

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Framework-free request handler; the Netlify function and the tests both call this. */
export async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  try {
    const matches = compiled.filter((c) => c.re.test(url.pathname));
    if (!matches.length) throw new HttpError(404, "not_found");
    const hit = matches.find((c) => c.route.method === req.method);
    if (!hit) throw new HttpError(405, "method_not_allowed");

    // CSRF: browsers can't send a custom header cross-site without a CORS preflight, which this API never grants.
    if (MUTATING.has(req.method) && req.headers.get("x-requested-with") !== "hlms") {
      throw new HttpError(403, "csrf", "Missing X-Requested-With header");
    }

    const m = hit.re.exec(url.pathname)!;
    const params = Object.fromEntries(hit.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (!ctx.env.SESSION_SECRET || ctx.env.SESSION_SECRET.length < 32) {
      throw new HttpError(500, "server_misconfigured", "ยังไม่ได้ตั้งค่า SESSION_SECRET (อย่างน้อย 32 ตัวอักษร) ใน Netlify environment variables");
    }
    const user = await authenticate(req, ctx.db, ctx.env.SESSION_SECRET, ctx.now());
    const { access } = hit.route;
    if (access !== "public") {
      if (!user) throw new HttpError(401, "unauthenticated", "กรุณาเข้าสู่ระบบ");
      if (user.mustChangePassword && !hit.route.duringPasswordChange) {
        throw new HttpError(403, "password_change_required", "กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน");
      }
      if (Array.isArray(access) && !access.some((r) => user.roles.includes(r))) throw new HttpError(403, "forbidden", "บทบาทของคุณเข้าถึงส่วนนี้ไม่ได้");
    }
    const cookies: string[] = [];
    const body = await hit.route.handler({ req, url, params, ctx, user: user!, cookies, secure });
    const headers = new Headers();
    for (const c of cookies) headers.append("set-cookie", c);
    return json(body, 200, headers);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    console.error("Unhandled API error", e);
    return json({ error: "internal", message: "เกิดข้อผิดพลาดในระบบ" }, 500);
  }
}
