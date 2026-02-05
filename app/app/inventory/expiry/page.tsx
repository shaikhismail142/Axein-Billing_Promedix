// app/inventory/expiry/page.tsx
// AxEin Billing — Expiry Page (server component)

import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return d || "—";
  }
}

function Pill({ text, kind }: { text: string; kind: "warn" | "danger" | "muted" }) {
  const cls =
    kind === "danger"
      ? "bg-red-100 text-red-700"
      : kind === "warn"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{text}</span>;
}

export default async function ExpiryPage() {
  // Build absolute origin for server-side fetch (fixes ERR_INVALID_URL)
  const h = headers();
  const xfProto = h.get("x-forwarded-proto");
  const xfHost = h.get("x-forwarded-host");
  const origin = xfHost
    ? `${xfProto || "http"}://${xfHost}`
    : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const res = await fetch(`${origin}/api/expiry`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch expiry data");
  const data = await res.json();

  const nearDays: number = data?.near_expiry_days ?? 30;
  const near = (data?.near_expiry ?? []) as any[];
  const expired = (data?.expired ?? []) as any[];

  const Table = ({ rows, mode }: { rows: any[]; mode: "near" | "expired" }) => (
    <div className="overflow-auto rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50/60 dark:bg-slate-900/40 sticky top-0 backdrop-blur">
          <tr>
            <th className="text-left p-3">Product</th>
            <th className="text-left p-3">Batch</th>
            <th className="text-left p-3">Mfg</th>
            <th className="text-left p-3">Expiry</th>
            <th className="text-right p-3">Qty</th>
            <th className="text-right p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-6 text-center opacity-60">
                No batches.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.batch_id}
                className="border-t border-slate-100/60 dark:border-slate-800/60 hover:bg-slate-50/40 dark:hover:bg-slate-900/40"
              >
                <td className="p-3">
                  <div className="font-medium">{r.product_name}</div>
                  <div className="text-xs opacity-70">ID: {r.product_id}</div>
                </td>
                <td className="p-3">{r.batch_no || "—"}</td>
                <td className="p-3">{fmtDate(r.mfg_date)}</td>
                <td className="p-3">{fmtDate(r.expiry_date)}</td>
                <td className="p-3 text-right">{r.qty}</td>
                <td className="p-3 text-right">
                  {mode === "expired" ? (
                    <Pill text={`Expired ${Math.abs(r.days_until)}d`} kind="danger" />
                  ) : (
                    <Pill text={`${r.days_until}d left`} kind={r.days_until <= 7 ? "danger" : "warn"} />
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold">Expiry</h1>
        <div className="text-sm opacity-80">
          Near-expiry window: <b>{nearDays}</b> days
        </div>
      </div>

      <div className="space-y-2" id="near">
        <h2 className="text-base font-medium opacity-80">Near Expiry (≤ {nearDays} days)</h2>
        <Table rows={near} mode="near" />
      </div>

      <div className="space-y-2" id="expired">
        <h2 className="text-base font-medium opacity-80">Expired</h2>
        <Table rows={expired} mode="expired" />
      </div>
    </div>
  );
}
