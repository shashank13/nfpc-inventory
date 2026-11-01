/** Inventory actions: product list, save, delete, bulk upload, label templates. */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Exec } from "@/db";
import { appSettings, auditLog, categories, labelTemplates, productSearchExpr, products, stockMovements } from "@/db/schema";
import { audit, auditRow, can, userForClient, takeImpNotice, type AuditEntry } from "../auth";
import { LOW_STOCK, MAX_BULK_ROWS, MAX_LOGO_CHARS, TZ, UNITS, type Permission, type Unit } from "../config";
import type { Ctx } from "../context";
import { cut, fmtNum, validDate } from "../format";
import { preBuiltJson } from "../json";
import { AppError, chunks, int, isUniqueViolation, num, str, val, type ApiCtx, type Input } from "./common";
import { pendingResetCount } from "./admin";
import { loadSkuSettings, SkuGenerator, skuSettingsProblem } from "./sku";

export function requirePerm(ctx: ApiCtx, perm: Permission | "users.manage") {
  if (!can(ctx.me, perm)) throw new AppError("You don't have permission to do this. Ask a Super Admin to change your role.", 403);
}

/* ----------------------------------------------------------- categories */

type Category = { id: number; name: string; code: string; color: string; life: number; unit: Unit };

// Categories almost never change (there's no screen to edit them), so they're kept in memory
// for a minute instead of being read on every request. The cache holds the finished list, never
// a pending promise: on Cloudflare Workers, awaiting a promise started by another request hangs.
const CATEGORY_TTL_MS = 60_000;
let catCache: { at: number; list: Category[] } | null = null;
const catLoading = new WeakMap<Ctx, Promise<Category[]>>(); // one query per request at most

function allCategories(ctx: Ctx): Promise<Category[]> {
  if (catCache && Date.now() - catCache.at <= CATEGORY_TTL_MS) return Promise.resolve(catCache.list);
  let p = catLoading.get(ctx);
  if (!p) {
    p = ctx.db
      .select({ id: categories.id, name: categories.name, code: categories.code, color: categories.color, life: categories.shelfLifeDays, unit: categories.defaultUnit })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .then((list) => {
        catCache = { at: Date.now(), list };
        return list;
      });
    catLoading.set(ctx, p);
  }
  return p;
}

const catName = (cats: Category[], id: number) => cats.find((c) => c.id === id)?.name ?? "";

/* -------------------------------------------------------------- products */

/** One product as JSON in the shape the page expects (built by PostgreSQL; p = products, c = categories). */
const ITEM_JSON = sql`json_build_object(
  'id', p.id::text, 'sku', p.sku, 'name', p.name, 'cat', c.name, 'grade', p.grade, 'net', p.pack_size,
  'unit', p.unit, 'qty', p.qty, 'price', p.mrp, 'loc', p.location, 'batch', p.batch_no, 'source', p.sourced_from,
  'packed', to_char(p.packed_on, 'YYYY-MM-DD'), 'best', to_char(p.best_before, 'YYYY-MM-DD'))`;

const TODAY = sql.raw(`((now() at time zone '${TZ}')::date)`);
const EXPIRY_WARN_DAYS = 15;
const WARN_DAYS_SQL = sql.raw(String(EXPIRY_WARN_DAYS)); // a literal, so "date + 15" is unambiguous

/** Stock-list filters (the same ones as the page's search box, status menu and category chips). */
interface ItemFilter { q: string; cat: string; status: string }

function itemWhere(f: ItemFilter): SQL {
  const w: SQL[] = [];
  if (f.cat) w.push(sql`c.name = ${f.cat}`);
  if (f.status === "low") w.push(sql`p.qty < ${LOW_STOCK}`);
  else if (f.status === "exp") w.push(sql`p.best_before between ${TODAY} and ${TODAY} + ${WARN_DAYS_SQL}`);
  else if (f.status === "expired") w.push(sql`p.best_before < ${TODAY}`);
  if (f.q) {
    const like = "%" + cut(f.q, 100).replace(/[\\%_]/g, (ch) => "\\" + ch) + "%";
    // Same expression as the trigram index idx_products_search, plus products whose category name
    // matches. "= any(array(…))" is computed once up front, which lets PostgreSQL combine the
    // search index with idx_products_category (a plain "in (select …)" forces a full table scan).
    w.push(sql`((${sql.raw(productSearchExpr("p."))}) ilike ${like}
      or p.category_id = any(array(select id from categories where name ilike ${like})))`);
  }
  return w.length ? sql`where ${sql.join(w, sql` and `)}` : sql``;
}

