import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Db } from "./db";
import { one } from "./db";
import { parseCookies } from "./http";
import type { Role } from "../shared/taxonomy";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(pw: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(pw, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, +n, +r, +p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash that never matches, used to keep login timing uniform for unknown e-mails. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

/** Readable one-time password, e.g. "kq7m-x2pf-9tah". Unambiguous characters only. */
export function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars: string[] = [];
  while (chars.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < 248 && chars.length < 12) chars.push(alphabet[b % alphabet.length]); // 248 = 8 * 31, avoids modulo bias
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

export const PASSWORD_MIN = 10;
export const COOKIE = "hlms_session";
const SESSION_HOURS = 12;
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

function secretKey(secret: string): Uint8Array {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

export async function issueSession(userId: string, sessionVersion: number, secret: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_HOURS * 3600)
    .sign(secretKey(secret));
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
}
export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  mustChangePassword: boolean;
  leaderboardOptIn: boolean;
  leaderboardAlias: string | null;
  sessionVersion: number;
  active: boolean;
}

interface UserRow {
  id: string; email: string; display_name: string; must_change_password: boolean; active: boolean;
  leaderboard_opt_in: boolean; leaderboard_alias: string | null; session_version: number; roles: Role[] | null;
}

export async function loadUser(db: Db, id: string): Promise<AuthUser | null> {
  const u = await one<UserRow>(db,
    `SELECT u.id, u.email, u.display_name, u.must_change_password, u.active, u.leaderboard_opt_in, u.leaderboard_alias,
            u.session_version,
            COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE u.id = $1 GROUP BY u.id`, [id]);
  if (!u) return null;
  return {
    id: u.id, email: u.email, displayName: u.display_name, roles: u.roles ?? [], mustChangePassword: u.must_change_password,
    leaderboardOptIn: u.leaderboard_opt_in, leaderboardAlias: u.leaderboard_alias, sessionVersion: u.session_version, active: u.active,
  };
}

export async function authenticate(req: Request, db: Db, secret: string, now: Date): Promise<AuthUser | null> {
  const token = parseCookies(req.headers.get("cookie"))[COOKIE];
  if (!token) return null;
  let sub: string | undefined, sv: unknown;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"], currentDate: now });
    sub = payload.sub; sv = payload.sv;
  } catch {
    return null;
  }
  if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) return null;
  const u = await loadUser(db, sub);
  if (!u || !u.active || u.sessionVersion !== sv) return null;
  return u;
}

export const publicMe = (u: AuthUser) => ({
  id: u.id, email: u.email, displayName: u.displayName, roles: u.roles, mustChangePassword: u.mustChangePassword,
  leaderboardOptIn: u.leaderboardOptIn, leaderboardAlias: u.leaderboardAlias,
});
