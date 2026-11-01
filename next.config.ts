import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// A new value on every build: static files are requested as "?v=<this>", so browsers can keep
// them for a year and still get new versions right after an update.
const assetVersion = process.env.ASSET_VERSION || Date.now().toString(36);

// Browser-enforced allow-list (same as the old .htaccess): scripts/styles only from this site
// (+ the Excel reader on cdnjs), data only sent back to this site, and no framing by other sites.
// `next dev` additionally needs eval and websockets for hot reload.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: csp },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { ASSET_VERSION: assetVersion },
  // This folder is the app root (there may be other lockfiles in parent folders).
  turbopack: { root: process.cwd() },
  agentRules: false,
  devIndicators: false,
  async headers() {
    const longCache = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      // Versioned static files (see assetVersion). Not in `next dev`, where files change constantly.
      ...(isDev ? [] : [{ source: "/assets/:file*", headers: longCache }, { source: "/js/:file*", headers: longCache }]),
    ];
  },
  // Old PHP addresses keep working (bookmarks, links in emails already sent).
  async redirects() {
    return [
      { source: "/index.php", destination: "/dashboard", permanent: true },
      { source: "/dashboard.php", destination: "/dashboard", permanent: true },
      { source: "/inventory-barcode.html", destination: "/inventory", permanent: true },
      { source: "/activity.php", destination: "/activity", permanent: true },
      { source: "/users.php", destination: "/users", permanent: true },
      { source: "/account.php", destination: "/account", permanent: true },
      { source: "/login.php", destination: "/login", permanent: true },
      { source: "/forgot.php", destination: "/forgot", permanent: true },
      { source: "/reset.php", has: [{ type: "query", key: "token" }], destination: "/auth/reset", permanent: false },
      { source: "/reset.php", destination: "/reset", permanent: true },
    ];
  },
};

export default nextConfig;
