export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ItemsEditor from "../_components/ItemsEditor";
import { pool } from "@/lib/db";

/* ---------------------------------- utils --------------------------------- */

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

function isNextRedirectErr(err: unknown) {
  // When we redirect() in a server action, Next throws an internal NEXT_REDIRECT error.
  // We must rethrow it (not convert to user-visible text), otherwise you'll see
  // "?error=NEXT_REDIRECT" on the page.
  return String((err as any)?.message || "") === "NEXT_REDIRECT";
}

async function getProductCols(client: any): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='products'`
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

/**
 * Create products by IDs if they don't exist, using the typed label and price from the form.
 * Works with both "price" (compat schema) and "selling_price" (alt schema).
 * Tries to insert with explicit ID first (SERIAL allows it); if that fails, inserts without ID.
 */
async function createMissingProducts(missingIds: string[], items: any[]) {
  if (!missingIds.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cols = await getProductCols(client);
    const hasPrice = cols.has("price");
    const hasSelling = cols.has("selling_price");

    for (const id of missingIds) {
      const candidate = items.find((i) => String(i.product_id) === String(id)) ?? {};
      const typedName = (candidate.name || candidate.product_name || `Product ${id}`).toString().slice(0, 200);
      const priceNum = Number(candidate.mrp ?? candidate.cost_price ?? 0) || 0;

      const withId = async () => {
        if (hasPrice) {
          await client.query(
            `INSERT INTO products (id, name, price) VALUES ($1,$2,$3)
             ON CONFLICT (id) DO NOTHING`,
            [Number(id), typedName, priceNum]
          );
        } else if (hasSelling) {
          await client.query(
            `INSERT INTO products (id, name, selling_price, stock) VALUES ($1,$2,$3,0)
             ON CONFLICT (id) DO NOTHING`,
            [Number(id), typedName, priceNum]
          );
        } else {
          await client.query(
            `INSERT INTO products (id, name) VALUES ($1,$2)
             ON CONFLICT (id) DO NOTHING`,
            [Number(id), typedName]
          );
        }
      };

      const withoutId = async () => {
        if (hasPrice) {
          await client.query(`INSERT INTO products (name, price) VALUES ($1,$2)`, [typedName, priceNum]);
        } else if (hasSelling) {
          await client.query(`INSERT INTO products (name, selling_price, stock) VALUES ($1,$2,0)`, [typedName, priceNum]);
        } else {
          await client.query(`INSERT INTO products (name) VALUES ($1)`, [typedName]);
        }
      };

      try {
        await withId();
      } catch {
        await withoutId();
      }
    }

    await client.query("COMMIT");
  } catch {
    try { await client.query("ROLLBACK"); } catch {}
  } finally {
    client.release();
  }
}

/* ------------------------------- server action ----------------------------- */

async function createPurchase(formData: FormData) {
  "use server";
  const origin = getBaseUrl();

  const vendor_name   = String(formData.get("vendor_name") || "").trim();
  const invoice_no    = String(formData.get("invoice_no") || "").trim();
  const purchase_date = String(formData.get("purchase_date") || "").trim();
  const notes         = String(formData.get("notes") || "").trim();
  const paid          = formData.get("paid") === "1";
  const amount_paid   = Number(formData.get("amount_paid") || 0);
  const payment_method = String(formData.get("payment_method") || "").trim();
  const addFlag       = formData.get("add_to_inventory") === "1";
  const autoCreate    = formData.get("auto_create_products") === "1";

  if (!vendor_name) {
    redirect(`/inventory/purchases/new?error=${encodeURIComponent("Vendor name is required.")}`);
  }

  let items: any[] = [];
  try { items = JSON.parse(String(formData.get("items_json") || "[]")); } catch {}

  const normalized = (Array.isArray(items) ? items : [])
    .map((it) => ({
      product_id: String(it.product_id ?? "").trim(),
      name: (it.name ?? it.product_name ?? "").toString(),
      qty: Number(it.qty ?? 0),
      cost_price: it.cost_price ?? it.price ?? 0,
      mrp: it.mrp ?? null,
      tax_rate: it.tax_rate ?? 0,
      discount: it.discount ?? 0,
      batch_no: it.batch_no ?? it.batch_no_text ?? null,
      mfg_date: it.mfg_date ?? it.mfd_date ?? null,
      exp_date: it.exp_date ?? it.expiry_date ?? null,
    }))
    .filter((it: any) => it.product_id && it.qty > 0);

  if (normalized.length === 0) {
    redirect(`/inventory/purchases/new?error=${encodeURIComponent("Add at least one valid item (Product ID & Qty > 0).")}`);
  }

  const payload = {
    vendor_name,
    invoice_no,
    purchase_date: purchase_date || null,
    notes,
    paid,
    amount_paid,
    payment_method: payment_method || null,
    add_to_inventory: !!addFlag,
    items: normalized,
  };

  const tryPost = async () => {
    const res = await fetch(`${origin}/api/purchases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  try {
    let { res, data } = await tryPost();

    // Auto-create products (single retry) if the API says some product IDs are unknown
    if (!res.ok && data?.error && /Unknown product_id\(s\):/i.test(String(data.error)) && autoCreate) {
      const ids = String(data.error)
        .replace(/^.*Unknown product_id\(s\):\s*/i, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await createMissingProducts(ids, normalized);
      ({ res, data } = await tryPost());
    }

    if (!res.ok || !data?.ok) {
      const msg = data?.error || `Failed to save purchase`;
      redirect(`/inventory/purchases/new?error=${encodeURIComponent(msg)}`);
    }

    revalidatePath("/inventory/purchases");
    redirect(`/inventory/purchases/${String(data.purchase_id)}`);
  } catch (err: any) {
    if (isNextRedirectErr(err)) throw err; // allow Next to complete the redirect
    const msg = err?.message || String(err);
    redirect(`/inventory/purchases/new?error=${encodeURIComponent(msg)}`);
  }
}

