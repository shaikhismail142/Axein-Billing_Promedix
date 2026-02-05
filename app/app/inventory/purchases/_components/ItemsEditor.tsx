"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** ---------- Types ---------- */
type Item = {
  product_id?: string;
  name?: string;
  qty?: number;
  cost_price?: number;
  mrp?: number | null;
  tax_rate?: number;
  discount?: number;
  batch_no?: string | null;
  // carry-through fields for server
  mfg_date?: string | null;
  exp_date?: string | null;
  price?: number; // tolerated on input; normalized to cost_price
  meta?: any;
};

/** ---------- Utils ---------- */
const asNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const normQty = (v: any) => clamp(asNum(v, 0), 0, 1e12);
const normMoney = (v: any) => clamp(asNum(v, 0), -1e12, 1e12);
const normTax = (v: any) => clamp(asNum(v, 0), 0, 999.99);

const emptyRow = (): Item => ({
  product_id: "",
  name: "",
  qty: 0,
  cost_price: 0,
  mrp: null,
  tax_rate: 0,
  discount: 0,
  batch_no: "",
});

/** Lightweight CSV parser (comma or tab). Columns supported:
 * product_id, name, qty, cost_price, mrp, tax_rate, discount, batch_no
 */
function parseCsv(text: string): Item[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const first = lines[0];
  const sep = first.includes("\t") ? "\t" : ",";

  // header?
  const headerish = /product_id|name|qty|cost|mrp|tax|discount|batch/i.test(first);
  const rows = headerish ? lines.slice(1) : lines;

  return rows.map((ln) => {
    const c = ln.split(sep).map((x) => x.trim());
    const [c0, c1, c2, c3, c4, c5, c6, c7] = c;
    const it: Item = emptyRow();
    it.product_id = c0 ?? "";
    it.name = c1 ?? "";
    it.qty = normQty(c2);
    it.cost_price = normMoney(c3);
    it.mrp = c4 === "" || c4 == null ? null : normMoney(c4);
    it.tax_rate = normTax(c5);
    it.discount = normMoney(c6);
    it.batch_no = (c7 ?? "") || "";
    return it;
  });
}

