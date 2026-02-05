export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

/** Minimal CSV parser: supports quoted fields, commas, and newlines in quotes. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0, q = false; // q = in quotes

  while (i < text.length) {
    const ch = text[i];

    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          q = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        q = true; i++; continue;
      }
      if (ch === ",") {
        row.push(field.trim()); field = ""; i++; continue;
      }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") {
        row.push(field.trim()); field = ""; rows.push(row); row = []; i++; continue;
      }
      field += ch; i++; continue;
    }
  }
  row.push(field.trim());
  rows.push(row);
  // trim trailing empty rows
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ""));
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function str(v: any) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

type MetaPatch = {
  selling_price?: number;
  gst_slab?: number;
  stock_qty?: number;
  cost_price?: number;
  low_stock_threshold?: number;
  sku?: string;
  brand?: string;
  hsn_code?: string;
  category?: string;
  unit?: string;
  notes?: string;
  exp_date?: string;
};

async function fetchByName(name: string) {
  const rs = await pool.query(
    `SELECT id, name, meta FROM products WHERE LOWER(name)=LOWER($1) LIMIT 1`,
    [name]
  );
  return rs.rows[0] as { id: number; name: string; meta: any } | undefined;
}

async function insertProduct(name: string, meta: Record<string, any>) {
  const category = meta.category ?? null;
  try {
    await pool.query(
      `INSERT INTO products (name, category, meta) VALUES ($1, $2, $3::jsonb)`,
      [name, category, JSON.stringify(meta)]
    );
  } catch {
    await pool.query(
      `INSERT INTO products (name, meta) VALUES ($1, $2::jsonb)`,
      [name, JSON.stringify(meta)]
    );
  }
}

async function updateProductMeta(id: number, patch: Record<string, any>) {
  const rs = await pool.query(`SELECT meta FROM products WHERE id=$1`, [id]);
  if (rs.rowCount === 0) return;
  const merged = { ...(rs.rows[0].meta || {}), ...patch };
  try {
    await pool.query(`UPDATE products SET meta=$2::jsonb, updated_at=now() WHERE id=$1`, [id, JSON.stringify(merged)]);
  } catch {
    await pool.query(`UPDATE products SET meta=$2::jsonb WHERE id=$1`, [id, JSON.stringify(merged)]);
  }
  if (patch.category !== undefined) {
    try {
      await pool.query(`UPDATE products SET category=$2 WHERE id=$1`, [id, patch.category]);
    } catch {}
  }
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Upload a CSV file (multipart/form-data)" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "File not found in form data" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const text = buf.toString("utf8");

    const rows = parseCSV(text);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Empty CSV" }, { status: 400 });
    }

    // Build header map (case-insensitive)
    const header = rows[0].map((h) => h.toLowerCase());
    const idx = (key: string) => header.findIndex((h) => h === key);

    const iName = idx("name");
    if (iName === -1) {
      return NextResponse.json({ error: "Missing required column: name" }, { status: 400 });
    }

    // Optional columns
    const iPrice = idx("price");
    const iGst = idx("gst_slab");
    const iStock = idx("stock_qty");
    const iCost = idx("cost_price");
    const iLow = idx("low_stock_threshold");
    const iSku = idx("sku");
    const iBrand = idx("brand");
    const iHsn = idx("hsn_code");
    const iCategory = idx("category");
    const iUnit = idx("unit");
    const iNotes = idx("notes");
    const iExp = idx("exp_date") !== -1 ? idx("exp_date") : idx("expiry_date");

    let created = 0, updated = 0, skipped = 0;

    // Process data rows
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = str(row[iName]);
      if (!name) { skipped++; continue; }

      const patch: MetaPatch = {};
      const price = num(row[iPrice]);
      if (price !== undefined) patch.selling_price = price;

      const gst = num(row[iGst]);
      if (gst !== undefined) patch.gst_slab = gst;

      const stock = num(row[iStock]);
      if (stock !== undefined) patch.stock_qty = stock;

      const cost = num(row[iCost]);
      if (cost !== undefined) patch.cost_price = cost;

      const low = num(row[iLow]);
      if (low !== undefined) patch.low_stock_threshold = low;

      const sku = str(row[iSku]); if (sku !== undefined) patch.sku = sku;
      const brand = str(row[iBrand]); if (brand !== undefined) patch.brand = brand;
      const hsn = str(row[iHsn]); if (hsn !== undefined) patch.hsn_code = hsn;
      const category = str(row[iCategory]); if (category !== undefined) patch.category = category;
      const unit = str(row[iUnit]); if (unit !== undefined) patch.unit = unit;
      const notes = str(row[iNotes]); if (notes !== undefined) patch.notes = notes;
      const exp = str(row[iExp]); if (exp !== undefined) patch.exp_date = exp;

      const existing = await fetchByName(name);
      if (existing) {
        await updateProductMeta(existing.id, patch);
        updated++;
      } else {
        const meta: Record<string, any> = { ...patch };
        await insertProduct(name, meta);
        created++;
      }
    }

    return NextResponse.json({ ok: true, created, updated, skipped });
  } catch (e: any) {
    console.error("POST /api/products/import failed:", e);
    return NextResponse.json({ error: e?.message || "Import failed" }, { status: 500 });
  }
}
