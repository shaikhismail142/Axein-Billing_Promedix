// app/api/products/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";

/* =========================
   GET /api/products
   ?page=&perPage=&q=
   Returns: { items, total, page, perPage, totalPages }
   NOTE: derives price/stock/low/sku from meta only (no hard deps on flat cols)
========================= */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(200, Math.max(1, Number(url.searchParams.get("perPage") || 20)));
  const q = (url.searchParams.get("q") || "").trim();
  const sort = (url.searchParams.get("sort") || "id").toString();
  const dir = (url.searchParams.get("dir") || "asc").toString().toLowerCase() === "desc" ? "desc" : "asc";
  const category = (url.searchParams.get("category") || "").trim();
  const lowOnly = (url.searchParams.get("low") || "").trim() === "1";

  // Check if updated_at exists (best-effort)
  let hasUpdatedAt = false;
  try {
    const u = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products' AND column_name='updated_at'`
    );
    hasUpdatedAt = (u.rowCount ?? u.rows?.length ?? 0) > 0;
  } catch {
    hasUpdatedAt = false;
  }

  // Build WHERE (name or meta->>'sku')
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(
      p.name ILIKE $${i}
      OR (p.meta->>'sku') ILIKE $${i}
      OR COALESCE(NULLIF(p.category,''), NULLIF(p.meta->>'category','')) ILIKE $${i}
      OR COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') ILIKE $${i}
    )`);
  }
  if (category) {
    params.push(category);
    const i = params.length;
    where.push(`COALESCE(NULLIF(p.category,''), NULLIF(p.meta->>'category','')) = $${i}`);
  }
  if (lowOnly) {
    where.push(
      `COALESCE(NULLIF(p.meta->>'stock_qty','')::int, NULLIF(p.meta->>'stock','')::int, 0)
       <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Count
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM products p ${whereSql}`,
    params
  );
  const total = cnt[0]?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;

  // Page
  const pageParams = [...params, perPage, offset];
  // Optional: read batch table metadata (for expiry sort)
  let batchTable = "";
  let batchCols = new Set<string>();
  if (sort === "expiry") {
    try {
      const tRes = await pool.query(`
        SELECT COALESCE(
          (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
          (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL),
          ''
        ) AS t
      `);
      batchTable = (tRes.rows?.[0] as any)?.t || "";
      if (batchTable) {
        const colsRes = await pool.query(
          `SELECT LOWER(column_name) AS col
           FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1`,
          [batchTable]
        );
        batchCols = new Set<string>(colsRes.rows.map((r: any) => r.col));
      }
    } catch {
      batchTable = "";
    }
  }

  const categoryExpr = `COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,''))`;
  const priceExpr = `COALESCE(NULLIF(p.meta->>'selling_price','')::numeric,
                               NULLIF(p.meta->>'price','')::numeric, 0)`;
  const stockExpr = `COALESCE(NULLIF(p.meta->>'stock_qty','')::int,
                               NULLIF(p.meta->>'stock','')::int, 0)`;
  const skuExpr = `COALESCE(p.meta->>'sku','')`;
  const metaExpExpr = `COALESCE(NULLIF(p.meta->>'exp_date',''), NULLIF(p.meta->>'expiry_date',''))`;
  const updatedExpr = hasUpdatedAt ? `COALESCE(p.updated_at, p.created_at)` : `p.created_at`;

  let orderBy = `p.id ${dir}`;
  let joinSql = "";
  let selectExtras = "";
  if (sort === "name") orderBy = `p.name ${dir}`;
  if (sort === "sku") orderBy = `${skuExpr} ${dir} NULLS LAST`;
  if (sort === "price") orderBy = `${priceExpr} ${dir}`;
  if (sort === "stock") orderBy = `${stockExpr} ${dir}`;
  if (sort === "category") orderBy = `${categoryExpr} ${dir} NULLS LAST`;
  if (sort === "least_bought") {
    joinSql = `
      LEFT JOIN (
        SELECT product_id, COALESCE(SUM(qty),0) AS qty_sold
        FROM sale_items
        WHERE product_id IS NOT NULL
        GROUP BY product_id
      ) sa ON sa.product_id = p.id
    `;
    selectExtras = ", COALESCE(sa.qty_sold,0) AS qty_sold";
    orderBy = `COALESCE(sa.qty_sold,0) ${dir}, p.name ASC`;
  }

  let rows: any[] = [];
  if (sort === "expiry" && batchTable && batchCols.size) {
    const pick = (...candidates: string[]) => candidates.find((c) => batchCols.has(c));
    const productIdCol = pick("product_id") || "product_id";
    const batchNoCol = pick("batch_no", "batch", "batch_code", "batchcode");
    const expCol = pick("exp_date", "expiry_date", "expiration_date", "exp_dt", "expiry_on", "expire_on");

    if (expCol) {
      const select = `
        SELECT
          p.id,
          p.name,
          ${categoryExpr} AS category,
          COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code') AS hsn_code,
          ${priceExpr} AS price,
          ${stockExpr} AS stock_qty,
          COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0) AS low_stock_threshold,
          ${skuExpr} AS sku,
          ${metaExpExpr} AS meta_exp_date,
          ${updatedExpr} AS updated_at,
          bmin.batch_no,
          bmin.exp_date
        FROM products p
        LEFT JOIN LATERAL (
          SELECT
            ${batchNoCol ? `b.${batchNoCol}::text` : "NULL::text"} AS batch_no,
            b.${expCol}::date AS exp_date
          FROM ${batchTable} b
          WHERE b.${productIdCol} = p.id
          ORDER BY b.${expCol} ${dir} NULLS LAST
          LIMIT 1
        ) bmin ON true
        ${whereSql}
        ORDER BY bmin.exp_date ${dir} NULLS LAST, p.name ASC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
      `;
      const r = await pool.query(select, pageParams);
      rows = r.rows;
    }
  }

  if (!rows.length) {
    const { rows: r } = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        ${categoryExpr}                                   AS category,
        COALESCE(p.hsn_code, p.hsn, p.meta->>'hsn_code')  AS hsn_code,
        ${priceExpr}                                      AS price,
        ${stockExpr}                                      AS stock_qty,
        COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0) AS low_stock_threshold,
        ${skuExpr}                                        AS sku,
        ${metaExpExpr}                                    AS meta_exp_date,
        ${updatedExpr}                                    AS updated_at
        ${selectExtras}
      FROM products p
      ${joinSql}
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
      `,
      pageParams
    );
    rows = r;
  }

  // Optional: attach nearest batch/expiry per product (if batches table exists)
  let batchByProduct = new Map<number, { batch_no?: string | null; exp_date?: string | null }>();
  if (rows.length > 0 && !rows[0]?.exp_date) {
    try {
      const client = await pool.connect();
      try {
        const tRes = await client.query(`
          SELECT COALESCE(
            (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
            (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL),
            ''
          ) AS t
        `);
        const table = (tRes.rows?.[0] as any)?.t || "";
        if (table) {
          const colsRes = await client.query(
            `SELECT LOWER(column_name) AS col
             FROM information_schema.columns
             WHERE table_schema='public' AND table_name=$1`,
            [table]
          );
          const cols = new Set<string>(colsRes.rows.map((r: any) => r.col));
          const pick = (...candidates: string[]) => candidates.find((c) => cols.has(c));

          const idCol = pick("id") || "id";
          const productIdCol = pick("product_id") || "product_id";
          const batchNoCol = pick("batch_no", "batch", "batch_code", "batchcode");
          const expCol = pick("exp_date", "expiry_date", "expiration_date", "exp_dt", "expiry_on", "expire_on");

          const ids = rows.map((r: any) => Number(r.id)).filter((n) => Number.isFinite(n));
          if (ids.length) {
            const sel = [
              `b.${productIdCol} AS product_id`,
              batchNoCol ? `b.${batchNoCol}::text AS batch_no` : `NULL::text AS batch_no`,
              expCol ? `to_char(b.${expCol}, 'YYYY-MM-DD') AS exp_date` : `NULL::text AS exp_date`,
            ].join(", ");
            const orderBy = expCol
              ? `b.${productIdCol}, b.${expCol} NULLS LAST, b.${idCol} DESC`
              : `b.${productIdCol}, b.${idCol} DESC`;

            const bRes = await client.query(
              `
              SELECT DISTINCT ON (b.${productIdCol})
                ${sel}
              FROM ${table} b
              WHERE b.${productIdCol} = ANY($1::int[])
              ORDER BY ${orderBy}
              `,
              [ids]
            );

            batchByProduct = new Map(
              (bRes.rows || []).map((r: any) => [
                Number(r.product_id),
                { batch_no: r.batch_no ?? null, exp_date: r.exp_date ?? null },
              ])
            );
          }
        }
      } finally {
        client.release();
      }
    } catch {
      // ignore batch lookup failures to keep /api/products resilient
    }
  }

  const items = rows.map((r: any) => {
    const b = batchByProduct.get(Number(r.id));
    return {
      ...r,
      batch_no: b?.batch_no ?? null,
      exp_date: b?.exp_date ?? r.meta_exp_date ?? null,
    };
  });

  return NextResponse.json({
    items,
    total,
    page,
    perPage,
    totalPages,
  });
}