/** Products as pre-built JSON, newest first. */
async function itemsJson(exec: Exec, where: SQL, limit?: { size: number; offset: number }): Promise<unknown> {
  const page = limit ? sql`limit ${limit.size} offset ${limit.offset}` : sql``;
  const [r] = (await exec.execute(sql`
    select coalesce(json_agg(x.j order by x.created_at desc, x.id desc), '[]')::text as items from (
      select p.created_at, p.id, ${ITEM_JSON} as j
      from products p join categories c on c.id = p.category_id ${where}
      order by p.created_at desc, p.id desc ${page}) x`)) as unknown as { items: string }[];
  return preBuiltJson(r.items);
}

/** Figures for the summary cards and category chips (whole inventory, not just one page). */
async function inventoryStats(exec: Exec) {
  const [kRows, byCat] = await Promise.all([
    exec.execute(sql`
      select count(*)::int as products, coalesce(sum(qty), 0)::float8 as units, coalesce(sum(qty * mrp), 0)::float8 as value,
        count(*) filter (where qty < ${LOW_STOCK})::int as low,
        count(*) filter (where best_before between ${TODAY} and ${TODAY} + ${WARN_DAYS_SQL})::int as exp
      from products`) as unknown as Promise<Record<string, number>[]>,
    exec.execute(sql`
      select c.name, count(*)::int as n from products p join categories c on c.id = p.category_id group by c.name`) as unknown as Promise<{ name: string; n: number }[]>,
  ]);
  const k = kRows[0];
  return {
    products: Number(k.products), units: Number(k.units), value: Math.round(Number(k.value) * 100) / 100,
    low: Number(k.low), exp: Number(k.exp), byCat: Object.fromEntries(byCat.map((r) => [r.name, Number(r.n)])),
  };
}

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * One page of the stock list for the given filters. Options:
 *   focus — a SKU to jump to (the page containing it), e.g. right after saving it
 *   stats — also return the whole-inventory figures
 */
async function itemsPage(ctx: Ctx, f: ItemFilter, o: { page: number; size: number; focus?: string; stats?: boolean }) {
  const where = itemWhere(f);
  const size = PAGE_SIZES.includes(o.size) ? o.size : 50;
  const [totalRows, focusRank, stats] = await Promise.all([
    ctx.db.execute(sql`select count(*)::int as total from products p join categories c on c.id = p.category_id ${where}`) as unknown as Promise<{ total: number }[]>,
    o.focus
      ? (ctx.db.execute(sql`
          select rn from (select p.sku, row_number() over (order by p.created_at desc, p.id desc) as rn
            from products p join categories c on c.id = p.category_id ${where}) x where x.sku = ${o.focus}`) as unknown as Promise<{ rn: number }[]>)
      : Promise.resolve([] as { rn: number }[]),
    o.stats ? inventoryStats(ctx.db) : Promise.resolve(undefined),
  ]);
  const total = Number(totalRows[0].total);
  const pages = Math.max(1, Math.ceil(total / size));
  let page = Math.min(Math.max(1, o.page), pages);
  if (focusRank[0]) page = Math.ceil(Number(focusRank[0].rn) / size);
  const rows = await itemsJson(ctx.db, where, { size, offset: (page - 1) * size });
  return { ok: true, rows, total, page, size, ...(stats ? { stats } : {}) };
}

function filterFrom(params: URLSearchParams): ItemFilter {
  const status = params.get("status") ?? "";
  return {
    q: (params.get("q") ?? "").trim(),
    cat: (params.get("cat") ?? "").trim(),
    status: ["low", "exp", "expired"].includes(status) ? status : "",
  };
}

/** One saved product in the page's shape, built from the values just written (no re-read). */
function toItem(id: number, d: ProductData, cats: Category[]) {
  return {
    id: String(id), sku: d.sku, name: d.name, cat: catName(cats, d.categoryId), grade: d.grade, net: d.packSize, unit: d.unit,
    qty: d.qty, price: d.mrp, loc: d.location, batch: d.batchNo, source: d.sourcedFrom, packed: d.packedOn, best: d.bestBefore,
  };
}

interface ProductData {
  name: string; grade: string; packSize: number; unit: Unit; qty: number; mrp: number; location: string;
  batchNo: string; sourcedFrom: string; packedOn: string; bestBefore: string; sku: string; categoryId: number;
}
type ProductRow = typeof products.$inferSelect;

/** True when the page asked for an automatic SKU (the "auto" flag, or the SKU left blank). */
const wantsAutoSku = (p: Input) => p.skuAuto === true || String(val(p, "sku")).trim() === "";

