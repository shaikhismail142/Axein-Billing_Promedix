import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchItem = {
  kind: "product" | "customer" | "invoice" | "quotation" | "purchase";
  id: number;
  title: string;
  subtitle: string;
  href: string;
};

async function safeRows(sql: string, values: unknown[]): Promise<any[]> {
  try {
    const result = await pool.query(sql, values);
    return result.rows || [];
  } catch (error) {
    // Older installations may not have every optional module yet. Global search
    // should still return the modules that are available.
    console.warn("Global search section skipped:", (error as Error)?.message || error);
    return [];
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get("limit") || 5)));

  if (q.length < 2) return NextResponse.json({ items: [] });
  const like = `%${q}%`;

  const [products, customers, invoices, quotations, purchases] = await Promise.all([
    safeRows(
      `SELECT p.id, p.name,
              COALESCE(NULLIF(p.meta->>'sku',''), NULLIF(p.sku,'')) AS sku,
              COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,''), 'other') AS category
         FROM products p
        WHERE p.name ILIKE $1
           OR COALESCE(p.meta->>'sku', p.sku, '') ILIKE $1
           OR COALESCE(p.meta->>'category', p.category, '') ILIKE $1
           OR COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code', '') ILIKE $1
        ORDER BY CASE WHEN lower(p.name)=lower($2) THEN 0 ELSE 1 END, lower(p.name)
        LIMIT $3`,
      [like, q, limit]
    ),
    safeRows(
      `SELECT c.id, c.name, c.phone, c.gstin
         FROM customers c
        WHERE c.name ILIKE $1
           OR COALESCE(c.phone,'') ILIKE $1
           OR COALESCE(c.gstin,'') ILIKE $1
           OR CAST(c.id AS text) = $2
        ORDER BY CASE WHEN lower(c.name)=lower($2) THEN 0 ELSE 1 END, lower(c.name)
        LIMIT $3`,
      [like, q, limit]
    ),
    safeRows(
      `SELECT s.id, s.invoice_no, c.name AS customer_name,
              COALESCE(s.total, s.grand_total, 0) AS total
         FROM sales s
         LEFT JOIN customers c ON c.id=s.customer_id
        WHERE COALESCE(s.invoice_no,'') ILIKE $1
           OR COALESCE(c.name,'') ILIKE $1
           OR COALESCE(c.phone,'') ILIKE $1
           OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id AND si.name ILIKE $1)
           OR CAST(s.id AS text) = $2
        ORDER BY s.id DESC
        LIMIT $3`,
      [like, q, limit]
    ),
    safeRows(
      `SELECT qt.id, qt.quotation_number, c.name AS customer_name
         FROM quotations qt
         LEFT JOIN customers c ON c.id=qt.customer_id
        WHERE COALESCE(qt.quotation_number,'') ILIKE $1
           OR COALESCE(c.name,'') ILIKE $1
           OR EXISTS (
                SELECT 1 FROM quotation_items qi
                 WHERE qi.quotation_id=qt.id AND qi.description ILIKE $1
              )
           OR CAST(qt.id AS text) = $2
        ORDER BY qt.id DESC
        LIMIT $3`,
      [like, q, limit]
    ),
    safeRows(
      `SELECT p.id,
              COALESCE(NULLIF(p.bill_no,''), p.meta->>'invoice_no', 'Purchase #' || p.id::text) AS purchase_no,
              COALESCE(s.name, p.meta->>'vendor_name', p.meta->>'supplier_name', '') AS supplier_name
         FROM purchases p
         LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE COALESCE(p.bill_no, p.meta->>'invoice_no', '') ILIKE $1
           OR COALESCE(s.name, p.meta->>'vendor_name', p.meta->>'supplier_name', '') ILIKE $1
           OR CAST(p.id AS text) = $2
        ORDER BY p.id DESC
        LIMIT $3`,
      [like, q, limit]
    ),
  ]);

  const items: SearchItem[] = [
    ...products.map((r) => ({
      kind: "product" as const,
      id: Number(r.id),
      title: String(r.name || `Product #${r.id}`),
      subtitle: [r.sku, r.category].filter(Boolean).join(" · ") || "Product",
      href: `/products/${r.id}/edit`,
    })),
    ...customers.map((r) => ({
      kind: "customer" as const,
      id: Number(r.id),
      title: String(r.name || `Customer #${r.id}`),
      subtitle: [r.phone, r.gstin].filter(Boolean).join(" · ") || "Customer",
      href: `/invoices?customerId=${r.id}`,
    })),
    ...invoices.map((r) => ({
      kind: "invoice" as const,
      id: Number(r.id),
      title: String(r.invoice_no || `Invoice #${r.id}`),
      subtitle: `${r.customer_name || "Walk-in"} · INR ${Number(r.total || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
      href: `/invoices/${r.id}`,
    })),
    ...quotations.map((r) => ({
      kind: "quotation" as const,
      id: Number(r.id),
      title: String(r.quotation_number || `Quotation #${r.id}`),
      subtitle: String(r.customer_name || "Walk-in quotation"),
      href: `/quotations/${r.id}`,
    })),
    ...purchases.map((r) => ({
      kind: "purchase" as const,
      id: Number(r.id),
      title: String(r.purchase_no || `Purchase #${r.id}`),
      subtitle: String(r.supplier_name || "Purchase"),
      href: `/inventory/purchases/${r.id}`,
    })),
  ];

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
