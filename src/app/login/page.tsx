/** Sign-in page. If no account exists yet, it shows a one-time "create Super Admin" form instead. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import type { Ctx } from "@/lib/context";
import { pageCtx, savePage, takeFlash, takeForm } from "@/lib/page";
import { Alert, AuthShell, PasswordInput, PasswordMeter } from "@/components/ui";

export const dynamic = "force-dynamic";

const FLASH: Record<string, [string, string]> = {
  timeout: ["info", "You were signed out after a period of inactivity. Please sign in again."],
  disabled: ["error", "Your account has been disabled. Contact your administrator."],
  signed_out: ["info", "Your session ended (your password or access was changed). Please sign in again."],
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await isSetup()) ? "Set up" : "Sign in" };
}

async function isSetup(): Promise<boolean> {
  try {
    const [r] = await getDb().select({ n: count() }).from(users);
    return Number(r.n) === 0;
  } catch {
    return false;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let ctx: Ctx | null = null;
  let setup = false;
  let error = "";
  try {
    ctx = await pageCtx();
    const [r] = await ctx.db.select({ n: count() }).from(users);
    setup = Number(r.n) === 0;
  } catch (e) {
    console.error("login: database error:", e);
    error = "Cannot connect to the database. Check that PostgreSQL is running and that the database has been set up (npm run db:setup).";
  }

  let goTo = "";
  if (ctx && !setup) {
    const me = await currentUser(ctx);
    if (me) goTo = me.mustChange ? "/account" : "/dashboard";
  }
  if (goTo) {
    await savePage(ctx!);
    redirect(goTo);
  }

  let notice: [string, string] | null = null;
  let form: Record<string, string | boolean> = {};
  if (ctx) {
    const s = ctx.session.data;
    if (s.flash && FLASH[s.flash]) notice = FLASH[s.flash];
    if (s.flash) { delete s.flash; ctx.session.touch(); }
    if (sp.bye !== undefined) notice = ["success", "You've been signed out."];
    if (sp.reset !== undefined) notice = ["success", "Your password has been updated. Sign in with your new password."];
    notice = takeFlash(ctx) ?? notice;
    form = takeForm(ctx);
    await savePage(ctx);
  }
  if (!error && typeof form.error === "string") error = form.error;
  const ident = String(form.ident ?? "");

  return (
    <AuthShell>
      {setup ? (
        <>
          <h1>Create the Super Admin</h1>
          <p className="lead">First-time setup. This account can manage users, roles and everything else. You can add more people afterwards.</p>
        </>
      ) : (
        <>
          <h1>Sign in</h1>
          <p className="lead">Welcome back. Sign in to manage inventory and labels.</p>
        </>
      )}
      {notice && <Alert type={notice[0]}>{notice[1]}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <form method="post" action="/auth/login" autoComplete="on" noValidate>
        {setup ? (
          <>
            <input type="hidden" name="setup" value="1" />
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" required maxLength={100} defaultValue={String(form.fullName ?? "")} autoComplete="name" autoFocus />
            <div className="row stack-sm">
              <div>
                <label htmlFor="username">Username</label>
                <input id="username" name="username" required maxLength={50} pattern="[A-Za-z0-9_.@\-]{3,50}" defaultValue={ident} autoComplete="username" autoCapitalize="none" spellCheck={false} />
              </div>
              <div>
                <label htmlFor="email">Email <span className="muted" style={{ fontWeight: 400 }}>(for password resets)</span></label>
                <input id="email" name="email" type="email" maxLength={190} defaultValue={String(form.email ?? "")} autoComplete="email" />
              </div>
            </div>
            <label htmlFor="password">Password</label>
            <PasswordInput id="password" name="password" required minLength={8} maxLength={72} autoComplete="new-password" data-caps="capsMsg" data-meter="1" data-confirm="confirm" data-match="pwMatch" />
            <PasswordMeter />
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
            <div className="field-err" id="pwMatch"></div>
            <button type="submit" className="btn primary block lg">Create account &amp; continue</button>
          </>
        ) : (
          <>
            <label htmlFor="username">Username or email</label>
            <input id="username" name="username" required maxLength={190} defaultValue={ident} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={ident === ""} />
            <div className="label-row">
              <label htmlFor="password">Password</label>
              <a href="/forgot">Forgot password?</a>
            </div>
            <PasswordInput id="password" name="password" required autoComplete="current-password" data-caps="capsMsg" autoFocus={ident !== ""} />
            <div className="caps" id="capsMsg">Caps Lock is on.</div>
            <button type="submit" className="btn primary block lg" disabled={!ctx}>Sign in</button>
            <p className="auth-alt">Need an account? Ask your administrator to add you.</p>
          </>
        )}
      </form>
    </AuthShell>
  );
}
