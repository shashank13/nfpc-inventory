/** Users & roles (Super Admin only): accounts, roles, password resets, test email. */
import { and, asc, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Exec } from "@/db";
import { passwordResets, roles, sessions, users } from "@/db/schema";
import { appUrl, audit, bumpSessionEpoch, createResetToken, setUserPassword } from "../auth";
import { ADMIN_RESET_TOKEN_HOURS, ALL_PERMISSIONS, PERMISSIONS, cleanPermissions } from "../config";
import { generateTempPassword, hashPassword, passwordProblem } from "../crypto";
import { stamp, validEmail } from "../format";
import { mailEnabled, mailFrom, sendMail } from "../mail";
import { AppError, int, str, val, type ApiCtx } from "./common";
import { requirePerm } from "./inventory";

/* ------------------------------------------------------------- queries */

/** "Forgot password" requests that weren't emailed, so a Super Admin needs to act on them. */
const pendingResetWhere = and(
  eq(passwordResets.viaAdmin, false), eq(passwordResets.mailSent, false), eq(passwordResets.dismissed, false),
  isNull(passwordResets.usedAt), sql`${passwordResets.createdAt} > now() - interval '7 days'`,
);

export async function pendingResetCount(exec: Exec): Promise<number> {
  const [r] = await exec.select({ n: count() }).from(passwordResets).where(pendingResetWhere);
  return Number(r?.n ?? 0);
}

async function adminUsers(exec: Exec) {
  const creator = alias(users, "creator");
  const rows = await exec
    .select({
      id: users.id, username: users.username, fullName: users.fullName, email: users.email, roleId: users.roleId,
      isActive: users.isActive, mustChange: users.mustChangePw,
      locked: sql<boolean>`(${users.lockedUntil} is not null and ${users.lockedUntil} > now())`,
      lastLogin: users.lastLogin, createdAt: users.createdAt, pwChangedAt: users.pwChangedAt,
      roleName: roles.name, isSuper: roles.isSuper, createdBy: creator.username,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(creator, eq(creator.id, users.createdBy))
    .orderBy(desc(users.isActive), desc(roles.isSuper), asc(users.fullName), asc(users.username));
  return rows.map((r) => ({
    id: String(r.id), username: r.username, name: r.fullName, email: r.email ?? "", roleId: String(r.roleId),
    role: r.roleName ?? "", isSuper: !!r.isSuper, active: r.isActive, mustChange: r.mustChange, locked: !!r.locked,
    lastLogin: stamp(r.lastLogin), created: stamp(r.createdAt), pwChanged: stamp(r.pwChangedAt), createdBy: r.createdBy ?? "",
  }));
}

async function adminRoles(exec: Exec) {
  const rows = await exec
    .select({ id: roles.id, name: roles.name, description: roles.description, permissions: roles.permissions, isSuper: roles.isSuper, users: count(users.id) })
    .from(roles)
    .leftJoin(users, eq(users.roleId, roles.id))
    .groupBy(roles.id)
    .orderBy(desc(roles.isSuper), asc(roles.name));
  return rows.map((r) => ({
    id: String(r.id), name: r.name, description: r.description, isSuper: r.isSuper,
    perms: r.isSuper ? [...ALL_PERMISSIONS] : cleanPermissions(r.permissions), users: Number(r.users),
  }));
}

async function adminResets(exec: Exec) {
  const rows = await exec
    .select({
      id: passwordResets.id, createdAt: passwordResets.createdAt, ip: passwordResets.requestedIp,
      userId: users.id, username: users.username, fullName: users.fullName, email: users.email, isActive: users.isActive,
    })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(pendingResetWhere)
    .orderBy(desc(passwordResets.createdAt));
  return rows.map((r) => ({
    id: String(r.id), userId: String(r.userId), username: r.username, name: r.fullName, email: r.email ?? "",
    active: r.isActive, requested: stamp(r.createdAt), ip: r.ip,
  }));
}

async function payload(ctx: ApiCtx, extra: Record<string, unknown> = {}) {
  const [u, r, rs] = await Promise.all([adminUsers(ctx.db), adminRoles(ctx.db), adminResets(ctx.db)]);
  const permissions = Object.entries(PERMISSIONS).map(([key, p]) => ({ key, group: p.group, label: p.label, hint: p.hint }));
  return { ok: true, users: u, roles: r, resets: rs, permissions, mailEnabled: mailEnabled(), mailFrom: mailEnabled() ? mailFrom() : "", ...extra };
}

async function findUser(exec: Exec, id: number) {
  const [u] = await exec
    .select({ user: users, isSuper: roles.isSuper })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, id))
    .for("update", { of: users });
  if (!u) throw new AppError("User not found (they may have been deleted). Reload the page.");
  return { ...u.user, isSuper: !!u.isSuper };
}