/**
 * Validate a product from the page; returns DB-ready values or throws AppError.
 * With a SKU generator, an automatic SKU is filled in (the one the form showed, if it's still free).
 */
async function cleanProduct(ctx: Ctx, p: Input, sku?: { gen: SkuGenerator; excludeId?: number }): Promise<ProductData> {
  const autoSku = !!sku && wantsAutoSku(p);
  const d = {
    name: str(p, "name", 150, "Product name", true),
    grade: str(p, "grade", 100, "Grade"),
    packSize: Math.round(num(p, "net", 1, "Pack size", 0.001, 9999999) * 1000) / 1000, // stored with 3 decimals
    unit: String(val(p, "unit", "kg")) as Unit,
    qty: Math.trunc(num(p, "qty", 0, "Stock", 0, 2000000000)),
    mrp: Math.round(num(p, "price", 0, "MRP", 0, 99999999.99) * 100) / 100,
    location: str(p, "loc", 100, "Location"),
    batchNo: str(p, "batch", 50, "Batch number", true),
    sourcedFrom: str(p, "source", 150, "Sourced from"),
    packedOn: String(val(p, "packed")),
    bestBefore: String(val(p, "best")),
    sku: str(p, "sku", 64, "SKU / barcode", !autoSku),
    categoryId: 0,
  };
  if (!UNITS.includes(d.unit)) throw new AppError("Invalid unit.");
  if (!validDate(d.packedOn)) throw new AppError("Invalid packed date.");
  if (!validDate(d.bestBefore)) throw new AppError("Invalid best-before date.");
  if (d.bestBefore < d.packedOn) throw new AppError("Best-before date can't be earlier than packed date.");
  const cats = await allCategories(ctx);
  const wanted = String(val(p, "cat")).toLowerCase();
  const cat = cats.find((c) => c.name.toLowerCase() === wanted) ?? cats.find((c) => c.name.toLowerCase() === "others");
  if (!cat) throw new AppError("Unknown category.");
  d.categoryId = cat.id;
  if (autoSku) d.sku = await sku!.gen.resolve(d.sku, cat.code, d.name, sku!.excludeId ?? 0);
  if (!/^[\x20-\x7E]+$/.test(d.sku)) throw new AppError("SKU has unsupported characters (use English letters, digits, - or /).");
  return d;
}

const dbValues = (d: ProductData) => ({ ...d, packSize: String(d.packSize), mrp: d.mrp.toFixed(2) });

/** "Coconut Oil · 500 ml · NFPC-OIL-12345" — how a product is named in the activity log. */
const productLabel = (d: { name: string; packSize: number | string; unit: string; sku: string }) =>
  `${d.name} · ${fmtNum(d.packSize)} ${d.unit} · ${d.sku}`;

/** Product fields as people read them, for before/after comparison. */
/** The product fields compared when logging an edit. */
type ProductView = Pick<ProductRow, "sku" | "name" | "categoryId" | "grade" | "packSize" | "unit" | "qty" | "mrp" | "location" | "batchNo" | "sourcedFrom" | "packedOn" | "bestBefore">;

function productView(cats: Category[], r: ProductData | ProductView): Record<string, string> {
  return {
    Name: r.name, Category: catName(cats, r.categoryId), Grade: r.grade, "Pack size": `${fmtNum(r.packSize)} ${r.unit}`,
    Stock: String(Math.trunc(Number(r.qty))), MRP: "₹" + fmtNum(r.mrp), Location: r.location, Batch: r.batchNo,
    "Sourced from": r.sourcedFrom, "Packed on": r.packedOn, "Best before": r.bestBefore, SKU: r.sku,
  };
}

/** Stock-ledger and activity entries collected during an action and written together. */
class WriteLog {
  moves: (typeof stockMovements.$inferInsert)[] = [];
  audits: (typeof auditLog.$inferInsert)[] = [];
  constructor(private ctx: ApiCtx) {}
  move(productId: number | null, sku: string, name: string, action: "create" | "update" | "import" | "delete", before: number, after: number, note = "") {
    this.moves.push({ productId, sku, productName: name, action, username: this.ctx.me.username, qtyBefore: before, qtyAfter: after, note });
  }
  audit(e: Omit<AuditEntry, "actorId" | "actorName">) {
    this.audits.push(auditRow(this.ctx, { ...e, actorId: this.ctx.me.id, actorName: this.ctx.me.username }));
  }
  merge(o: WriteLog) {
    this.moves.push(...o.moves);
    this.audits.push(...o.audits);
  }
  /**
   * Write everything as multi-row inserts. One after another on purpose: queries sent together
   * inside a transaction hang on Cloudflare Workers.
   */
  async flush(exec: Exec) {
    for (const c of chunks(this.moves, 1000)) await exec.insert(stockMovements).values(c);
    for (const c of chunks(this.audits, 1000)) await exec.insert(auditLog).values(c);
    this.moves = [];
    this.audits = [];
  }
}

