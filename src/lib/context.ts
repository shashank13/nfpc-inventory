/**
 * Per-request context: database, session, client IP and the address the browser used.
 *
 * Sessions are stored in the `sessions` table. The browser keeps only a random token in the
 * NFPC_SESSION cookie (HttpOnly, SameSite=Lax); the table stores its sha256, so a database leak
 * can't be replayed. This replaces PHP's file sessions and works on serverless hosts such as Vercel.
 */
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { roles, sessions, users } from "@/db/schema";
import { SESSION_IDLE_SECONDS, SESSION_MAX_SECONDS } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import type { CurrentUser } from "./auth";
import { userRowColumns, type UserRow } from "./user-row";

export const SESSION_COOKIE = "NFPC_SESSION";
const SESSION_ROW_HOURS = 24; // rows not used for a day are deleted (the idle limit is 8 h anyway)

export interface Impersonation {
  mode: "user" | "role";
  target: number;
  started: number;
  reason: string;
  admin_uid: number;
  admin_epoch: number;
  admin_login_at: number;
  admin_username: string;
  admin_name: string;
  label: string;
}

export interface SessionData {
  uid?: number;
  epoch?: number;
  last_seen?: number;
  login_at?: number;
  /** Code for a message on the sign-in page: timeout | disabled | signed_out */
  flash?: string;
  /** One-time message shown after a redirect: [type, text] */
  flash_msg?: [string, string];
  imp?: Impersonation;
  imp_notice?: string;
  reset_token?: string;
  /** What a server-rendered form showed last time (error text, typed values). */
  form?: Record<string, string | boolean>;
}

export class Session {
  data: SessionData = {};
  dirty = false;
  rotateRequested = false;
  destroyed = false;
  constructor(
    public id: string | null, // sha256 of the cookie token, when the row exists
    public existed: boolean,
  ) {}
  touch() {
    this.dirty = true;
  }
}

export interface Ctx {
  db: DB;
  session: Session;
  ip: string;
  host: string;
  https: boolean;
  /** Route handlers can set cookies; Server Component pages can't. */
  canSetCookies: boolean;
  /** Cached result of currentUser() (undefined = not looked up yet). */
  user?: CurrentUser | null;
  /** The session's user, read together with the session (saves a query per request). */
  prefetched?: { uid: number; row: UserRow | null };
}

const now = () => Math.floor(Date.now() / 1000);

function firstHeader(h: Headers, name: string) {
  return (h.get(name) ?? "").split(",")[0].trim();
}

export function clientIp(h: Headers): string {
  // Vercel overwrites these two with the visitor's real address.
  const ip = firstHeader(h, "x-real-ip") || firstHeader(h, "x-forwarded-for");
  return ip.replace(/^::ffff:/, "").slice(0, 45);
}

export async function createCtx(h: Headers, cookieToken: string | undefined, canSetCookies: boolean): Promise<Ctx> {
  const db = getDb();
  const host = firstHeader(h, "x-forwarded-host") || h.get("host") || "localhost";
  const proto = firstHeader(h, "x-forwarded-proto");
  const { session, prefetched } = await loadSession(db, cookieToken);
  const ctx: Ctx = {
    db,
    session,
    prefetched,
    ip: clientIp(h),
    host,
    https: proto === "https",
    canSetCookies,
  };
  startSession(ctx);
  return ctx;
}

/** The session and its signed-in user (with role), in one query. */
async function loadSession(db: DB, token: string | undefined): Promise<{ session: Session; prefetched?: Ctx["prefetched"] }> {
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const id = await sha256Hex(token);
    const [row] = await db
      .select({ data: sessions.data, user: userRowColumns })
      .from(sessions)
      .leftJoin(users, sql`${users.id} = (${sessions.data}->>'uid')::int`)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (row) {
      const s = new Session(id, true);
      s.data = (row.data ?? {}) as SessionData;
      const uid = s.data.uid;
      return { session: s, prefetched: uid ? { uid, row: row.user?.id === uid ? (row.user as UserRow) : null } : undefined };
    }
  }
  return { session: new Session(null, false) };
}

/** Idle / maximum-age checks (like PHP start_session()). */
function startSession(ctx: Ctx) {
  const s = ctx.session, d = s.data, t = now();
  const idle = d.last_seen !== undefined && t - d.last_seen > SESSION_IDLE_SECONDS;
  const tooOld = d.login_at !== undefined && t - d.login_at > SESSION_MAX_SECONDS;
  if (d.uid && (idle || tooOld)) {
    clearSession(ctx);
    s.data.flash = "timeout";
  }
  // Write "last seen" at most once a minute instead of on every request.
  if (s.data.last_seen === undefined || t - s.data.last_seen >= 60) {
    s.data.last_seen = t;
    s.touch();
  }
}

/** Forget the signed-in user but keep a usable session (for messages). */
export function clearSession(ctx: Ctx) {
  ctx.session.data = { last_seen: now() };
  rotateSession(ctx);
  ctx.user = undefined;
}

/** New cookie value (prevents session fixation). Only possible where cookies can be set. */
export function rotateSession(ctx: Ctx) {
  ctx.session.touch();
  if (ctx.canSetCookies) ctx.session.rotateRequested = true;
}

export function destroySession(ctx: Ctx) {
  ctx.session.destroyed = true;
  ctx.session.data = {};
  ctx.user = undefined;
}

function cookieHeader(ctx: Ctx, token: string | null): string {
  const base = `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax${ctx.https ? "; Secure" : ""}`;
  return token ? base : base + "; Max-Age=0";
}

/**
 * Save the session if it changed. Returns a Set-Cookie header value when the browser's cookie
 * must change (new / rotated / destroyed session), otherwise null.
 */
export async function persistSession(ctx: Ctx): Promise<string | null> {
  const s = ctx.session, db = ctx.db;
  if (s.destroyed) {
    if (s.id) await db.delete(sessions).where(eq(sessions.id, s.id));
    return ctx.canSetCookies ? cookieHeader(ctx, null) : null;
  }
  if (!s.dirty) return null;
  const expiresAt = new Date(Date.now() + SESSION_ROW_HOURS * 3600_000);
  const userId = s.data.uid ?? null;

  const needsNewRow = !s.existed || s.rotateRequested;
  if (needsNewRow) {
    if (!ctx.canSetCookies) return null; // a page can't hand out a new cookie; nothing to keep anyway
    // Don't create rows for visitors who have nothing worth remembering.
    const meaningful = Object.keys(s.data).some((k) => k !== "last_seen");
    if (!s.existed && !meaningful) return null;
    const token = randomToken();
    const id = await sha256Hex(token);
    if (s.id) await db.delete(sessions).where(eq(sessions.id, s.id));
    else await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); // tidy up old sessions
    await db.insert(sessions).values({ id, userId, data: s.data as Record<string, unknown>, expiresAt });
    s.id = id;
    s.existed = true;
    s.rotateRequested = false;
    s.dirty = false;
    return cookieHeader(ctx, token);
  }
  await db
    .update(sessions)
    .set({ data: s.data as Record<string, unknown>, userId, expiresAt })
    .where(eq(sessions.id, s.id!));
  s.dirty = false;
  return null;
}

/** Full URL of the app's own origin as the browser sees it. */
export function requestOrigin(ctx: Ctx) {
  return (ctx.https ? "https://" : "http://") + ctx.host;
}