/** Number of active Super Admins other than `exceptId` (rows locked, so two admins can't race). */
async function otherActiveSupers(exec: Exec, exceptId: number) {
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.isSuper, true), eq(users.isActive, true), ne(users.id, exceptId)))
    .for("update", { of: users });
  return rows.length;
}

/** Usernames and emails share one namespace, because either can be used to sign in. */
async function loginNameTaken(exec: Exec, value: string, exceptId: number) {
  if (value === "") return false;
  const [r] = await exec.select({ id: users.id }).from(users).where(and(or(eq(users.username, value), eq(users.email, value)), ne(users.id, exceptId))).limit(1);
  return !!r;
}

/* ------------------------------------------------------------- actions */

export async function adminData(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  return payload(ctx);
}

export async function userSave(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const p = await ctx.body();
  const id = int(p, "id");
  const username = str(p, "username", 50, "Username", true);
  const name = str(p, "name", 100, "Full name", true);
  const email = str(p, "email", 190, "Email");
  const roleId = int(p, "roleId");
  const active = !!p.active;
  const me = ctx.me;
  if (!/^[A-Za-z0-9_.@-]{3,50}$/.test(username)) throw new AppError("Username must be 3–50 characters: letters, digits, _ . @ -");
  if (email !== "" && !validEmail(email)) throw new AppError("Enter a valid email address, or leave it blank.");

  if (id) {
    const changes: string[] = [];
    await ctx.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!role) throw new AppError("Choose a role.");
      if (await loginNameTaken(tx, username, id)) throw new AppError("That username is already taken.");
      if (await loginNameTaken(tx, email, id)) throw new AppError("That email address is already used by another account.");
      const old = await findUser(tx, id);
      if (id === me.id && !active) throw new AppError("You can't deactivate your own account.");
      if (id === me.id && !role.isSuper) throw new AppError("You can't remove your own Super Admin role. Ask another Super Admin.");
      if (old.isSuper && old.isActive && (!role.isSuper || !active) && (await otherActiveSupers(tx, id)) === 0) {
        throw new AppError("This is the only active Super Admin. Make someone else a Super Admin first.");
      }
      await tx.update(users).set({ username, fullName: name, email: email !== "" ? email : null, roleId, isActive: active }).where(eq(users.id, id));
      if (old.roleId !== roleId) changes.push("role → " + role.name);
      if (old.isActive !== active) changes.push(active ? "activated" : "deactivated");
      if (old.username.toLowerCase() !== username.toLowerCase()) changes.push("username was " + old.username);
      if (!active && old.isActive) await bumpSessionEpoch(ctx, tx, id); // sign them out now
    });
    await audit(ctx, { event: "user_updated", detail: changes.length ? changes.join(", ") : "Profile details", actorId: me.id, actorName: me.username, target: username });
    return payload(ctx, { id: String(id) });
  }

  const password = String(val(p, "password", ""));
  const problem = passwordProblem(password, username);
  if (problem) throw new AppError(problem);
  const mustChange = p.mustChange === undefined || !!p.mustChange;
  let roleName = "";
  const newId = await ctx.db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) throw new AppError("Choose a role.");
    roleName = role.name;
    if (await loginNameTaken(tx, username, 0)) throw new AppError("That username is already taken.");
    if (await loginNameTaken(tx, email, 0)) throw new AppError("That email address is already used by another account.");
    const [row] = await tx
      .insert(users)
      .values({
        username, fullName: name, email: email !== "" ? email : null, passwordHash: await hashPassword(password), roleId,
        isActive: active, mustChangePw: mustChange, pwChangedAt: new Date(), createdBy: me.id,
      })
      .returning({ id: users.id });
    return row.id;
  });
  await audit(ctx, { event: "user_created", detail: "Role: " + roleName + (active ? "" : " (inactive)"), actorId: me.id, actorName: me.username, target: username });
  return payload(ctx, { id: String(newId) });
}

