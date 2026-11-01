import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ASSET_VERSION } from "@/components/ui";

export const metadata: Metadata = {
  title: { template: "%s · Nitte FPC Inventory", default: "Nitte FPC Inventory" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f7d32",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const v = ASSET_VERSION;
  return (
    // app.js sets data-theme on <html> before the page paints (saved light/dark choice).
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href={`/assets/favicon.ico?v=${v}`} sizes="16x16 32x32 48x48" />
        <link rel="icon" type="image/png" sizes="32x32" href={`/assets/favicon-32.png?v=${v}`} />
        <link rel="icon" type="image/png" sizes="192x192" href={`/assets/logo-192.png?v=${v}`} />
        <link rel="apple-touch-icon" href={`/assets/apple-touch-icon.png?v=${v}`} />
        <link rel="stylesheet" href={`/assets/app.css?v=${v}`} />
        {/* Shared helpers (theme, API calls, dialogs, top bar). Loaded before the page so the theme never flashes. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={`/assets/app.js?v=${v}`} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
