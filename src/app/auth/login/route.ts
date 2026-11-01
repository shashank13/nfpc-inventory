/** Sign-in and first-time setup form posts (from /login). */
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auditLog, roles, users } from "@/db/schema";
import { audit, logInUser } from "@/lib/auth";
import { LOCK_MINUTES, MAX_FAILED_LOGINS, MAX_FAILED_PER_IP } from "@/lib/config";
import type { Ctx } from "@/lib/context";
import { dummyHash, hashPassword, needsRehash, passwordProblem, verifyPassword } from "@/lib/crypto";
import { charLen, cut, validEmail } from "@/lib/format";
import { formCtx, readForm, redirectTo, sameOrigin, setForm } from "@/lib/page";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response("Bad request.", { status: 403 });
  let ctx: Ctx;
  try {
    ctx = await formCtx(req);
  } catch (e) {
    console.error("login: database error:", e);
    return redirectTo(null, "/login");
  }
  const f = await readForm(req);
  const ident = (f.username ?? "").trim();
  const password = f.password ?? "";

  try {
    const [{ n }] = await ctx.db.select({ n: count() }).from(users);
    const setup = Number(n) === 0;
    return setup ? await firstSetup(ctx, f, ident, password) : await signIn(ctx, ident, password);
  } catch (e) {
    console.error("login error:", e);
    setForm(ctx, { error: "Server error. Please try again.", ident });
    return redirectTo(ctx, "/login");
  }
}

async function firstSetup(ctx: Ctx, f: Record<string, string>, ident: string, password: string) {
  const fullName = (f.full_name ?? "").trim();
  const email = (f.email ?? "").trim();
  const back = (error: string) => {
    setForm(ctx, { error, ident, fullName, email });
    return redirectTo(ctx, "/login");
  };
  if (fullName === "" || charLen(fullName) > 100) return back("Enter your full name (up to 100 characters).");
  if (!/^[A-Za-z0-9_.@-]{3,50}$/.test(ident)) return back("Username must be 3–50 characters: letters, digits, _ . @ -");
  if (email !== "" && !validEmail(email)) return back("Enter a valid email address, or leave it blank.");
  const problem = passwordProblem(password, ident);
  if (problem) return back(problem);
  if (password !== (f.confirm ?? "")) return back("Passwords do not match.");

  const [superRole] = await ctx.db.select({ id: roles.id }).from(roles).where(eq(roles.isSuper, true)).orderBy(roles.id).limit(1);
  if (!superRole) return back("The database has no Super Admin role. Run: npm run db:seed");
  const hash = await hashPassword(password);
  // Insert only if the table is still empty, so two people can't both claim the first account.
  const inserted = (await ctx.db.execute(sql`
    insert into users (username, full_name, email, password_hash, role_id, pw_changed_at)
    select ${ident}, ${fullName}, ${email !== "" ? email : null}, ${hash}, ${superRole.id}, now()
    where not exists (select 1 from users)
    returning id`)) as unknown as { id: number }[];
  if (inserted.length === 1) {
    const id = Number(inserted[0].id);
    await logInUser(ctx, id);
    await audit(ctx, { event: "setup", detail: "Created the first Super Admin account", actorId: id, actorName: ident });
    return redirectTo(ctx, "/dashboard");
  }
  setForm(ctx, { error: "An account was already created. Please sign in." });
  return redirectTo(ctx, "/login");
}

async function signIn(ctx: Ctx, ident: string, password: string) {
  const back = (error: string) => {
    setForm(ctx, { error, ident });
    return redirectTo(ctx, "/login");
  };
  const db = ctx.db;
  const since = sql`now() - make_interval(mins => ${LOCK_MINUTES})`;

  const [{ n: ipFails }] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.event, "login_failed"), eq(auditLog.ip, ctx.ip), gt(auditLog.createdAt, since)));

  const pick = {
    id: users.id, username: users.username, passwordHash: users.passwordHash, isActive: users.isActive,
    mustChangePw: users.mustChangePw, failedLogins: users.failedLogins, lockedUntil: users.lockedUntil,
  };
  let [u] = ident ? await db.select(pick).from(users).where(eq(users.username, ident)).limit(1) : [];
  if (!u && ident.includes("@")) [u] = await db.select(pick).from(users).where(eq(users.email, ident)).limit(1);
  const isLocked = !!u?.lockedUntil && u.lockedUntil.getTime() > Date.now();

  if (ident === "" || password === "") return back("Enter your username (or email) and password.");
  if (Number(ipFails) >= MAX_FAILED_PER_IP) return back(`Too many failed sign-in attempts from this device. Try again in ${LOCK_MINUTES} minutes.`);
  if (u && isLocked) {
    const left = Math.max(1, Math.ceil((u.lockedUntil!.getTime() - Date.now()) / 60_000));
    return back(`This account is temporarily locked after too many failed attempts. Try again in ${left} minute(s), or reset your password.`);
  }
  if (!u) {
    // Unknown usernames "lock" the same way, so the message doesn't reveal which accounts exist.
    const [{ n: unknownFails }] = await db
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.event, "login_failed"), isNull(auditLog.userId), eq(auditLog.username, cut(ident, 50)), gt(auditLog.createdAt, since)));
    if (Number(unknownFails) >= MAX_FAILED_LOGINS) {
      return back(`This account is temporarily locked after too many failed attempts. Try again in ${LOCK_MINUTES} minute(s), or reset your password.`);
    }
  }

  // Check against a dummy hash when the user doesn't exist, so the response time doesn't reveal it.
  const ok = (await verifyPassword(password, u ? u.passwordHash : await dummyHash())) && !!u;
  if (ok && u && !u.isActive) {
    await audit(ctx, { event: "login_blocked", detail: "Account disabled", actorId: u.id, actorName: u.username });
    return back("Your account has been disabled. Contact your administrator.");
  }
  if (ok && u) {
    if (needsRehash(u.passwordHash)) {
      // Upgrade old (bcrypt) or weaker hashes now that we know the password.
      await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
    }
    await logInUser(ctx, u.id);
    await audit(ctx, { event: "login", actorId: u.id, actorName: u.username });
    return redirectTo(ctx, u.mustChangePw ? "/account" : "/dashboard");
  }

  if (u) {
    const fails = u.failedLogins + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      await db.update(users).set({ failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }).where(eq(users.id, u.id));
      await audit(ctx, { event: "account_locked", detail: `${MAX_FAILED_LOGINS} failed attempts`, actorId: u.id, actorName: u.username });
    } else {
      await db.update(users).set({ failedLogins: fails }).where(eq(users.id, u.id));
    }
  }
  await audit(ctx, { event: "login_failed", detail: u ? "" : "Unknown user", actorId: u ? u.id : null, actorName: ident });
  await sleep(1000); // slow down password guessing
  return back("Incorrect username or password.");
}
