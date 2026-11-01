/** Account settings form posts: profile, password, sign out other devices. */
import { and, eq, ne, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { users } from "@/db/schema";
import { audit, bumpSessionEpoch, currentUser, isImpersonating, setUserPassword } from "@/lib/auth";
import type { Ctx } from "@/lib/context";
import { passwordProblem, verifyPassword } from "@/lib/crypto";
import { charLen, validEmail } from "@/lib/format";
import { formCtx, readForm, redirectTo, sameOrigin, setFlash, setForm } from "@/lib/page";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response("Bad request.", { status: 403 });
  let ctx: Ctx;
  try {
    ctx = await formCtx(req);
  } catch (e) {
    console.error("account: database error:", e);
    return redirectTo(null, "/login");
  }
  const me = await currentUser(ctx);
  if (!me) return redirectTo(ctx, "/login");

  const f = await readForm(req);
  const action = f.do ?? "";
  const forced = me.mustChange;
  const errKey = action === "profile" ? "profile" : "password";
  const [row] = await ctx.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1);

  const back = (error: string, extra: Record<string, string> = {}) => {
    setForm(ctx, { [errKey]: error, ...extra });
    return redirectTo(ctx, "/account");
  };

  // A Super Admin viewing as someone must not change that person's password, email or sessions.
  if (isImpersonating(ctx)) return back("You're viewing as someone else. Return to your own account to change account settings.");

  if (action === "profile" && !forced) {
    const fullName = (f.full_name ?? "").trim();
    const email = (f.email ?? "").trim();
    const keep = { full_name: fullName, email };
    const emailChanged = email.toLowerCase() !== me.email.toLowerCase();
    if (fullName === "" || charLen(fullName) > 100) return back("Enter your full name (up to 100 characters).", keep);
    if (email !== "" && !validEmail(email)) return back("Enter a valid email address, or leave it blank.", keep);
    if (emailChanged && !(await verifyPassword(f.current_password ?? "", row.passwordHash))) {
      return back("Enter your current password to change your email address.", keep);
    }
    if (email !== "") {
      const [dup] = await ctx.db.select({ id: users.id }).from(users)
        .where(and(or(eq(users.email, email), eq(users.username, email)), ne(users.id, me.id))).limit(1);
      if (dup) return back("That email address is already used by another account.", keep);
    }
    await ctx.db.update(users).set({ fullName, email: email !== "" ? email : null }).where(eq(users.id, me.id));
    await audit(ctx, { event: "profile_updated", detail: emailChanged ? "Changed name / email" : "Changed name", actorId: me.id, actorName: me.username });
    setFlash(ctx, "success", "Profile saved.");
    return redirectTo(ctx, "/account");
  }

  if (action === "password") {
    const cur = f.current_password ?? "", next = f.new_password ?? "";
    if (!(await verifyPassword(cur, row.passwordHash))) return back("Your current password is incorrect.");
    const problem = passwordProblem(next, me.username);
    if (problem) return back(problem);
    if (next !== (f.confirm_password ?? "")) return back("New passwords do not match.");
    if (await verifyPassword(next, row.passwordHash)) return back("Choose a password different from your current one.");
    await setUserPassword(ctx, ctx.db, me.id, next, false, true);
    await audit(ctx, { event: "password_changed", detail: forced ? "Replaced temporary password" : "", actorId: me.id, actorName: me.username });
    setFlash(ctx, "success", forced ? "Password set. Welcome!" : "Password changed. Other devices have been signed out.");
    return redirectTo(ctx, forced ? "/dashboard" : "/account");
  }

  if (action === "signout_others" && !forced) {
    await bumpSessionEpoch(ctx, ctx.db, me.id, true);
    await audit(ctx, { event: "signout_others", actorId: me.id, actorName: me.username });
    setFlash(ctx, "success", "Signed out of all other devices.");
  }
  return redirectTo(ctx, "/account");
}
