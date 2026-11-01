/**
 * Passwords and tokens, using only Web Crypto (works on Node.js and serverless hosts).
 *
 * New passwords: PBKDF2-SHA256, 100,000 iterations (the Workers maximum), 16-byte salt.
 * Passwords from the old PHP app ($2y$ bcrypt) still verify, and are upgraded on the next sign-in.
 */
import bcrypt from "bcryptjs";

const ITERATIONS = 100_000;
const PREFIX = `pbkdf2-sha256$${ITERATIONS}$`;
const enc = new TextEncoder();

const toHex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 64 hex characters (256 bits). */
export const randomToken = () => toHex(randomBytes(32));

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return PREFIX + toB64(salt) + "$" + toB64(await pbkdf2(password, salt, ITERATIONS));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2-sha256$")) {
    const [, iter, salt, hash] = stored.split("$");
    const n = Number(iter);
    if (!salt || !hash || !(n >= 1000 && n <= ITERATIONS)) return false;
    return equal(await pbkdf2(password, fromB64(salt), n), fromB64(hash));
  }
  if (/^\$2[aby]\$/.test(stored)) {
    // PHP's $2y$ is the same algorithm as $2a$ / $2b$.
    return bcrypt.compare(password, stored.replace(/^\$2y\$/, "$2b$"));
  }
  return false;
}

export const needsRehash = (stored: string) => !stored.startsWith(PREFIX);

// Kept as a finished string, not a promise: on Cloudflare Workers, awaiting a promise started by
// another request hangs.
let dummy: string | null = null;
/** Hash to check against when the user doesn't exist, so the timing doesn't reveal which accounts exist. */
export async function dummyHash(): Promise<string> {
  if (!dummy) dummy = await hashPassword("not-a-real-password-" + randomToken());
  return dummy;
}

/** A readable temporary password, e.g. "Kite-4827-mango". */
export function generateTempPassword(): string {
  const words = ["mango", "river", "paddy", "cocoa", "pepper", "lotus", "cedar", "monsoon", "harbor", "tiger", "falcon", "amber", "coral", "maple", "orchid", "banyan"];
  const b = randomBytes(4);
  const w1 = words[b[0] % words.length], w2 = words[b[1] % words.length];
  const n = ((b[2] * 256 + b[3]) % 9000) + 1000;
  return w1[0].toUpperCase() + w1.slice(1) + "-" + n + "-" + w2;
}

/** Returns an error message, or "" if the password is acceptable. */
export function passwordProblem(pw: unknown, username = ""): string {
  if (typeof pw !== "string" || enc.encode(pw).length < 8) return "Password must be at least 8 characters.";
  if (enc.encode(pw).length > 72) return "Password must be at most 72 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include at least one letter and one number.";
  if (username !== "" && pw.toLowerCase() === username.toLowerCase()) return "Password can't be the same as the username.";
  const common = ["password", "password1", "password123", "12345678", "123456789", "qwerty123", "admin123", "welcome1", "abc12345", "nfpc1234", "iloveyou1"];
  if (common.includes(pw.toLowerCase())) return "That password is too common. Choose another.";
  return "";
}
