/**
 * "Forgot password" form post. The response is the same whether or not the account exists,
 * so it can't be used to find usernames.
 */
import { and, count, desc, eq, gt, or, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auditLog, passwordResets, users } from "@/db/schema";
import { appUrl, audit, createResetToken } from "@/lib/auth";
import { RESET_TOKEN_MINUTES } from "@/lib/config";
import type { Ctx } from "@/lib/context";
import { charLen } from "@/lib/format";
import { mailEnabled, sendMail } from "@/lib/mail";
import { formCtx, readForm, redirectTo, sameOrigin, setForm } from "@/lib/page";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response("Bad request.", { status: 403 });
  let ctx: Ctx;
  try {
    ctx = await formCtx(req);
  } catch (e) {
    console.error("forgot: database error:", e);
    return redirectTo(null, "/forgot");
  }
  const ident = ((await readForm(req)).ident ?? "").trim();
  if (ident === "" || charLen(ident) > 190) {
    setForm(ctx, { error: "Enter your username or email address.", ident });
    return redirectTo(ctx, "/forgot");
  }
  try {
    await handle(ctx, ident);
  } catch (e) {
    console.error("forgot error:", e);
  }
  setForm(ctx, { done: true, ident });
  return redirectTo(ctx, "/forgot");
}

async function handle(ctx: Ctx, ident: string) {
  const db = ctx.db;
  const hourAgo = sql`now() - interval '1 hour'`;
  const [{ n: ipCount }] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.event, "reset_requested"), eq(auditLog.ip, ctx.ip), gt(auditLog.createdAt, hourAgo)));
  if (Number(ipCount) >= 10) return;

  const [u] = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, email: users.email, isActive: users.isActive })
    .from(users)
    .where(or(eq(users.username, ident), eq(users.email, ident)))
    .orderBy(desc(sql`(${users.username} = ${ident})`))
    .limit(1);
  let recent = 0;
  if (u) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, u.id), eq(passwordResets.viaAdmin, false), gt(passwordResets.createdAt, hourAgo)));
    recent = Number(n);
  }
  if (!u || !u.isActive || recent >= 3) {
    await audit(ctx, { event: "reset_requested", detail: u ? "Ignored (disabled account or too many requests)" : "Unknown user", actorId: u ? u.id : null, actorName: u ? u.username : ident });
    return;
  }

  const t = await createResetToken(ctx, db, u.id, false);
  const link = appUrl(ctx, "/auth/reset?token=" + t.token, true);
  let sent = false;
  if (mailEnabled() && u.email && link !== "") {
    const name = u.fullName !== "" ? u.fullName : u.username;
    const r = await sendMail(u.email, "Reset your Nitte FPC Inventory password",
      `Hello ${name},\n\n` +
      `We received a request to reset the password for your Nitte FPC Inventory account (username: ${u.username}).\n\n` +
      `Open this link to choose a new password. It works once and expires in ${RESET_TOKEN_MINUTES} minutes:\n\n${link}\n\n` +
      "If you didn't ask for this, you can ignore this email; your password won't change.\n\n— Nitte FPC Inventory");
    sent = r.ok;
    if (sent) await db.update(passwordResets).set({ mailSent: true }).where(eq(passwordResets.id, t.id));
  } else if (mailEnabled() && link === "") {
    console.error("forgot: set APP_URL so reset emails can contain a link.");
  }
  await audit(ctx, { event: "reset_requested", detail: sent ? "Reset link emailed" : "Waiting for an administrator", actorId: u.id, actorName: u.username });
}
