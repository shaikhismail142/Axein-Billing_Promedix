// app/api/license/start-trial/route.ts
import { NextResponse } from "next/server";
import { startTrial, getActivationStatus } from "@/app/lib/license-activation";


export const dynamic = "force-dynamic";
export const revalidate = 0;


function json(data: any, status = 200) {
return NextResponse.json(data, {
status,
headers: { "Cache-Control": "no-store" },
});
}


export async function POST() {
try {
// Start (or re-affirm) a 7-day trial; implementation should
// respect trial_allowed and existing trial state internally.
const record = await startTrial(7);
const status = await getActivationStatus();


const trialActive = status.mode === "trial";
const trial_expires_at = (record as any)?.trial_expires_at ?? null;


return json({
ok: true,
trialActive,
trialExpiresAt: trial_expires_at,
status,
});
} catch (e: any) {
return json({ ok: false, error: e?.message || "Failed to start trial" }, 400);
}
}