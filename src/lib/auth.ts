/**
 * Signed-in user, roles & permissions, impersonation, the activity log and password resets.
 * (Port of auth.php — same rules and messages.)
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { auditLog, passwordResets, roles, users } from "@/db/schema";
import {
  ADMIN_RESET_TOKEN_HOURS,
  ALL_PERMISSIONS,
  IMPERSONATE_SECONDS,
  RESET_TOKEN_MINUTES,
  cleanPermissions,
  env,
  eventCategory,
  type Permission,
} from "./config";
import { clearSession, rotateSession, requestOrigin, type Ctx, type Impersonation } from "./context";
import { hashPassword, randomToken, sha256Hex } from "./crypto";
import { userRowColumns, type UserRow } from "./user-row";
import { cut } from "./format";

export interface CurrentUser {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  isSuper: boolean;
  perms: Permission[];
  mustChange: boolean;
  impersonation: null | {
    mode: "user" | "role";
    adminName: string;
    admin: string;
    roleName: string;
    secondsLeft: number;
  };
}

const now = () => Math.floor(Date.now() / 1000);

export async function loadUserRow(exec: Exec, id: number): Promise<UserRow | null> {
  const [u] = await exec
    .select(userRowColumns)
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, id))
    .limit(1);
  return u ?? null;
}

export async function loadRoleRow(exec: Exec, id: number) {
  const [r] = await exec
    .select({ id: roles.id, name: roles.name, permissions: roles.permissions, isSuper: roles.isSuper })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  return (r ?? null) as typeof r | null;
}

/**
 * The signed-in user, re-read from the database on every request so that role changes,
 * deactivation and password resets take effect immediately. Null if not signed in.
 */
export async function currentUser(ctx: Ctx): Promise<CurrentUser | null> {
  if (ctx.user !== undefined) return ctx.user;
  ctx.user = null;
  const s = ctx.session.data;
  if (!s.uid) return null;

  // While a Super Admin is viewing as someone else, check the admin is still allowed to.
  const imp = s.imp ?? null;
  if (imp) {
    const why = await impersonationProblem(ctx, imp);
    if (why === "admin") {
      clearSession(ctx);
      ctx.session.data.flash = "signed_out";
      ctx.user = null;
      return null;
    }
    if (why !== "") {
      await endImpersonation(ctx, why);
      return currentUser(ctx);
    }
  }

  // Usually already read together with the session (see createCtx).
  const pre = ctx.prefetched;
  const u = pre && pre.uid === s.uid ? pre.row : await loadUserRow(ctx.db, s.uid);
  const epoch = s.epoch ?? -1;
  if (!u || !u.isActive || !u.roleId || u.sessionEpoch !== epoch) {
    if (imp) {
      await endImpersonation(ctx, "The account you were viewing changed.");
      return currentUser(ctx);
    }
    clearSession(ctx);
    ctx.session.data.flash = u && !u.isActive ? "disabled" : "signed_out";
    ctx.user = null;
    return null;
  }
  const isSuper = !!u.isSuper;
  const me: CurrentUser = {
    id: u.id,
    username: u.username,
    name: u.fullName !== "" ? u.fullName : u.username,
    email: u.email ?? "",
    role: u.roleName ?? "",
    isSuper,
    perms: isSuper ? [...ALL_PERMISSIONS] : cleanPermissions(u.permissions),
    mustChange: u.mustChangePw,
    impersonation: null,
  };
  if (imp) {
    if (imp.mode === "role") {
      // The admin keeps their identity but gets only this role's permissions.
      const r = await loadRoleRow(ctx.db, imp.target);
      me.role = r?.name ?? "";
      me.isSuper = false;
      me.perms = cleanPermissions(r?.permissions);
    }
    me.mustChange = false; // the admin is only looking; don't push them into a password change
    me.impersonation = {
      mode: imp.mode,
      adminName: imp.admin_name,
      admin: imp.admin_username,
      roleName: me.role,
      secondsLeft: Math.max(0, IMPERSONATE_SECONDS - (now() - imp.started)),
    };
  }
  ctx.user = me;
  return me;
}

export function can(user: CurrentUser | null, perm: Permission | "users.manage"): boolean {
  if (!user) return false;
  if (perm === "users.manage") return user.isSuper;
  return user.isSuper || user.perms.includes(perm);
}

/** Public view of the user for the page's JavaScript. */
export function userForClient(u: CurrentUser) {
  return {
    username: u.username, name: u.name, email: u.email, role: u.role, isSuper: u.isSuper,
    perms: u.perms, mustChange: u.mustChange, impersonation: u.impersonation,
  };
}

