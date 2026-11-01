/**
 * "Forgot password": emails a single-use reset link (when email is set up).
 * Without email, the request is shown to Super Admins under Users & roles → Reset requests.
 */
import type { Metadata } from "next";
import { RESET_TOKEN_MINUTES } from "@/lib/config";
import type { Ctx } from "@/lib/context";
import { mailEnabled } from "@/lib/mail";
import { pageCtx, savePage, takeForm } from "@/lib/page";
import { Alert, AuthIcon, AuthShell, BackLink } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPage() {
  let ctx: Ctx | null = null;
  let error = "";
  let form: Record<string, string | boolean> = {};
  try {
    ctx = await pageCtx();
    form = takeForm(ctx);
    await savePage(ctx);
  } catch (e) {
    console.error("forgot: database error:", e);
    error = "Cannot connect to the database. Check that PostgreSQL is running.";
  }
  if (!error && typeof form.error === "string") error = form.error;
  const ident = String(form.ident ?? "");
  const mail = mailEnabled();

  return (
    <AuthShell>
      <BackLink />
      {form.done ? (
        <>
          <AuthIcon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></AuthIcon>
          {mail ? (
            <>
              <h1>Check your email</h1>
              <p className="lead">If an account matches <b>{ident}</b> and has an email address, we&apos;ve sent it a link to reset the password. The link expires in {RESET_TOKEN_MINUTES} minutes.</p>
              <Alert type="info">Didn&apos;t get it? Check your spam folder. If your account has no email address, your administrator can reset your password for you.</Alert>
            </>
          ) : (
            <>
              <h1>Request sent</h1>
              <p className="lead">If an account matches <b>{ident}</b>, your administrator has been notified. They&apos;ll give you a reset link or a temporary password.</p>
              <Alert type="info">For a quicker reset, contact your administrator directly.</Alert>
            </>
          )}
          <a className="btn primary block lg" href="/login" style={{ marginTop: 8 }}>Return to sign in</a>
        </>
      ) : (
        <>
          <AuthIcon><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" /></AuthIcon>
          <h1>Forgot your password?</h1>
          <p className="lead">
            {mail ? "Enter your username or email and we'll send you a link to reset it." : "Enter your username or email and we'll ask your administrator to reset it."}
          </p>
          {error && <Alert type="error">{error}</Alert>}
          <form method="post" action="/auth/forgot" noValidate>
            <label htmlFor="ident">Username or email</label>
            <input id="ident" name="ident" required maxLength={190} defaultValue={ident} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
            <button type="submit" className="btn primary block lg" disabled={!ctx}>{mail ? "Send reset link" : "Request a reset"}</button>
          </form>
          <p className="auth-alt">Remembered it? <a href="/login">Sign in</a></p>
        </>
      )}
    </AuthShell>
  );
}
