import { TZ } from "./config";

const stampFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** "YYYY-MM-DD HH:MM:SS" in the app's time zone (the format the pages expect), or null. */
export function stamp(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  const p = Object.fromEntries(stampFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Today's date (YYYY-MM-DD) in the app's time zone. */
export const today = () => stamp(new Date())!.slice(0, 10);

/** Add days to a YYYY-MM-DD date. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 5.000 -> "5", 0.250 -> "0.25" (like the PHP fmt_num). */
export const fmtNum = (n: number | string) => Number(n).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

/** Cut text to `max` characters without breaking a multi-byte (e.g. Kannada) character. */
export function cut(s: unknown, max: number): string {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  return Array.from(str).slice(0, max).join("");
}

export const charLen = (s: string) => Array.from(s).length;

/** A real calendar date between 2000 and 2099, as YYYY-MM-DD. */
export function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "2000-01-01" && s <= "2099-12-31";
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const validEmail = (s: string) => s.length <= 190 && EMAIL_RE.test(s);
