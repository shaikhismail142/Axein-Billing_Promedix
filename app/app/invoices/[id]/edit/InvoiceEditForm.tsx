// app/invoices/[id]/edit/InvoiceEditForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";

type Item = {
  id?: number;
  product_id?: number | null;
  name: string;
  gst_slab: number | string | null;   // %
  qty: number | string;
  unit_price: number | string;
  discount_pct: number | string | null; // %
  batch_no?: string | null;
  exp_date?: string | null;
};

type Props = { sale: any; items: Item[] };

export default function InvoiceEditForm({ sale, items: initItems }: Props) {
  const router = useRouter();

  // ---------- helpers ----------
  const toNum = (v: any, d = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const inr = (n: number): string => {
    const parts = round2(n).toFixed(2).split(".");
    let x = parts[0];
    const last3 = x.slice(-3);
    const other = x.slice(0, -3);
    if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
    return `INR (Rs/-) ${x}.${parts[1]}`;
  };

  // ---------- customer autosuggest ----------
  const [customerInput, setCustomerInput] = useState<string>(sale.customer_name || "");
  const [customerId, setCustomerId] = useState<number | null>(sale.customer_id || null);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    const q = customerInput.trim();
    if (!q) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
        if (!active) return;
        if (res.ok) {
          const j = await res.json();
          setSuggestions(j.items || []);
        } else {
          setSuggestions([]);
        }
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [customerInput]);

  function pickCustomer(c: any) {
    setCustomerInput(c.name);
    setCustomerId(c.id);
    setSuggestions([]);
  }

  // ---------- form state ----------
  const [items, setItems] = useState<Item[]>(
    initItems?.length ? initItems : [{ name: "", gst_slab: 0, qty: 1, unit_price: 0, discount_pct: 0, batch_no: "", exp_date: "" }]
  );
  const [isReturn, setIsReturn] = useState<boolean>(!!sale.is_return);
  const [amountPaid, setAmountPaid] = useState<number>(toNum(sale.amount_paid, 0));
  const [paymentMethod, setPaymentMethod] = useState<string>(sale.payment_method || "");
  const [patientName, setPatientName] = useState<string>(sale.patient_name || "");
  const [doctorName, setDoctorName] = useState<string>(sale.doctor_name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- computations (per-row + totals) ----------
  const rowsComputed = useMemo(() => {
    return items.map((it) => {
      const qty = Math.max(0, toNum(it.qty, 0));
      const rate = Math.max(0, toNum(it.unit_price, 0));
      const discPct = Math.max(0, toNum(it.discount_pct, 0));
      const gst = Math.max(0, toNum(it.gst_slab, 0));
      const gross = qty * rate;                     // qty * rate
      const discount = (gross * discPct) / 100;     // % discount
      const taxable = Math.max(0, gross - discount);
      const tax = (taxable * gst) / 100;            // GST on taxable
      const lineTotal = taxable + tax;
      return { qty, rate, discPct, gst, gross, discount, taxable, tax, lineTotal };
    });
  }, [items]);

    const computed = useMemo(() => {
      let subtotal = 0, tax_total = 0, total = 0;
    for (const rc of rowsComputed) {
      subtotal += rc.taxable;
      tax_total += rc.tax;
      total += rc.lineTotal;
    }
    if (isReturn) { subtotal = -subtotal; tax_total = -tax_total; total = -total; }
    const balancedue = Math.max(total - toNum(amountPaid, 0), 0);
    return {
      subtotal: round2(subtotal),
      tax_total: round2(tax_total),
      total: round2(total),
      balance: round2(balancedue),
    };
  }, [rowsComputed, isReturn, amountPaid]);

  // ---------- row ops ----------
  function setItem<K extends keyof Item>(idx: number, key: K, value: Item[K]) {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }
  function addRow() {
    setItems(prev => [...prev, { name: "", gst_slab: 0, qty: 1, unit_price: 0, discount_pct: 0, batch_no: "", exp_date: "" }]);
  }
  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  // ---------- save ----------
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const cleanItems = items.map(it => ({
        product_id: it.product_id ?? null,
        name: String((it.name || "").trim()),
        gst_slab: toNum(it.gst_slab, 0),
        qty: toNum(it.qty, 0),
        unit_price: toNum(it.unit_price, 0),
        discount_pct: toNum(it.discount_pct, 0),
        batch_no: String(it.batch_no || "").trim() || null,
        exp_date: String(it.exp_date || "").trim() || null,
      }));

      if (cleanItems.length === 0) throw new Error("Add at least one item.");
      if (cleanItems.some(it => !it.name)) throw new Error("Item name cannot be empty.");

      const payload = {
        is_return: !!isReturn,
        amount_paid: toNum(amountPaid, 0),
        payment_method: paymentMethod || null,
        customer_id: customerId || undefined,
        customer_name: !customerId ? (customerInput || "").trim() : undefined,
        patient_name: (patientName || "").trim() || null,
        doctor_name: (doctorName || "").trim() || null,
        items: cleanItems,
      };

      const res = await fetch(`/api/sales/${sale.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = "Failed to save invoice.";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      router.push(`/invoices/${sale.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Failed to save invoice.");
    } finally {
      setSaving(false);
    }
  }

  // ---------- ui ----------
  return (
    <form onSubmit={onSave}>
      {/* Customer picker */}
      <div className="flex items-start gap-3 mb-3 relative flex-wrap">
        <div className="flex-1">
          <label className="block mb-1 font-semibold">Customer</label>
          <input
            value={customerInput}
            onChange={(e) => { setCustomerInput(e.target.value); setCustomerId(null); }}
            className="border px-2 py-1 rounded w-full"
            placeholder="Type to search or enter new customer"
          />
          {!!suggestions.length && (
            <div className="absolute mt-1 border rounded bg-white shadow z-10 w-full max-h-60 overflow-auto">
              {suggestions.map((c) => (
                <div
                  key={c.id}
                  className="px-2 py-1 hover:bg-gray-100 cursor-pointer"
                  onClick={() => pickCustomer(c)}
                  title={c.phone ? `Phone: ${c.phone}` : ''}
                >
                  <b>{c.name}</b>{c.phone ? ` — ${c.phone}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isReturn} onChange={e => setIsReturn(e.target.checked)} />
          <span>Return</span>
        </label>

        <label className="flex items-center gap-2">
          <span>Amount Paid</span>
          <input
            type="number" step="0.01" value={amountPaid}
            onChange={e => setAmountPaid(toNum(e.target.value, 0))}
            className="border px-2 py-1 rounded w-32 text-right"
          />
        </label>

        <label className="flex items-center gap-2">
          <span>Method</span>
          <select
            className="border px-2 py-1 rounded"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="">Select</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank">Bank</option>
            <option value="split">Split</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block mb-1 font-semibold">Patient Name</label>
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="border px-2 py-1 rounded w-full"
            placeholder="Patient name"
          />
        </div>
        <div>
          <label className="block mb-1 font-semibold">Doctor Name</label>
          <input
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
            className="border px-2 py-1 rounded w-full"
            placeholder="Doctor name"
          />
        </div>
        <div>
          <label className="block mb-1 font-semibold">DC No</label>
          <input
            value={sale.dc_no || ""}
            className="border px-2 py-1 rounded w-full bg-gray-50"
            readOnly
          />
        </div>
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th>Item</th>
              <th style={{ width: 140 }}>Lot</th>
              <th style={{ width: 140 }}>Expiry</th>
              <th style={{ width: 90, textAlign: "right" }}>Qty</th>
              <th style={{ width: 120, textAlign: "right" }}>Rate</th>
              <th style={{ width: 90, textAlign: "right" }}>Disc%</th>
              <th style={{ width: 90, textAlign: "right" }}>GST%</th>
              <th style={{ width: 140, textAlign: "right" }}>Line Total</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const rc = rowsComputed[idx];
              return (
                <tr key={it.id ?? idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <input
                      value={it.name}
                      onChange={e => setItem(idx, "name", e.target.value)}
                      className="border px-2 py-1 rounded w-full"
                      placeholder="Item name"
                    />
                  </td>
                  <td>
                    <input
                      value={it.batch_no ?? ""}
                      onChange={e => setItem(idx, "batch_no", e.target.value)}
                      className="border px-2 py-1 rounded w-full"
                      placeholder="Lot / Batch"
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={it.exp_date ?? ""}
                      onChange={e => setItem(idx, "exp_date", e.target.value)}
                      className="border px-2 py-1 rounded w-full"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number" step="0.01"
                      value={it.qty as any}
                      onChange={e => setItem(idx, "qty", toNum(e.target.value, 0))}
                      className="border px-2 py-1 rounded w-20 text-right"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number" step="0.01"
                      value={it.unit_price as any}
                      onChange={e => setItem(idx, "unit_price", toNum(e.target.value, 0))}
                      className="border px-2 py-1 rounded w-28 text-right"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number" step="0.01"
                      value={it.discount_pct as any}
                      onChange={e => setItem(idx, "discount_pct", toNum(e.target.value, 0))}
                      className="border px-2 py-1 rounded w-24 text-right"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number" step="0.01"
                      value={it.gst_slab as any}
                      onChange={e => setItem(idx, "gst_slab", toNum(e.target.value, 0))}
                      className="border px-2 py-1 rounded w-24 text-right"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {inr(rc?.lineTotal ?? 0)}
                  </td>
                  <td>
                    <button type="button" onClick={() => removeRow(idx)} className="border px-2 py-1 rounded">
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={10}>
                <button type="button" onClick={addRow} className="border px-3 py-1 rounded">
                  + Add Item
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-3 flex justify-end">
        <div className="card" style={{ padding: 12, minWidth: 340 }}>
          <Row label="Subtotal" value={inr(computed.subtotal)} />
          <Row label="Tax" value={inr(computed.tax_total)} />
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e5e7eb", marginTop: 6, paddingTop: 6 }}>
            <span>Total</span><b style={{ fontSize: 18 }}>{inr(computed.total)}</b>
          </div>
          {!isReturn && <Row label="Balance Due" value={inr(computed.balance)} />}
        </div>
      </div>

      {error && <div style={{ color: "#B91C1C", marginTop: 8 }}>{error}</div>}

      <div className="flex gap-2 mt-3">
        <button type="submit" className="border px-3 py-1 rounded" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button type="button" onClick={() => history.back()} className="border px-3 py-1 rounded" disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span>{label}</span><b>{value}</b>
    </div>
  );
}