/* =========================
   POST /api/products  (JSON)
   Body fields are stored in meta; name is required.
   Returns: { ok, item }
========================= */
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({} as any));

    const name = String(payload.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }

    const category = payload.category != null ? String(payload.category).trim() : null;
    const meta = {
      selling_price: Number(payload.selling_price ?? payload.price ?? 0) || 0,
      gst_slab: Number(payload.gst_slab ?? 0) || 0,
      stock_qty: Number(payload.stock_qty ?? payload.stock ?? 0) || 0,
      low_stock_threshold: Number(payload.low_stock_threshold ?? 0) || 0,
      sku: payload.sku != null ? String(payload.sku) : null,
      brand: payload.brand != null ? String(payload.brand) : null,
      hsn_code: payload.hsn_code != null ? String(payload.hsn_code) : null,
      category: category || null,
      exp_date: payload.exp_date != null && String(payload.exp_date).trim() !== "" ? String(payload.exp_date).trim() : null,
      unit: payload.unit != null ? String(payload.unit) : null,
      notes: payload.notes != null ? String(payload.notes) : null,
    };

    // Try to insert category into column if it exists (best-effort)
    let rows: any[] = [];
    try {
      const r = await pool.query(
        `INSERT INTO products (name, category, meta)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id, name, meta`,
        [name, category || null, JSON.stringify(meta)]
      );
      rows = r.rows;
    } catch {
      const r = await pool.query(
        `INSERT INTO products (name, meta)
         VALUES ($1, $2::jsonb)
         RETURNING id, name, meta`,
        [name, JSON.stringify(meta)]
      );
      rows = r.rows;
    }

    return NextResponse.json({ ok: true, item: rows[0] }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Create failed" }, { status: 500 });
  }
}
