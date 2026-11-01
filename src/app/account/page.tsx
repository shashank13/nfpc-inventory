/**
 * Account settings: profile, change password, sign out other devices.
 * Users given a temporary password land here and must choose a new one first.
 */
import type { Metadata } from "next";
import Script from "next/script";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { isImpersonating, userJson } from "@/lib/auth";
import { stamp } from "@/lib/format";
import { requireUser, savePage, takeFlash, takeForm } from "@/lib/page";
import { ASSET_VERSION, Alert, MeData, PasswordInput, PasswordMeter } from "@/components/ui";
import { footerHtml } from "@/components/app-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { me } = await requireUser({ allowMustChange: true });
  return { title: me.mustChange ? "Set your password" : "Account settings" };
}

export default async function AccountPage() {
  const { ctx, me } = await requireUser({ allowMustChange: true });
  const forced = me.mustChange;
  const [row] = await ctx.db
    .select({ createdAt: users.createdAt, pwChangedAt: users.pwChangedAt })
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1);
  const flash = takeFlash(ctx);
  const form = takeForm(ctx);
  const meJson = userJson(ctx, me);
  const imp = isImpersonating(ctx);
  await savePage(ctx);

  const profileErr = typeof form.profile === "string" ? form.profile : "";
  const passwordErr = typeof form.password === "string" ? form.password : "";
  const fullName = typeof form.full_name === "string" ? form.full_name : me.name;
  const email = typeof form.email === "string" ? form.email : me.email;

  return (
    <>
      <div id="topbar" className="topbar"></div>
      <main className="page" style={{ maxWidth: 860 }}>
        {forced ? (
          <div className="page-head"><div><h1>Set your password</h1><p>Your administrator gave you a temporary password. Choose your own to continue.</p></div></div>
        ) : (
          <div className="page-head">
            <div><h1>Account settings</h1><p>Manage your profile, password and sign-in sessions.</p></div>
            <div className="page-actions"><a className="btn" href="/inventory">Back to inventory</a></div>
          </div>
        )}
        {flash && <Alert type={flash[0]}>{flash[1]}</Alert>}
        {imp && <Alert type="warn">You are viewing this account as a Super Admin. Password, email and session changes are disabled until you return to your own account.</Alert>}

        {!forced && (
          <>
            <section className="card" style={{ marginBottom: 18 }}>
              <div className="card-head">
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <span className="avatar lg" style={{ width: 52, height: 52, fontSize: 17 }} id="bigAvatar"></span>
                  <div>
                    <h2>{me.name}</h2>
                    <div className="muted" style={{ fontSize: 13 }}>
                      @{me.username} · <span className={`badge ${me.isSuper ? "accent" : "neutral"}`}>{me.role}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="row stack-sm" style={{ fontSize: 13 }}>
                <div><span className="muted">Member since</span><br /><b data-dt={stamp(row?.createdAt) ?? ""}></b></div>
                <div><span className="muted">Password last changed</span><br /><b data-dt={stamp(row?.pwChangedAt) ?? ""}></b></div>
              </div>
            </section>

            <section className="card" style={{ marginBottom: 18 }}>
              <h2>Profile</h2>
              <p className="card-sub">Your name appears in the top bar and in the stock history. Your email is used for password reset links.</p>
              {profileErr && <Alert type="error">{profileErr}</Alert>}
              <form method="post" action="/auth/account" noValidate>
                <input type="hidden" name="do" value="profile" />
                <div className="row stack-sm">
                  <div>
                    <label htmlFor="full_name">Full name</label>
                    <input id="full_name" name="full_name" required maxLength={100} defaultValue={fullName} autoComplete="name" />
                  </div>
                  <div>
                    <label htmlFor="username_ro">Username</label>
                    <input id="username_ro" defaultValue={me.username} readOnly />
                    <div className="help">Only a Super Admin can change usernames.</div>
                  </div>
                </div>
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" maxLength={190} defaultValue={email} autoComplete="email" placeholder="name@example.com" />
                <div id="curPwWrap" className="hidden">
                  <label htmlFor="profile_pw">Current password <span className="muted" style={{ fontWeight: 400 }}>(required to change email)</span></label>
                  <input id="profile_pw" name="current_password" type="password" autoComplete="current-password" />
                </div>
                <div className="actions" style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button type="submit" className="btn primary">Save profile</button>
                </div>
              </form>
            </section>
          </>
        )}

        <section className="card" style={{ marginBottom: 18 }}>
          <h2>{forced ? "Choose a new password" : "Change password"}</h2>
          <p className="card-sub">
            Use at least 8 characters with a letter and a number. A longer passphrase is stronger.{forced ? "" : " Changing it signs you out on other devices."}
          </p>
          {passwordErr && <Alert type="error">{passwordErr}</Alert>}
          <form method="post" action="/auth/account" noValidate style={{ maxWidth: 420 }}>
            <input type="hidden" name="do" value="password" />
            <input type="text" name="username" defaultValue={me.username} autoComplete="username" hidden />
            <label htmlFor="current_password">{forced ? "Temporary password" : "Current password"}</label>
            <PasswordInput id="current_password" name="current_password" required autoComplete="current-password" autoFocus={forced} />
            <label htmlFor="new_password">New password</label>
            <PasswordInput id="new_password" name="new_password" required minLength={8} maxLength={72} autoComplete="new-password" data-caps="capsMsg" data-meter="1" data-confirm="confirm_password" data-match="pwMatch" />
            <PasswordMeter />
            <label htmlFor="confirm_password">Confirm new password</label>
            <input id="confirm_password" name="confirm_password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
            <div className="field-err" id="pwMatch"></div>
            <div style={{ marginTop: 18 }}>
              <button type="submit" className="btn primary">{forced ? "Set password & continue" : "Update password"}</button>
            </div>
          </form>
        </section>

        {!forced && (
          <section className="card">
            <div className="card-head" style={{ margin: 0, alignItems: "center", flexWrap: "wrap" }}>
              <div><h2>Sessions</h2><p className="card-sub" style={{ margin: "4px 0 0" }}>Signed in on a shared or lost device? Sign out everywhere except here.</p></div>
              <form method="post" action="/auth/account" data-no-busy="">
                <input type="hidden" name="do" value="signout_others" />
                <button type="submit" className="btn">Sign out other devices</button>
              </form>
            </div>
          </section>
        )}
      </main>
      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: footerHtml() }} />
      <MeData json={meJson} />
      <Script src={`/js/auth.js?v=${ASSET_VERSION}`} strategy="afterInteractive" />
      <Script src={`/js/account.js?v=${ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