async function insertProduct(ctx: ApiCtx, exec: Exec, d: ProductData, action: "create" | "import", log: WriteLog): Promise<number> {
  const [row] = await exec.insert(products).values(dbValues(d)).returning({ id: products.id });
  const cats = await allCategories(ctx);
  log.move(row.id, d.sku, d.name, action, 0, d.qty);
  log.audit({
    event: action === "import" ? "product_imported" : "product_created",
    target: productLabel(d),
    detail: (action === "import" ? "Added by bulk upload · " : "") + `Stock ${d.qty} · MRP ₹${fmtNum(d.mrp)} · ${catName(cats, d.categoryId)}`,
  });
  return row.id;
}

/** Update a product and get its previous values back, in one statement (lock + read + write). */
async function updateReturningOld(exec: Exec, id: number, d: ProductData): Promise<ProductView | null> {
  const [r] = (await exec.execute(sql`
    with prev as (select * from products where id = ${id} for update)
    update products p set
      sku = ${d.sku}, name = ${d.name}, category_id = ${d.categoryId}, grade = ${d.grade},
      pack_size = ${String(d.packSize)}::numeric, unit = ${d.unit}::unit, qty = ${d.qty}, mrp = ${d.mrp.toFixed(2)}::numeric,
      location = ${d.location}, batch_no = ${d.batchNo}, sourced_from = ${d.sourcedFrom},
      packed_on = ${d.packedOn}::date, best_before = ${d.bestBefore}::date, updated_at = now()
    from prev where p.id = prev.id
    returning prev.sku, prev.name, prev.category_id, prev.grade, prev.pack_size::text, prev.unit::text, prev.qty, prev.mrp::text,
      prev.location, prev.batch_no, prev.sourced_from,
      to_char(prev.packed_on, 'YYYY-MM-DD') as packed_on, to_char(prev.best_before, 'YYYY-MM-DD') as best_before`)) as unknown as Record<string, string | number>[];
  if (!r) return null;
  return {
    sku: String(r.sku), name: String(r.name), categoryId: Number(r.category_id), grade: String(r.grade), packSize: String(r.pack_size),
    unit: String(r.unit) as Unit, qty: Number(r.qty), mrp: String(r.mrp), location: String(r.location), batchNo: String(r.batch_no),
    sourcedFrom: String(r.sourced_from), packedOn: String(r.packed_on), bestBefore: String(r.best_before),
  };
}

async function updateProduct(ctx: ApiCtx, exec: Exec, id: number, d: ProductData, action: "update" | "import", log: WriteLog, locked?: ProductView) {
  let old: ProductView | null | undefined = locked;
  if (old) await exec.update(products).set(dbValues(d)).where(eq(products.id, id));
  else old = await updateReturningOld(exec, id, d);
  if (!old) throw new AppError("Product not found (it may have been deleted). Reload the page.");
  log.move(id, d.sku, d.name, action, old.qty, d.qty);

  // Record exactly which fields changed.
  const cats = await allCategories(ctx);
  const a = productView(cats, old), b = productView(cats, d);
  const changes: [string, string, string][] = [];
  for (const f of Object.keys(a)) if (a[f] !== b[f]) changes.push([f, a[f], b[f]]);
  const summary = changes.slice(0, 4).map(([f, x, y]) => `${f} ${x === "" ? "—" : x} → ${y === "" ? "—" : y}`);
  if (changes.length > 4) summary.push(`+${changes.length - 4} more`);
  log.audit({
    event: "product_updated",
    target: productLabel(d),
    detail: (action === "import" ? "Updated by bulk upload · " : "") + (summary.length ? summary.join(", ") : "Saved with no changes"),
    changes: changes.length ? changes : null,
  });
}

/* ------------------------------------------------------- label templates */

const LOGO_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/;

/** Width/height/type of a PNG or JPEG (like PHP getimagesizefromstring), or null. */
function imageInfo(b: Uint8Array): { mime: string; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { mime: "image/png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: "image/jpeg", h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** A label dimension in mm, rounded to 0.5 mm and kept within range. */
function mmSetting(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.round(n * 2) / 2)) : fallback;
}

