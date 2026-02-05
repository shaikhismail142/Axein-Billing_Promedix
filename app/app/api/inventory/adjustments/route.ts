// app/api/inventory/adjustments/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";

/** ------------ Types for payload ------------ */
type ReasonLiteral =
  | "adjustment" | "sale" | "return" | "purchase"
  | "damage" | "loss" | "promo" | "correction";

type NewItem = {
  product_id: number | string;
  delta_qty: number | string;
  unit_cost?: number | string | null;
  notes?: string | null;
};

type NewAdjustmentBody = {
  reason?: ReasonLiteral | string;
  reference?: string | null;
  notes?: string | null;
  items: NewItem[];
};

/** ------------ Helpers ------------ */
function nstr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseDateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ============================================
 *  GET /api/inventory/adjustments
 *  Query: ?page=&perPage=&q=&status=&from=&to=
 *  Returns: { items, total, page, perPage, totalPages }
 *  NOTE: derives `lines` using COUNT(*) on items (no JSON ops)
 * ============================================ */
export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(200, Math.max(1, Number(url.searchParams.get("perPage") || 20)));
  const q = (url.searchParams.get("q") || "").trim();
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  const from = parseDateOrNull(fromRaw ? new Date(fromRaw).toISOString() : null);
  const to = parseDateOrNull(toRaw ? new Date(toRaw).toISOString() : null);

  // Build WHERE
  const where: string[] = [];
  const params: any[] = [];

  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(ia.reason ILIKE $${i} OR ia.reference ILIKE $${i} OR ia.notes ILIKE $${i})`);
  }

  if (status && ["draft", "posted", "reversed"].includes(status)) {
    params.push(status);
    where.push(`ia.status = $${params.length}`);
  }

  if (from) {
    params.push(from.toISOString());
    where.push(`ia.adjustment_date >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`ia.adjustment_date <= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Count
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS cnt
       FROM inventory_adjustments ia
       ${whereSql}`,
    params
  );
  const total = cnt[0]?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;

  // Page data — JSON-free line count
  const pageParams = [...params, perPage, offset];
  const list = await pool.query(
    `
    SELECT
      ia.id,
      ia.adjustment_date,
      ia.status,
      ia.reason,
      ia.reference,
      ia.notes,
      ia.created_at,
      ia.posted_at,
      (
        SELECT COUNT(*)::int
        FROM inventory_adjustment_items i
        WHERE i.adjustment_id = ia.id
      ) AS lines
    FROM inventory_adjustments ia
    ${whereSql}
    ORDER BY ia.adjustment_date DESC, ia.id DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
    `,
    pageParams
  );

  return NextResponse.json({
    items: list.rows,
    total,
    page,
    perPage,
    totalPages,
  });
}

/** ============================================
 *  POST /api/inventory/adjustments
 *  Body: { reason?, reference?, notes?, items: [{product_id, delta_qty, unit_cost?, notes?}, ...] }
 *  Creates a DRAFT header + lines (no stock change yet).
 *  Returns: { ok, id }
 * ============================================ */
export async function POST(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  let body: NewAdjustmentBody;
  try {
    body = (await req.json()) as NewAdjustmentBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "At least one item is required" }, { status: 400 });
  }

  // Normalize reason -> one of our literals; fallback 'adjustment'
  const allowed: ReasonLiteral[] = [
    "adjustment","sale","return","purchase","damage","loss","promo","correction"
  ];
  const rawReason = String(body.reason ?? "adjustment").toLowerCase();
  const reason: ReasonLiteral = (allowed as string[]).includes(rawReason)
    ? (rawReason as ReasonLiteral)
    : "adjustment";

  const reference = nstr(body.reference);
  const notes = nstr(body.notes);

  // Validate/normalize lines
  type Line = { product_id: number; delta_qty: number; unit_cost: number | null; notes: string | null; };
  const lines: Line[] = [];

  for (const it of items) {
    const product_id = Number((it as any).product_id);
    const delta_qty = Number((it as any).delta_qty);
    const unit_costRaw = (it as any).unit_cost;
    const unit_cost = unit_costRaw == null || unit_costRaw === "" ? null : Number(unit_costRaw);
    const lnNotes = nstr((it as any).notes);

    if (!Number.isFinite(product_id) || product_id <= 0) {
      return NextResponse.json({ ok: false, error: "Each item needs a valid product_id" }, { status: 400 });
    }
    if (!Number.isFinite(delta_qty) || delta_qty === 0) {
      return NextResponse.json({ ok: false, error: "Each item needs a non-zero delta_qty" }, { status: 400 });
    }
    if (unit_cost != null && !Number.isFinite(unit_cost)) {
      return NextResponse.json({ ok: false, error: "unit_cost must be a number" }, { status: 400 });
    }

    lines.push({ product_id, delta_qty, unit_cost, notes: lnNotes });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert header (explicit casts prevent Postgres type inference errors)
    const headIns = await client.query(
      `INSERT INTO inventory_adjustments
         (adjustment_date, status, reason, reference, notes, meta)
       VALUES (now(), 'draft', $1::text, $2::text, $3::text, '{}'::jsonb)
       RETURNING id`,
      [reason, reference, notes]
    );
    const id = Number(headIns.rows[0].id);

    // Insert lines (cast numeric/text so NULLs are well-typed)
    const values: any[] = [];
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const base = i * 5;
      //                  $1               $2                 $3        $4         $5
      chunks.push(`($${base + 1}, $${base + 2}, $${base + 3}::numeric, $${base + 4}::numeric, $${base + 5}::text, '{}'::jsonb)`);
      values.push(
        id,                 // adjustment_id
        ln.product_id,      // product_id
        ln.delta_qty,       // delta_qty (numeric)
        ln.unit_cost,       // unit_cost (numeric or null)
        ln.notes            // notes (text or null)
      );
    }
    await client.query(
      `INSERT INTO inventory_adjustment_items
         (adjustment_id, product_id, delta_qty, unit_cost, notes, meta)
       VALUES ${chunks.join(", ")}`,
      values
    );

    // Optional: summary in meta (safe; list does not depend on it)
    await client.query(
      `UPDATE inventory_adjustments
          SET meta = jsonb_set(
            COALESCE(meta,'{}'::jsonb),
            '{items_summary}',
            jsonb_build_object('lines', $2::int, 'net_delta', $3::numeric)::jsonb,
            true
          )
        WHERE id = $1`,
      [
        id,
        lines.length,
        lines.reduce((a, b) => a + Number(b.delta_qty || 0), 0)
      ]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Create failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
