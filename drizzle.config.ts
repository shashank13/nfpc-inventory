import { defineConfig } from "drizzle-kit";
import { directDatabaseUrl } from "./src/db/url";

// drizzle-kit doesn't read .env by itself; Node 20.12+ can.
try { process.loadEnvFile(".env"); } catch { /* no .env file: use the real environment */ }

// Migrations need a normal session, not Supabase's transaction pooler.
// (`db:generate` needs no database, so a missing URL is fine there.)
let url = "";
try { url = directDatabaseUrl(); } catch { /* not set */ }

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
