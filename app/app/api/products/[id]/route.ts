// app/api/products/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db"; // change to "@/lib/db" if that's your real path

function n(v: unknown) {
  if (v === null || v === undefined || v === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}
function s(v: unknown) {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
}

function resolveOrigin(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  let origin = host ? `${proto}://${host}` : new URL(req.url).origin;
  if (origin.includes("0.0.0.0")) origin = origin.replace("0.0.0.0", "localhost");
  return origin;
}

async function readMeta(id: number) {
  try {
    const r = await pool.query(`SELECT id, name, meta, category, created_at, updated_at FROM products WHERE id=$1`, [id]);
    if (r.rowCount === 0) return null;
    return r.rows[0] as {
      id: number;
      name: string;
      meta: any;
      category?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    };
  } catch {
    const r = await pool.query(`SELECT id, name, meta, category, created_at FROM products WHERE id=$1`, [id]);
    if (r.rowCount === 0) return null;
    return r.rows[0] as {
      id: number;
      name: string;
      meta: any;
      category?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    };
  }
}
async function writeMeta(id: number, patch: Record<string, any>, opts?: { name?: string }) {
  const cur = await readMeta(id);
  if (!cur) return null;
  const next = { ...(cur.meta || {}), ...patch };
  const nextName = opts?.name ?? cur.name;
  try {
    await pool.query(`UPDATE products SET name=$2, meta=$3::jsonb, updated_at=now() WHERE id=$1`, [id, nextName, JSON.stringify(next)]);
  } catch {
    await pool.query(`UPDATE products SET name=$2, meta=$3::jsonb WHERE id=$1`, [id, nextName, JSON.stringify(next)]);
  }
  return readMeta(id);
}

// GET /api/products/:id
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });

  const row = await readMeta(id);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const m = row.meta || {};
  return NextResponse.json({
    ok: true,
    id: row.id,
    name: row.name,
    category: s(m.category) ?? s((row as any).category),
    selling_price: n(m.selling_price ?? m.price) ?? 0,
    gst_slab: n(m.gst_slab) ?? 0,
    stock_qty: n(m.stock_qty ?? m.stock) ?? 0,
    low_stock_threshold: n(m.low_stock_threshold) ?? 0,
    cost_price: n(m.cost_price),
    sku: s(m.sku),
    brand: s(m.brand),
    hsn_code: s(m.hsn_code),
    unit: s(m.unit),
    notes: s(m.notes),
    exp_date: s(m.exp_date ?? m.expiry_date),
    updated_at: (row as any).updated_at ?? (row as any).created_at ?? null,
    meta: m,
  });
}

// PATCH /api/products/:id
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  const name = s(body.name);

  const price = n(body.selling_price ?? body.price);
  if (price !== undefined) patch.selling_price = price;

  const gst = n(body.gst_slab);
  if (gst !== undefined) patch.gst_slab = gst;

  const stock = n(body.stock_qty ?? body.stock);
  if (stock !== undefined) patch.stock_qty = stock;

  const low = n(body.low_stock_threshold);
  if (low !== undefined) patch.low_stock_threshold = low;

  const cost = n(body.cost_price);
  if (cost !== undefined) patch.cost_price = cost;

  const sku = s(body.sku);
  if (sku !== undefined) patch.sku = sku;

  const brand = s(body.brand);
  if (brand !== undefined) patch.brand = brand;

  const hsn = s(body.hsn_code);
  if (hsn !== undefined) patch.hsn_code = hsn;

  const unit = s(body.unit);
  if (unit !== undefined) patch.unit = unit;

  const notes = s(body.notes);
  if (notes !== undefined) patch.notes = notes;

  const category = s(body.category);
  if (category !== undefined) patch.category = category;

  const expDate = s(body.exp_date ?? body.expiry_date);
  if (expDate !== undefined) patch.exp_date = expDate;

  if (Object.keys(patch).length === 0 && name === undefined) {
    return NextResponse.json({ ok: true, message: "nothing to update" });
  }

  const updated = await writeMeta(id, patch, { name });
  if (!updated) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Best-effort sync to column if it exists
  if (category !== undefined) {
    try {
      await pool.query(`UPDATE products SET category=$2 WHERE id=$1`, [id, category]);
    } catch {}
  }

  return NextResponse.json({ ok: true, item: updated });
}

// Aliases
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  return PATCH(req, ctx);
}
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return PATCH(req, ctx);

  const form = await req.formData();
  if (String(form.get("_method") || "").toUpperCase() !== "PATCH") {
    return NextResponse.json({ ok: false, error: "Only PATCH supported" }, { status: 405 });
  }

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });

  const patch: Record<string, any> = {};
  const low = n(form.get("low_stock_threshold"));
  if (low !== undefined) patch.low_stock_threshold = low;
  const stock = n(form.get("stock_qty") ?? form.get("stock"));
  if (stock !== undefined) patch.stock_qty = stock;
  const price = n(form.get("selling_price") ?? form.get("price"));
  if (price !== undefined) patch.selling_price = price;
  const category = s(form.get("category"));
  if (category !== undefined) patch.category = category;
  const expDate = s(form.get("exp_date") ?? form.get("expiry_date"));
  if (expDate !== undefined) patch.exp_date = expDate;

  try {
    const updated = await writeMeta(id, patch, { name: s(form.get("name")) });
    if (!updated) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    if (category !== undefined) {
      try {
        await pool.query(`UPDATE products SET category=$2 WHERE id=$1`, [id, category]);
      } catch {}
    }
    const returnTo = s(form.get("return_to"));
    const safeReturn = returnTo && returnTo.startsWith("/") ? returnTo : "/inventory/low-stock";
    const url = new URL(safeReturn, resolveOrigin(req));
    url.searchParams.set("updated", "1");
    url.searchParams.delete("error");
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    console.error("POST /api/products/:id failed:", err);
    const returnTo = s(form.get("return_to"));
    const safeReturn = returnTo && returnTo.startsWith("/") ? returnTo : "/inventory/low-stock";
    const url = new URL(safeReturn, resolveOrigin(req));
    url.searchParams.set("error", "1");
    url.searchParams.delete("updated");
    return NextResponse.redirect(url, { status: 303 });
  }
}
