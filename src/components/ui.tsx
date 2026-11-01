/** Small server-rendered building blocks shared by the sign-in, password and account pages. */
import type { ReactNode } from "react";
import Script from "next/script";
import { COPYRIGHT_OWNER, DEVELOPER } from "@/lib/config";
import { today } from "@/lib/format";

/** Changes on every build (set in next.config.ts), so browsers can cache static files for a year. */
export const ASSET_VERSION = process.env.ASSET_VERSION || "dev";

const ALERT_ICONS: Record<string, ReactNode> = {
  error: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  warn: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
};

export function Svg({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {children}
    </svg>
  );
}

export function Alert({ type, children }: { type: string; children: ReactNode }) {
  return (
    <div className={`alert ${type}`} role={type === "error" ? "alert" : "status"}>
      <Svg>{ALERT_ICONS[type] ?? ALERT_ICONS.info}</Svg>
      <div>{children}</div>
    </div>
  );
}

export function BackLink() {
  return (
    <a className="back-link" href="/login">
      <Svg><path d="M19 12H5M12 19l-7-7 7-7" /></Svg>Back to sign in
    </a>
  );
}

export function AuthIcon({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className="auth-icon" style={danger ? { background: "var(--danger-soft)", color: "var(--danger)" } : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </div>
  );
}

/** Split-screen layout for the sign-in / password pages. */
export function AuthShell({ children }: { children: ReactNode }) {
  const v = ASSET_VERSION;
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="auth-brand">
          <img className="auth-logo" src={`/assets/logo-192.png?v=${v}`} alt="Nitte Farmers Producer Company Ltd. logo" width={72} height={72} />
          <div>
            <div className="auth-brand-name">Nitte Farmers Producer Company Ltd.</div>
            <div className="auth-brand-sub">Inventory &amp; barcode labelling</div>
          </div>
        </div>
        <div className="auth-pitch">
          <h2>From farm to shelf, every batch accounted for.</h2>
          <ul className="auth-points">
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8" /></svg>
              <span><b>Barcode labels</b> Print FSSAI-ready labels with Code 128 barcodes.</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5z" /><path d="m3 7 9 5 9-5M12 12v10" /></svg>
              <span><b>Batch traceability</b> Know which farmer group every pack came from.</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>
              <span><b>Expiry &amp; stock alerts</b> Spot low stock and short-dated batches early.</span>
            </li>
          </ul>
        </div>
        <div className="auth-foot">NMAMIT Campus, Nitte, Karkala Tq., Udupi Dist., Karnataka</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <img className="tb-logo-img" src={`/assets/logo-128.png?v=${v}`} alt="" width={44} height={44} />
            <b>Nitte FPC Inventory</b>
          </div>
          {children}
          <p className="auth-legal">
            &copy; {today().slice(0, 4)} {COPYRIGHT_OWNER} All rights reserved.
            <br />
            Developed by <a href={DEVELOPER.url} target="_blank" rel="noopener">{DEVELOPER.name}</a>
          </p>
        </div>
      </main>
      <Script src={`/js/auth.js?v=${v}`} strategy="afterInteractive" />
    </div>
  );
}

/** Password input with the show/hide button (wired up by /js/auth.js). */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="input-wrap">
      <input type="password" {...props} />
      <button type="button" className="pw-toggle" aria-label="Show password" aria-pressed="false"></button>
    </div>
  );
}

/** Strength meter + rules for a new-password field (wired up by /js/auth.js via data-meter). */
export function PasswordMeter() {
  return (
    <>
      <div className="strength" id="pwMeter"><i></i><i></i><i></i><i></i></div>
      <ul className="rules" id="pwRules"></ul>
      <div className="caps" id="capsMsg">Caps Lock is on.</div>
    </>
  );
}

/** The signed-in user for the page's JavaScript, as a JSON data block. */
export function MeData({ json }: { json: string }) {
  return <script id="me-data" type="application/json" dangerouslySetInnerHTML={{ __html: json }} />;
}
