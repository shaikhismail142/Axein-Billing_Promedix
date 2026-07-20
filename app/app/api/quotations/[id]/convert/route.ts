import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { POST as createSale } from "@/api/sales/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const quotationId = Number(params.id);
  if (!Number.isFinite(quotationId)) {
    return NextResponse.json({ ok: false, error: "Invalid quotation id" }, { status: 400 });
  }

  // Converting twice must never create duplicate invoices or deduct stock twice.
  const existing = await pool.query(
    `SELECT id FROM sales
      WHERE COALESCE(meta->>'source_quotation_id', '') = $1
      ORDER BY id DESC LIMIT 1`,
    [String(quotationId)]
  );
  if (existing.rows[0]?.id) {
    const saleId = Number(existing.rows[0].id);
    return NextResponse.json({
      ok: true,
      sale_id: saleId,
      redirect: `/invoices/${saleId}`,
      info: "Already converted",
    });
  }

  const quotationResult = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.phone AS customer_phone,
            c.gstin AS customer_gstin, c.address AS customer_address
       FROM quotations q
       LEFT JOIN customers c ON c.id=q.customer_id
      WHERE q.id=$1 LIMIT 1`,
    [quotationId]
  );
  const quotation = quotationResult.rows[0];
  if (!quotation) {
    return NextResponse.json({ ok: false, error: "Quotation not found" }, { status: 404 });
  }

  const itemResult = await pool.query(
    `SELECT product_id, description, qty, price, tax, discount, batch_no, exp_date
       FROM quotation_items
      WHERE quotation_id=$1
      ORDER BY id ASC`,
    [quotationId]
  );
  if (!itemResult.rows.length) {
    return NextResponse.json({ ok: false, error: "Quotation has no items" }, { status: 400 });
  }

  const meta = quotation.meta || {};
  const saleRequest = new Request(new URL("/api/sales", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_quotation_id: quotationId,
      customer_id: quotation.customer_id,
      customer_name: quotation.customer_name,
      customer_phone: quotation.customer_phone,
      customer_gstin: quotation.customer_gstin,
      customer_address: quotation.customer_address,
      amount_paid: 0,
      payment_method: null,
      notes: meta.notes || null,
      terms: meta.terms || null,
      vehicle_registration: meta.vehicle_registration || null,
      vehicle_make_model: meta.vehicle_make_model || null,
      odometer: meta.odometer || null,
      job_card_no: meta.job_card_no || null,
      service_advisor: meta.service_advisor || null,
      items: itemResult.rows.map((item) => {
        const qty = Number(item.qty || 0);
        const unitPrice = Number(item.price || 0);
        const gross = qty * unitPrice;
        const discount = Math.max(0, Number(item.discount || 0));
        const discountPct = discount <= 100
          ? discount
          : gross > 0
          ? Math.min(100, (discount / gross) * 100)
          : 0;
        return {
          product_id: item.product_id,
          name: item.description || "Item",
          qty,
          unit_price: unitPrice,
          discount_pct: discountPct,
          gst_slab: Number(item.tax || 0),
          batch_no: item.batch_no || null,
          exp_date: item.exp_date || null,
        };
      }),
    }),
  });

  const saleResponse = await createSale(saleRequest);
  const result = await saleResponse.json().catch(() => ({}));
  if (!saleResponse.ok || !result?.id) {
    return NextResponse.json(
      { ok: false, error: result?.error || "Failed to convert this quotation" },
      { status: saleResponse.status || 500 }
    );
  }

  const saleId = Number(result.id);
  return NextResponse.json({ ok: true, sale_id: saleId, redirect: `/invoices/${saleId}` });
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return POST(req, ctx);
}
