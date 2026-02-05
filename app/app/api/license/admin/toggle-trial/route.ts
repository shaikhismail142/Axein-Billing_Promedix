import { NextResponse } from "next/server";
import {
  getActivationRecord,
  saveActivationRecord,
  getActivationStatus,
} from "@/app/lib/license-activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };

    const current = (await getActivationRecord()) ?? null;
    // Treat undefined as true (back-compat)
    const currAllowed = current?.trial_allowed ?? true;

    // If body.enabled is provided, set to that; else toggle.
    const newAllowed = typeof body.enabled === "boolean" ? body.enabled : !currAllowed;

    // Do not accidentally flip mode; only patch the flag.
    const merged = await saveActivationRecord({ trial_allowed: newAllowed });

    const status = await getActivationStatus();

    return NextResponse.json(
      {
        ok: true,
        trial_allowed: merged.trial_allowed ?? true,
        status,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Failed to toggle trial" },
      { status: 500 }
    );
  }
}
