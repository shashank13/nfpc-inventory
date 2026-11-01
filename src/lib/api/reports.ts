/** Dashboard figures and the activity log. Totals are calculated in the database. */
import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth";
import { AUDIT_SEARCH_EXPR } from "@/db/schema";
import { LOW_STOCK, TZ } from "../config";
import { addDays, cut, stamp, today, validDate } from "../format";
import type { ApiCtx } from "./common";
import { requirePerm } from "./inventory";

/** Today's date in the app's time zone, as SQL. */
const TODAY = sql.raw(`((now() at time zone '${TZ}')::date)`);
/** Start of a YYYY-MM-DD day in the app's time zone, as a timestamptz. */
const dayStart = (ymd: string) => sql`((${ymd}::date)::timestamp at time zone ${TZ})`;

const n = (v: unknown) => Number(v ?? 0) || 0;

async function rows<T = Record<string, unknown>>(ctx: ApiCtx, q: SQL): Promise<T[]> {
  return (await ctx.db.execute(q)) as unknown as T[];
}

export async function dashboard(ctx: ApiCtx) {
  let days = Math.trunc(Number(ctx.url.searchParams.get("days") ?? 30));
  if (![7, 30, 90].includes(days)) days = 30;
  const LOW = LOW_STOCK;
  const t = today();
  const from = addDays(t, -(days - 1));
  const withActivity = can(ctx.me, "activity.view");

  const list = (where: SQL, order: SQL) =>
    rows(ctx, sql`
      select p.id, p.sku, p.name, c.name as category, p.pack_size, p.unit, p.qty, p.mrp, to_char(p.best_before, 'YYYY-MM-DD') as best
      from products p join categories c on c.id = p.category_id where ${where} order by ${order} limit 8`).then((rs) =>
      rs.map((r) => ({
        id: String(r.id), sku: String(r.sku), name: String(r.name), cat: String(r.category), net: n(r.pack_size), unit: String(r.unit),
        qty: n(r.qty), price: n(r.mrp), best: String(r.best), value: Math.round(n(r.qty) * n(r.mrp) * 100) / 100,
      })));

  // All queries are independent: send them together and wait once.
  const [[kRow], catRows, moveRows, weekRows, topValue, lowStock, expiringSoon, actRows, recentRows] = await Promise.all([
    rows(ctx, sql`
      select count(*)::int as products, coalesce(sum(qty), 0)::float8 as units, coalesce(sum(qty * mrp), 0)::float8 as value,
        count(*) filter (where qty <= 0)::int as out_stock,
        count(*) filter (where qty > 0 and qty < ${LOW})::int as low_stock,
        count(*) filter (where qty >= ${LOW})::int as ok_stock,
        count(*) filter (where best_before >= ${TODAY} and best_before <= ${TODAY} + 15)::int as expiring,
        count(*) filter (where best_before < ${TODAY})::int as expired,
        count(*) filter (where best_before < ${TODAY} and qty > 0)::int as expired_in_stock
      from products`),
    rows(ctx, sql`
      select c.name as cat, c.color, count(p.id)::int as products, coalesce(sum(p.qty), 0)::float8 as units,
        count(*) filter (where p.qty > 0 and p.qty < ${LOW})::int as low,
        count(*) filter (where p.id is not null and p.qty <= 0)::int as out_stock,
        coalesce(sum(p.qty * p.mrp), 0)::float8 as value
      from categories c left join products p on p.category_id = c.id
      group by c.id, c.name, c.color, c.sort_order
      order by value desc, products desc, c.sort_order`),
    // Stock added / removed per day (from the stock ledger; answered from idx_moves_created).
    rows(ctx, sql`
      select to_char((created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as d,
        coalesce(sum(greatest(qty_change, 0)), 0)::float8 as added, coalesce(sum(greatest(-qty_change, 0)), 0)::float8 as removed
      from stock_movements where created_at >= ${dayStart(from)} group by 1`),
    // Batches expiring in each of the next 12 weeks.
    rows(ctx, sql`
      select ((best_before - ${TODAY}) / 7)::int as w, count(*)::int as batches, coalesce(sum(qty), 0)::float8 as units
      from products where best_before >= ${TODAY} and best_before < ${TODAY} + 84 group by 1`),
    list(sql`p.qty > 0`, sql`p.qty * p.mrp desc`),
    list(sql`p.qty < ${LOW}`, sql`p.qty asc, p.name`),
    list(sql`p.best_before <= ${TODAY} + 15`, sql`(p.best_before < ${TODAY}) desc, p.best_before asc`),
    withActivity
      ? rows(ctx, sql`
          select count(*) filter (where event in ('product_created', 'product_imported'))::int as added_products,
            count(*) filter (where event = 'product_updated')::int as edits,
            count(*) filter (where event = 'product_deleted')::int as deletes,
            count(*) filter (where event = 'labels_printed')::int as prints,
            count(*) filter (where event = 'labels_downloaded')::int as downloads,
            count(distinct username) filter (where user_id is not null)::int as people
          from audit_log where created_at >= ${dayStart(from)}`)
      : Promise.resolve([]),
    withActivity
      ? rows(ctx, sql`
          select created_at, username, via, event, target, detail from audit_log
          where category in ('inventory', 'labels') order by created_at desc, id desc limit 8`)
      : Promise.resolve([]),
  ]);

  const kpi: Record<string, number> = {};
  for (const [f, v] of Object.entries(kRow)) kpi[f] = f === "value" ? Math.round(n(v) * 100) / 100 : n(v);
  const byCategory = catRows.map((c) => ({
    cat: String(c.cat), color: String(c.color), products: n(c.products), units: n(c.units), low: n(c.low),
    out_stock: n(c.out_stock), value: Math.round(n(c.value) * 100) / 100,
  }));
  const mv = new Map(moveRows.map((r) => [String(r.d), [n(r.added), n(r.removed)]]));
  const movement = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(t, -i);
    movement.push({ date: d, added: mv.get(d)?.[0] ?? 0, removed: mv.get(d)?.[1] ?? 0 });
  }
  const weeks = Array.from({ length: 12 }, (_, w) => ({ week: w, from: addDays(t, w * 7), batches: 0, units: 0 }));
  for (const r of weekRows) {
    const w = weeks[n(r.w)];
    if (w) { w.batches = n(r.batches); w.units = n(r.units); }
  }

  const out: Record<string, unknown> = {
    ok: true, days, today: t, lowLimit: LOW, kpi, byCategory, movement, expiryWeeks: weeks, topValue, lowStock, expiringSoon,
  };
  if (withActivity) {
    out.activity = Object.fromEntries(Object.entries(actRows[0] ?? {}).map(([k, v]) => [k, n(v)]));
    out.recent = recentRows.map((r) => ({ ...r, created_at: stamp(r.created_at as Date) }));
  }
  return out;
}

