import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant";

export default async function Home() {
  const viewer = await getViewerContext();
  redirect(viewer ? "/dashboard" : "/login");
}
