/**
 * Default data: roles, categories and the "Standard" label template. Safe to run again
 * (existing rows are left alone).
 *
 *   npm run db:seed            — defaults only
 *   npm run db:seed:samples    — defaults + 12 sample products (only if there are no products yet)
 *
 * The first Super Admin account is created on the sign-in page the first time the app is opened.
 */
try { process.loadEnvFile(".env"); } catch { /* use the real environment */ }

import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { directDatabaseUrl } from "./url";
import { categories, labelTemplates, products, roles, stockMovements } from "./schema";

export const DEFAULT_ROLES = [
  { name: "Super Admin", description: "Full access, including managing users and roles.", permissions: [], isSuper: true },
  { name: "Manager", description: "Full inventory access: products, bulk upload, label templates and exports.",
    permissions: ["products.create", "products.edit", "products.delete", "products.import", "labels.print", "templates.manage", "reports.export", "activity.view"], isSuper: false },
  { name: "Inventory Staff", description: "Adds and updates products and prints labels. Cannot delete.", permissions: ["products.create", "products.edit", "labels.print"], isSuper: false },
  { name: "Viewer", description: "Read-only access to the inventory.", permissions: [], isSuper: false },
];

export const DEFAULT_CATEGORIES = [
  { name: "Grains & Pulses", code: "GRP", color: "#c98a12", shelfLifeDays: 180, defaultUnit: "kg", sortOrder: 1 },
  { name: "Oils & Oilseeds", code: "OIL", color: "#e0b400", shelfLifeDays: 270, defaultUnit: "L", sortOrder: 2 },
  { name: "Spices & Plantation", code: "SPC", color: "#8b4a2b", shelfLifeDays: 365, defaultUnit: "g", sortOrder: 3 },
  { name: "Processed Products", code: "PRC", color: "#b8456b", shelfLifeDays: 120, defaultUnit: "g", sortOrder: 4 },
  { name: "Fresh Produce", code: "FRS", color: "#2f9d4a", shelfLifeDays: 7, defaultUnit: "kg", sortOrder: 5 },
  { name: "Others", code: "OTH", color: "#6b7a8f", shelfLifeDays: 180, defaultUnit: "pcs", sortOrder: 6 },
] as const;

export const STANDARD_TEMPLATE = {
  brand: "NITTE FARMERS PRODUCER COMPANY LTD.", tagline: "", logoMode: "default", logo: "", logoAspect: 1, color: "#2f7d32",
  header: "band", mrpText: "MRP (incl. of all taxes)", address: "NMAMIT Campus, Nitte, Karkala Tq., Udupi Dist., Karnataka – 574110",
  cin: "U01110KA2021PTC149385", fssai: "", contact: "", note: "", perRow: 3,
  media: "roll", labelW: 100, labelH: 75, across: 1, gapX: 2, mono: true, layout: "full",
  show: { net: true, batch: true, packed: true, best: true, grade: true, source: true, mrp: true, barcodeText: true, footer: true },
};

