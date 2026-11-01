/** Shared helpers for the JSON API (same validation rules and messages as api.php). */
import type { Ctx } from "../context";
import type { CurrentUser } from "../auth";
import { charLen } from "../format";

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(message: string, public status = 400, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export type Input = Record<string, unknown>;

export interface ApiCtx extends Ctx {
  me: CurrentUser;
  url: URL;
  body: () => Promise<Input>;
}

/** A scalar value from the input, or the default. */
export function val(a: Input, k: string, def: string | number = ""): string | number {
  const v = a[k];
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "1" : "";
  return def;
}

export function str(a: Input, k: string, max: number, label: string, required = false): string {
  const s = String(val(a, k)).trim();
  if (required && s === "") throw new AppError(`${label} is required.`);
  if (charLen(s) > max) throw new AppError(`${label} is too long (max ${max} characters).`);
  return s;
}

const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

export function num(a: Input, k: string, def: number, label: string, min: number, max: number): number {
  const v = val(a, k, def);
  if (v === "" || (typeof v === "string" && !NUMERIC.test(v))) throw new AppError(`${label} must be a number.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`${label} is out of range.`);
  return n;
}

export const int = (a: Input, k: string) => Math.trunc(Number(val(a, k, 0))) || 0;

/** True for a PostgreSQL unique-constraint violation (also when wrapped by Drizzle). */
export function isUniqueViolation(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (x.code === "23505") return true;
  return false;
}

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
