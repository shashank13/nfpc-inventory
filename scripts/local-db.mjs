/**
 * A private PostgreSQL server for this app, stored in nextjs-app/.pgdata (port 5433).
 * Uses the PostgreSQL programs already installed on this computer; your main server is untouched.
 *
 *   npm run localdb:init    — create it once (writes DATABASE_URL into .env)
 *   npm run localdb:start   — start it (run before `npm start` / `npm run dev`)
 *   npm run localdb:stop    — stop it
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PORT = 5433;
const DATA = resolve(".pgdata");
const DB = "nfpc_inventory";

function pgBin(name) {
  const exe = process.platform === "win32" ? name + ".exe" : name;
  const roots = ["C:/Program Files/PostgreSQL", "/usr/lib/postgresql", "/opt/homebrew/opt", "/usr/local/opt"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const v of versions) {
      const p = join(root, v, "bin", exe);
      if (existsSync(p)) return p;
    }
  }
  return exe; // hope it's on PATH
}

const run = (name, args, opts = {}) => execFileSync(pgBin(name), args, { stdio: "inherit", ...opts });

function setEnv(key, value) {
  const file = ".env";
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : text + `\n${line}\n`;
  writeFileSync(file, text);
}

const cmd = process.argv[2];
if (cmd === "init") {
  if (existsSync(DATA)) {
    console.log(".pgdata already exists — nothing to do. (Delete the folder to start over.)");
    process.exit(0);
  }
  const password = randomBytes(18).toString("base64url");
  const tmp = mkdtempSync(join(tmpdir(), "nfpc-"));
  const pwfile = join(tmp, "pw");
  writeFileSync(pwfile, password);
  try {
    run("initdb", ["-D", DATA, "-U", "nfpc", "--pwfile", pwfile, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C"], { stdio: "ignore" });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  start();
  run("createdb", ["-h", "127.0.0.1", "-p", String(PORT), "-U", "nfpc", DB], { env: { ...process.env, PGPASSWORD: password } });
  setEnv("DATABASE_URL", `postgres://nfpc:${password}@127.0.0.1:${PORT}/${DB}`);
  console.log(`Local database ready on port ${PORT}; DATABASE_URL written to .env.`);
} else if (cmd === "start") {
  start();
} else if (cmd === "stop") {
  run("pg_ctl", ["-D", DATA, "stop", "-m", "fast"]);
} else {
  console.log("Usage: node scripts/local-db.mjs init | start | stop");
  process.exit(1);
}

function start() {
  try {
    execFileSync(pgBin("pg_ctl"), ["-D", DATA, "status"], { stdio: "ignore" });
    console.log("Local database is already running.");
    return;
  } catch { /* not running */ }
  // The server keeps running in the background; don't tie it to this terminal's output.
  run("pg_ctl", ["-D", DATA, "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-l", join(DATA, "server.log"), "-w", "start"], { stdio: "ignore" });
  console.log(`Local database running on port ${PORT}.`);
}