/** Why an impersonation ended on its own (shown once), or "". */
export function takeImpNotice(ctx: Ctx): string {
  const n = ctx.session.data.imp_notice ?? "";
  if (n) {
    delete ctx.session.data.imp_notice;
    ctx.session.touch();
  }
  return n;
}

/** The signed-in user as JSON for a page (safe inside a <script> tag). */
export function userJson(ctx: Ctx, u: CurrentUser): string {
  return JSON.stringify({ ...userForClient(u), notice: takeImpNotice(ctx) })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/* ======================= Impersonation (Super Admin only) =======================
 * 'user' — the session switches to another person's account.
 * 'role' — the admin stays themselves but gets only the chosen role's permissions.
 * Ends automatically after IMPERSONATE_SECONDS, or as soon as the admin, the person or the role
 * no longer qualifies. Every action taken meanwhile is logged with "via <admin>".
 */

/** "" if it may continue; "admin" if the admin lost access; otherwise a reason to end it. */
async function impersonationProblem(ctx: Ctx, imp: Impersonation): Promise<string> {
  const a = await loadUserRow(ctx.db, imp.admin_uid);
  if (!a || !a.isActive || !a.isSuper || a.sessionEpoch !== imp.admin_epoch) return "admin";
  if (now() - imp.started > IMPERSONATE_SECONDS) return `Time limit reached (${Math.max(1, Math.ceil(IMPERSONATE_SECONDS / 60))} min).`;
  if (imp.mode === "user") {
    const t = await loadUserRow(ctx.db, imp.target);
    if (!t || !t.isActive) return "That account was deactivated or deleted.";
    if (t.isSuper) return "That account became a Super Admin.";
  } else {
    const r = await loadRoleRow(ctx.db, imp.target);
    if (!r || r.isSuper) return "That role was deleted or changed.";
  }
  return "";
}

/** Start viewing as a user or with a role's permissions. Returns an error or "". */
export async function startImpersonation(ctx: Ctx, admin: CurrentUser, mode: string, targetId: number, reason: string): Promise<string> {
  const s = ctx.session.data;
  if (!admin.isSuper || s.imp) return "Only a Super Admin can do this.";
  let label = "";
  let target: Awaited<ReturnType<typeof loadUserRow>> = null;
  if (mode === "user") {
    target = await loadUserRow(ctx.db, targetId);
    if (!target) return "User not found.";
    if (target.id === admin.id) return "You can't view as yourself.";
    if (!target.isActive) return "This account is deactivated. Activate it first.";
    if (target.isSuper) return "Super Admin accounts can't be impersonated.";
    label = target.username;
  } else if (mode === "role") {
    const r = await loadRoleRow(ctx.db, targetId);
    if (!r) return "Role not found.";
    if (r.isSuper) return "You already have every Super Admin permission.";
    label = "role: " + r.name;
  } else {
    return "Unknown mode.";
  }
  const imp: Impersonation = {
    mode, target: targetId, started: now(), reason,
    admin_uid: admin.id, admin_epoch: s.epoch ?? 0, admin_login_at: s.login_at ?? now(),
    admin_username: admin.username, admin_name: admin.name, label,
  };
  // Logged before switching, so the entry is the admin's own action.
  await audit(ctx, {
    event: "impersonation_started",
    detail: (mode === "user" ? "Viewing as user" : "Previewing role") + (reason !== "" ? " · reason: " + reason : ""),
    actorId: admin.id, actorName: admin.username, target: label,
  });
  rotateSession(ctx);
  s.imp = imp;
  if (mode === "user" && target) {
    s.uid = target.id;
    s.epoch = target.sessionEpoch;
  }
  ctx.user = undefined;
  return "";
}

/** Return to the admin's own account. `why` explains an automatic end (shown once, and logged). */
export async function endImpersonation(ctx: Ctx, why = "") {
  const s = ctx.session.data;
  const imp = s.imp;
  if (!imp) return;
  delete s.imp;
  rotateSession(ctx);
  s.uid = imp.admin_uid;
  s.epoch = imp.admin_epoch;
  s.login_at = imp.admin_login_at;
  if (why !== "") s.imp_notice = why;
  ctx.user = undefined;
  await audit(ctx, {
    event: "impersonation_ended",
    detail: (why !== "" ? why : "Returned to own account") + " · lasted " + Math.max(1, Math.round((now() - imp.started) / 60)) + " min",
    actorId: imp.admin_uid, actorName: imp.admin_username, target: imp.label,
  });
}

export const isImpersonating = (ctx: Ctx) => !!ctx.session.data.imp;

/* ============================== Sessions ============================== */

export async function logInUser(ctx: Ctx, id: number) {
  const [u] = await ctx.db
    .update(users)
    .set({ lastLogin: new Date(), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, id))
    .returning({ epoch: users.sessionEpoch });
  rotateSession(ctx); // prevent session fixation
  ctx.prefetched = undefined;
  ctx.session.data = { uid: id, epoch: u?.epoch ?? 1, last_seen: now(), login_at: now() };
  ctx.user = undefined;
}

/** Sign out every session of a user. With keepCurrent, the caller's own session stays signed in. */
export async function bumpSessionEpoch(ctx: Ctx, exec: Exec, userId: number, keepCurrent = false) {
  const [u] = await exec
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(eq(users.id, userId))
    .returning({ epoch: users.sessionEpoch });
  if (ctx.prefetched?.uid === userId) ctx.prefetched = undefined; // it now has an old epoch
  if (keepCurrent && ctx.session.data.uid === userId && u) {
    ctx.session.data.epoch = u.epoch;
    rotateSession(ctx);
  }
}

/* ============================ Activity log ============================ */

export interface AuditEntry {
  event: string;
  detail?: string;
  actorId?: number | null;
  actorName?: string;
  target?: string;
  changes?: [string, string, string][] | null;
}

/** Build an activity-log row (lets bulk actions insert many at once). */
export function auditRow(ctx: Ctx, e: AuditEntry): typeof auditLog.$inferInsert {
  // While impersonating, record the Super Admin who really acted.
  const imp = ctx.session.data.imp;
  const via = imp ? (imp.mode === "role" ? "role preview by " + imp.admin_username : imp.admin_username) : "";
  return {
    userId: e.actorId ?? null,
    username: cut(e.actorName ?? "", 50),
    via: cut(via, 80),
    event: e.event,
    category: eventCategory(e.event),
    detail: cut(e.detail ?? "", 500),
    target: cut(e.target ?? "", 190),
    changes: e.changes && e.changes.length ? e.changes : null,
    ip: ctx.ip,
  };
}

/**
 * Record an activity. Pass a transaction as `exec` to roll the entry back with the change it
 * describes; outside a transaction a logging failure never breaks the action itself.
 */
export async function audit(ctx: Ctx, e: AuditEntry, exec?: Exec) {
  if (exec) {
    await exec.insert(auditLog).values(auditRow(ctx, e));
    return;
  }
  try {
    await ctx.db.insert(auditLog).values(auditRow(ctx, e));
  } catch (err) {
    console.error("audit failed:", err);
  }
}

/* =========================== Password resets =========================== */

/** Create a single-use reset token. Older unused links for the user stop working. */
export async function createResetToken(ctx: Ctx, exec: Exec, userId: number, viaAdmin: boolean) {
  const token = randomToken();
  await exec.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  const minutes = viaAdmin ? ADMIN_RESET_TOKEN_HOURS * 60 : RESET_TOKEN_MINUTES;
  const [row] = await exec
    .insert(passwordResets)
    .values({
      userId, tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + minutes * 60_000),
      viaAdmin, requestedIp: ctx.ip, dismissed: viaAdmin,
    })
    .returning({ id: passwordResets.id });
  return { token, id: row.id, minutes };
}

