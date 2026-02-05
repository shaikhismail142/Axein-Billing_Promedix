"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function NewProductPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        const names = Array.isArray(j?.items) ? j.items.map((c: any) => String(c?.name || "").trim()).filter(Boolean) : [];
        setCategories(names);
      } catch {}
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) return setErr("Name is required");

    setBusy(true); setErr(null);
    try {
      const payload: any = {
        name,
        category: String(fd.get("category") || "").trim() || null,
        selling_price: Number(fd.get("selling_price") || 0),
        gst_slab: Number(fd.get("gst_slab") || 0),
        stock_qty: Number(fd.get("stock_qty") || 0),
        low_stock_threshold: Number(fd.get("low_stock_threshold") || 0),
        sku: String(fd.get("sku") || ""),
        brand: String(fd.get("brand") || ""),
        hsn_code: String(fd.get("hsn_code") || ""),
        unit: String(fd.get("unit") || ""),
        exp_date: String(fd.get("exp_date") || ""),
        notes: String(fd.get("notes") || ""),
      };
      // If category is new, try creating it (best-effort)
      const cat = payload.category;
      if (cat && !categories.map((c) => c.toLowerCase()).includes(cat.toLowerCase())) {
        try {
          await fetch("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cat }),
          });
        } catch {}
      }

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed");
      router.push("/products");
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16, maxWidth: 700 }}>
        <h1>New Product</h1>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            <div>Name</div>
            <input name="name" required />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label>
              <div>Selling Price</div>
              <input name="selling_price" type="number" step="0.01" defaultValue={0} />
            </label>
            <label>
              <div>GST %</div>
              <input name="gst_slab" type="number" step="1" defaultValue={0} />
            </label>
            <label>
              <div>Stock Qty</div>
              <input name="stock_qty" type="number" step="1" defaultValue={0} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label>
              <div>Low Stock Threshold</div>
              <input name="low_stock_threshold" type="number" step="1" defaultValue={0} />
            </label>
            <label>
              <div>SKU</div>
              <input name="sku" />
            </label>
            <label>
              <div>Brand</div>
              <input name="brand" />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div>Category</div>
              <input name="category" list="category-list" placeholder="e.g., medicines" />
              <datalist id="category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label>
              <div>HSN</div>
              <input name="hsn_code" />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div>Default Expiry (optional)</div>
              <input name="exp_date" type="date" />
            </label>
            <label>
              <div>Unit</div>
              <input name="unit" />
            </label>
          </div>
          <label>
            <div>Notes</div>
            <textarea name="notes" rows={3} />
          </label>

          {err && <div style={{ color: "crimson" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={busy} className="btn-primary" type="submit">Create</button>
            <button type="button" onClick={() => router.back()} className="btn-outline">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
