/**
 * Automatic SKUs (barcode values) from an editable format.
 *
 * The format is plain text with codes in braces, e.g. "{PREFIX}-{CAT}-{SEQ:5}" → NFPC-GRP-00042:
 *   {PREFIX}   company code (settings)            {CAT}      category code (GRP, OIL, …)
 *   {NAME:n}   first n letters of the product     {YYYY} {YY} {MM} {DD}   today's date
 *   {SEQ:n}    running number, n digits — the next one after the highest existing SKU of that shape
 *   {RAND:n}   n random digits
 * Every SKU handed out is checked against the database (and against others made in the same
 * request), so it is always free when it's returned.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { appSettings, products } from "@/db/schema";
import { today } from "../format";
import { AppError } from "./common";

export interface SkuSettings {
  /** The format, e.g. "{PREFIX}-{CAT}-{RAND:5}". */
  format: string;
  /** Company code used for {PREFIX}. */
  prefix: string;
  /** Fill in the SKU automatically when a product is added. */
  auto: boolean;
}

export const DEFAULT_SKU_SETTINGS: SkuSettings = { format: "{PREFIX}-{CAT}-{RAND:5}", prefix: "NFPC", auto: true };

const TOKEN_RE = /\{(PREFIX|CAT|YYYY|YY|MM|DD|NAME|SEQ|RAND)(?::(\d{1,2}))?\}/gi;
const MAX_SKU = 64;

/** True if every character is printable ASCII (what a Code 128 barcode can hold). */
const printableAscii = (s: string) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeSkuSettings(v: unknown): SkuSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    format: typeof o.format === "string" && o.format.trim() ? o.format.trim() : DEFAULT_SKU_SETTINGS.format,
    prefix: typeof o.prefix === "string" ? o.prefix.trim().toUpperCase() : DEFAULT_SKU_SETTINGS.prefix,
    auto: o.auto === undefined ? DEFAULT_SKU_SETTINGS.auto : !!o.auto,
  };
}

export async function loadSkuSettings(exec: Exec): Promise<SkuSettings> {
  const [r] = await exec.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "sku")).limit(1);
  return normalizeSkuSettings(r?.value);
}

/** "" if the settings are usable, otherwise a message for the user. */
export function skuSettingsProblem(s: SkuSettings): string {
  if (!/^[A-Za-z0-9]{0,10}$/.test(s.prefix)) return "Company code: up to 10 English letters or digits.";
  const f = s.format;
  if (!f) return "Enter a format.";
  if (f.length > 60) return "The format is too long (max 60 characters).";
  const literal = f.replace(TOKEN_RE, "");
  if (/[{}]/.test(literal)) return "The format has an unknown {…} code. Use the codes listed below.";
  if (!printableAscii(literal)) return "Use English letters, digits and - / . _ in the format (barcode scanners can't read other characters).";
  const codes = [...f.matchAll(TOKEN_RE)].map((m) => ({ t: m[1].toUpperCase(), n: m[2] ? Number(m[2]) : undefined }));
  const seq = codes.filter((c) => c.t === "SEQ"), rand = codes.filter((c) => c.t === "RAND");
  if (seq.length > 1) return "Use {SEQ} only once.";
  if (!seq.length && !rand.length) return "Include {SEQ} (running number) or {RAND} (random digits) so every product gets a different SKU.";
  if (seq.some((c) => c.n !== undefined && (c.n < 1 || c.n > 10))) return "{SEQ:n} can have 1 to 10 digits.";
  if (rand.some((c) => c.n !== undefined && (c.n < 3 || c.n > 10))) return "{RAND:n} can have 3 to 10 digits.";
  if (codes.some((c) => c.t === "NAME" && c.n !== undefined && (c.n < 1 || c.n > 20))) return "{NAME:n} can use 1 to 20 letters.";
  return "";
}

function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = String(1 + (bytes[0] % 9)); // no leading zero, so the length stays fixed
  for (let i = 1; i < n; i++) s += String(bytes[i] % 10);
  return s;
}

/** Makes SKUs for one request (remembers what it handed out, so a bulk upload never repeats one). */
export class SkuGenerator {
  private nextSeq = new Map<string, number>();
  private handedOut = new Set<string>();

  constructor(private exec: Exec, private settings: SkuSettings) {}

  /** The format with everything except {SEQ} and {RAND} filled in. */
  private fill(catCode: string, name: string): string {
    const d = today();
    return this.settings.format.replace(TOKEN_RE, (m, t: string, n?: string) => {
      switch (t.toUpperCase()) {
        case "PREFIX": return this.settings.prefix;
        case "CAT": return catCode.toUpperCase();
        case "YYYY": return d.slice(0, 4);
        case "YY": return d.slice(2, 4);
        case "MM": return d.slice(5, 7);
        case "DD": return d.slice(8, 10);
        case "NAME": {
          const letters = name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
          return (letters || "X").slice(0, Number(n ?? 4));
        }
        default: return m; // SEQ / RAND
      }
    });
  }

  /** Highest running number already used by SKUs that look like before + digits + after. */
  private async highestSeq(before: string, after: string): Promise<number> {
    const re = ("^" + regexEscape(before) + "([0-9]+)" + regexEscape(after) + "$").toLowerCase();
    const rows = (await this.exec.execute(sql`
      select coalesce(max(substring(lower(sku::text) from ${re})::numeric), 0)::float8 as n
      from products where lower(sku::text) ~ ${re}`)) as unknown as { n: number }[];
    return Number(rows[0]?.n) || 0;
  }

  private async taken(sku: string, excludeId: number): Promise<boolean> {
    if (this.handedOut.has(sku.toLowerCase())) return true;
    const [r] = await this.exec.select({ id: products.id }).from(products)
      .where(and(eq(products.sku, sku), ne(products.id, excludeId))).limit(1);
    return !!r;
  }

  /** A new, unused SKU for a product. */
  async next(catCode: string, name: string, excludeId = 0): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      let s = this.fill(catCode, name).replace(/\{RAND(?::(\d{1,2}))?\}/gi, (_m, n?: string) => randomDigits(Number(n ?? 5)));
      const seq = /\{SEQ(?::(\d{1,2}))?\}/i.exec(s);
      if (seq) {
        const before = s.slice(0, seq.index), after = s.slice(seq.index + seq[0].length), width = Number(seq[1] ?? 5);
        const key = (before + "|" + after).toLowerCase();
        const n = (this.nextSeq.get(key) ?? (await this.highestSeq(before, after))) + 1;
        this.nextSeq.set(key, n);
        s = before + String(n).padStart(width, "0") + after;
      }
      if (s.length > MAX_SKU) throw new AppError(`This SKU format makes SKUs longer than ${MAX_SKU} characters. Shorten the format.`);
      if (!printableAscii(s)) throw new AppError("This SKU format makes characters a barcode can't hold.");
      if (!(await this.taken(s, excludeId))) {
        this.handedOut.add(s.toLowerCase());
        return s;
      }
    }
    throw new AppError("Couldn't find a free SKU with this format. Add more digits to {SEQ} or {RAND}.");
  }

  /** Keep `candidate` if it is still free (e.g. the one shown in the form), otherwise make a new one. */
  async resolve(candidate: string, catCode: string, name: string, excludeId = 0): Promise<string> {
    if (candidate && printableAscii(candidate) && !(await this.taken(candidate, excludeId))) {
      this.handedOut.add(candidate.toLowerCase());
      return candidate;
    }
    return this.next(catCode, name, excludeId);
  }
}
