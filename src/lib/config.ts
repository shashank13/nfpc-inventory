/** App-wide settings (same values as the old PHP app). */

export const TZ = "Asia/Kolkata";

export const SESSION_IDLE_SECONDS = 8 * 3600; // sign out after 8 hours of inactivity
export const SESSION_MAX_SECONDS = 12 * 3600; // and always after 12 hours, even if active
export const MAX_FAILED_LOGINS = 5; // per account, before a temporary lock
export const LOCK_MINUTES = 15;
export const MAX_FAILED_PER_IP = 20; // per IP address within LOCK_MINUTES
export const RESET_TOKEN_MINUTES = 30; // self-service "forgot password" link
export const ADMIN_RESET_TOKEN_HOURS = 24; // link created by a Super Admin
export const IMPERSONATE_SECONDS = 60 * 60;

export const MAX_BULK_ROWS = 5000;
export const MAX_LOGO_CHARS = 500_000; // ~370 KB image; the page shrinks logos before upload
export const LOW_STOCK = 10;

export const UNITS = ["kg", "g", "L", "ml", "pcs", "dozen", "bunch"] as const;
export type Unit = (typeof UNITS)[number];

/** Everything a role can be allowed to do. Viewing the inventory is always allowed. */
export const PERMISSIONS = {
  "products.create": { group: "Inventory", label: "Add products", hint: "Create new product batches and scan in new barcodes." },
  "products.edit": { group: "Inventory", label: "Edit products & stock", hint: "Change product details and stock quantities." },
  "products.delete": { group: "Inventory", label: "Delete products", hint: "Permanently remove product batches." },
  "products.import": { group: "Inventory", label: "Bulk upload", hint: "Import or update many products from CSV / Excel." },
  "labels.print": { group: "Labels", label: "Print & download labels", hint: "Print labels and download barcodes (PNG, SVG, ZIP)." },
  "templates.manage": { group: "Labels", label: "Manage label templates", hint: "Create, edit and delete label designs." },
  "reports.export": { group: "Reports", label: "Export inventory (CSV)", hint: "Download the full inventory as a spreadsheet." },
  "activity.view": { group: "Reports", label: "View activity log", hint: "See everyone's activity: product changes, printing, exports, sign-ins and user changes." },
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Keep only known permission keys (from an array or the old comma-separated text). */
export function cleanPermissions(list: unknown): Permission[] {
  const arr = typeof list === "string" ? list.split(",") : Array.isArray(list) ? list : [];
  const out: Permission[] = [];
  for (const p of arr) if (typeof p === "string" && p in PERMISSIONS && !out.includes(p as Permission)) out.push(p as Permission);
  return out;
}

export type AuditCategory = "inventory" | "labels" | "admin" | "auth" | "security" | "other";

/** Which activity-log tab an event belongs to. */
const EVENT_CATEGORY: Record<string, AuditCategory> = {
  login: "auth", logout: "auth", login_failed: "auth", login_blocked: "auth", signout_others: "auth", setup: "auth",
  account_locked: "security", user_unlocked: "security", password_changed: "security", password_reset: "security",
  password_set_by_admin: "security", reset_requested: "security", reset_link_created: "security",
  profile_updated: "security", mail_test: "security", impersonation_started: "security", impersonation_ended: "security",
  user_created: "admin", user_updated: "admin", user_deleted: "admin", role_created: "admin", role_updated: "admin", role_deleted: "admin",
  product_created: "inventory", product_updated: "inventory", product_deleted: "inventory", product_imported: "inventory", bulk_import: "inventory",
  template_created: "labels", template_updated: "labels", template_deleted: "labels",
  labels_printed: "labels", labels_downloaded: "labels", inventory_exported: "labels", sku_format_updated: "labels",
};
export const eventCategory = (event: string): AuditCategory => EVENT_CATEGORY[event] ?? "other";

/** Read a setting from the environment (.env locally, Project → Settings → Environment Variables on Vercel). */
export const env = (name: string) => (process.env[name] ?? "").trim();

/** Credit shown in every page footer. */
export const DEVELOPER = { name: "Inspirante Technologies Pvt. Ltd.", url: "https://inspirantech.in/" };

/** Copyright holder shown in every page footer ("© <year> … All rights reserved."). */
export const COPYRIGHT_OWNER = "Inspirante Technologies Pvt. Ltd.";
