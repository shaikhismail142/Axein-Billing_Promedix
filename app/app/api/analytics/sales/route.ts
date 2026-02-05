import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";

const VERSION = "r8c"; // conditional-join + from-clause-safe

function defaultWindow() {
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setDate(from.getDate() - 13);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const qFrom = searchParams.get("from");
  const qTo = searchParams.get("to");
  const debugFlag = searchParams.get("debug") === "1";
  const win = (!qFrom || !qTo) ? defaultWindow() : { from: qFrom!, to: qTo! };

  const debug: any = {
    echo: { from: qFrom, to: qTo, debug: debugFlag },
    window: win,
    version: VERSION,
  };

  const client = await pool.connect();
  try {
    // 1) Table presence
    const tables = await client.query(`
      SELECT
        to_regclass('public.sales')         IS NOT NULL AS has_sales,
        to_regclass('public.sale_items')    IS NOT NULL AS has_sale_items,
        to_regclass('public.sale_payments') IS NOT NULL AS has_sale_payments,
        to_regclass('public.products')      IS NOT NULL AS has_products
    `);
    const t = tables.rows[0] || {};
    debug.tables = t;

    if (!t?.has_sales) {
      const res = NextResponse.json({
        version: VERSION,
        daily: [], breakdown: [], today: { sales_total: 0, gross_profit: 0 },
        ...(debugFlag ? { debug } : {}),
      });
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    // 2) Which total column can we use on sales (fallback path)?
    const salesTotalColProbe = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='sales'
          AND column_name IN ('total_amount','grand_total','total','amount')
        ORDER BY 1`
    );
    const salesTotalCol = salesTotalColProbe.rows[0]?.column_name ?? null;

    // 3) Find a usable date column on sales, build sdate expr
    const salesColsProbe = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='sales'`
    );
    const salesCols: string[] = salesColsProbe.rows.map((r: any) => r.column_name);
    const dateCandidates = ["invoice_date", "date", "bill_date", "sale_date", "sales_date", "created_at"];
    const presentDates = dateCandidates.filter(c => salesCols.includes(c));
    const sdateExpr = presentDates.length
      ? `COALESCE(${presentDates.map(c => `s.${c}::date`).join(", ")})`
      : "s.created_at::date";

    debug.salesTotalCol = salesTotalCol;
    debug.salesDateExpr = sdateExpr;
    debug.salesDateCandidates = presentDates;

    // 4) sale_items columns & join keys
    let itemsJoinKey: string | null = null;
    let itemsCount = 0;
    let itemCols: string[] = [];
    if (t.has_sale_items) {
      const colProbe = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sale_items'`
      );
      itemCols = colProbe.rows.map((r: any) => r.column_name);

      const hasSaleId = itemCols.includes("sale_id");
      const hasInvoiceId = itemCols.includes("invoice_id");
      itemsJoinKey = hasSaleId ? "sale_id" : (hasInvoiceId ? "invoice_id" : null);

      const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM sale_items`);
      itemsCount = Number(cnt.rows[0]?.n || 0);
    }
    const has = (c: string) => itemCols.includes(c);
    const hasProductId = has("product_id");

    // Expressions that exist on the current schema
    const itemMoneyExpr = t.has_sale_items
      ? has("total")       ? "si.total"
      : has("line_total")  ? "si.line_total"
      : (has("price") && has("qty")) ? "(si.price * NULLIF(si.qty,0))"
      : "0"
      : "0";

    const itemQtyExpr = t.has_sale_items
      ? has("qty")         ? "si.qty"
      : has("total_qty")   ? "si.total_qty"
      : has("quantity")    ? "si.quantity"
      : has("units")       ? "si.units"
      : "0"
      : "0";

    // If sale_items.product_id is missing, don't reference p.*
    const itemNameExpr = t.has_sale_items
      ? has("name")          ? "si.name"
      : has("product_name")  ? "si.product_name"
      : (hasProductId ? "COALESCE(p.name, 'Unknown')" : "'Unknown'")
      : "'Unknown'";

    const itemGpExpr = t.has_sale_items && has("gross_profit") ? "si.gross_profit" : "0";

    // products join is conditional
    const productsJoin  = hasProductId ? "LEFT JOIN products p ON p.id = si.product_id" : "";
    const productsJoin2 = productsJoin;
    const productsJoin3 = productsJoin;

    debug.items = { itemsJoinKey, itemsCount, itemCols, hasProductId };
    debug.itemExpr = { money: itemMoneyExpr, qty: itemQtyExpr, name: itemNameExpr, gp: itemGpExpr };

    // 5) payments fallback
    let paymentsJoinKey: string | null = null;
    let paymentsCount = 0;
    if (t.has_sale_payments) {
      const pCols = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sale_payments'`
      );
      const names = pCols.rows.map((r: any) => r.column_name);
      paymentsJoinKey = names.includes("sale_id") ? "sale_id" : null;
      const pcnt = await client.query(`SELECT COUNT(*)::int AS n FROM sale_payments`);
      paymentsCount = Number(pcnt.rows[0]?.n || 0);
    }
    debug.payments = { paymentsJoinKey, paymentsCount };

    // 6) Strategy
    const useItems = itemsCount > 0 && !!itemsJoinKey;
    const useSalesTotals = !useItems && !!salesTotalCol;
    const usePayments = !useItems && !useSalesTotals && paymentsCount > 0 && !!paymentsJoinKey;
    debug.strategy = { useItems, useSalesTotals, usePayments };

    // 7) DAILY
    const dailySql = useItems
      ? `
        WITH bounds AS (SELECT $1::date AS dfrom, $2::date AS dto),
        days AS (SELECT generate_series(dfrom, dto, interval '1 day')::date AS day FROM bounds),
        joined AS (
          SELECT
            (${sdateExpr})::date AS sdate,
            (${itemMoneyExpr})::numeric AS line_total
          FROM sales s
          JOIN sale_items si ON si.${itemsJoinKey} = s.id
          ${productsJoin}
          WHERE (${sdateExpr}) BETWEEN (SELECT dfrom FROM bounds) AND (SELECT dto FROM bounds)
        )
        SELECT to_char(d.day,'YYYY-MM-DD') AS day, COALESCE(SUM(j.line_total),0) AS total
        FROM days d LEFT JOIN joined j ON j.sdate = d.day
        GROUP BY d.day ORDER BY d.day;
      `
      : useSalesTotals
      ? `
        WITH bounds AS (SELECT $1::date AS dfrom, $2::date AS dto),
        days AS (SELECT generate_series(dfrom, dto, interval '1 day')::date AS day FROM bounds)
        SELECT to_char(d.day,'YYYY-MM-DD') AS day,
               COALESCE(SUM(s.${salesTotalCol}),0)::numeric AS total
        FROM days d
        LEFT JOIN sales s ON (${sdateExpr}) = d.day
         AND d.day BETWEEN (SELECT dfrom FROM bounds) AND (SELECT dto FROM bounds)
        GROUP BY d.day ORDER BY d.day;
      `
      : usePayments
      ? `
        WITH bounds AS (SELECT $1::date AS dfrom, $2::date AS dto),
        days AS (SELECT generate_series(dfrom, dto, interval '1 day')::date AS day FROM bounds),
        joined AS (
          SELECT
            (${sdateExpr})::date AS sdate,
            COALESCE(sp.amount, sp.total, 0)::numeric AS paid
          FROM sales s
          JOIN sale_payments sp ON sp.${paymentsJoinKey} = s.id
          WHERE (${sdateExpr}) BETWEEN (SELECT dfrom FROM bounds) AND (SELECT dto FROM bounds)
        )
        SELECT to_char(d.day,'YYYY-MM-DD') AS day, COALESCE(SUM(j.paid),0) AS total
        FROM days d LEFT JOIN joined j ON j.sdate = d.day
        GROUP BY d.day ORDER BY d.day;
      `
      : `SELECT to_char($1::date,'YYYY-MM-DD') AS day, 0::numeric AS total`;

    // 8) BREAKDOWN (items only)
    const breakdownSql = useItems
      ? `
        WITH joined AS (
          SELECT
            (${sdateExpr}) AS sdate,
            ${itemNameExpr} AS name,
            (${itemQtyExpr})::numeric AS qty,
            (${itemMoneyExpr})::numeric AS line_total
          FROM sales s
          JOIN sale_items si ON si.${itemsJoinKey} = s.id
          ${productsJoin2}
          WHERE (${sdateExpr}) BETWEEN $1::date AND $2::date
        )
        SELECT name, COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(line_total),0) AS total
        FROM joined
        GROUP BY name
        ORDER BY total DESC
        LIMIT 100;
      `
      : null;

    // 9) TODAY KPI
    const todaySql = useItems
      ? `
        WITH rows AS (
          SELECT
            (${itemMoneyExpr})::numeric AS line_total,
            (${itemGpExpr})::numeric AS gp
          FROM sales s
          JOIN sale_items si ON si.${itemsJoinKey} = s.id
          WHERE (${sdateExpr}) = $1::date
        )
        SELECT COALESCE(SUM(line_total),0) AS sales_total, COALESCE(SUM(gp),0) AS gross_profit FROM rows;
      `
      : useSalesTotals
      ? `
        SELECT COALESCE(SUM(${salesTotalCol}),0)::numeric AS sales_total, 0::numeric AS gross_profit
        FROM sales s
        WHERE (${sdateExpr}) = $1::date;
      `
      : usePayments
      ? `
        SELECT COALESCE(SUM(COALESCE(sp.amount, sp.total, 0)),0)::numeric AS sales_total, 0::numeric AS gross_profit
        FROM sales s
        JOIN sale_payments sp ON sp.${paymentsJoinKey} = s.id
        WHERE (${sdateExpr}) = $1::date;
      `
      : `SELECT 0::numeric AS sales_total, 0::numeric AS gross_profit`;

    // Execute
    const [dailyRes, breakdownRes, todayRes] = await Promise.all([
      client.query(dailySql, [win.from, win.to]),
      breakdownSql ? client.query(breakdownSql, [win.from, win.to]) : Promise.resolve({ rows: [] }),
      client.query(todaySql, [win.to]),
    ]);

    // 10) Extra debug sample (only when requested)
    if (debugFlag && useItems) {
      const sampleDaily = await client.query(
        `
        SELECT
          (${sdateExpr}) AS sdate,
          (${itemMoneyExpr})::numeric AS line_total
        FROM sales s
        JOIN sale_items si ON si.${itemsJoinKey} = s.id
        ${productsJoin3}
        WHERE (${sdateExpr}) BETWEEN $1::date AND $2::date
        ORDER BY 1 DESC
        LIMIT 5
        `,
        [win.from, win.to],
      );
      debug.dailySample = sampleDaily.rows;
    }

    const payload: any = {
      version: VERSION,
      daily: dailyRes.rows,
      breakdown: breakdownRes.rows,
      today: todayRes.rows[0] ?? { sales_total: 0, gross_profit: 0 },
      ...(debugFlag ? { debug } : {}),
    };

    const res = NextResponse.json(payload);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    console.error("analytics/sales error", e);
    debug.error = String(e);
    const res = NextResponse.json(
      {
        version: VERSION,
        daily: [],
        breakdown: [],
        today: { sales_total: 0, gross_profit: 0 },
        ...(debugFlag ? { debug } : {}),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    return res;
  } finally {
    client.release();
  }
}