/** Whitelist + validate template settings so only known, safe values are stored. */
function cleanTemplateSettings(raw: unknown) {
  const s = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Input;
  const show = (s.show && typeof s.show === "object" ? s.show : {}) as Input;
  const logoMode = ["default", "custom", "none"].includes(String(val(s, "logoMode"))) ? String(val(s, "logoMode")) : "default";
  const color = String(val(s, "color"));
  const out = {
    brand: str(s, "brand", 80, "Brand name", true),
    tagline: str(s, "tagline", 100, "Tagline"),
    logoMode,
    logo: "",
    logoAspect: 1,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#2f7d32",
    header: val(s, "header") === "line" ? "line" : "band",
    mrpText: str(s, "mrpText", 60, "MRP text"),
    address: str(s, "address", 200, "Address"),
    cin: str(s, "cin", 40, "CIN"),
    fssai: str(s, "fssai", 30, "FSSAI number"),
    contact: str(s, "contact", 80, "Contact"),
    note: str(s, "note", 150, "Extra note"),
    perRow: Math.max(1, Math.min(5, Math.trunc(Number(val(s, "perRow", 3))) || 0)),
    // Printing: "roll" = barcode / thermal label printer at the exact label size; "sheet" = A4.
    media: val(s, "media") === "sheet" ? "sheet" : "roll",
    layout: ["full", "compact", "barcode"].includes(String(val(s, "layout"))) ? String(val(s, "layout")) : "full",
    labelW: mmSetting(val(s, "labelW", 100), 15, 220, 100),
    labelH: mmSetting(val(s, "labelH", 75), 10, 300, 75),
    across: Math.max(1, Math.min(4, Math.trunc(Number(val(s, "across", 1))) || 1)),
    gapX: Math.max(0, Math.min(10, Number(val(s, "gapX", 2)) || 0)),
    mono: s.mono === undefined ? true : !!s.mono,
    show: {} as Record<string, boolean>,
  };
  for (const f of ["net", "batch", "packed", "best", "grade", "source", "mrp", "barcodeText", "footer"]) out.show[f] = !(f in show) || !!show[f];

  if (logoMode === "custom") {
    const logo = String(val(s, "logo"));
    if (logo === "") throw new AppError('Upload a logo image, or choose "Default leaf" / "No logo".');
    if (logo.length > MAX_LOGO_CHARS) throw new AppError("Logo image is too large.");
    const m = LOGO_RE.exec(logo);
    if (!m) throw new AppError("Logo must be a PNG or JPEG image.");
    let info = null;
    try {
      info = imageInfo(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)));
    } catch { /* invalid base64 */ }
    if (!info || info.w < 1 || info.h < 1 || info.w > 2000 || info.h > 2000) throw new AppError("Logo file is not a valid image.");
    out.logo = logo;
    out.logoAspect = Math.round(Math.max(0.2, Math.min(5, info.w / Math.max(1, info.h))) * 10000) / 10000;
  }
  return out;
}

async function fetchTemplates(exec: Exec) {
  const rows = await exec
    .select({ id: labelTemplates.id, name: labelTemplates.name, settings: labelTemplates.settings, isDefault: labelTemplates.isDefault })
    .from(labelTemplates)
    .orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.name));
  return rows.map((r) => ({ id: String(r.id), name: r.name, isDefault: r.isDefault, settings: r.settings ?? {} }));
}

/** Make sure exactly one template is the default (the given one, or the current/oldest). */
async function fixDefaultTemplate(exec: Exec, id = 0) {
  if (!id) {
    const [t] = await exec.select({ id: labelTemplates.id }).from(labelTemplates).orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.id)).limit(1);
    if (!t) return;
    id = t.id;
  }
  await exec.update(labelTemplates).set({ isDefault: false }).where(and(ne(labelTemplates.id, id), eq(labelTemplates.isDefault, true)));
  await exec.update(labelTemplates).set({ isDefault: true }).where(eq(labelTemplates.id, id));
}

/* ================================================================ actions */

export async function list(ctx: ApiCtx) {
  const cats = await allCategories(ctx);
  const [inventory, templates, pending, sku] = await Promise.all([
    // First page of the stock list (default filters, 50 rows) + summary figures.
    itemsPage(ctx, { q: "", cat: "", status: "" }, { page: 1, size: 50, stats: true }),
    fetchTemplates(ctx.db),
    ctx.me.isSuper ? pendingResetCount(ctx.db) : Promise.resolve(0),
    loadSkuSettings(ctx.db),
  ]);
  return {
    ok: true, user: userForClient(ctx.me), notice: takeImpNotice(ctx), pendingResets: pending,
    categories: cats.map((c) => ({ name: c.name, code: c.code, color: c.color, life: c.life, unit: c.unit })),
    inventory, templates, sku, canEditSku: can(ctx.me, "templates.manage"),
  };
}

