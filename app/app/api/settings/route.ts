// app/api/settings/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * GET
 * - Backward compatible: no query => returns the raw business settings object (existing behavior)
 * - New: `?key=inventory` (or any key) => returns that key's value_json object (or `{}` if missing)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = (url.searchParams.get("key") || "business").trim();

  const rs = await pool.query(
    `SELECT value_json FROM settings WHERE key=$1 LIMIT 1`,
    [key]
  );
  const obj = rs.rows?.[0]?.value_json ?? {};
  return NextResponse.json(obj);
}

/**
 * PATCH (new): upsert arbitrary { key, value_json }
 * - Keeps legacy text `value` column in sync when key==='business' (best-effort)
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const key = (body?.key || "").trim();
    const value_json = isPlainObject(body?.value_json) ? body.value_json : {};
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

    await pool.query(
      `INSERT INTO settings(key, value_json)
       VALUES($1, $2)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [key, value_json]
    );

    // Keep legacy text `value` in sync for business (best-effort)
    if (key === 'business') {
      const col = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='settings' AND column_name='value'
         ) AS has_value`
      );
      const hasValue = !!col.rows?.[0]?.has_value;
      if (hasValue) {
        await pool.query(`UPDATE settings SET value = $1 WHERE key='business'`, [JSON.stringify(value_json)]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/settings failed:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}

/**
 * PUT (existing): upsert the BUSINESS settings JSON only (backward compatibility)
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const data = isPlainObject(body) ? body : {};

    await pool.query(
      `INSERT INTO settings(key, value_json)
       VALUES('business', $1)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [data]
    );

    // legacy text column sync (best-effort)
    const col = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='settings'
           AND column_name='value'
       ) AS has_value`
    );
    const hasValue = !!col.rows?.[0]?.has_value;
    if (hasValue) {
      await pool.query(
        `UPDATE settings SET value = $1 WHERE key='business'`,
        [JSON.stringify(data)]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/settings failed:", err);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
