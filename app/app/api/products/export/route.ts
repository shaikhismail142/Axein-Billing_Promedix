// app/api/products/export/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const lowOnly = (url.searchParams.get("low") || "").trim() === "1";
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n))
    : [];

  const where: string[] = [];
  const params: any[] = [];

  if (ids.length) {
    params.push(ids);
    where.push(`p.id = ANY($${params.length}::int[])`);
  } else if (q) {
    params.push(`%${q}%`);
    where.push(`(
      p.name ILIKE $${params.length}
      OR (p.meta->>'sku') ILIKE $${params.length}
      OR COALESCE(NULLIF(p.category,''), NULLIF(p.meta->>'category','')) ILIKE $${params.length}
      OR COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') ILIKE $${params.length}
    )`);
  }
  if (!ids.length && category) {
    params.push(category);
    where.push(`COALESCE(NULLIF(p.category,''), NULLIF(p.meta->>'category','')) = $${params.length}`);
  }
  if (!ids.length && lowOnly) {
    where.push(
      `COALESCE(NULLIF(p.meta->>'stock_qty','')::int, NULLIF(p.meta->>'stock','')::int, 0)
       <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      (p.meta->>'sku') AS sku,
      COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,'')) AS category,
      COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code,
      COALESCE((p.meta->>'price')::numeric, 0) AS price,
      COALESCE((p.meta->>'stock_qty')::int, 0) AS stock_qty,
      COALESCE((p.meta->>'low_stock_threshold')::int, 0) AS low_stock_threshold
    FROM products p
    ${whereSql}
    ORDER BY p.id ASC
    `,
    params
  );

  const header = ["ID", "Name", "SKU", "Category", "HSN", "Price", "Stock", "LowStock"];
  const lines = [header.join(",")];

  for (const r of rows) {
    const safeName = csvSafe(r.name);
    const safeSku = csvSafe(r.sku ?? "");
    const safeCat = csvSafe(r.category ?? "");
    const safeHsn = csvSafe(r.hsn_code ?? "");
    lines.push([r.id, safeName, safeSku, safeCat, safeHsn, r.price, r.stock_qty, r.low_stock_threshold].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products_export.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvSafe(val: any) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes(`"`) || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}
