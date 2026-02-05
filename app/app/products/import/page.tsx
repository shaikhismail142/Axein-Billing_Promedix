"use client";

import { useState, useRef } from "react";

export default function ImportProductsPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/products/import", { method: "POST", body: fd });
      let j: any = null;
      try { j = await res.json(); } catch {}
      if (!res.ok) throw new Error(j?.error || "Import failed");

      const { created = 0, updated = 0, skipped = 0 } = j || {};
      setMsg(`Imported successfully — created: ${created}, updated: ${updated}${skipped ? `, skipped: ${skipped}` : ""}`);
    } catch (e: any) {
      setErr(e?.message || "Import failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function downloadTemplate() {
    const csv =
      "name,category,price,gst_slab,stock_qty,cost_price,low_stock_threshold,sku,brand,hsn_code,unit,exp_date,notes\n" +
      "Shampoo 200ml,cosmetics,120,18,20,70,5,SH-200,Acme,33059011,pcs,2026-12-31,Popular\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16, maxWidth: 780 }}>
        <h1 style={{ marginTop: 0 }}>Import Products (CSV)</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Supported columns (case-insensitive): <b>name</b>, <b>category</b>, <b>price</b>, <b>gst_slab</b>, <b>stock_qty</b>,
          <b> cost_price</b>, <b>low_stock_threshold</b>, <b>sku</b>, <b>brand</b>, <b>hsn_code</b>, <b>unit</b>, <b>exp_date</b>, <b>notes</b>.
          Only <b>name</b> is required. Matching is by product name (case-insensitive).
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "12px 0" }}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onChange}
            disabled={busy}
          />
          <button type="button" className="btn-outline" onClick={downloadTemplate} disabled={busy}>
            Download CSV Template
          </button>
        </div>

        {busy && <div className="muted">Uploading &amp; processing…</div>}
        {msg && <div style={{ marginTop: 8, color: "var(--success, #16a34a)" }}>{msg}</div>}
        {err && <div style={{ marginTop: 8, color: "var(--danger, #dc2626)" }}>{err}</div>}

        <div className="glass" style={{ marginTop: 16, padding: 12, borderRadius: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Tips</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Header row required. Extra columns are ignored.</li>
            <li>If a product name already exists (case-insensitive), it will be <b>updated</b>.</li>
            <li>Values are stored in <code>products.meta</code> (JSONB).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
