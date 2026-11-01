/**
 * Database schema (PostgreSQL, managed with Drizzle).
 *
 * Compared with the old MySQL schema:
 *  - usernames, emails, SKUs and names use `citext`, so they stay case-insensitive (as MySQL's
 *    *_ci collation was) for both look-ups and uniqueness;
 *  - fixed value lists are real enums, role permissions are a text[] and JSON is stored as jsonb;
 *  - CHECK constraints keep impossible data out (negative stock, best-before before packed date…);
 *  - indexes match the queries the app actually runs, and unused ones were dropped;
 *  - sessions live in the database, so the app runs without a server filesystem (Vercel serverless functions);
 *  - row-level security is on for every table with no policies: Supabase's public REST API (anon /
 *    authenticated keys) can't read or change anything, while the app, connecting as the table owner,
 *    is unaffected.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Text searched by the activity log's search box: the searchable columns joined with a separator
 * that can't be typed, so a match never spans two columns. Indexed with pg_trgm (idx_audit_search);
 * queries must use exactly this expression to hit the index.
 */
export const AUDIT_SEARCH_EXPR = `target || chr(1) || detail || chr(1) || username || chr(1) || via || chr(1) || event || chr(1) || ip`;

/**
 * Text searched by the stock list's search box (name, SKU, batch, grade, source, location).
 * `prefix` is the table alias used in a query ("p."); the index uses none. Indexed with pg_trgm
 * (idx_products_search), so "contains" searches stay fast with large inventories.
 */
export const productSearchExpr = (prefix = "") =>
  ["name", "sku::text", "batch_no", "grade", "sourced_from", "location"].map((c) => prefix + c).join(" || chr(1) || ");

