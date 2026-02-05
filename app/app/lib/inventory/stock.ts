// app/lib/inventory/stock.ts
import { pool } from "@/app/lib/db";

/**
 * Reads current inventory settings.
 * If missing, falls back to sane defaults.
 */
export async function getInventorySettings(client?: any): Promise<{
  allow_negative_stock: boolean;
  low_stock_threshold_default: number;
  reorder_multiplier: number;
  alert_channels: string[];
}> {
  const q = `SELECT value_json FROM settings WHERE key = 'inventory' LIMIT 1`;
  const exec = client ?? pool;
  const rs = await exec.query(q);
  const j = rs.rows?.[0]?.value_json ?? {};
  return {
    allow_negative_stock: !!j.allow_negative_stock,
    low_stock_threshold_default: Number(j.low_stock_threshold_default ?? 5),
    reorder_multiplier: Number(j.reorder_multiplier ?? 1.5),
    alert_channels: Array.isArray(j.alert_channels) ? j.alert_channels : ["dashboard"],
  };
}

/**
 * Lock product row and read meta.stock_qty.
 */
async function lockAndReadProductById(client: any, id: number) {
  const rs = await client.query(
    `SELECT id, name, meta FROM products WHERE id = $1 FOR UPDATE`,
    [id]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as { id: number; name: string; meta: any };
  const meta = row.meta || {};
  const current = Number(meta.stock_qty ?? meta.stock ?? 0) || 0;
  return { id: row.id, name: row.name, meta, current };
}

/**
 * Adjust stock atomically and record a stock_movements entry.
 * - Positive delta: stock in
 * - Negative delta: stock out
 */
export async function adjustStock(opts: {
  client?: any;
  productId: number;
  delta: number;
  reason:
    | "sale" | "return" | "purchase" | "adjustment"
    | "damage" | "loss" | "promo" | "correction";
  refType?: string;
  refId?: number | string | null;
  allowNegativeOverride?: boolean;
  meta?: Record<string, any>;
}) {
  const {
    client: extClient,
    productId,
    delta,
    reason,
    refType,
    refId,
    allowNegativeOverride,
    meta = {},
  } = opts;

  const client = extClient ?? (await pool.connect());
  const createdTx = !extClient;

  try {
    if (createdTx) await client.query("BEGIN");

    const settings = await getInventorySettings(client);
    const allowNegative = allowNegativeOverride ?? settings.allow_negative_stock;

    const locked = await lockAndReadProductById(client, Number(productId));
    if (!locked) throw new Error("Product not found");

    const before = Number(locked.current);
    let after = before + Number(delta);
    if (!allowNegative) after = Math.max(0, after);
    const nextMeta = { ...locked.meta, stock_qty: after };

    await client.query(`UPDATE products SET meta = $2::jsonb WHERE id = $1`, [
      locked.id,
      JSON.stringify(nextMeta),
    ]);

    await client.query(
      `INSERT INTO stock_movements
       (product_id, delta_qty, reason, ref_type, ref_id, before_qty, after_qty, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        locked.id,
        Number(delta),
        String(reason),
        refType ?? null,
        refId ?? null,
        before,
        after,
        JSON.stringify(meta),
      ]
    );

    if (createdTx) await client.query("COMMIT");
    return { ok: true, product_id: locked.id, before, after };
  } catch (e: any) {
    if (createdTx) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    return { ok: false, error: e?.message || "adjustStock failed" };
  } finally {
    if (!extClient) client.release();
  }
}