export async function save(ctx: ApiCtx) {
  const p = await ctx.body();
  const id = int(p, "id");
  requirePerm(ctx, id ? "products.edit" : "products.create");
  const auto = wantsAutoSku(p);
  const settings = await loadSkuSettings(ctx.db);
  for (let attempt = 0; ; attempt++) {
    const d = await cleanProduct(ctx, p, { gen: new SkuGenerator(ctx.db, settings), excludeId: id });
    try {
      // A duplicate SKU is caught by the unique index (reported as "This SKU already exists").
      const savedId = await ctx.db.transaction(async (tx) => {
        const log = new WriteLog(ctx);
        let pid = id;
        if (id) await updateProduct(ctx, tx, id, d, "update", log);
        else pid = await insertProduct(ctx, tx, d, "create", log);
        await log.flush(tx);
        return pid;
      });
      return { ok: true, item: toItem(savedId, d, await allCategories(ctx)) };
    } catch (e) {
      // Someone took the same automatic SKU a moment ago: make a fresh one and try again.
      if (auto && attempt < 2 && isUniqueViolation(e)) { p.sku = ""; continue; }
      throw e;
    }
  }
}

/** GET sku_next — the SKU a new product would get now (cat, name; format/prefix to preview other settings). */
export async function skuNext(ctx: ApiCtx) {
  if (!(["products.create", "products.edit", "products.import", "templates.manage"] as const).some((pm) => can(ctx.me, pm))) {
    throw new AppError("You don't have permission to do this. Ask a Super Admin to change your role.", 403);
  }
  const q = ctx.url.searchParams;
  let settings = await loadSkuSettings(ctx.db);
  if (q.has("format")) {
    settings = { format: (q.get("format") ?? "").trim(), prefix: (q.get("prefix") ?? settings.prefix).trim().toUpperCase(), auto: settings.auto };
    const problem = skuSettingsProblem(settings);
    if (problem) throw new AppError(problem);
  }
  const cats = await allCategories(ctx);
  const wanted = (q.get("cat") ?? "").toLowerCase();
  const cat = cats.find((c) => c.name.toLowerCase() === wanted) ?? cats.find((c) => c.name.toLowerCase() === "others") ?? cats[0];
  const sku = await new SkuGenerator(ctx.db, settings).next(cat?.code ?? "OTH", (q.get("name") ?? "").trim(), Math.trunc(Number(q.get("exclude"))) || 0);
  return { ok: true, sku };
}

/** POST sku_settings_save {format, prefix, auto} — how automatic SKUs are made (managers). */
export async function skuSettingsSave(ctx: ApiCtx) {
  requirePerm(ctx, "templates.manage");
  const b = await ctx.body();
  const s = { format: String(val(b, "format")).trim(), prefix: String(val(b, "prefix")).trim().toUpperCase(), auto: !!b.auto };
  const problem = skuSettingsProblem(s);
  if (problem) throw new AppError(problem);
  await ctx.db
    .insert(appSettings)
    .values({ key: "sku", value: { ...s }, updatedBy: ctx.me.id })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { ...s }, updatedAt: new Date(), updatedBy: ctx.me.id } });
  await audit(ctx, {
    event: "sku_format_updated", actorId: ctx.me.id, actorName: ctx.me.username, target: "SKU format",
    detail: `${s.format}${s.prefix ? " · company code " + s.prefix : ""} · automatic ${s.auto ? "on" : "off"}`,
  });
  return { ok: true, sku: s };
}

export async function remove(ctx: ApiCtx) {
  requirePerm(ctx, "products.delete");
  const id = int(await ctx.body(), "id");
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.delete(products).where(eq(products.id, id)).returning();
    if (!row) throw new AppError("Product not found (it may already be deleted).", 404);
    // The product is gone, so its ledger entry has no product_id (as with older entries).
    const log = new WriteLog(ctx);
    log.move(null, row.sku, row.name, "delete", row.qty, 0);
    log.audit({ event: "product_deleted", target: productLabel(row), detail: `Stock was ${row.qty} · MRP ₹${fmtNum(row.mrp)}` });
    await log.flush(tx);
  });
  return { ok: true };
}

