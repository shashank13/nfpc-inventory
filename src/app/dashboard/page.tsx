import type { Metadata } from "next";
import { dashboard } from "@/lib/api/reports";
import { userJson } from "@/lib/auth";
import { preloadApi, requireUser, savePage } from "@/lib/page";
import { AppPage } from "@/components/app-page";
import { markup } from "./markup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

/** Dashboard: stock value, alerts, charts, items needing attention and recent activity. */
export default async function Page() {
  const { ctx, me } = await requireUser();
  // The default 30-day view comes embedded; other periods are fetched when chosen.
  const preload = await preloadApi(ctx, me, { "dashboard&days=30": dashboard });
  const json = userJson(ctx, me);
  await savePage(ctx);
  return <AppPage markup={markup} script="dashboard" meJson={json} preload={preload} />;
}
