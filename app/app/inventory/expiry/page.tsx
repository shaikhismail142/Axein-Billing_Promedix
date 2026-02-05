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

export default async function ExpiryPage({
  searchParams,
}: {
  searchParams?: { q?: string; nearPage?: string; expiredPage?: string };
}) {
  const q = (searchParams?.q || "").trim();
  const nearPage = Math.max(1, Number(searchParams?.nearPage || 1));
  const expiredPage = Math.max(1, Number(searchParams?.expiredPage || 1));
  const perPage = 20;

  // Build absolute origin for server-side fetch (fixes ERR_INVALID_URL)
  const h = headers();
  const xfProto = h.get("x-forwarded-proto");
  const xfHost = h.get("x-forwarded-host");
  const origin = xfHost
    ? `${xfProto || "http"}://${xfHost}`
    : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  const res = await fetch(`${origin}/api/expiry?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch expiry data");
  const data = await res.json();

  const nearDays: number = data?.near_expiry_days ?? 30;
  const nearAll = (data?.near_expiry ?? []) as any[];
  const expiredAll = (data?.expired ?? []) as any[];

  const nearTotalPages = Math.max(1, Math.ceil(nearAll.length / perPage));
  const expiredTotalPages = Math.max(1, Math.ceil(expiredAll.length / perPage));
  const nearPageClamped = Math.min(nearPage, nearTotalPages);
  const expiredPageClamped = Math.min(expiredPage, expiredTotalPages);

  const near = nearAll.slice((nearPageClamped - 1) * perPage, nearPageClamped * perPage);
  const expired = expiredAll.slice((expiredPageClamped - 1) * perPage, expiredPageClamped * perPage);

  const buildLink = (nextNear: number, nextExpired: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (nextNear > 1) sp.set("nearPage", String(nextNear));
    if (nextExpired > 1) sp.set("expiredPage", String(nextExpired));
    return `/inventory/expiry?${sp.toString()}`;
  };

  const Table = ({ rows, mode }: { rows: any[]; mode: "near" | "expired" }) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="text-left">Product</th>
            <th className="text-left">Batch</th>
            <th className="text-left">Mfg</th>
            <th className="text-left">Expiry</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-6 text-center" style={{ color: "var(--muted)" }}>
                No items.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.row_id || r.batch_id || r.product_id}
                className="border-t"
              >
                <td>
                  <div className="font-medium">{r.product_name}</div>
                  <div className="text-xs opacity-70">ID: {r.product_id}</div>
                </td>
                <td>{r.batch_no || "—"}</td>
                <td>{fmtDate(r.mfg_date)}</td>
                <td>{fmtDate(r.expiry_date)}</td>
                <td className="text-right">{r.qty}</td>
                <td className="text-right">
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
      <div className="card" style={{ padding: 16 }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Expiry</h1>
            <div className="text-sm opacity-80">
              Near-expiry window: <b>{nearDays}</b> days
            </div>
          </div>
        </div>

        <form method="get" action="/inventory/expiry" className="mt-3 no-print">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-xs">Search</label>
              <input
                name="q"
                defaultValue={q}
                placeholder="Search product or batch…"
                className="input"
              />
            </div>
            <button className="px-3 py-2 rounded-xl border">Search</button>
            {q && (
              <a className="glass-btn px-3 py-2 rounded-2xl" href="/inventory/expiry">
                Clear
              </a>
            )}
          </div>
        </form>
      </div>

      <div className="space-y-2" id="near">
        <h2 className="text-base font-medium opacity-80">Near Expiry (≤ {nearDays} days)</h2>
        <Table rows={near} mode="near" />
        <div className="mt-2 flex items-center justify-between text-sm">
          <div className="muted">
            Page {nearPageClamped} of {nearTotalPages} • {nearAll.length} results
          </div>
          <div className="flex items-center gap-2">
            <a
              className={`px-3 py-2 rounded-xl border ${nearPageClamped <= 1 ? "pointer-events-none opacity-50" : ""}`}
              href={buildLink(nearPageClamped - 1, expiredPageClamped)}
            >
              Prev
            </a>
            <a
              className={`px-3 py-2 rounded-xl border ${nearPageClamped >= nearTotalPages ? "pointer-events-none opacity-50" : ""}`}
              href={buildLink(nearPageClamped + 1, expiredPageClamped)}
            >
              Next
            </a>
          </div>
        </div>
      </div>

      <div className="space-y-2" id="expired">
        <h2 className="text-base font-medium opacity-80">Expired</h2>
        <Table rows={expired} mode="expired" />
        <div className="mt-2 flex items-center justify-between text-sm">
          <div className="muted">
            Page {expiredPageClamped} of {expiredTotalPages} • {expiredAll.length} results
          </div>
          <div className="flex items-center gap-2">
            <a
              className={`px-3 py-2 rounded-xl border ${expiredPageClamped <= 1 ? "pointer-events-none opacity-50" : ""}`}
              href={buildLink(nearPageClamped, expiredPageClamped - 1)}
            >
              Prev
            </a>
            <a
              className={`px-3 py-2 rounded-xl border ${expiredPageClamped >= expiredTotalPages ? "pointer-events-none opacity-50" : ""}`}
              href={buildLink(nearPageClamped, expiredPageClamped + 1)}
            >
              Next
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
