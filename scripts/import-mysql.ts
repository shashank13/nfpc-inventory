/**
 * Copy all data from the old PHP/MySQL system into PostgreSQL.
 *
 *   1. Open the old PHP app once (so its database is on the latest schema, version 5).
 *   2. Set MYSQL_URL and DATABASE_URL (+ DIRECT_URL for Supabase) in .env.
 *   3. npm run db:migrate
 *   4. npm run import:mysql -- --yes
 *
 * Everything already in the PostgreSQL tables is REPLACED (that's what --yes confirms).
 * IDs are kept, so links between records stay intact. Existing passwords keep working: the old
 * bcrypt hashes are verified as-is and upgraded automatically at each user's next sign-in.
 */
try { process.loadEnvFile(".env"); } catch { /* use the real environment */ }

import mysql from "mysql2/promise";
import postgres from "postgres";
import { directDatabaseUrl } from "../src/db/url";

const BATCH = 500;
const TZ_OFFSET = "+05:30"; // the PHP app stored times in India time (Asia/Kolkata)
const PERMS = new Set(["products.create", "products.edit", "products.delete", "products.import", "labels.print", "templates.manage", "reports.export", "activity.view"]);

type Row = Record<string, unknown>;

/** MySQL "YYYY-MM-DD HH:MM:SS" (India time) → Date, or null. */
const ts = (v: unknown) => (v == null || v === "" ? null : new Date(String(v).replace(" ", "T") + TZ_OFFSET));
const bool = (v: unknown) => Number(v) === 1;
const json = (v: unknown) => {
  if (v == null || v === "") return null;
  try { return JSON.parse(String(v)); } catch { return null; }
};

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log("This replaces ALL data in the PostgreSQL database with the data from MySQL.\nRun again with --yes to continue:  npm run import:mysql -- --yes");
    process.exit(1);
  }
  const myUrl = process.env.MYSQL_URL, pgUrl = directDatabaseUrl();
  if (!myUrl || !pgUrl) throw new Error("Set MYSQL_URL in .env first.");

  const my = await mysql.createConnection({ uri: myUrl, dateStrings: true, timezone: TZ_OFFSET, supportBigNumbers: true, bigNumberStrings: true });
  const pg = postgres(pgUrl, { max: 1, onnotice: () => {} });
  try {
    const all = async (q: string) => (await my.query(q))[0] as Row[];

    let version = 0;
    try { version = Number((await all("SELECT v FROM app_meta WHERE k = 'schema_version'"))[0]?.v ?? 0); } catch { /* very old install */ }
    if (version < 5) throw new Error(`The MySQL database is on schema version ${version}. Open the old PHP app once so it upgrades itself to version 5, then run this again.`);

    const roles = await all("SELECT * FROM roles ORDER BY id");
    const superId = roles.find((r) => bool(r.is_super))?.id;
    const users = await all("SELECT * FROM users ORDER BY id");
    const userIds = new Set(users.map((u) => String(u.id)));
    const categories = await all("SELECT * FROM categories ORDER BY id");
    const products = await all("SELECT * FROM products ORDER BY id");
    const moves = await all("SELECT * FROM stock_movements ORDER BY id");
    const templates = await all("SELECT * FROM label_templates ORDER BY id");
    const resets = await all("SELECT * FROM password_resets ORDER BY id");
    const audit = await all("SELECT * FROM audit_log ORDER BY id");

    await pg.begin(async (tx) => {
      await tx`TRUNCATE sessions, audit_log, password_resets, stock_movements, products, label_templates, categories, users, roles RESTART IDENTITY CASCADE`;

      const insert = async (table: string, rows: Row[]) => {
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          await tx`INSERT INTO ${tx(table)} ${tx(chunk as Record<string, postgres.ParameterOrJSON<never>>[])}`;
        }
        console.log(`  ${table}: ${rows.length}`);
      };

      await insert("roles", roles.map((r) => ({
        id: r.id, name: r.name, description: r.description ?? "",
        permissions: [...new Set(String(r.permissions ?? "").split(",").filter((p) => PERMS.has(p)))],
        is_super: bool(r.is_super), created_at: ts(r.created_at) ?? new Date(), updated_at: ts(r.updated_at),
      })));
      await insert("users", users.map((u) => ({
        id: u.id, username: u.username, full_name: u.full_name ?? "", email: u.email || null, password_hash: u.password_hash,
        role_id: u.role_id ?? superId, is_active: bool(u.is_active), must_change_pw: bool(u.must_change_pw),
        failed_logins: Number(u.failed_logins ?? 0), locked_until: ts(u.locked_until), pw_changed_at: ts(u.pw_changed_at),
        session_epoch: Number(u.session_epoch ?? 1), created_by: u.created_by != null && userIds.has(String(u.created_by)) ? u.created_by : null,
        last_login: ts(u.last_login), created_at: ts(u.created_at) ?? new Date(), updated_at: ts(u.updated_at),
      })));
      await insert("categories", categories.map((c) => ({
        id: c.id, name: c.name, code: c.code, color: c.color, shelf_life_days: c.shelf_life_days, default_unit: c.default_unit,
        sort_order: c.sort_order, created_at: ts(c.created_at) ?? new Date(),
      })));
      await insert("products", products.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, category_id: p.category_id, grade: p.grade ?? "", pack_size: p.pack_size, unit: p.unit,
        qty: p.qty, mrp: p.mrp, location: p.location ?? "", batch_no: p.batch_no, sourced_from: p.sourced_from ?? "",
        packed_on: p.packed_on, best_before: p.best_before, created_at: ts(p.created_at) ?? new Date(), updated_at: ts(p.updated_at),
      })));
      await insert("stock_movements", moves.map((m) => ({
        id: m.id, product_id: m.product_id, sku: m.sku, product_name: m.product_name, action: m.action, username: m.username ?? "",
        qty_before: m.qty_before, qty_after: m.qty_after, note: m.note ?? "", created_at: ts(m.created_at) ?? new Date(),
      })));
      // Exactly one default template (the old schema didn't enforce it).
      let seenDefault = false;
      await insert("label_templates", templates.map((t) => {
        const isDefault = bool(t.is_default) && !seenDefault;
        seenDefault ||= isDefault;
        return { id: t.id, name: t.name, settings: tx.json(json(t.settings) ?? {}), is_default: isDefault, created_at: ts(t.created_at) ?? new Date(), updated_at: ts(t.updated_at) };
      }));
      if (!seenDefault && templates.length) await tx`UPDATE label_templates SET is_default = true WHERE id = (SELECT min(id) FROM label_templates)`;
      await insert("password_resets", resets.filter((r) => userIds.has(String(r.user_id))).map((r) => ({
        id: r.id, user_id: r.user_id, token_hash: r.token_hash, expires_at: ts(r.expires_at), used_at: ts(r.used_at),
        via_admin: bool(r.via_admin), mail_sent: bool(r.mail_sent), dismissed: bool(r.dismissed), requested_ip: r.requested_ip ?? "",
        created_at: ts(r.created_at) ?? new Date(),
      })));
      const cats = new Set(["inventory", "labels", "admin", "auth", "security", "other"]);
      await insert("audit_log", audit.map((a) => ({
        id: a.id, user_id: a.user_id, username: a.username ?? "", via: a.via ?? "", event: a.event,
        category: cats.has(String(a.category)) ? a.category : "other", detail: a.detail ?? "", target: a.target ?? "",
        changes: a.changes ? tx.json(json(a.changes)) : null, ip: a.ip ?? "", created_at: ts(a.created_at) ?? new Date(),
      })));

      // Continue numbering after the imported IDs.
      for (const t of ["roles", "users", "categories", "products", "stock_movements", "label_templates", "password_resets", "audit_log"]) {
        await tx.unsafe(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce(max(id), 1), max(id) IS NOT NULL) FROM ${t}`);
      }
    });
    console.log("Import finished. Everyone signs in with their existing username and password.");
  } finally {
    await my.end();
    await pg.end();
  }
}

main().catch((e) => {
  console.error("Import failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
