/**
 * Which connection string to use.
 *
 * Supabase gives two:
 *  - DATABASE_URL — the pooler in transaction mode (port 6543). Used by the running app.
 *  - DIRECT_URL   — the pooler in session mode (port 5432) or the direct connection. Used by
 *                   migrations, the seed and the MySQL import, which need a normal session.
 *
 * The names set by Vercel's Supabase integration (POSTGRES_URL, POSTGRES_URL_NON_POOLING) work too.
 * With a plain local PostgreSQL, DATABASE_URL alone is enough.
 */
const pick = (...names: string[]) => names.map((n) => (process.env[n] ?? "").trim()).find(Boolean) ?? "";

export function appDatabaseUrl(): string {
  const url = pick("DATABASE_URL", "POSTGRES_URL");
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env (or set it in Vercel) and fill it in.");
  return url;
}

export function directDatabaseUrl(): string {
  const url = pick("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL");
  if (!url) throw new Error("DIRECT_URL / DATABASE_URL is not set (see .env.example).");
  return url;
}
