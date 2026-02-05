// app/invoices/[id]/InvoiceActions.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function InvoiceActions({
  id,
  isReturn,
  total,
  amountPaid,
}: {
  id: number;
  isReturn?: boolean;
  total?: number | string;
  amountPaid?: number | string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const totalNum = Number(total || 0);
  const paidNum = Number(amountPaid || 0);
  const isPaid = paidNum >= totalNum - 0.01;

  async function patch(body: any) {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Failed");
      }
      router.refresh();
    } catch (e) {
      alert((e as Error).message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2 no-print" style={{ marginBottom: 12 }}>
      <Link href={`/invoices/${id}/edit`} prefetch>
        <button className="border px-3 py-1 rounded" disabled={busy}>Edit</button>
      </Link>

      {!isPaid ? (
        <button className="border px-3 py-1 rounded" disabled={busy} onClick={() => patch({ amount_paid: totalNum })}>
          Mark as Paid
        </button>
      ) : (
        <button className="border px-3 py-1 rounded" disabled={busy} onClick={() => patch({ amount_paid: 0 })}>
          Mark as Unpaid
        </button>
      )}

      <button className="border px-3 py-1 rounded" disabled={busy} onClick={() => patch({ is_return: !isReturn })}>
        {isReturn ? "Unmark Return" : "Mark as Return"}
      </button>

      <Link href={`/invoices/${id}/print`} target="_blank" rel="noopener noreferrer">
        <button className="border px-3 py-1 rounded" disabled={busy}>Print</button>
      </Link>

      <details className="border rounded">
        <summary className="px-3 py-1 cursor-pointer select-none">More</summary>
        <div className="p-2 flex flex-col gap-2">
          <button className="border px-3 py-1 rounded" onClick={async () => {
            const n = window.prompt("Add / update note for this invoice:");
            if (n !== null) await patch({ notes: n });
          }} disabled={busy}>
            Add/Update Note
          </button>
          <button className="border px-3 py-1 rounded" onClick={async () => {
            try { await navigator.clipboard.writeText(`${window.location.origin}/invoices/${id}`); alert("Link copied"); }
            catch { alert("Copy failed. Use address bar."); }
          }} disabled={busy}>
            Copy Share Link
          </button>
        </div>
      </details>
    </div>
  );
}
