# Nitte FPC Inventory — Next.js + Drizzle + PostgreSQL

Inventory & barcode-label system built on **Next.js 16**, **Drizzle ORM** and **PostgreSQL**.
Hosted on **Vercel**, with the database on **Supabase**. It also runs locally with Node.js and any
PostgreSQL server.

The original PHP/MySQL version is kept on the `main` branch.

---

## 1. Run it locally

You need Node.js 20.9+ and a PostgreSQL database: either your Supabase project (see section 3) or
a local PostgreSQL server.

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL (and DIRECT_URL for Supabase)

npm run db:setup            # create the tables and default data (roles, categories, label template)
#   (optional) add the 12 sample products too:  npm run db:seed:samples

npm run dev                 # http://localhost:3000
```

With a local PostgreSQL, create an empty database first, e.g.
`"C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres nfpc_inventory`, and set
`DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/nfpc_inventory`.
**No PostgreSQL password handy?** `npm run localdb:init` creates a private database just for this app
(in `.pgdata/`, port 5433) and writes `DATABASE_URL` to `.env`. After a restart, run
`npm run localdb:start` first.

Open <http://localhost:3000>. The first time, the sign-in page asks you to create the Super Admin account.

## 2. Bring over your existing data from MySQL (optional)

Copies every product, stock movement, user, role, label template, reset request and activity-log
entry, keeping their IDs. **Everyone keeps their username and password**: old PHP password hashes are
accepted and upgraded automatically at each person's next sign-in.

1. Start MySQL in XAMPP, and open the old PHP app once (so its database is on the latest version).
2. Set `MYSQL_URL` in `.env`, and `DATABASE_URL` / `DIRECT_URL` to the database you're copying into
   (your Supabase project, for example).
3. On a freshly created database:

```bash
npm run db:migrate
npm run import:mysql -- --yes     # replaces everything in the PostgreSQL database
```

Don't run `db:seed` before the import (the import brings your own roles, categories and templates).

## 3. Deploy: GitHub → Supabase → Vercel

### a. Put the code on GitHub

Create an **empty** repository on GitHub (no README / .gitignore), then:

```bash
git remote add origin https://github.com/YOUR_USER/nfpc-inventory.git
git push -u origin main               # the original PHP version
git push -u origin nextjs-migration   # this app
```

`.env` (passwords) and `.pgdata/` are listed in `.gitignore` and are never uploaded.

### b. Create the database on Supabase

