export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import ItemsEditor from "../../_components/ItemsEditor";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

function isNextRedirectErr(err: unknown) {
  const msg = String((err as any)?.message || err || "");
  return msg === "NEXT_REDIRECT";
}

async function fetchPurchase(id: string) {
  const res = await fetch(`${getBaseUrl()}/api/purchases/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function patchPurchase(formData: FormData) {
  "use server";
  const origin = getBaseUrl();
  const id = String(formData.get("id") || "");
  if (!id) redirect("/inventory/purchases?error=Missing+purchase+id");

  const vendor_name  = String(formData.get("vendor_name") || "").trim();
  const invoice_no   = String(formData.get("invoice_no") || "").trim();
  const invoice_date = String(formData.get("invoice_date") || "").trim();
  const notes        = String(formData.get("notes") || "").trim();
  const paid         = formData.get("paid") === "1";
  const amount_paid  = Number(formData.get("amount_paid") || 0);
  const payment_method = String(formData.get("payment_method") || "").trim();

  let items: any[] = [];
  try { items = JSON.parse(String(formData.get("items_json") || "[]")); } catch {}
  const normalized = (Array.isArray(items) ? items : [])
    .map((it) => ({
      product_id: String(it.product_id ?? "").trim(),
      qty: Number(it.qty ?? 0),
      cost_price: it.cost_price ?? it.price ?? 0,
      mrp: it.mrp ?? null,
      tax_rate: it.tax_rate ?? 0,
      discount: it.discount ?? 0,
      batch_no: it.batch_no ?? it.batch_no_text ?? null,
      mfg_date: it.mfg_date ?? it.mfd_date ?? null,
      exp_date: it.exp_date ?? it.expiry_date ?? null,
      meta: it.meta ?? {},
    }))
    .filter((it: any) => it.product_id && it.qty > 0);

  try {
        const res = await fetch(`${origin}/api/purchases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoice_no: invoice_no || null,
        invoice_date: invoice_date || null,
        amount_paid,
        payment_method: payment_method || null,
        meta: { vendor_name, notes, paid, amount_paid, payment_method: payment_method || null },
        items: normalized,
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      redirect(`/inventory/purchases/${id}/edit?error=${encodeURIComponent(data?.error || "Failed to save changes")}`);
    }

    revalidatePath(`/inventory/purchases/${id}`);
    revalidatePath(`/inventory/purchases`);
    redirect(`/inventory/purchases/${id}`);
  } catch (err) {
    if (isNextRedirectErr(err)) throw err;
    redirect(`/inventory/purchases/${id}/edit?error=${encodeURIComponent(String((err as any)?.message || err))}`);
  }
}

export default async function EditPurchasePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string>;
}) {
  const id = params.id;
  const resp = await fetchPurchase(id);
  const error = searchParams?.error ? decodeURIComponent(searchParams.error) : "";

  if (!resp?.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-[color:var(--muted)]">Purchase not found.</p>
        <Link href="/inventory/purchases" className="underline">Back to list</Link>
      </div>
    );
  }

  const p = resp.purchase;
  const items = resp.items || [];
  const meta = p?.meta || {};
  const vendor = meta.vendor_name || "";
  const paid = !!meta.paid;
  const notes = meta.notes || "";
  const amountPaid = Number(p.amount_paid ?? meta.amount_paid ?? 0);
  const paymentMethod = p.payment_method ?? meta.payment_method ?? "";
  const invDate =
    p.invoice_date ? String(p.invoice_date).slice(0, 10) : "";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit Purchase #{String(p.id)}
        </h1>
        <Link
          href={`/inventory/purchases/${p.id}`}
          className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]"
        >
          Back to Detail
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] p-4 md:p-6">
        <form action={patchPurchase} className="space-y-6">
          <input type="hidden" name="id" value={String(p.id)} />

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Vendor Name</span>
              <input
                name="vendor_name"
                defaultValue={vendor}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Invoice No</span>
              <input
                name="invoice_no"
                defaultValue={p.invoice_no ?? ""}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Invoice Date</span>
              <input
                type="date"
                name="invoice_date"
                defaultValue={invDate}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Amount Paid</span>
              <input
                name="amount_paid"
                type="number"
                step="0.01"
                defaultValue={amountPaid}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-[color:var(--muted)]">Payment Method</span>
              <select
                name="payment_method"
                defaultValue={paymentMethod}
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
              <input
                type="checkbox"
                name="paid"
                value="1"
                defaultChecked={paid}
                className="size-4 rounded border-black/20"
              />
              <span>Paid</span>
            </label>
          </div>

          <div>
            <label className="text-sm block">
              <span className="block mb-1 text-[color:var(--muted)]">Notes</span>
              <textarea
                name="notes"
                defaultValue={notes}
                rows={3}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              />
            </label>
          </div>

          <ItemsEditor name="items_json" defaultItems={items} />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-3 py-2 rounded-2xl shadow-sm border border-black/5 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)] transition"
            >
              Save Changes
            </button>
            <Link
              href={`/inventory/purchases/${p.id}`}
              className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
