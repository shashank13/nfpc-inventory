import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminData } from "@/lib/api/admin";
import { userJson } from "@/lib/auth";
import { preloadApi, requireUser, savePage } from "@/lib/page";
import { AppPage } from "@/components/app-page";
import { markup } from "./markup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users & roles" };

/** Users & roles (Super Admin only). */
export default async function Page() {
  const { ctx, me } = await requireUser();
  if (!me.isSuper) redirect("/inventory");
  const preload = await preloadApi(ctx, me, { admin_data: adminData });
  const json = userJson(ctx, me);
  await savePage(ctx);
  return <AppPage markup={markup} script="users" meJson={json} preload={preload} />;
}
