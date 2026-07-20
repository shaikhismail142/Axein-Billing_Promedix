import { NextResponse } from "next/server";
import { ping } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await ping();
  return NextResponse.json(
    {
      ok: database,
      service: "axein-billing",
      database: database ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
    },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