export async function userDelete(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const id = int(await ctx.body(), "id");
  if (id === ctx.me.id) throw new AppError("You can't delete your own account.");
  const name = await ctx.db.transaction(async (tx) => {
    const u = await findUser(tx, id);
    if (u.isSuper && u.isActive && (await otherActiveSupers(tx, id)) === 0) throw new AppError("You can't delete the only active Super Admin.");
    await tx.delete(users).where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    return u.username;
  });
  await audit(ctx, { event: "user_deleted", actorId: ctx.me.id, actorName: ctx.me.username, target: name });
  return payload(ctx);
}

export async function userPassword(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const p = await ctx.body();
  const id = int(p, "id");
  if (id === ctx.me.id) throw new AppError("Change your own password from Account settings.");
  let password = String(val(p, "password", ""));
  const generated = password === "";
  if (generated) password = generateTempPassword();
  const username = await ctx.db.transaction(async (tx) => {
    const u = await findUser(tx, id);
    const problem = passwordProblem(password, u.username);
    if (problem) throw new AppError(problem);
    await setUserPassword(ctx, tx, id, password, p.mustChange === undefined || !!p.mustChange);
    await tx.update(passwordResets).set({ dismissed: true }).where(eq(passwordResets.userId, id));
    return u.username;
  });
  await audit(ctx, { event: "password_set_by_admin", detail: "Temporary password set", actorId: ctx.me.id, actorName: ctx.me.username, target: username });
  return payload(ctx, { password: generated ? password : null, username });
}

export async function userResetLink(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const p = await ctx.body();
  const id = int(p, "id");
  if (id === ctx.me.id) throw new AppError("Change your own password from Account settings.");
  const { u, t } = await ctx.db.transaction(async (tx) => {
    const u = await findUser(tx, id);
    if (!u.isActive) throw new AppError("This account is disabled. Activate it first.");
    const t = await createResetToken(ctx, tx, id, true);
    await tx.update(passwordResets).set({ dismissed: true }).where(eq(passwordResets.userId, id));
    return { u, t };
  });
  const path = "/auth/reset?token=" + t.token;
  const link = appUrl(ctx, path);
  let emailed = false;
  if (p.send) {
    const emailLink = appUrl(ctx, path, true);
    if (!u.email) throw new AppError("This user has no email address. Copy the link instead.");
    if (emailLink === "") throw new AppError("Set APP_URL in the settings so emailed links point to the right address.");
    const nm = u.fullName !== "" ? u.fullName : u.username;
    const r = await sendMail(u.email, "Set your Nitte FPC Inventory password",
      `Hello ${nm},\n\nAn administrator created a link for you to set the password for your Nitte FPC Inventory account (username: ${u.username}).\n\n` +
      `It works once and expires in ${ADMIN_RESET_TOKEN_HOURS} hours:\n\n${emailLink}\n\n— Nitte FPC Inventory`);
    if (!r.ok) throw new AppError("The email couldn't be sent. Check the email settings, or copy the link instead.");
    emailed = true;
  }
  await audit(ctx, { event: "reset_link_created", detail: emailed ? "Emailed to the user" : "Link copied by admin", actorId: ctx.me.id, actorName: ctx.me.username, target: u.username });
  return payload(ctx, { link: emailed ? null : link, emailed, hours: ADMIN_RESET_TOKEN_HOURS, username: u.username });
}

