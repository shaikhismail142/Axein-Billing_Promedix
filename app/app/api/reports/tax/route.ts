export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getTaxReport } from "@/app/lib/tax-report";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const group = url.searchParams.get("group") === "quarter" ? "quarter" : "month";
    const includeDraft = url.searchParams.get("includeDraft") === "1";

    const data = await getTaxReport(from, to, { group, includeDraft });

    return NextResponse.json({
      ok: true,
      ...data,
      note: "Input GST = tax paid on purchases (ITC). Output GST = tax collected on sales.",
    });
  } catch (err: any) {
    console.error("GET /api/reports/tax", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
