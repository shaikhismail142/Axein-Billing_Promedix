import { NextRequest, NextResponse } from "next/server";
import { savePortalCertificate } from "@/app/lib/license-activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isLoopback(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const host = request.headers.get("host") || "";
  return !forwarded && /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
}

export async function POST(request: NextRequest) {
  if (!isLoopback(request)) {
    return NextResponse.json({ ok: false, error: "Local desktop access only." }, { status: 403 });
  }
  const expected = process.env.AXEIN_DESKTOP_ACTIVATION_SECRET || "";
  const supplied = request.headers.get("x-axein-desktop-secret") || "";
  if (!expected || supplied !== expected) {
    return NextResponse.json({ ok: false, error: "Desktop activation secret is invalid." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const record = await savePortalCertificate(body.certificate, String(body.deviceHash || ""));
    return NextResponse.json({ ok: true, activation: record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Portal activation could not be saved." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
