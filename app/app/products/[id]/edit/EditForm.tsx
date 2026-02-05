"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type EditFormProps = {
  id: number;
  name: string;
  category?: string;
  selling_price: number;
  stock_qty: number;
  low_stock_threshold: number;
  sku: string;
  brand: string;
  hsn_code: string;
  unit: string;
  exp_date?: string | null;
  notes: string;
};

export default function EditForm(p: EditFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const labelStyle = { color: "var(--muted)" } as const;

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
    setSaving(true);
    setMsg(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name") || "").trim(),
      category: String(form.get("category") || "").trim() || null,
      selling_price: Number(form.get("selling_price") || 0),
      stock_qty: Number(form.get("stock_qty") || 0),
      low_stock_threshold: Number(form.get("low_stock_threshold") || 0),
      sku: String(form.get("sku") || "").trim() || null,
      brand: String(form.get("brand") || "").trim() || null,
      hsn_code: String(form.get("hsn_code") || "").trim() || null,
      unit: String(form.get("unit") || "").trim() || null,
      exp_date: String(form.get("exp_date") || "").trim() || null,
      notes: String(form.get("notes") || "").trim() || null,
    };

    const res = await fetch(`/api/products/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const isJSON = res.headers.get("content-type")?.includes("application/json");
    const data = isJSON ? await res.json() : null;

    if (!res.ok || !data?.ok) {
      setMsg(data?.error || `Save failed (${res.status})`);
      setSaving(false);
      return;
    }

    router.push("/products");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm" style={labelStyle}>Name</label>
          <input name="name" defaultValue={p.name} required className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Selling Price</label>
          <input name="selling_price" defaultValue={p.selling_price} type="number" step="0.01" className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Stock Qty</label>
          <input name="stock_qty" defaultValue={p.stock_qty} type="number" step="1" className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Low Stock Threshold</label>
          <input name="low_stock_threshold" defaultValue={p.low_stock_threshold} type="number" step="1" className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>SKU</label>
          <input name="sku" defaultValue={p.sku} className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Brand</label>
          <input name="brand" defaultValue={p.brand} className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Category</label>
          <input name="category" defaultValue={p.category ?? ""} list="category-list" className="border rounded-lg px-3 py-2 w-full" />
          <datalist id="category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>HSN Code</label>
          <input name="hsn_code" defaultValue={p.hsn_code} className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div>
          <label className="block text-sm" style={labelStyle}>Unit</label>
          <input name="unit" defaultValue={p.unit} className="border rounded-lg px-3 py-2 w-full" />
        </div>
        <div>
          <label className="block text-sm" style={labelStyle}>Default Expiry (optional)</label>
          <input name="exp_date" type="date" defaultValue={p.exp_date ?? ""} className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm" style={labelStyle}>Notes</label>
          <textarea name="notes" defaultValue={p.notes} rows={3} className="border rounded-lg px-3 py-2 w-full" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        <a className="btn btn-outline" href="/products">Cancel</a>
        {msg && <span className="text-sm" style={{ color: "var(--danger)" }}>{msg}</span>}
      </div>
    </form>
  );
}