export async function removeMany(ctx: ApiCtx) {
  requirePerm(ctx, "products.delete");
  const p = await ctx.body();
  const raw = Array.isArray(p.ids) ? p.ids : [];
  const ids = [...new Set(raw.map((x) => Math.trunc(Number(x)) || 0).filter(Boolean))];
  if (!ids.length) throw new AppError("Select at least one product.");
  if (ids.length > MAX_BULK_ROWS) throw new AppError(`Too many products — delete at most ${MAX_BULK_ROWS} at a time.`);
  const deleted = await ctx.db.transaction(async (tx) => {
    const rows = await tx.delete(products).where(inArray(products.id, ids)).returning();
    if (!rows.length) return [];
    const log = new WriteLog(ctx);
    for (const r of rows) {
      log.move(null, r.sku, r.name, "delete", r.qty, 0, "Bulk delete");
      log.audit({ event: "product_deleted", target: productLabel(r), detail: `Bulk delete of ${rows.length} · stock was ${r.qty}` });
    }
    await log.flush(tx);
    return rows.map((r) => r.id);
  });
  return { ok: true, deleted: deleted.map(String), missing: ids.length - deleted.length };
}

export async function bulk(ctx: ApiCtx) {
  requirePerm(ctx, "products.import");
  const p = await ctx.body();
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const allowUpdate = p.update === undefined || !!p.update;
  if (!rows.length) throw new AppError("No rows to import.");
  if (rows.length > MAX_BULK_ROWS) throw new AppError(`Too many rows — import at most ${MAX_BULK_ROWS} at a time.`);

  // Validate everything first (no database writes), so bad rows cost nothing.
  const skuGen = new SkuGenerator(ctx.db, await loadSkuSettings(ctx.db));
  const cleaned: (ProductData | string)[] = [];
  for (const r of rows) {
    try {
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new AppError("Invalid row.");
      // Rows without a SKU get one from the SKU format (never repeated within the upload).
      cleaned.push(await cleanProduct(ctx, r as Input, { gen: skuGen }));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      cleaned.push(e.message);
    }
  }

  let added = 0, updated = 0, skipped = 0;
  const errors: string[] = [];
  await ctx.db.transaction(async (tx) => {
    const skus = [...new Set(cleaned.filter((d): d is ProductData => typeof d !== "string").map((d) => d.sku))];
    const existing = new Map<string, ProductRow>();
    for (const c of chunks(skus, 1000)) {
      for (const r of await tx.select().from(products).where(inArray(products.sku, c)).for("update")) existing.set(r.sku.toLowerCase(), r);
    }
    const log = new WriteLog(ctx);
    for (let n = 0; n < cleaned.length; n++) {
      const d = cleaned[n];
      if (typeof d === "string") {
        skipped++;
        errors.push(`Row ${n + 1}: ${d}`);
        continue;
      }
      const key = d.sku.toLowerCase();
      const old = existing.get(key);
      if (old && !allowUpdate) {
        skipped++;
        continue;
      }
      const rowLog = new WriteLog(ctx);
      try {
        // A savepoint per row: one bad row doesn't undo the others.
        await tx.transaction(async (sp) => {
          if (old) {
            await updateProduct(ctx, sp, old.id, d, "import", rowLog, old);
            existing.set(key, { ...old, ...dbValues(d) } as ProductRow);
          } else {
            const id = await insertProduct(ctx, sp, d, "import", rowLog);
            existing.set(key, { ...dbValues(d), id } as ProductRow);
          }
        });
        log.merge(rowLog);
        if (old) updated++;
        else added++;
      } catch (e) {
        skipped++;
        let msg: string;
        if (e instanceof AppError) msg = e.message;
        else if (isUniqueViolation(e)) msg = "SKU already exists.";
        else {
          console.error("bulk row error:", e);
          msg = "Could not save this row.";
        }
        errors.push(`Row ${n + 1}: ${msg}`);
      }
    }
    log.audits.push(auditRow(ctx, {
      event: "bulk_import", actorId: ctx.me.id, actorName: ctx.me.username, target: `${rows.length} rows uploaded`,
      detail: `Added ${added}, updated ${updated}, skipped ${skipped}` + (errors.length ? " · first error: " + errors[0] : ""),
    }));
    await log.flush(tx);
  });
  return { ok: true, added, updated, skipped, errors: errors.slice(0, 200) };
}

