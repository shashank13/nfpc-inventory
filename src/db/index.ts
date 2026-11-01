/**
 * Database connection (Drizzle ORM + postgres.js).
 *
 *  - Locally: one shared connection pool, reused across hot reloads in `next dev`.
 *  - On Vercel: each serverless instance keeps a single connection and goes through Supabase's
 *    connection pooler (Supavisor, transaction mode, port 6543), so many instances don't run the
 *    database out of connections. Transaction mode can't keep prepared statements between
 *    queries, so they're turned off whenever the URL points at port 6543.
 *
 * DATABASE_URL is the app's (pooled) connection. Migrations and scripts use DIRECT_URL instead
 * (see src/db/url.ts).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { appDatabaseUrl } from "./url";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Exec = DB | Tx;

const serverless = !!process.env.VERCEL;

function connect(): DB {
  const url = appDatabaseUrl();
  const client = postgres(url, {
    max: serverless ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !/:6543\//.test(url), // Supabase transaction pooler: no prepared statements
    fetch_types: false, // only built-in types are used; skips a round trip on connect
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as { __nfpcDb?: DB };

/** The shared database handle. Call once per request and pass the result down. */
export function getDb(): DB {
  return (globalForDb.__nfpcDb ??= connect());
}

export { schema };
