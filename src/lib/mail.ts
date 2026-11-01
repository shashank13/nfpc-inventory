/**
 * Email for "Forgot password" links. Set MAIL_TRANSPORT in .env:
 *   none   — off; requests appear under Users & roles → Reset requests
 *   smtp   — any SMTP server, e.g. Gmail with an App password (local and Vercel)
 *   resend — Resend's HTTP API (works everywhere, no SMTP server needed)
 */
import { env } from "./config";
import { validEmail } from "./format";

export type MailResult = { ok: true } | { ok: false; error: string };

const transport = () => env("MAIL_TRANSPORT").toLowerCase();
export const mailEnabled = () => transport() === "smtp" || transport() === "resend";
export const mailFrom = () => env("MAIL_FROM") || env("SMTP_USER");
const fromName = () => env("MAIL_FROM_NAME") || "Nitte FPC Inventory";

/** Send a plain-text email. Failures come back as a message a Super Admin can act on. */
export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  if (!mailEnabled()) return { ok: false, error: "Email is switched off. Set MAIL_TRANSPORT to 'smtp' or 'resend' in the settings (.env)." };
  if (!validEmail(to)) return { ok: false, error: "Invalid recipient address." };
  try {
    return transport() === "resend" ? await viaResend(to, subject, text) : await viaSmtp(to, subject, text);
  } catch (e) {
    console.error("sendMail:", e);
    return { ok: false, error: e instanceof Error ? e.message : "The email could not be sent." };
  }
}

async function viaSmtp(to: string, subject: string, text: string): Promise<MailResult> {
  const user = env("SMTP_USER"), pass = env("SMTP_PASS");
  if (!user || !pass) return { ok: false, error: "Fill in SMTP_USER and SMTP_PASS in the settings (.env)." };
  const host = env("SMTP_HOST") || "smtp.gmail.com";
  const port = Number(env("SMTP_PORT") || 587);
  const secure = env("SMTP_SECURE").toLowerCase() || "tls";
  const nodemailer = (await import("nodemailer")).default;
  const tx = nodemailer.createTransport({
    host, port, secure: secure === "ssl", requireTLS: secure === "tls", auth: { user, pass },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
  });
  try {
    await tx.sendMail({ from: { name: fromName(), address: mailFrom() }, to, subject, text });
    return { ok: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("smtp:", m);
    if (/\b535\b|BadCredentials|Invalid login/i.test(m)) {
      return { ok: false, error: "Gmail rejected the username or password. Use a 16-letter App password (not your normal Gmail password), and check SMTP_USER is the full Gmail address." };
    }
    if (/\b534\b/.test(m)) return { ok: false, error: "Gmail requires an App password. Turn on 2-Step Verification, then create one at https://myaccount.google.com/apppasswords" };
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout/i.test(m)) {
      return { ok: false, error: `Can't reach ${host}:${port}. Check the internet connection, or a firewall/antivirus blocking outgoing mail.` };
    }
    return { ok: false, error: m };
  } finally {
    tx.close();
  }
}

async function viaResend(to: string, subject: string, text: string): Promise<MailResult> {
  const key = env("RESEND_API_KEY");
  if (!key) return { ok: false, error: "Fill in RESEND_API_KEY in the settings." };
  if (!mailFrom()) return { ok: false, error: "Set MAIL_FROM to an address on a domain verified in Resend." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${fromName()} <${mailFrom()}>`, to: [to], subject, text }),
  });
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => "");
  console.error("resend:", res.status, body);
  return { ok: false, error: `The email service refused the message (${res.status}). ${body.slice(0, 200)}` };
}
