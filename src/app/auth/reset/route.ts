/**
 * Password reset links.
 *   GET  /auth/reset?token=…  — moves the token from the URL into the session (so it doesn't linger
 *                               in the address bar or history) and opens /reset.
 *   POST /auth/reset          — sets the new password.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { passwordResets } from "@/db/schema";
import { audit, findResetToken, setUserPassword } from "@/lib/auth";
import { clearSession, type Ctx } from "@/lib/context";
import { passwordProblem } from "@/lib/crypto";
import { formCtx, readForm, redirectTo, sameOrigin, setForm } from "@/lib/page";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  let ctx: Ctx | null = null;
  try {
    ctx = await formCtx(req);
    if (token) {
      ctx.session.data.reset_token = token;
      ctx.session.touch();
    }
  } catch (e) {
    console.error("reset: database error:", e);
  }
  return redirectTo(ctx, "/reset");
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response("Bad request.", { status: 403 });
  let ctx: Ctx;
  try {
    ctx = await formCtx(req);
  } catch (e) {
    console.error("reset: database error:", e);
    return redirectTo(null, "/reset");
  }
  const f = await readForm(req);
  const pw = f.password ?? "";
  const reset = await findResetToken(ctx.db, ctx.session.data.reset_token);
  if (!reset) return redirectTo(ctx, "/reset"); // shows "Link expired or invalid"

  const problem = passwordProblem(pw, reset.username);
  if (problem || pw !== (f.confirm ?? "")) {
    setForm(ctx, { error: problem || "Passwords do not match." });
    return redirectTo(ctx, "/reset");
  }
  const changed = await ctx.db.transaction(async (tx) => {
    const used = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.id, reset.resetId), isNull(passwordResets.usedAt)))
      .returning({ id: passwordResets.id });
    if (used.length !== 1) return false;
    await setUserPassword(ctx, tx, reset.id, pw, false);
    return true;
  });
  if (!changed) return redirectTo(ctx, "/reset");
  await audit(ctx, { event: "password_reset", detail: "Password changed with a reset link", actorId: reset.id, actorName: reset.username });
  delete ctx.session.data.reset_token;
  if (ctx.session.data.uid) clearSession(ctx);
  ctx.session.touch();
  return redirectTo(ctx, "/login?reset=1");
}
