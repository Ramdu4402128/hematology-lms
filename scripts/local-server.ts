/**
 * Runs the whole app locally WITHOUT Netlify: the same API handler on an embedded Postgres (PGlite),
 * plus the built frontend from dist/. For trying the app or demoing it offline.
 *
 *   npm run build && npm run local            # data kept in .local-db/
 *   LOCAL_DB=memory npm run local             # throwaway in-memory database
 *
 * For real deployments use `netlify dev` / Netlify Database instead.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { handle } from "../server/app";
import { openPGlite } from "../server/db-pglite";

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const SESSION_SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
const SETUP_TOKEN = process.env.SETUP_TOKEN ?? "local-setup";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const { db } = await openPGlite(process.env.LOCAL_DB === "memory" ? undefined : join(ROOT, ".local-db"));
const ctx = { db, env: { SESSION_SECRET, SETUP_TOKEN }, now: () => new Date() };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await handle(new Request(url, {
        method: req.method, headers: req.headers as Record<string, string>,
        body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
      }), ctx);
      res.statusCode = r.status;
      r.headers.forEach((v, k) => { if (k !== "set-cookie") res.setHeader(k, v); });
      const cookies = r.headers.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = normalize(join(DIST, url.pathname));
    const isFile = (f: string) => { try { return statSync(f).isFile(); } catch { return false; } };
    if (!file.startsWith(DIST) || !isFile(file)) file = join(DIST, "index.html");
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("error");
  }
}).listen(PORT, () => {
  console.log(`Hematology LMS (local) → http://localhost:${PORT}`);
  console.log(`First run: open the page and use setup token "${SETUP_TOKEN}"`);
});
