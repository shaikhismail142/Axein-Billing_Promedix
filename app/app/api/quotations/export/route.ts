// app/api/quotations/export/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const from = url.searchParams.get("from")?.trim() || "";
  const to = url.searchParams.get("to")?.trim() || "";
  const idsP = url.searchParams.get("ids")?.trim() || "";

  const where: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (idsP) {
    const ids = idsP
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }
    where.push(`q.id = ANY($${p}::int[])`);
    params.push(ids);
    p++;
  } else {
    if (q) {
      where.push(`(c.name ILIKE $${p} OR q.quotation_number ILIKE $${p})`);
      params.push(`%${q}%`);
      p++;
    }
    if (from) {
      where.push(`q.quotation_date::date >= $${p}::date`);
      params.push(from);
      p++;
    }
    if (to) {
      where.push(`q.quotation_date::date < ($${p}::date + INTERVAL '1 day')`);
      params.push(to);
      p++;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const db = await getDb();
  const { rows } = await db.query(
    `
    SELECT
      q.id,
      q.quotation_number,
      q.quotation_date,
      q.valid_until,
      c.name AS customer_name,
      COALESCE(
        SUM(
          (qi.qty * qi.price)
          - CASE WHEN qi.discount > 0
                 THEN CASE WHEN qi.discount <= 100
                           THEN (qi.qty*qi.price) * (qi.discount/100.0)
                           ELSE qi.discount END
                 ELSE 0 END
          + (
              ( (qi.qty*qi.price)
                - CASE WHEN qi.discount > 0
                       THEN CASE WHEN qi.discount <= 100
                                 THEN (qi.qty*qi.price) * (qi.discount/100.0)
                                 ELSE qi.discount END
                       ELSE 0 END
              ) * (COALESCE(qi.tax,0)/100.0)
            )
        ),
        0
      )::float8 AS total_amount
    FROM quotations q
    LEFT JOIN customers c ON c.id = q.customer_id
    LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
    ${whereSql}
    GROUP BY q.id, q.quotation_number, q.quotation_date, q.valid_until, c.name
    ORDER BY q.quotation_date DESC, q.id DESC
    `,
    params
  );

  const lines: string[] = [];
  lines.push([
    "id",
    "quotation_number",
    "quotation_date",
    "valid_until",
    "customer_name",
    "total_amount",
  ].join(","));

  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.quotation_number ?? r.id),
      csvEscape(r.quotation_date ? new Date(r.quotation_date).toISOString() : ""),
      csvEscape(r.valid_until ? new Date(r.valid_until).toISOString() : ""),
      csvEscape(r.customer_name ?? ""),
      csvEscape(r.total_amount ?? ""),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\n");
  const name =
    from && to ? `quotations_${from}_${to}.csv`
    : idsP ? "quotations_selected.csv"
    : "quotations_export.csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
