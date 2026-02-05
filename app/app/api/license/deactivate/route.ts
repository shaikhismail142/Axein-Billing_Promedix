import { NextResponse } from "next/server";
import { saveActivationRecord } from "@/app/lib/license-activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  await saveActivationRecord({
    mode: "inactive",
    ok: false,
    reason: "Manually deactivated for QA",
    license: null,
    // keep trial_allowed as-is; just clear any running trial
    trial_started_at: null,
    trial_expires_at: null,
  });
  return NextResponse.json({ ok: true });
}
