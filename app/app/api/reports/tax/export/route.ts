export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { getTaxReport } from "@/app/lib/tax-report";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const group = url.searchParams.get("group") === "quarter" ? "quarter" : "month";
  const includeDraft = url.searchParams.get("includeDraft") === "1";
  const format = (url.searchParams.get("format") || "csv").toLowerCase();

  const data = await getTaxReport(from, to, { group, includeDraft });
  const { summary, months } = data;

  const lines: string[] = [];
  lines.push(`GST Summary Report`);
  lines.push(`Period,${csvEscape(data.from)} to ${csvEscape(data.to)}`);
  lines.push(`Grouping,${group === "quarter" ? "Quarterly" : "Monthly"}`);
  lines.push(`Draft Purchases,${includeDraft ? "Included" : "Excluded"}`);
  lines.push("");
  lines.push(`Output GST (Sales),${summary.output_tax.toFixed(2)}`);
  lines.push(`Input GST (Purchases/ITC),${summary.input_tax.toFixed(2)}`);
  lines.push(`Net GST (${summary.status}),${summary.net_tax.toFixed(2)}`);
  lines.push("");
  lines.push(`Period,Output GST,Input GST,Net GST`);
  for (const m of months) {
    lines.push([
      csvEscape(m.label),
      m.output_tax.toFixed(2),
      m.input_tax.toFixed(2),
      m.net_tax.toFixed(2),
    ].join(","));
  }

  const csv = lines.join("\n");
  const isExcel = format === "excel" || format === "xls" || format === "xlsx";
  const filename = `axein-gst-report-${data.from}_to_${data.to}.${isExcel ? "xls" : "csv"}`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": isExcel ? "application/vnd.ms-excel" : "text/csv",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
