import type { Metadata } from "next";
import { list } from "@/lib/api/inventory";
import { preloadApi, requireUser, savePage } from "@/lib/page";
import { AppPage } from "@/components/app-page";
import { markup } from "./markup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory" };

/** Inventory: stock list, add / edit products, labels, bulk upload, ZIP export and templates. */
export default async function Page() {
  const { ctx, me } = await requireUser();
  // The page's first request (user, categories, products, templates) comes embedded in the HTML.
  const preload = await preloadApi(ctx, me, { list });
  await savePage(ctx);
  return <AppPage markup={markup} script="inventory" preload={preload} topbarInner={'<div class="topbar-in"></div>'} />;
}