1. [supabase.com](https://supabase.com) → **New project**. Pick the region closest to your users
   (e.g. *South Asia (Mumbai)*), and save the database password.
2. **Connect** (top bar) → **Connection string** → copy two of them, with your password filled in:
   - **Transaction pooler** (port **6543**) → `DATABASE_URL`
   - **Session pooler** (port **5432**) → `DIRECT_URL`
3. Put both in your local `.env` and create the tables from your computer:
   ```bash
   npm run db:setup              # or db:migrate + import:mysql -- --yes to bring your data
   ```
   Run `npm run db:migrate` again whenever a new migration is added.

The app talks to PostgreSQL directly through Drizzle; Supabase's REST API and keys aren't used.
Every table has row-level security switched on, so that API can't reach the data.

### c. Deploy on Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub repository.
   Framework *Next.js* is detected; leave the build settings as they are.
2. **Environment Variables** — add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase *Transaction pooler* URL (port 6543) |
   | `APP_URL` | `https://<your-project>.vercel.app` (or your own domain) |
   | `MAIL_TRANSPORT` | `none`, `smtp` or `resend` (+ the matching `MAIL_*` / `SMTP_*` / `RESEND_API_KEY`) |

3. **Deploy.** To make the `nextjs-migration` branch the live site, either merge it into `main`, or
   set *Project → Settings → Git → Production Branch* to `nextjs-migration`. Every push then
   redeploys automatically, and other branches get preview links.

`vercel.json` runs the server code in Mumbai (`bom1`). If your Supabase project is in another
region, change it to the [nearest Vercel region](https://vercel.com/docs/regions) — keeping the two
close makes every page faster.

## Automatic SKUs

New products get a SKU (barcode value) automatically, and it can always be edited: type your own
SKU in the form, or click **Generate** to go back to an automatic one. Managers set the format with
the gear button next to the SKU field (**SKU format**): pick a style or write your own, using
`{PREFIX}` (company code), `{CAT}` (category code), `{NAME:4}`, `{SEQ:5}` (running number that never
repeats), `{RAND:5}` (random digits) and `{YYYY}` `{YY}` `{MM}` `{DD}`. Bulk-upload rows without a SKU
use the same format. SKUs are made on the server, so two people adding products at once never get
the same one.

## Printing labels on a barcode / label printer

Works with thermal label printers that have a Windows driver: Zebra, TSC, TVS, Godex, Xprinter, Honeywell, and others.

1. **Install the printer's Windows driver**, and in the driver's printing preferences set the
   paper/stock size to your label size (e.g. 50 × 25 mm), with the label gap/mark sensor as your roll needs.
2. In the app: **Inventory → Label templates → Printer & label size**
   - *Print on:* **Barcode / label printer (roll)**
   - *Label size:* your roll (or *Custom size…*), *Labels across the roll* for 2-up / 3-up rolls
   - *Label layout:* **Full label** (100 × 75 mm and up), **Compact** (≈ 50 × 25 to 75 × 50 mm) or
     **Barcode + price only** (smallest labels)
   - *Black only:* on for thermal printers
   The preview shows the label at its real shape, and warns if the barcode bars would be thinner than
   0.25 mm (too thin for many 203 dpi printers). Shorter SKUs or a larger label fix that.
3. **Print** (from a product's *Label* button, the selection bar, or *Export → Print labels*). In the
   print dialog choose the label printer, **Margins: None**, **Scale: 100% / Default**, and turn off
   *Headers and footers*. Each label is sent as its own page at the exact label size, so the printer
   feeds exactly one label per label.

**One-click printing (no print dialog):** make the label printer Windows' *default printer*, then open
the app from a Chrome shortcut with the `--kiosk-printing` switch, e.g.
`"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://<your-project>.vercel.app`
(close all other Chrome windows first). Print then goes straight to the printer. Microsoft Edge
accepts the same switch.

The *Normal printer (A4 sheet)* option keeps the previous behaviour: several labels per A4 page.

## Settings (`.env` locally, Environment Variables on Vercel)

| Name | What it does |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection the app uses (Supabase: transaction pooler, port 6543) |
| `DIRECT_URL` | Connection for migrations, seed and the MySQL import (Supabase: session pooler, port 5432). Not needed on Vercel or with a local database. |
| `APP_URL` | Public address of the app, used in password-reset emails. Blank = the address in the browser (only trusted for `localhost`). |
| `MAIL_TRANSPORT` | `none` (reset requests go to Users & roles → Reset requests), `smtp` or `resend` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP server (Gmail: use an App password) |
| `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` | Resend / sender details |
| `MYSQL_URL` | Old MySQL database, only for `npm run import:mysql` |

## Commands

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop / build / run in production mode |
| `npm run db:setup` | Create tables + default data (`db:migrate` then `db:seed`) |
| `npm run db:seed:samples` | Default data plus 12 sample products |
| `npm run db:generate` | After editing `src/db/schema.ts`: create a new migration in `src/db/migrations` |
| `npm run db:migrate` | Apply new migrations to the database |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run import:mysql -- --yes` | Copy all data from the old MySQL database |
| `npm run localdb:init` / `localdb:start` / `localdb:stop` | Optional private local PostgreSQL |
| `npm run typecheck` | TypeScript check |

## How it's organised

```
src/
  app/<page>/page.tsx     pages: login, forgot, reset, account, dashboard, inventory, activity, users
  app/api/route.ts        /api?action=… JSON API
  app/auth/*/route.ts     sign-in, forgot / reset password and account form posts
  components/             shared page shell and UI pieces
  db/schema.ts            database tables (Drizzle) — the single source of truth for the schema
  db/migrations/          SQL migrations generated from schema.ts
  db/index.ts             database connection (pooled on Vercel)
  db/url.ts               which connection string to use (app vs. migrations)
  db/seed.ts              default roles, categories, label template (+ sample products)
  lib/auth.ts             signed-in user, permissions, impersonation, activity log, password resets
  lib/context.ts          per-request context and database-backed sessions
  lib/api/*.ts            the API: inventory, SKUs, users & roles, dashboard & activity
public/
  assets/                 shared CSS, JS, logos
  js/                     each page's browser script
scripts/
  import-mysql.ts         MySQL → PostgreSQL data copy
  local-db.mjs            optional private local PostgreSQL
drizzle.config.ts         Drizzle Kit settings (migrations)
next.config.ts            security headers, caching, redirects from the old .php addresses
vercel.json               Vercel region
```

Every page footer credits the developer, [Inspirante Technologies Pvt. Ltd.](https://inspirantech.in/), next to the "© year … All rights reserved." notice
(set in `src/lib/config.ts`).

Old addresses such as `dashboard.php` or reset links `reset.php?token=…` redirect to the new ones.

### Speed

- **Pages draw immediately:** each page's first data is embedded in the HTML, and page scripts
  start as soon as the HTML arrives (not after React loads).
- **Inventory is paged on the server:** search, category, stock filters, counts and paging run in
  PostgreSQL, so only one page of products (25–200) is ever sent. "Export", "Print all" and the ZIP
  download fetch the full list only when clicked. The activity log is paged the same way.
- **Fewer database trips:** the session and signed-in user load in one query; categories are
  cached for a minute; a product edit locks, reads and writes in one statement; dashboard and
  activity queries run in parallel; PostgreSQL builds the product JSON itself.
- **Smaller, cached transfers:** API responses are compressed (by Vercel when hosted there, by the
  app locally), and CSS/JS/images are cached by the browser for a year with a new `?v=` on every build.
- **Indexes for every list and search** (see below), including trigram indexes so "contains"
  searches stay fast as the inventory and activity log grow.

### Database changes from MySQL

- Usernames, emails, SKUs and names are case-insensitive (`citext`), just as MySQL's collation was.
- Units, stock actions and log categories are real enums; role permissions are a `text[]`; label
  templates and change lists are `jsonb`.
- Checks keep bad data out: stock and MRP can't be negative, best-before can't be before packing.
- `stock_movements.qty_change` is calculated by the database.
- Indexes match the queries the app runs: newest-first lists, sign-in rate limits, activity filters,
  pending resets, a covering index for the stock-movement chart, and `pg_trgm` trigram indexes for
  the stock-list and activity-log search boxes. At most one label template can be the default.
- Frequently updated tables (products, sessions, users) keep free space in each page, so updates
  happen in place (HOT) instead of rewriting index entries.
- Sessions are stored in the `sessions` table (only a hash of the cookie is kept).
- Row-level security is on for every table (with no policies), so Supabase's public REST API can't
  read or change anything. The app connects as the table owner and is unaffected.
- The unused report views `v_low_stock` / `v_expiring_soon` were dropped; the dashboard computes these.