// [sku, name, category, grade, pack size, unit, qty, mrp, location, batch, sourced from, packed days ago, shelf life (null = category)]
const SAMPLES: [string, string, string, string, number, string, number, number, string, string, string, number, number | null][] = [
  ["NFPC-GRP-48213", "Red Rice (Kajé Akki)", "Grains & Pulses", "Boiled, Grade A", 5, "kg", 64, 420, "Godown 1", "B2610-001", "Kedinje farmers group", 20, null],
  ["NFPC-GRP-51734", "Ragi", "Grains & Pulses", "Cleaned", 1, "kg", 8, 68, "Godown 1", "B2610-002", "Nitte village", 35, null],
  ["NFPC-GRP-60942", "Toor Dal", "Grains & Pulses", "Unpolished", 1, "kg", 40, 165, "Godown 1", "B2610-003", "Belman", 12, null],
  ["NFPC-OIL-27315", "Cold-pressed Coconut Oil", "Oils & Oilseeds", "Wood-pressed", 1, "L", 52, 330, "Oil room", "B2610-004", "FPC mill, Nitte", 30, null],
  ["NFPC-OIL-38806", "Groundnut Oil", "Oils & Oilseeds", "Cold-pressed", 1, "L", 0, 290, "Oil room", "B2610-005", "FPC mill, Nitte", 60, null],
  ["NFPC-SPC-14527", "Black Pepper", "Spices & Plantation", "Bold, 550 GL", 250, "g", 30, 260, "Spice store", "B2610-006", "Karkala growers", 40, null],
  ["NFPC-SPC-73391", "Cashew Nuts W320", "Spices & Plantation", "Whole", 500, "g", 25, 520, "Spice store", "B2610-007", "Local processing unit", 25, 180],
  ["NFPC-PRC-22648", "Banana Chips", "Processed Products", "Coconut-oil fried", 200, "g", 6, 90, "Retail shelf", "B2610-008", "FPC kitchen", 110, null],
  ["NFPC-PRC-85120", "Mango Pickle", "Processed Products", "Appe midi", 300, "g", 36, 150, "Retail shelf", "B2610-009", "Women SHG, Kukkundoor", 30, null],
  ["NFPC-PRC-49075", "Wild Honey", "Processed Products", "Raw", 500, "g", 18, 380, "Retail shelf", "B2610-010", "Kudremukh fringe collectors", 50, 365],
  ["NFPC-FRS-31864", "Tender Coconut", "Fresh Produce", "Green", 1, "pcs", 120, 35, "Cold room", "B2610-011", "Nitte village", 2, null],
  ["NFPC-FRS-66209", "Arecanut (Chali)", "Fresh Produce", "New crop", 1, "kg", 45, 480, "Godown 2", "B2610-012", "Kedinje farmers group", 15, 365],
];

async function main() {
  const url = directDatabaseUrl();
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  try {
    await db.insert(roles).values(DEFAULT_ROLES).onConflictDoNothing();
    await db.insert(categories).values([...DEFAULT_CATEGORIES]).onConflictDoNothing();
    const [{ n: templates }] = await db.select({ n: count() }).from(labelTemplates);
    if (Number(templates) === 0) await db.insert(labelTemplates).values({ name: "Standard", settings: STANDARD_TEMPLATE, isDefault: true });
    console.log("Defaults ready: roles, categories, label template.");

    if (process.argv.includes("--samples")) {
      const [{ n }] = await db.select({ n: count() }).from(products);
      if (Number(n) > 0) {
        console.log("Products already exist — sample products skipped.");
      } else {
        const cats = await db.select().from(categories);
        for (const [sku, name, cat, grade, size, unit, qty, mrp, location, batch, source, ago, life] of SAMPLES) {
          const c = cats.find((x) => x.name === cat)!;
          const packed = sql`(now() at time zone 'Asia/Kolkata')::date - ${ago}::int`;
          const best = sql`(now() at time zone 'Asia/Kolkata')::date - ${ago}::int + ${life ?? c.shelfLifeDays}::int`;
          const [p] = await db.insert(products).values({
            sku, name, categoryId: c.id, grade, packSize: String(size), unit: unit as never, qty, mrp: String(mrp),
            location, batchNo: batch, sourcedFrom: source, packedOn: packed as never, bestBefore: best as never,
          }).returning({ id: products.id });
          await db.insert(stockMovements).values({ productId: p.id, sku, productName: name, action: "create", qtyBefore: 0, qtyAfter: qty, note: "Sample data" });
        }
        console.log(`Added ${SAMPLES.length} sample products.`);
      }
    }
    const [superRole] = await db.select().from(roles).where(eq(roles.isSuper, true)).limit(1);
    if (!superRole) console.warn("Warning: no Super Admin role exists.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