/** ---------- Component ---------- */
export default function ItemsEditor({
  name = "items_json",
  defaultItems = [],
}: {
  name?: string;
  defaultItems?: any[];
}) {
  const [rows, setRows] = useState<Item[]>(
    Array.isArray(defaultItems) && defaultItems.length
      ? defaultItems.map((r: any) => ({
          product_id: String(r.product_id ?? r.id ?? ""),
          name: r.product_name ?? r.name ?? "",
          qty: normQty(r.qty ?? 0),
          cost_price: normMoney(r.cost_price ?? r.purchase_rate ?? r.price ?? 0),
          mrp: r.mrp == null ? null : normMoney(r.mrp),
          tax_rate: normTax(r.tax_rate ?? r.gst_slab ?? 0),
          discount: normMoney(r.discount ?? r.discount_pct ?? 0),
          batch_no:
            r.batch_no ??
            r?.meta?.batch?.batch_no ??
            r.batch_no_text ??
            (r.meta?.batch_no ?? ""),
          mfg_date: r.mfg_date ?? r.mfd_date ?? r?.meta?.batch?.mfg_date ?? null,
          exp_date: r.exp_date ?? r.expiry_date ?? r?.meta?.batch?.exp_date ?? null,
          meta: r.meta ?? {},
        }))
      : [emptyRow()]
  );

  // Keep at least one row
  useEffect(() => {
    if (!rows.length) setRows([emptyRow()]);
  }, [rows.length]);

  /** ---- Derived totals ---- */
  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let discount = 0;
    for (const r of rows) {
      const line = normQty(r.qty) * normMoney(r.cost_price);
      subtotal += line;
      tax += (normTax(r.tax_rate) / 100) * line;
      discount += normMoney(r.discount);
    }
    return {
      subtotal,
      tax,
      discount,
      total: subtotal + tax - discount,
    };
  }, [rows]);

  /** ---- Serialize payload (includes typed name for auto-create) ---- */
  const json = useMemo(() => {
    const normalized = rows
      .filter((r) => String(r.product_id || "").trim() && normQty(r.qty) > 0)
      .map((r) => ({
        product_id: String(r.product_id).trim(),
        name: (r.name ?? "").toString(), // <-- important for auto-create
        qty: normQty(r.qty),
        cost_price: normMoney(r.cost_price),
        mrp: r.mrp == null ? null : normMoney(r.mrp),
        tax_rate: normTax(r.tax_rate),
        discount: normMoney(r.discount),
        batch_no: (r.batch_no ?? "").trim() || null,
        mfg_date: r.mfg_date ?? null,
        exp_date: r.exp_date ?? null,
        meta: r.meta ?? {},
      }));
    return JSON.stringify(normalized);
  }, [rows]);

  /** ---- Row ops ---- */
  const update = (idx: number, patch: Partial<Item>) => {
    setRows((old) => {
      const next = [...old];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };
  const addRow = () => setRows((old) => [...old, emptyRow()]);
  const duplicateRow = (idx: number) =>
    setRows((old) => {
      const clone = { ...old[idx] };
      return [...old.slice(0, idx + 1), clone, ...old.slice(idx + 1)];
    });
  const removeRow = (idx: number) =>
    setRows((old) => (old.length <= 1 ? [emptyRow()] : old.filter((_, i) => i !== idx)));
  const clearAll = () => setRows([emptyRow()]);

  /** ---- CSV import ---- */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onChooseCsv = () => fileRef.current?.click();
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const parsed = parseCsv(txt);
    if (parsed.length) setRows(parsed);
    e.target.value = "";
  }, []);

  /** ---- Keyboard niceties ---- */
  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (rowIdx === rows.length - 1) addRow();
    }
    if (e.key === "Escape") {
      // quick clear current row (except product_id)
      update(rowIdx, { qty: 0, cost_price: 0, mrp: null, tax_rate: 0, discount: 0, batch_no: "" });
    }
  };

  /** ---- Helpers ---- */
  const lineTotal = (r: Item) => {
    const line = normQty(r.qty) * normMoney(r.cost_price);
    const tax = (normTax(r.tax_rate) / 100) * line;
    const disc = normMoney(r.discount);
    return clamp(line + tax - disc, -1e12, 1e12);
  };

  const invalidRow = (r: Item) => !String(r.product_id || "").trim() || normQty(r.qty) <= 0;

  return (
    <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-[color:var(--muted)]">
          <tr className="border-b border-black/5">
            <th className="px-3 py-2">Product ID</th>
            <th className="px-3 py-2">Product Name</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Cost</th>
            <th className="px-3 py-2">MRP</th>
            <th className="px-3 py-2">Tax %</th>
            <th className="px-3 py-2">Discount</th>
            <th className="px-3 py-2">Batch</th>
            <th className="px-3 py-2">Line Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-black/5 ${invalidRow(r) ? "bg-red-50/40" : ""}`}>
              <td className="px-3 py-2">
                <input
                  className="w-28 rounded-lg border border-black/10 px-2 py-1"
                  value={r.product_id ?? ""}
                  onChange={(e) => update(i, { product_id: e.target.value })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                  placeholder="ID"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-44 rounded-lg border border-black/10 px-2 py-1"
                  value={r.name ?? ""}
                  onChange={(e) => update(i, { name: e.target.value })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                  placeholder="(optional)"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className={`w-20 rounded-lg border px-2 py-1 text-right ${normQty(r.qty) <= 0 ? "border-red-300" : "border-black/10"}`}
                  inputMode="decimal"
                  value={r.qty ?? 0}
                  onChange={(e) => update(i, { qty: normQty(e.target.value) })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-24 rounded-lg border border-black/10 px-2 py-1 text-right"
                  inputMode="decimal"
                  value={r.cost_price ?? 0}
                  onChange={(e) => update(i, { cost_price: normMoney(e.target.value) })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-24 rounded-lg border border-black/10 px-2 py-1 text-right"
                  inputMode="decimal"
                  value={r.mrp ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(i, { mrp: v === "" ? null : normMoney(v) });
                  }}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                  placeholder="(optional)"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className={`w-20 rounded-lg border px-2 py-1 text-right ${normTax(r.tax_rate) > 100 ? "border-amber-300" : "border-black/10"}`}
                  inputMode="decimal"
                  value={r.tax_rate ?? 0}
                  onChange={(e) => update(i, { tax_rate: normTax(e.target.value) })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-24 rounded-lg border border-black/10 px-2 py-1 text-right"
                  inputMode="decimal"
                  value={r.discount ?? 0}
                  onChange={(e) => update(i, { discount: normMoney(e.target.value) })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-28 rounded-lg border border-black/10 px-2 py-1"
                  value={r.batch_no ?? ""}
                  onChange={(e) => update(i, { batch_no: e.target.value })}
                  onKeyDown={(e) => onCellKeyDown(e, i)}
                  placeholder="(optional)"
                />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                INR (Rs/-) {lineTotal(r).toFixed(2)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => duplicateRow(i)}
                    className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
                    title="Duplicate row"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
                    title="Remove row"
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals & actions */}
      <div className="px-3 py-2 border-t border-black/5 text-xs flex flex-wrap items-center gap-4">
        <div>Subtotal: <b>INR (Rs/-) {totals.subtotal.toFixed(2)}</b></div>
        <div>Tax: <b>INR (Rs/-) {totals.tax.toFixed(2)}</b></div>
        <div>Discount: <b>INR (Rs/-) {totals.discount.toFixed(2)}</b></div>
        <div>Total: <b>INR (Rs/-) {totals.total.toFixed(2)}</b></div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
          >
            + Add Row
          </button>
          <button
            type="button"
            onClick={onChooseCsv}
            className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
            title="Import CSV: product_id,name,qty,cost_price,mrp,tax_rate,discount,batch_no"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="px-2 py-1 rounded-lg border border-black/10 hover:bg-black/5"
            title="Clear all rows"
          >
            Clear
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={onFile}
          />
        </div>
      </div>

      {/* Hidden serialized payload for server action */}
      <input type="hidden" name={name} value={json} readOnly />
    </div>
  );
}