export async function userUnlock(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const id = int(await ctx.body(), "id");
  const [u] = await ctx.db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, id)).returning({ username: users.username });
  await audit(ctx, { event: "user_unlocked", actorId: ctx.me.id, actorName: ctx.me.username, target: u?.username ?? "" });
  return payload(ctx);
}

export async function mailTest(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const to = String(val(await ctx.body(), "to", "")).trim();
  if (!validEmail(to)) throw new AppError("Enter a valid email address to send the test to.");
  const r = await sendMail(to, "Test email from Nitte FPC Inventory",
    'Hello,\n\nThis is a test from Nitte FPC Inventory. Email is working, so "Forgot password" links will now be emailed to users.\n\n— Nitte FPC Inventory');
  await audit(ctx, { event: "mail_test", detail: r.ok ? "Sent" : "Failed: " + r.error, actorId: ctx.me.id, actorName: ctx.me.username, target: to });
  if (!r.ok) throw new AppError(r.error || "The email could not be sent.");
  return { ok: true };
}

export async function resetDismiss(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  await ctx.db.update(passwordResets).set({ dismissed: true }).where(eq(passwordResets.id, int(await ctx.body(), "id")));
  return payload(ctx);
}

export async function roleSave(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const p = await ctx.body();
  let id = int(p, "id");
  const name = str(p, "name", 50, "Role name", true);
  const description = str(p, "description", 255, "Description");
  const perms = cleanPermissions(Array.isArray(p.perms) ? p.perms : []);
  const [dup] = await ctx.db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, name), ne(roles.id, id))).limit(1);
  if (dup) throw new AppError("A role with this name already exists.", 409);
  const permText = perms.length ? perms.join(",") : "view only";
  if (id) {
    const [r] = await ctx.db.select({ isSuper: roles.isSuper }).from(roles).where(eq(roles.id, id)).limit(1);
    if (!r) throw new AppError("Role not found. Reload the page.");
    // Super Admin always has every permission; only the text can change.
    await ctx.db.update(roles).set(r.isSuper ? { name, description } : { name, description, permissions: perms }).where(eq(roles.id, id));
    await audit(ctx, { event: "role_updated", detail: "Permissions: " + (r.isSuper ? "all" : permText), actorId: ctx.me.id, actorName: ctx.me.username, target: name });
  } else {
    [{ id }] = await ctx.db.insert(roles).values({ name, description, permissions: perms }).returning({ id: roles.id });
    await audit(ctx, { event: "role_created", detail: "Permissions: " + permText, actorId: ctx.me.id, actorName: ctx.me.username, target: name });
  }
  return payload(ctx, { id: String(id) });
}

export async function roleDelete(ctx: ApiCtx) {
  requirePerm(ctx, "users.manage");
  const id = int(await ctx.body(), "id");
  const [r] = await ctx.db
    .select({ name: roles.name, isSuper: roles.isSuper, n: count(users.id) })
    .from(roles)
    .leftJoin(users, eq(users.roleId, roles.id))
    .where(eq(roles.id, id))
    .groupBy(roles.id);
  if (!r) throw new AppError("Role not found.", 404);
  if (r.isSuper) throw new AppError("The Super Admin role can't be deleted.");
  if (Number(r.n) > 0) throw new AppError(`${r.n} user(s) have this role. Move them to another role first.`);
  await ctx.db.delete(roles).where(eq(roles.id, id));
  await audit(ctx, { event: "role_deleted", actorId: ctx.me.id, actorName: ctx.me.username, target: r.name });
  return payload(ctx);
}
