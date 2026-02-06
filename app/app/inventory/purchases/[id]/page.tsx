export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

async function getPurchase(id: string) {
  const res = await fetch(`${getBaseUrl()}/api/purchases/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function deletePurchaseAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  await fetch(`${getBaseUrl()}/api/purchases/${id}`, { method: "DELETE", cache: "no-store" });
  revalidatePath("/inventory/purchases");
  redirect("/inventory/purchases");
}

const asINR = (n: any) => `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;

export default async function PurchaseDetailPage({ params }: { params: { id: string } }) {
  const data = await getPurchase(params.id);
  if (!data?.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-[color:var(--muted)]">Purchase not found.</p>
        <Link href="/inventory/purchases" className="underline">Back to list</Link>
      </div>
    );
  }

  const p = data.purchase;
  const items = data.items || [];
  const meta = p?.meta || {};
  const vendor = meta.vendor_name || "-";
  const paidAmt = Number(p.amount_paid ?? meta.amount_paid ?? 0);
  const totalAmt = Number(p.total_amount || meta?.totals?.total_amount || 0);
  const pendingAmt = Number(p.pending_amount ?? Math.max(totalAmt - paidAmt, 0));
  const payStatus = p.payment_status || (pendingAmt <= 0 ? "Paid" : paidAmt > 0 ? "Partial" : "Pending");
  const notes = meta.notes || "-";
  const date = p.invoice_date || p.created_at || "";
  const total = totalAmt;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase #{String(p.id)}</h1>
          <p className="text-sm text-[color:var(--muted)]">
            Vendor: <b>{vendor}</b> · {payStatus} · Date: {date ? new Date(date).toLocaleDateString("en-IN") : "-"} · Total: <b>{asINR(total)}</b> · Outstanding: <b>{asINR(pendingAmt)}</b>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/purchases" className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">Back</Link>
          <Link href={`/inventory/purchases/${p.id}/edit`} className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">Edit</Link>
          <a href={`/api/purchases/${p.id}/pdf`} target="_blank" className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">
            Print / PDF
          </a>
          <form action={deletePurchaseAction}>
            <input type="hidden" name="id" value={String(p.id)} />
            <button className="px-3 py-2 rounded-2xl border border-red-300 bg-red-50 hover:bg-red-100 text-red-700">Delete</button>
          </form>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-[color:var(--muted)]">
            <tr className="border-b border-black/5">
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">MRP</th>
              <th className="px-4 py-3">Tax%</th>
              <th className="px-4 py-3">Discount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any) => (
              <tr key={it.id} className="border-b border-black/5">
                <td className="px-4 py-3">{it.product_label ?? it.product_id}</td>
                <td className="px-4 py-3">{it.qty}</td>
                <td className="px-4 py-3">{asINR(it.cost_price)}</td>
                <td className="px-4 py-3">{it.mrp ?? "-"}</td>
                <td className="px-4 py-3">{it.tax_rate ?? 0}</td>
                <td className="px-4 py-3">{it.discount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] p-4">
        <p className="text-sm text-[color:var(--muted)] mb-1">Notes</p>
        <p className="text-sm whitespace-pre-wrap">{notes}</p>
      </div>
    </div>
  );
}
