/** Fast JSON responses. */
import { randomToken } from "./crypto";

/**
 * JSON text that was already built (e.g. by PostgreSQL's json_agg). It's spliced into the
 * response as-is by stringify(), so large lists are never parsed and re-encoded in JavaScript.
 */
export class PreBuiltJson {
  constructor(public readonly text: string) {}
}
export const preBuiltJson = (text: string): unknown => new PreBuiltJson(text);

/** JSON.stringify that inserts PreBuiltJson values verbatim. */
export function stringify(data: unknown): string {
  const raws: string[] = [];
  const nonce = randomToken().slice(0, 16); // unguessable, so no real text can look like a placeholder
  const out = JSON.stringify(data, (_key, value) =>
    value instanceof PreBuiltJson ? `@@${nonce}:${raws.push(value.text) - 1}@@` : value,
  );
  if (!raws.length) return out;
  return out.replace(new RegExp(`"@@${nonce}:([0-9]+)@@"`, "g"), (_m, i: string) => raws[Number(i)]);
}

// Vercel compresses responses itself (gzip / brotli), so there the body is sent as-is.
const hostCompresses = !!process.env.VERCEL;

// Characters that must be escaped for JSON placed inside a <script> tag. (In JSON they can only
// occur inside strings, where the \uXXXX form means the same thing.)
const SCRIPT_UNSAFE = new RegExp("[<" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
const escapeChar = (c: string) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");

/** JSON that is safe to place inside a <script type="application/json"> tag. */
export function jsonForScript(data: unknown): string {
  return stringify(data).replace(SCRIPT_UNSAFE, escapeChar);
}

/**
 * A JSON response, gzip-compressed when the browser accepts it (unless the host compresses
 * responses itself).
 */
export function jsonResponse(data: unknown, status: number, acceptEncoding: string | null, cookie: string | null = null): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  const text = stringify(data);
  if (!hostCompresses && text.length > 1400 && /\bgzip\b/.test(acceptEncoding ?? "")) {
    headers.set("Content-Encoding", "gzip");
    headers.set("Vary", "Accept-Encoding");
    const body = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(body, { status, headers });
  }
  return new Response(text, { status, headers });
}
