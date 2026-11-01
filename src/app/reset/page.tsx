/** Choose a new password using a single-use reset link (from email or from a Super Admin). */
import type { Metadata } from "next";
import { findResetToken } from "@/lib/auth";
import { ADMIN_RESET_TOKEN_HOURS, RESET_TOKEN_MINUTES } from "@/lib/config";
import { pageCtx, savePage, takeForm } from "@/lib/page";
import { Alert, AuthIcon, AuthShell, BackLink, PasswordInput, PasswordMeter } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPage() {
  let error = "";
  let reset: Awaited<ReturnType<typeof findResetToken>> = null;
  try {
    const ctx = await pageCtx();
    reset = await findResetToken(ctx.db, ctx.session.data.reset_token);
    const form = takeForm(ctx);
    if (typeof form.error === "string") error = form.error;
    await savePage(ctx);
  } catch (e) {
    console.error("reset: database error:", e);
    error = "Cannot connect to the database. Check that PostgreSQL is running.";
  }

  return (
    <AuthShell>
      <BackLink />
      {!reset ? (
        <>
          <AuthIcon danger><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></AuthIcon>
          <h1>Link expired or invalid</h1>
          <p className="lead">
            This password reset link has expired, was already used, or isn&apos;t valid. Reset links work once and expire after {RESET_TOKEN_MINUTES} minutes ({ADMIN_RESET_TOKEN_HOURS} hours when created by an administrator).
          </p>
          {error && <Alert type="error">{error}</Alert>}
          <a className="btn primary block lg" href="/forgot">Request a new link</a>
        </>
      ) : (
        <>
          <AuthIcon><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></AuthIcon>
          <h1>Set a new password</h1>
          <p className="lead">
            For <b>{reset.fullName !== "" ? reset.fullName : reset.username}</b> ({reset.username}). You&apos;ll be signed out on all other devices.
          </p>
          {error && <Alert type="error">{error}</Alert>}
          <form method="post" action="/auth/reset" noValidate>
            <input type="text" name="username" defaultValue={reset.username} autoComplete="username" hidden />
            <label htmlFor="password">New password</label>
            <PasswordInput id="password" name="password" required minLength={8} maxLength={72} autoComplete="new-password" data-caps="capsMsg" autoFocus data-meter="1" data-confirm="confirm" data-match="pwMatch" />
            <PasswordMeter />
            <label htmlFor="confirm">Confirm new password</label>
            <input id="confirm" name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
            <div className="field-err" id="pwMatch"></div>
            <button type="submit" className="btn primary block lg">Update password</button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