/** Case-insensitive text (PostgreSQL `citext` extension, enabled in the first migration). */
const citext = customType<{ data: string }>({ dataType: () => "citext" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */

export const unitEnum = pgEnum("unit", ["kg", "g", "L", "ml", "pcs", "dozen", "bunch"]);
export const stockActionEnum = pgEnum("stock_action", ["create", "update", "import", "delete"]);
export const auditCategoryEnum = pgEnum("audit_category", [
  "inventory",
  "labels",
  "admin",
  "auth",
  "security",
  "other",
]);

/* ------------------------------------------------------------ inventory */

/** Product categories. `code` is used inside generated SKUs (NFPC-GRP-12345). */
export const categories = pgTable(
  "categories",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: citext("name").notNull(),
    code: varchar("code", { length: 10 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#6b7a8f"),
    shelfLifeDays: integer("shelf_life_days").notNull().default(180),
    defaultUnit: unitEnum("default_unit").notNull().default("pcs"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_categories_name").on(t.name),
    uniqueIndex("uq_categories_code").on(t.code),
    check("ck_categories_life", sql`${t.shelfLifeDays} >= 0`),
  ],
).enableRLS();

/** One row per product batch, each with its own barcode (SKU). */
export const products = pgTable(
  "products",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    sku: citext("sku").notNull(), // Code 128 barcode value
    name: varchar("name", { length: 150 }).notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onUpdate: "cascade", onDelete: "restrict" }),
    grade: varchar("grade", { length: 100 }).notNull().default(""),
    packSize: numeric("pack_size", { precision: 10, scale: 3 }).notNull().default("1"),
    unit: unitEnum("unit").notNull().default("kg"),
    qty: integer("qty").notNull().default(0), // packs in stock
    mrp: numeric("mrp", { precision: 10, scale: 2 }).notNull().default("0"), // INR per pack
    location: varchar("location", { length: 100 }).notNull().default(""),
    batchNo: varchar("batch_no", { length: 50 }).notNull(),
    sourcedFrom: varchar("sourced_from", { length: 150 }).notNull().default(""),
    packedOn: date("packed_on", { mode: "string" }).notNull(),
    bestBefore: date("best_before", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_products_sku").on(t.sku),
    index("idx_products_category").on(t.categoryId),
    index("idx_products_best_before").on(t.bestBefore),
    // Stock list order (newest first). Plain ascending btree indexes are scanned backwards for
    // ORDER BY … DESC; a "DESC NULLS LAST" index would NOT match that order and be ignored.
    index("idx_products_recent").on(t.createdAt, t.id),
    index("idx_products_search").using("gin", sql.raw(`(${productSearchExpr()}) gin_trgm_ops`)),
    check("ck_products_qty", sql`${t.qty} >= 0`),
    check("ck_products_mrp", sql`${t.mrp} >= 0`),
    check("ck_products_pack", sql`${t.packSize} > 0`),
    check("ck_products_dates", sql`${t.bestBefore} >= ${t.packedOn}`),
  ],
).enableRLS();

/**
 * Stock ledger: every add / edit / import / delete. product_id becomes NULL when the product is
 * deleted; sku and name are kept. qty_change is computed by the database.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    productId: integer("product_id").references(() => products.id, {
      onUpdate: "cascade",
      onDelete: "set null",
    }),
    sku: varchar("sku", { length: 64 }).notNull(),
    productName: varchar("product_name", { length: 150 }).notNull(),
    action: stockActionEnum("action").notNull(),
    username: varchar("username", { length: 50 }).notNull().default(""),
    qtyBefore: integer("qty_before").notNull().default(0),
    qtyAfter: integer("qty_after").notNull().default(0),
    qtyChange: integer("qty_change").generatedAlwaysAs(sql`qty_after - qty_before`),
    note: varchar("note", { length: 255 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    // Dashboard chart: covers created_at + qty_change, so it's answered from the index alone.
    index("idx_moves_created").on(t.createdAt, t.qtyChange),
    index("idx_moves_product").on(t.productId),
  ],
).enableRLS();

/** Label designs. `settings` is the template JSON (the logo is a small data URI inside it). */
export const labelTemplates = pgTable(
  "label_templates",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: citext("name").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_label_templates_name").on(t.name),
    // At most one default template.
    uniqueIndex("uq_label_templates_default").on(t.isDefault).where(sql`${t.isDefault}`),
  ],
).enableRLS();

/* -------------------------------------------------------- users & roles */

export const roles = pgTable(
  "roles",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: citext("name").notNull(),
    description: varchar("description", { length: 255 }).notNull().default(""),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    isSuper: boolean("is_super").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_roles_name").on(t.name)],
).enableRLS();

export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    username: citext("username").notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull().default(""),
    email: citext("email"),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onUpdate: "cascade", onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePw: boolean("must_change_pw").notNull().default(false),
    failedLogins: smallint("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    pwChangedAt: timestamp("pw_changed_at", { withTimezone: true }),
    sessionEpoch: integer("session_epoch").notNull().default(1),
    createdBy: integer("created_by").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    lastLogin: timestamp("last_login", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_users_username").on(t.username),
    uniqueIndex("uq_users_email").on(t.email),
    index("idx_users_role").on(t.roleId),
    check("ck_users_username", sql`char_length(${t.username}) between 3 and 50`),
    check("ck_users_email", sql`${t.email} is null or char_length(${t.email}) <= 190`),
  ],
).enableRLS();

export const passwordResets = pgTable(
  "password_resets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade", onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(), // sha256 of the emailed token
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    viaAdmin: boolean("via_admin").notNull().default(false),
    mailSent: boolean("mail_sent").notNull().default(false),
    dismissed: boolean("dismissed").notNull().default(false),
    requestedIp: varchar("requested_ip", { length: 45 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_resets_token").on(t.tokenHash),
    index("idx_resets_user").on(t.userId, t.createdAt),
    // "Reset requests" waiting for a Super Admin.
    index("idx_resets_pending")
      .on(t.createdAt)
      .where(
        sql`${t.viaAdmin} = false and ${t.mailSent} = false and ${t.dismissed} = false and ${t.usedAt} is null`,
      ),
  ],
).enableRLS();

/**
 * One activity log for everything. user_id has no foreign key on purpose: entries stay
 * after a user is deleted. `via` records the Super Admin who acted while viewing as someone.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id"),
    username: varchar("username", { length: 50 }).notNull().default(""),
    via: varchar("via", { length: 80 }).notNull().default(""),
    event: varchar("event", { length: 40 }).notNull(),
    category: auditCategoryEnum("category").notNull().default("other"),
    detail: varchar("detail", { length: 500 }).notNull().default(""),
    target: varchar("target", { length: 190 }).notNull().default(""),
    changes: jsonb("changes").$type<[string, string, string][]>(),
    ip: varchar("ip", { length: 45 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_audit_created").on(t.createdAt, t.id),
    index("idx_audit_cat").on(t.category, t.createdAt),
    index("idx_audit_user").on(t.username, t.createdAt),
    // Sign-in / reset rate limits (by IP and by typed username).
    index("idx_audit_event_ip").on(t.event, t.ip, t.createdAt),
    index("idx_audit_event_user").on(t.event, t.username, t.createdAt),
    // Activity-log search ("contains" on several columns) via trigrams (pg_trgm).
    index("idx_audit_search").using("gin", sql.raw(`(${AUDIT_SEARCH_EXPR}) gin_trgm_ops`)),
  ],
).enableRLS();

/** App-wide settings as key → JSON (e.g. "sku": the SKU format). Small, read by key. */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"), // no FK: the setting stays if that user is deleted
}).enableRLS();

/** Sign-in sessions. `id` is the sha256 of the cookie value, so a database leak can't be replayed. */
export const sessions = pgTable(
  "sessions",
  {
    id: char("id", { length: 64 }).primaryKey(),
    userId: integer("user_id"), // no FK: a session may briefly outlive its user; it's then rejected
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  // No index on expires_at on purpose: it changes on every save, and an index on it would stop
  // PostgreSQL from updating rows in place (HOT updates). Expired rows are deleted in bulk at sign-in.
  (t) => [index("idx_sessions_user").on(t.userId)],
).enableRLS();
