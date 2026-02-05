export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { isActivated } from "@/app/lib/activation-check";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (process.env.APP_ACTIVATION_REQUIRED === "true") {
    const ok = await isActivated();
    if (!ok) redirect("/activate");
  }
  return <>{children}</>;
}
