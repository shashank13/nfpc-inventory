/**
 * JSON API for the pages — same protocol as the old api.php:
 *   GET  /api?action=list | items | sku_next | dashboard | admin_data | activity_list | activity_export
 *   POST /api?action=items_lookup | sku_settings_save | save | delete | delete_many | bulk | template_save | template_delete | log_event |
 *        user_save | user_delete | user_password | user_reset_link | user_unlock | mail_test |
 *        reset_dismiss | role_save | role_delete | logout | impersonate_start | impersonate_stop
 *
 * Every request must send "X-Requested-With: XMLHttpRequest". Browsers won't let another website
 * add that header to a cross-site request, so this blocks CSRF attacks.
 */
import type { NextRequest } from "next/server";
import { audit, can, currentUser, endImpersonation, isImpersonating, startImpersonation } from "@/lib/auth";
import { createCtx, destroySession, persistSession, SESSION_COOKIE, type Ctx } from "@/lib/context";
import { cut } from "@/lib/format";
import { jsonResponse } from "@/lib/json";
import { AppError, isUniqueViolation, val, type ApiCtx, type Input } from "@/lib/api/common";
import * as inv from "@/lib/api/inventory";
import * as admin from "@/lib/api/admin";
import * as reports from "@/lib/api/reports";

export const dynamic = "force-dynamic";

type Handler = (ctx: ApiCtx) => Promise<Record<string, unknown>>;

const GET_ACTIONS: Record<string, Handler> = {
  list: inv.list,
  items: inv.items,
  sku_next: inv.skuNext,
  dashboard: reports.dashboard,
  admin_data: admin.adminData,
  activity_list: (c) => reports.activity(c, false),
  activity_export: (c) => reports.activity(c, true),
};

const POST_ACTIONS: Record<string, Handler> = {
  save: inv.save,
  items_lookup: inv.itemsLookup,
  sku_settings_save: inv.skuSettingsSave,
  delete: inv.remove,
  delete_many: inv.removeMany,
  bulk: inv.bulk,
  template_save: inv.templateSave,
  template_delete: inv.templateDelete,
  log_event: inv.logEvent,
  user_save: admin.userSave,
  user_delete: admin.userDelete,
  user_password: admin.userPassword,
  user_reset_link: admin.userResetLink,
  user_unlock: admin.userUnlock,
  mail_test: admin.mailTest,
  reset_dismiss: admin.resetDismiss,
  role_save: admin.roleSave,
  role_delete: admin.roleDelete,
};

const fail = (error: string, status = 400) => jsonResponse({ ok: false, error }, status, null);

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "list";
  const isGet = action in GET_ACTIONS;

  if (req.headers.get("x-requested-with") !== "XMLHttpRequest") return fail("Bad request.", 403);
  if (!isGet) {
    if (req.method !== "POST") return fail("Use POST for this action.", 405);
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("Bad request.", 415);
  }

  let ctx: Ctx;
  try {
    ctx = await createCtx(req.headers, req.cookies.get(SESSION_COOKIE)?.value, true);
  } catch (e) {
    console.error("api: database connection error:", e);
    return fail("Could not connect to the database. Check that PostgreSQL is running and DATABASE_URL in the settings (.env).", 500);
  }

  // Respond and save the session (sets a new cookie when the session changed identity).
  const accept = req.headers.get("accept-encoding");
  const done = async (data: unknown, status = 200) => jsonResponse(data, status, accept, await persistSession(ctx));

  let parsed: Input | null = null;
  const body = async (): Promise<Input> => {
    if (parsed) return parsed;
    try {
      const d = await req.json();
      parsed = d && typeof d === "object" && !Array.isArray(d) ? d : {};
    } catch {
      parsed = {};
    }
    return parsed!;
  };

  try {
    const me = await currentUser(ctx);
    if (!me) return done({ ok: false, error: "Please sign in." }, 401);

    // Impersonation changes the session, so it's handled before anything else.
    if (action === "logout" && isImpersonating(ctx)) {
      await endImpersonation(ctx); // "Sign out" while viewing as someone returns to your own account
      return done({ ok: true, returned: true });
    }
    if (action === "logout") {
      await audit(ctx, { event: "logout", actorId: me.id, actorName: me.username });
      destroySession(ctx);
      return done({ ok: true });
    }
    if (action === "impersonate_stop") {
      await endImpersonation(ctx);
      return done({ ok: true });
    }
    if (action === "impersonate_start") {
      if (isImpersonating(ctx)) return done({ ok: false, error: "Return to your own account first." }, 400);
      if (!can(me, "users.manage")) return done({ ok: false, error: "Only a Super Admin can view the app as someone else." }, 403);
      const p = await body();
      const err = await startImpersonation(ctx, me, String(val(p, "mode")), Math.trunc(Number(val(p, "id", 0))) || 0, cut(val(p, "reason"), 150).trim());
      return err ? done({ ok: false, error: err }, 400) : done({ ok: true });
    }
    if (me.mustChange) return done({ ok: false, code: "must_change", error: "Set a new password to continue." }, 403);

    const handler = isGet ? GET_ACTIONS[action] : POST_ACTIONS[action];
    if (!handler) return done({ ok: false, error: "Unknown action." }, 404);
    const apiCtx = Object.assign(ctx, { me, url, body }) as ApiCtx;
    return done(await handler(apiCtx));
  } catch (e) {
    if (e instanceof AppError) return done({ ok: false, error: e.message, ...e.extra }, e.status);
    if (isUniqueViolation(e)) {
      return done({ ok: false, error: action === "save" || action === "bulk" ? "This SKU already exists — generate a new one." : "That name is already in use." }, 409);
    }
    console.error(`api ${action} error:`, e); // details go to the server log, not the browser
    try {
      return await done({ ok: false, error: "Server error. Please try again." }, 500);
    } catch {
      return fail("Server error. Please try again.", 500);
    }
  }
}

export const GET = handle;
export const POST = handle;
