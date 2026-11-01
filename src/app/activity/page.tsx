import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { activity } from "@/lib/api/reports";
import { can, userJson } from "@/lib/auth";
import { preloadApi, requireUser, savePage } from "@/lib/page";
import { AppPage } from "@/components/app-page";
import { markup } from "./markup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity log" };

/** Activity log: who did what, to which item, and when. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, me } = await requireUser();
  if (!can(me, "activity.view")) redirect("/inventory");
  // The unfiltered first page comes embedded (filtered links fetch as usual).
  const filtered = Object.keys(await searchParams).length > 0;
  const preload = filtered ? {} : await preloadApi(ctx, me, { "activity_list&page=1&size=50&meta=1": (c) => activity(c, false) });
  const json = userJson(ctx, me);
  await savePage(ctx);
  return <AppPage markup={markup} script="activity" meJson={json} preload={preload} />;
}
