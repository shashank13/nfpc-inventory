/**
 * Helpers for server-rendered pages and for the form posts behind them.
 *
 * Pages (Server Components) can read the session but not set cookies, so every form posts to a
 * route handler under /auth/*, which does the work and redirects back (Post/Redirect/Get), the
 * same flow as the old PHP pages. Form posts are protected against CSRF by checking the Origin
 * header (plus SameSite=Lax cookies).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { NextRequest } from "next/server";
import { currentUser, type CurrentUser } from "./auth";
import { createCtx, persistSession, SESSION_COOKIE, type Ctx } from "./context";
import type { ApiCtx } from "./api/common";

/** Context for a Server Component page. */
export async function pageCtx(): Promise<Ctx> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return createCtx(h, c.get(SESSION_COOKIE)?.value, false);
}

/** Save session changes made while rendering a page (flash messages read, last-seen time, …). */
export async function savePage(ctx: Ctx) {
  try {
    await persistSession(ctx);
  } catch (e) {
    console.error("session save failed:", e);
  }
}

/**
 * For signed-in pages: returns the context and user, or redirects to sign-in (and to the
 * password page when a new password must be chosen first).
 */
export const requireUser = (opts: { allowMustChange?: boolean } = {}) => requireUserOnce(!!opts.allowMustChange);

// Cached per request (React cache), so generateMetadata and the page share one lookup.
const requireUserOnce = cache(async (allowMustChange: boolean): Promise<{ ctx: Ctx; me: CurrentUser }> => {
  let ctx: Ctx | null = null;
  let me: CurrentUser | null = null;
  try {
    ctx = await pageCtx();
    me = await currentUser(ctx);
    await savePage(ctx);
  } catch (e) {
    console.error("page: database error:", e);
  }
  if (!ctx || !me) redirect("/login");
  if (me.mustChange && !allowMustChange) redirect("/account");
  return { ctx, me };
});

/* ----------------------------------------------------------- form posts */

/** Context for a form-post route handler (can set cookies). */
export function formCtx(req: NextRequest): Promise<Ctx> {
  return createCtx(req.headers, req.cookies.get(SESSION_COOKIE)?.value, true);
}

/** Reject form posts that come from another website. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

/** Form fields as strings. */
export async function readForm(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  } catch {
    /* not a form */
  }
  return out;
}

/** 303 redirect to a path on this site, saving the session first. */
export async function redirectTo(ctx: Ctx | null, path: string): Promise<Response> {
  const h = new Headers({ Location: path, "Cache-Control": "no-store" });
  if (ctx) {
    try {
      const cookie = await persistSession(ctx);
      if (cookie) h.append("Set-Cookie", cookie);
    } catch (e) {
      console.error("session save failed:", e);
    }
  }
  return new Response(null, { status: 303, headers: h });
}

/** Remember what a form showed (error text, typed values) for the page after the redirect. */
export function setForm(ctx: Ctx, data: Record<string, string | boolean>) {
  ctx.session.data.form = data;
  ctx.session.touch();
}

/** Read and forget the remembered form state. */
export function takeForm(ctx: Ctx): Record<string, string | boolean> {
  const f = ctx.session.data.form ?? {};
  if (ctx.session.data.form) {
    delete ctx.session.data.form;
    ctx.session.touch();
  }
  return f;
}

/** One-time message after a redirect. */
export function setFlash(ctx: Ctx, type: string, msg: string) {
  ctx.session.data.flash_msg = [type, msg];
  ctx.session.touch();
}

export function takeFlash(ctx: Ctx): [string, string] | null {
  const f = ctx.session.data.flash_msg ?? null;
  if (f) {
    delete ctx.session.data.flash_msg;
    ctx.session.touch();
  }
  return f;
}

/**
 * Run API handlers while rendering a page, so their results can be embedded in the HTML
 * (see components/app-page.tsx). Keys are the exact `action&params` strings the page's script
 * requests; a failing handler is simply left out (the page then fetches it as usual).
 */
export async function preloadApi(
  ctx: Ctx,
  me: CurrentUser,
  handlers: Record<string, (c: ApiCtx) => Promise<Record<string, unknown>>>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(handlers).map(async ([key, handler]) => {
      const [action, ...rest] = key.split("&");
      const url = new URL(`http://local/api?action=${action}${rest.length ? "&" + rest.join("&") : ""}`);
      try {
        out[key] = await handler({ ...ctx, me, url, body: async () => ({}) });
      } catch (e) {
        console.error(`preload ${key} failed:`, e);
      }
    }),
  );
  return out;
}