/** WHERE clause for the activity log filters: q (search), cat, user, from / to (YYYY-MM-DD). */
function activityFilter(p: URLSearchParams): SQL {
  const w: SQL[] = [];
  const get = (k: string) => (p.get(k) ?? "").trim();
  const cat = get("cat");
  if (["inventory", "labels", "admin", "auth", "security"].includes(cat)) w.push(sql`category = ${cat}`);
  const user = get("user");
  if (user !== "") w.push(sql`(username = ${user} or via = ${user})`);
  const from = get("from"), to = get("to");
  if (from !== "" && validDate(from)) w.push(sql`created_at >= ${dayStart(from)}`);
  if (to !== "" && validDate(to)) w.push(sql`created_at < ${dayStart(addDays(to, 1))}`);
  const q = get("q");
  if (q !== "") {
    const like = "%" + cut(q, 100).replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    // Same expression as the trigram index idx_audit_search, so the search uses it.
    w.push(sql`(${sql.raw(AUDIT_SEARCH_EXPR)}) ilike ${like}`);
  }
  return w.length ? sql`where ${sql.join(w, sql` and `)}` : sql``;
}

export async function activity(ctx: ApiCtx, exportAll: boolean) {
  requirePerm(ctx, "activity.view");
  const p = ctx.url.searchParams;
  const where = activityFilter(p);
  const size = exportAll ? 20000 : Math.max(10, Math.min(200, Math.trunc(Number(p.get("size") ?? 50)) || 50));
  const askedPage = exportAll ? 1 : Math.max(1, Math.trunc(Number(p.get("page") ?? 1)) || 1);
  const meta = !exportAll && !!p.get("meta") && p.get("meta") !== "0";
  const todayStart = dayStart(today());

  const pageRows = (page: number) =>
    rows(ctx, sql`
      select id, created_at, username, via, event, category, detail, target, changes, ip from audit_log ${where}
      order by created_at desc, id desc limit ${size} offset ${(page - 1) * size}`);

  // Count, first page and the filter lists run together.
  const [[{ total: totalRaw }], firstRows, userRows, statRows] = await Promise.all([
    rows(ctx, sql`select count(*)::int as total from audit_log ${where}`),
    pageRows(askedPage),
    meta
      ? // Distinct names via an index skip-scan (one index probe per person, not a full table scan).
        rows(ctx, sql`
          with recursive u as (
            (select username from audit_log where username > '' and user_id is not null order by username limit 1)
            union all
            select (select a.username from audit_log a where a.username > u.username and a.user_id is not null order by a.username limit 1)
            from u where u.username is not null)
          select username from u where username is not null`)
      : Promise.resolve([]),
    meta
      ? rows(ctx, sql`
          select count(*) filter (where created_at >= ${todayStart})::int as today,
            count(distinct username) filter (where created_at >= ${todayStart} and user_id is not null)::int as users_today,
            count(*) filter (where created_at >= ${todayStart} and category = 'inventory')::int as stock_today,
            count(*) filter (where created_at >= now() - interval '1 day' and event in ('login_failed', 'account_locked', 'login_blocked'))::int as failed_24h
          from audit_log where created_at >= ${dayStart(addDays(today(), -1))}`)
      : Promise.resolve([]),
  ]);
  const total = n(totalRaw);
  const page = Math.min(askedPage, Math.max(1, Math.ceil(total / size)));
  // Only when the asked page was past the end (e.g. rows were deleted) is a second read needed.
  const list = (page === askedPage ? firstRows : await pageRows(page)).map((r) => ({
    ...r, id: n(r.id), created_at: stamp(r.created_at as Date), changes: r.changes ?? null,
  }));
  const out: Record<string, unknown> = { ok: true, rows: list, total, page, size };
  if (meta) {
    out.users = userRows.map((r) => r.username);
    out.stats = statRows[0];
  }
  return out;
}
