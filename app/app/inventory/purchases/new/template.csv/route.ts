import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rows = [
    ["product_id","qty","cost_price","mrp","tax_rate","discount","batch_no","mfg_date","exp_date","product_name"],
    ["1","10","120","","5","","B-123","2025-09-01","2026-09-01","Sample Product"],
  ];
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="purchase_template.csv"',
    },
  });
}
