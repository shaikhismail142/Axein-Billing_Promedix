// app/inventory/adjustments/page.tsx
"use client";

import { useEffect, useState } from "react";

/* ========= Types ========= */
type AdjRow = {
  id: number | string;
  adjustment_date: string;
  status: "draft" | "posted" | "reversed";
  reason: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
  posted_at: string | null;
  lines?: number;
};

type Product = {
  id: number;
  name: string;
  sku: string | null;
  price: string | number;
  stock_qty: number;
};

/* ========= Helpers ========= */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    try {
      const j = JSON.parse(txt);
      throw new Error(j?.error || txt || `HTTP ${r.status}`);
    } catch {
      throw new Error(txt || `HTTP ${r.status}`);
    }
  }
  return r.json();
}

function toast(msg: string) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.setAttribute(
    "style",
    [
      "position:fixed",
      "z-index:9999",
      "bottom:16px",
      "right:16px",
      "padding:10px 14px",
      "background:var(--surface-1, #111)",
      "color:var(--text, #fff)",
      "border-radius:12px",
      "box-shadow:0 6px 20px rgba(0,0,0,.25)",
      "font-size:14px",
    ].join(";")
  );
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

/* ========= Theme toggle (reads DOM, no auto-flip) ========= */
function useThemeToggle() {
  const initial =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  const [theme, setThemeState] = useState<"light" | "dark">(initial);

  function setTheme(t: "light" | "dark") {
    setThemeState(t);
    const html = document.documentElement;
    if (t === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
    try { localStorage.setItem("theme", t); } catch {}
  }

  return { theme, setTheme };
}

/* ========= Page ========= */
export default function InventoryAdjustmentsPage() {
  const { theme, setTheme } = useThemeToggle();

  // list state
  const [items, setItems] = useState<AdjRow[]>([]);
  const [page, setPage] = useState(1);
  const [perPage] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "posted" | "reversed">("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  // new draft modal state
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [reason, setReason] = useState<"adjustment"|"sale"|"return"|"purchase"|"damage"|"loss"|"promo"|"correction">("adjustment");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [newLines, setNewLines] = useState<Array<{
    product?: Product|null;
    product_id?: number | "";
    delta_qty?: number | "";
    unit_cost?: number | "";
    notes?: string;
  }>>([{ }]);

  /* ----- load list ----- */
  async function loadList(pg = page) {
    const params = new URLSearchParams({ page: String(pg), perPage: String(perPage) });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const d = await api<{items: AdjRow[]; totalPages: number}>(`/api/inventory/adjustments?${params}`);
    setItems(d.items || []);
    setTotalPages(d.totalPages || 1);
  }

  useEffect(() => {
    loadList().catch((e) => console.error("list load failed:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, q, status, from, to]);

  /* ----- product search ----- */
  async function searchProducts(term: string): Promise<Product[]> {
    const d = await api<{items: any[]}>(`/api/products?q=${encodeURIComponent(term)}&perPage=20&page=1`);
    return (d.items || []) as Product[];
  }

  /* ----- create draft ----- */
  async function createDraft() {
    setErrMsg(null);

    try {
      // basic validation
      const lines = newLines.map((ln) => {
        const pid = ln.product?.id ?? (ln.product_id === "" ? undefined : Number(ln.product_id));
        const qty = ln.delta_qty === "" ? undefined : Number(ln.delta_qty);
        const ucost = ln.unit_cost === "" || ln.unit_cost == null ? undefined : Number(ln.unit_cost);
        return {
          product_id: pid,
          delta_qty: qty,
          unit_cost: ucost,
          notes: (ln.notes || "").trim() || undefined,
        };
      }).filter((x) => Number.isFinite(x.product_id) && x.product_id! > 0 && Number.isFinite(x.delta_qty) && x.delta_qty !== 0);

      if (lines.length === 0) {
        setErrMsg("Add at least one valid line: select a product and non-zero Δ Qty.");
        return;
      }

      setSaving(true);
      await api(`/api/inventory/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          items: lines,
        }),
      });

      toast("Draft saved ✅");
      setShowNew(false);
      setNewLines([{}]);
      setReference("");
      setNotes("");
      setReason("adjustment");
      setPage(1);
      await loadList(1);
    } catch (e: any) {
      console.error("save failed:", e);
      setErrMsg(e?.message || "Save failed");
      toast("Save failed ❌");
    } finally {
      setSaving(false);
    }
  }

  /* ----- post draft ----- */
  async function postAdjustment(id: number|string) {
    try {
      if (!confirm("Post this adjustment and apply stock changes?")) return;
      await api(`/api/inventory/adjustments/${id}/post`, { method: "POST" });
      toast("Adjustment posted ✅");
      await loadList(page);
    } catch (e:any) {
      console.error("post failed:", e);
      toast("Post failed ❌");
      alert(`Post failed: ${e?.message || e}`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header with Theme toggle */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col">
          <label className="text-xs">Search</label>
          <input className="rounded-lg px-3 py-2 border" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="reason / reference / notes" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Status</label>
          <select className="rounded-lg px-3 py-2 border" value={status} onChange={(e)=>setStatus(e.target.value as any)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="reversed">Reversed</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs">From</label>
          <input type="date" className="rounded-lg px-3 py-2 border" value={from} onChange={(e)=>setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">To</label>
          <input type="date" className="rounded-lg px-3 py-2 border" value={to} onChange={(e)=>setTo(e.target.value)} />
        </div>

        <div className="flex-1" />

        {/* Theme switch */}
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-70">Theme</span>
          <button
            className="rounded-xl px-3 py-2 border font-medium"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle dark/light theme for this page"
          >
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
          </button>
        </div>

        <button className="rounded-xl px-3 py-2 border font-medium" onClick={()=>setShowNew(true)}>➕ New Adjustment</button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Reason</th>
              <th className="text-left p-2">Reference</th>
              <th className="text-left p-2">Lines</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-gray-500">No adjustments yet.</td></tr>
            )}
            {items.map((r) => (
              <tr key={String(r.id)} className="border-t">
                <td className="p-2">{new Date(r.adjustment_date).toLocaleString()}</td>
                <td className="p-2">{r.reason}</td>
                <td className="p-2">{r.reference || "-"}</td>
                <td className="p-2">{r.lines ?? "-"}</td>
                <td className="p-2">
                  <span
                    className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      r.status === "draft"
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                        : r.status === "reversed"
                        ? "bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
                        : "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="p-2 space-x-2">
                  {r.status === "draft" && (
                    <button className="rounded-lg px-2 py-1 border" onClick={()=>postAdjustment(r.id)}>Post</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Draft Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,.25)"}}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 w-[min(950px,95vw)]">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">New Stock Adjustment</div>
              <button className="px-2 py-1 rounded-lg border" onClick={()=>setShowNew(false)}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="flex flex-col">
                <label className="text-xs">Reason</label>
                <select className="rounded-lg px-3 py-2 border" value={reason} onChange={(e)=>setReason(e.target.value as any)}>
                  {["adjustment","sale","return","purchase","damage","loss","promo","correction"].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs">Reference</label>
                <input className="rounded-lg px-3 py-2 border" value={reference} onChange={(e)=>setReference(e.target.value)} placeholder="e.g. BR-2025-10" />
              </div>
              <div className="flex flex-col md:col-span-1">
                <label className="text-xs">Notes</label>
                <input className="rounded-lg px-3 py-2 border" value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="optional" />
              </div>
            </div>

            {errMsg && (
              <div className="mb-3 text-sm text-red-600">{errMsg}</div>
            )}

            <LinesEditor
              rows={newLines}
              onChange={setNewLines}
              searchProducts={searchProducts}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg px-3 py-2 border" onClick={()=>setShowNew(false)} disabled={saving}>Cancel</button>
              <button
                className="rounded-lg px-3 py-2 border font-semibold"
                onClick={createDraft}
                disabled={saving}
                title="Save draft (does not affect stock yet)"
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========= Inline line editor ========= */
function LinesEditor({
  rows, onChange, searchProducts
}: {
  rows: { product?: Product|null; product_id?: number | ""; delta_qty?: number | ""; unit_cost?: number | ""; notes?: string }[];
  onChange: (r: any[]) => void;
  searchProducts: (term: string) => Promise<Product[]>;
}) {
  const [suggestions, setSuggestions] = useState<Record<number, Product[]>>({});

  function setRow(i: number, patch: Partial<any>) {
    const copy = rows.slice();
    copy[i] = { ...copy[i], ...patch };
    onChange(copy);
  }
  function addRow() { onChange([...rows, {}]); }
  function delRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }

  return (
    <div className="overflow-auto rounded-xl border">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <th className="text-left p-2">Product</th>
            <th className="text-left p-2">Δ Qty</th>
            <th className="text-left p-2">Unit Cost</th>
            <th className="text-left p-2">Notes</th>
            <th className="text-left p-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t align-top">
              <td className="p-2">
                <ProductPicker
                  value={r.product || null}
                  onChange={(p)=> setRow(i, { product: p, product_id: p?.id ?? "" })}
                  onSearch={async (term)=>{
                    const res = await searchProducts(term);
                    setSuggestions((s)=>({ ...s, [i]: res }));
                  }}
                  suggestions={suggestions[i] || []}
                />
                {/* Manual ID fallback */}
                {!r.product && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="opacity-70">or ID:</span>
                    <input
                      className="w-24 rounded-md px-2 py-1 border"
                      value={r.product_id ?? ""}
                      onChange={(e)=>setRow(i, { product_id: e.target.value === "" ? "" : Number(e.target.value) })}
                      placeholder="e.g. 9"
                    />
                  </div>
                )}
              </td>
              <td className="p-2">
                <input
                  type="number"
                  className="w-28 rounded-lg px-2 py-1 border"
                  value={r.delta_qty ?? ""}
                  onChange={(e)=> setRow(i, { delta_qty: e.target.value === "" ? "" : Number(e.target.value) })}
                  placeholder="+5 or -2"
                />
              </td>
              <td className="p-2">
                <input
                  type="number"
                  className="w-28 rounded-lg px-2 py-1 border"
                  value={r.unit_cost ?? ""}
                  onChange={(e)=> setRow(i, { unit_cost: e.target.value === "" ? "" : Number(e.target.value) })}
                  placeholder="optional"
                />
              </td>
              <td className="p-2">
                <input
                  className="w-64 rounded-lg px-2 py-1 border"
                  value={r.notes ?? ""}
                  onChange={(e)=> setRow(i, { notes: e.target.value })}
                  placeholder="optional"
                />
              </td>
              <td className="p-2">
                <button className="rounded-lg px-2 py-1 border" onClick={()=>delRow(i)}>🗑️</button>
              </td>
            </tr>
          ))}
          <tr>
            <td className="p-2" colSpan={5}>
              <button className="rounded-lg px-3 py-2 border" onClick={addRow}>➕ Add line</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ========= Product picker ========= */
function ProductPicker({
  value, onChange, onSearch, suggestions
}: {
  value: Product|null;
  onChange: (p: Product|null)=>void;
  onSearch: (term: string)=>void;
  suggestions: Product[];
}) {
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { if (term.trim()) onSearch(term.trim()); }, 250);
    return () => clearTimeout(t);
  }, [term, onSearch]);

  return (
    <div className="relative w-[340px]">
      <input
        className="w-full rounded-lg px-3 py-2 border"
        value={value ? `${value.name}${value.sku ? ` (${value.sku})`:""}` : term}
        onChange={(e)=>{ onChange(null); setTerm(e.target.value); }}
        placeholder="Search product by name or SKU"
      />
      {(!value && term.trim() && suggestions.length>0) && (
        <div className="absolute z-10 mt-1 max-h-64 overflow-auto w-full rounded-lg border bg-white dark:bg-gray-800 shadow">
          {suggestions.map((p)=>(
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={()=>{ onChange(p); setTerm(""); }}
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-xs opacity-70">SKU: {p.sku || "-"} • Stock: {p.stock_qty}</div>
            </button>
          ))}
        </div>
      )}
      {value && (
        <div className="mt-1 text-xs opacity-80">
          Selected: <span className="font-medium">{value.name}</span> (SKU: {value.sku || "-"}) • Stock: {value.stock_qty}
          <button className="ml-2 underline" onClick={()=>onChange(null)}>change</button>
        </div>
      )}
    </div>
  );
}