/** Look up a reset token: the reset + user if it's valid, otherwise null. */
export async function findResetToken(exec: Exec, token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [r] = await exec
    .select({ resetId: passwordResets.id, id: users.id, username: users.username, fullName: users.fullName, isActive: users.isActive })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, await sha256Hex(token)), isNull(passwordResets.usedAt), sql`${passwordResets.expiresAt} > now()`))
    .limit(1);
  return r && r.isActive ? r : null;
}

/** Set a user's password and sign out their other sessions. */
export async function setUserPassword(ctx: Ctx, exec: Exec, userId: number, password: string, mustChange: boolean, keepCurrent = false) {
  await exec
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePw: mustChange, pwChangedAt: new Date(), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, userId));
  await exec.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  await bumpSessionEpoch(ctx, exec, userId, keepCurrent);
}

/**
 * Full URL of a page in this app. For emails, the address the browser used is trusted only if
 * it's this machine (localhost); otherwise APP_URL must be set. This stops someone faking the
 * Host header to plant their own site in a reset email. Returns "" if no trusted URL exists.
 */
export function appUrl(ctx: Ctx, path: string, forEmail = false): string {
  const configured = env("APP_URL");
  if (configured) return configured.replace(/\/+$/, "") + path;
  if (forEmail) {
    const hostname = ctx.host.replace(/:\d+$/, "").toLowerCase();
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) return "";
  }
  return requestOrigin(ctx) + path;
}
