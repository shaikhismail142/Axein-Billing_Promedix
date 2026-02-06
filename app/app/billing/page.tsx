'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from "next/link";

type Product = {
  id: number;
  name: string;
  sku?: string;
  gst_slab?: number;
  selling_price?: number;
  price?: number;
  stock_qty?: number;
  low_stock_threshold?: number;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type Customer = {
  id: number;
  name: string;
  phone?: string;
  gstin?: string;
};

type Item = {
  product_id?: number;
  name: string;
  gst_slab: number;
  qty: number;
  unit_price: number;
  discount_pct: number;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

function inr(n: number) {
  const amt = (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `INR (Rs/-) ${amt}`;
}

export default function Billing() {
  // Product search
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState<Product[]>([]);

  // Customer search
  const [custQ, setCustQ] = useState('');
  const [custSuggest, setCustSuggest] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string>('');

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  // NEW: per-invoice fields (prefilled from settings)
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [extraLabel, setExtraLabel] = useState<string>("Service Charge");
  const [extraAmount, setExtraAmount] = useState<number>(0);
  const [patientName, setPatientName] = useState<string>("");
  const [doctorName, setDoctorName] = useState<string>("");

  // Payment
  const [paymentMode, setPaymentMode] = useState<"paid" | "partial" | "pending">("paid");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");

  // -------- Prefill Notes/Terms from settings ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/settings?key=invoice_defaults`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (typeof j?.notes_default === 'string') setNotes(j.notes_default);
        if (typeof j?.terms_default === 'string') setTerms(j.terms_default);
      } catch { /* ignore */ }
    })();
  }, []);

  // -------- Product search ----------
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setSuggest([]); return; }
      const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSuggest(j.items || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function addProduct(p: Product) {
    const stock = Number(p.stock_qty ?? 0);
    const low = Number(p.low_stock_threshold ?? 0);
    if (stock <= low) {
      const proceed = confirm(
        stock <= 0
          ? `“${p.name}” appears to be out of stock (stock: ${stock}). Add anyway?`
          : `“${p.name}” is at/under low threshold (stock: ${stock}, low: ${low}). Add anyway?`
      );
      if (!proceed) return;
    }
    const unitPrice = Number(p.selling_price ?? p.price ?? 0);
    setItems((prev) => [...prev, {
      product_id: p.id,
      name: p.name,
      gst_slab: Number(p.gst_slab ?? 18),
      qty: 1,
      unit_price: unitPrice,
      discount_pct: 0,
      category: p.category ?? null,
      hsn_code: p.hsn_code ?? null,
      batch_no: p.batch_no ?? "",
      exp_date: p.exp_date ?? "",
    }]);
    setQ(''); setSuggest([]);
  }

  // -------- Customer search ----------
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!custQ.trim()) { setCustSuggest([]); return; }
      const r = await fetch(`/api/customers?q=${encodeURIComponent(custQ)}`);
      const j = await r.json();
      setCustSuggest(j.items || []);
    }, 250);
    return () => clearTimeout(t);
  }, [custQ]);

  function pickCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustQ(''); setCustSuggest([]);
  }
  function clearCustomer() { setCustomerId(null); setCustomerName(''); }

  // -------- Items helpers ----------
  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  function lineTotals(it: Item) {
    const gross = it.qty * it.unit_price;
    const discount = +(gross * (Number(it.discount_pct || 0) / 100)).toFixed(2);
    const taxable = +(gross - discount).toFixed(2);
    const tax = +((taxable * Number(it.gst_slab || 0)) / 100).toFixed(2);
    const total = +(taxable + tax).toFixed(2);
    return { taxable, tax, total };
  }

  const totals = useMemo(
    () => items.reduce((acc, it) => {
      const t = lineTotals(it);
      acc.taxable += t.taxable; acc.tax += t.tax; acc.total += t.total;
      return acc;
    }, { taxable: 0, tax: 0, total: 0 }),
    [items]
  );

  const extra = Math.max(0, Number(extraAmount || 0));
  const grandTotal = +(totals.total + extra).toFixed(2);
  const pendingAmount = Math.max(grandTotal - (Number(amountPaid) || 0), 0);

  useEffect(() => {
    if (paymentMode === "paid") setAmountPaid(grandTotal);
    if (paymentMode === "pending") setAmountPaid(0);
  }, [paymentMode, grandTotal]);

  // -------- Save sale ----------
  async function save() {
    if (!items.length) return alert('No items in bill');
    try {
      setSaving(true);
      const payload = {
        customer_id: customerId,
        customer_name: customerId ? undefined : (customerName || '').trim() || undefined,
        patient_name: (patientName || '').trim() || null,
        doctor_name: (doctorName || '').trim() || null,
        notes: (notes || "").trim() || null,
        terms: (terms || "").trim() || null,
        extra_label: (extraLabel || "").trim() || null,
        extra_amount: extra,
        amount_paid: Number(amountPaid || 0),
        payment_method: paymentMethod || null,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          name: it.name,
          gst_slab: Number(it.gst_slab || 0),
          qty: Number(it.qty || 0),
          unit_price: Number(it.unit_price || 0),
          discount_pct: Number(it.discount_pct || 0),
          batch_no: it.batch_no || null,
          exp_date: it.exp_date || null,
        })),
      };
      const r = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const raw = await r.text();
      let j: any = null;
      try { j = raw ? JSON.parse(raw) : null; } catch {}
      if (!r.ok) {
        const msg = j?.detail || j?.error || raw || 'save failed';
        throw new Error(msg);
      }
      if (!j) j = {};
      window.location.href = `/invoices/${j.id}`;
    } catch (e) {
      console.error(e);
      alert(`Failed to save: ${(e as any)?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
        <div className="card" style={{ padding: 16 }}>
          <h1 style={{ marginTop: 0 }}>Quick Billing</h1>
          <p className="text-xs opacity-70">Create a bill fast — add customer, items, then confirm payment.</p>

        {/* Customer (optional) */}
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Customer (optional)</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  placeholder="Type to search or enter a new customer name"
                  value={customerName || custQ}
                  onChange={(e) => {
                    if (customerId) setCustomerId(null);
                    setCustomerName(e.target.value);
                    setCustQ(e.target.value);
                  }}
                />
                {!!custSuggest.length && (
                  <div
                    className="card"
                    style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, maxHeight: 240, overflow: 'auto', border: '1px solid var(--glass-brd)' }}
                  >
                    {custSuggest.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => pickCustomer(c)}
                        style={{ padding: '8px 10px', borderTop: '1px solid var(--glass-brd)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                      >
                        <span>{c.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {c.phone || c.gstin ? [c.phone, c.gstin].filter(Boolean).join(' • ') : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <button className="btn" onClick={clearCustomer}>Clear</button>
            </div>
          </div>
          {customerId && (
            <div style={{ marginTop: 6, color: 'var(--success)', fontSize: 12 }}>
              ✓ Linked to existing customer (ID: {customerId})
            </div>
          )}
        </div>

        {/* Patient / Doctor */}
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Patient Name</label>
              <input
                className="input"
                placeholder="Patient name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Doctor Name</label>
              <input
                className="input"
                placeholder="Doctor name"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 text-xs opacity-70">
            These details will appear on the invoice and print.
          </div>
        </div>

        {/* Product search / scan */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Product search / scan</label>
          <input
            className="input"
            placeholder="Scan barcode or search product..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {!!suggest.length && (
            <div
              className="card"
              style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, maxHeight: 260, overflow: 'auto', border: '1px solid var(--glass-brd)' }}
            >
              {suggest.map((p) => (
                <div
                  key={p.id}
                  onClick={() => addProduct(p)}
                  style={{ padding: '8px 10px', borderTop: '1px solid var(--glass-brd)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <span>
                    {p.name} {p.sku ? `(${p.sku})` : ''}
                    {typeof p.stock_qty === 'number' ? ` • Stock: ${p.stock_qty}` : ''}
                    {p.category ? ` • ${p.category}` : ''}
                  </span>
                  <b>{inr(Number((p.selling_price ?? p.price) || 0))}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items grid */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Item</th>
                  <th style={{ width: 120 }}>Category</th>
                  <th style={{ width: 120 }}>HSN</th>
                  <th style={{ width: 120 }}>Lot</th>
                  <th style={{ width: 120 }}>Expiry</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Disc %</th>
                  <th style={{ width: 80, textAlign: 'right' }}>GST %</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Line Total</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const t = lineTotals(it);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</td>
                      <td>{it.category || '-'}</td>
                      <td>{it.hsn_code || '-'}</td>
                      <td>
                        <input
                          className="input"
                          value={it.batch_no ?? ""}
                          onChange={(e) => updateItem(i, { batch_no: e.target.value })}
                          style={{ height: 30, width: 120 }}
                          placeholder="Lot"
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="date"
                          value={it.exp_date ?? ""}
                          onChange={(e) => updateItem(i, { exp_date: e.target.value })}
                          style={{ height: 30, width: 130 }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={1}
                          value={it.qty}
                          onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                          style={{ height: 30, width: 90, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.unit_price}
                          onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })}
                          style={{ height: 30, width: 120, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.discount_pct}
                          onChange={(e) => updateItem(i, { discount_pct: Number(e.target.value) })}
                          style={{ height: 30, width: 100, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={1}
                          value={it.gst_slab}
                          onChange={(e) => updateItem(i, { gst_slab: Number(e.target.value) })}
                          style={{ height: 30, width: 80, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(t.total)}</td>
                      <td>
                        <button className="btn" onClick={() => removeItem(i)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={12} className="muted">
                      Add products using search above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Extra + Notes/Terms */}
        <div className="grid gap-3 md:grid-cols-2" style={{ marginTop: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="mb-2 text-sm font-semibold">Additional / Service Charge</div>
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="Label (e.g., Service Charge, Delivery)"
                value={extraLabel}
                onChange={(e) => setExtraLabel(e.target.value)}
              />
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                placeholder="Amount"
                value={extraAmount}
                onChange={(e) => setExtraAmount(Number(e.target.value))}
                style={{ width: 160 }}
              />
            </div>
            <div className="mt-2 text-xs opacity-70">This will be added to the total and shown on the invoice.</div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="mb-2 text-sm font-semibold">Notes (optional)</div>
            <textarea className="input" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="mt-2 text-sm font-semibold">Terms & Conditions (optional)</div>
            <textarea className="input" style={{ minHeight: 70 }} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </div>

        {/* Summary + Payment */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 12, flexWrap: "wrap" }}>
          <div />
          <div className="card no-break" style={{ padding: 12, minWidth: 320 }}>
            <div className="flex justify-between"><span>Taxable</span><b>{inr(totals.taxable)}</b></div>
            <div className="flex justify-between"><span>Tax</span><b>{inr(totals.tax)}</b></div>
            <div className="flex justify-between">
              <span>{extraLabel || 'Additional Charge'}</span><b>{inr(extra)}</b>
            </div>
            <div className="flex justify-between" style={{ borderTop: '1px solid var(--glass-brd)', marginTop: 6, paddingTop: 6 }}>
              <span>Total</span><b style={{ fontSize: 18 }}>{inr(grandTotal)}</b>
            </div>
            <div className="flex justify-between mt-1"><span>Amount Paid</span><b>{inr(Number(amountPaid || 0))}</b></div>
            <div className="flex justify-between"><span>Pending</span><b>{inr(pendingAmount)}</b></div>
          </div>
        </div>

        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="text-sm font-semibold mb-2">Payment</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs">Mode</label>
              <select
                className="input"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
              >
                <option value="paid">Paid in full</option>
                <option value="partial">Partial</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs">Amount Paid</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={amountPaid}
                onChange={(e) => {
                  const val = Number(e.target.value || 0);
                  setAmountPaid(val);
                  if (val <= 0) setPaymentMode("pending");
                  else if (val >= grandTotal - 0.01) setPaymentMode("paid");
                  else setPaymentMode("partial");
                }}
                style={{ width: 160, textAlign: "right" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs">Method</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="split">Split</option>
              </select>
            </div>
            <div className="text-xs opacity-70">
              Pending: <b>{inr(pendingAmount)}</b>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || items.length === 0}>
            {saving ? 'Saving...' : 'Save & View Invoice'}
          </button>
          <Link href="/invoices/">Go to Invoices</Link>
        </div>
      </div>
    </div>
  );
}