/* ---------------------------------- page ---------------------------------- */

export default async function NewPurchasePage({ searchParams }: { searchParams?: Record<string, string> }) {
  const error = searchParams?.error ? decodeURIComponent(searchParams.error) : "";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New Purchase</h1>
          <p className="text-sm text-[color:var(--muted)]">Create a purchase; optionally post it to inventory.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/purchases" className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">Back to Purchases</Link>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div> : null}

      <div className="card p-4 text-sm">
        <div className="font-medium">Tips for faster purchase entry</div>
        <ul className="mt-2 list-disc pl-5 text-[color:var(--muted)]">
          <li>Use the <b>Import CSV</b> button inside the item table to paste or upload rows.</li>
          <li>Enable <b>Create missing products automatically</b> to avoid rejections for new items.</li>
          <li>Use <b>Directly add to inventory</b> only if quantities should update stock immediately.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] p-4 md:p-6">
        <form action={createPurchase} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Vendor Name <span className="text-red-600">*</span></span>
              <input name="vendor_name" required className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10" placeholder="e.g., Akbar Traders" />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Invoice No</span>
              <input name="invoice_no" className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10" placeholder="e.g., P-0241" />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Purchase Date</span>
              <input type="date" name="purchase_date" className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10" />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Amount Paid</span>
              <input
                name="amount_paid"
                type="number"
                step="0.01"
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Payment Method</span>
              <select
                name="payment_method"
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              >
                <option value="">Select</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="split">Split</option>
              </select>
            </label>
            <label className="text-sm inline-flex items-center gap-2 mt-6">
              <input type="checkbox" name="paid" value="1" className="size-4 rounded border-black/20" />
              <span>Paid</span>
            </label>
          </div>

          <div>
            <label className="text-sm block">
              <span className="block mb-1 text-[color:var(--muted)]">Notes</span>
              <textarea name="notes" rows={3} className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10" placeholder="Optional notes about this purchase..." />
            </label>
          </div>

          <ItemsEditor name="items_json" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="add_to_inventory" value="1" className="size-4 rounded border-black/20" />
                <span>Directly add these quantities to inventory now</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="auto_create_products" value="1" className="size-4 rounded border-black/20" />
                <span>Create missing products automatically</span>
              </label>
            </div>
            <button type="button" disabled className="px-3 py-2 rounded-2xl border border-black/10 bg-gray-100 text-gray-400 cursor-not-allowed">
              Print / PDF (after save)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className="px-3 py-2 rounded-2xl shadow-sm border border-black/5 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)] transition">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