export async function templateSave(ctx: ApiCtx) {
  requirePerm(ctx, "templates.manage");
  const p = await ctx.body();
  const givenId = int(p, "id");
  const name = str(p, "name", 80, "Template name", true);
  const settings = cleanTemplateSettings(p.settings);
  const [dup] = await ctx.db.select({ id: labelTemplates.id }).from(labelTemplates).where(and(eq(labelTemplates.name, name), ne(labelTemplates.id, givenId))).limit(1);
  if (dup) throw new AppError("A template with this name already exists.", 409);
  const id = await ctx.db.transaction(async (tx) => {
    let id = givenId;
    if (id) {
      const r = await tx.update(labelTemplates).set({ name, settings }).where(eq(labelTemplates.id, id)).returning({ id: labelTemplates.id });
      if (!r.length) throw new AppError("Template not found (it may have been deleted).");
    } else {
      [{ id }] = await tx.insert(labelTemplates).values({ name, settings }).returning({ id: labelTemplates.id });
    }
    await fixDefaultTemplate(tx, p.makeDefault ? id : 0);
    await audit(ctx, { event: givenId ? "template_updated" : "template_created", detail: p.makeDefault ? "Set as default template" : "", actorId: ctx.me.id, actorName: ctx.me.username, target: name }, tx);
    return id;
  });
  return { ok: true, id: String(id), templates: await fetchTemplates(ctx.db) };
}

export async function templateDelete(ctx: ApiCtx) {
  requirePerm(ctx, "templates.manage");
  const id = int(await ctx.body(), "id");
  await ctx.db.transaction(async (tx) => {
    const all = await tx.select({ id: labelTemplates.id, name: labelTemplates.name }).from(labelTemplates).for("update");
    if (all.length <= 1) throw new AppError("You need at least one label template.");
    const t = all.find((x) => x.id === id);
    if (!t) throw new AppError("Template not found.", 404);
    await tx.delete(labelTemplates).where(eq(labelTemplates.id, id));
    await fixDefaultTemplate(tx);
    await audit(ctx, { event: "template_deleted", actorId: ctx.me.id, actorName: ctx.me.username, target: t.name }, tx);
  });
  return { ok: true, templates: await fetchTemplates(ctx.db) };
}

/** Printing, downloads and exports happen in the browser and report themselves here. */
export async function logEvent(ctx: ApiCtx) {
  const p = await ctx.body();
  const event = String(val(p, "event"));
  const need: Record<string, Permission> = { labels_printed: "labels.print", labels_downloaded: "labels.print", inventory_exported: "reports.export" };
  if (!need[event]) throw new AppError("Unknown event.");
  requirePerm(ctx, need[event]);
  await audit(ctx, {
    event, actorId: ctx.me.id, actorName: ctx.me.username,
    detail: cut(val(p, "detail"), 300), target: cut(val(p, "target"), 190),
  });
  return { ok: true };
}


/**
 * GET items — the stock list, one page at a time.
 *   q, cat, status       filters (search box, category chip, stock-status menu)
 *   page, size           which page (size 25 / 50 / 100 / 200)
 *   focus=<sku>          jump to the page containing this product
 *   stats=1              also return the summary-card figures
 *   all=1                every matching product (export, "print all", ZIP — only on request)
 *   ids=1                only the ids of every matching product ("select all matching")
 */
export async function items(ctx: ApiCtx) {
  const p = ctx.url.searchParams;
  const f = filterFrom(p);
  if (p.get("ids") === "1") {
    const rows = (await ctx.db.execute(sql`
      select p.id::text as id from products p join categories c on c.id = p.category_id ${itemWhere(f)}
      order by p.created_at desc, p.id desc`)) as unknown as { id: string }[];
    return { ok: true, ids: rows.map((r) => r.id) };
  }
  if (p.get("all") === "1") return { ok: true, rows: await itemsJson(ctx.db, itemWhere(f)) };
  return itemsPage(ctx, f, {
    page: Math.trunc(Number(p.get("page") ?? 1)) || 1,
    size: Math.trunc(Number(p.get("size") ?? 50)) || 50,
    focus: (p.get("focus") ?? "").trim() || undefined,
    stats: p.get("stats") === "1",
  });
}

/** POST items_lookup {skus?: string[], ids?: string[]} — specific products (scanner, bulk upload, selections). */
export async function itemsLookup(ctx: ApiCtx) {
  const b = await ctx.body();
  const skus = (Array.isArray(b.skus) ? b.skus : []).map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_BULK_ROWS);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => Math.trunc(Number(x)) || 0).filter(Boolean).slice(0, MAX_BULK_ROWS);
  if (!skus.length && !ids.length) return { ok: true, rows: [] };
  const conds: SQL[] = [];
  // (The query aliases products as "p", so plain SQL rather than inArray(products.…).)
  if (skus.length) conds.push(sql`p.sku in ${skus}`);
  if (ids.length) conds.push(sql`p.id in ${ids}`);
  return { ok: true, rows: await itemsJson(ctx.db, sql`where ${sql.join(conds, sql` or `)}`) };
}
