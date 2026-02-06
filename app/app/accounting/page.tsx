export const dynamic = "force-dynamic";
export const revalidate = 0;

import { headers } from "next/headers";

function buildBaseUrl() {
  const hdrs = headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (!host) return "";
  return `${proto}://${host}`;
}

function inr(n: number) {
  const amt = (Number(n || 0)).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `INR (Rs/-) ${amt}`;
}

export default async function AccountingPage({ searchParams }: { searchParams?: { q?: string; focus?: string } }) {
  const q = (searchParams?.q || "").trim().toLowerCase();
  const focus = (searchParams?.focus || "").trim().toLowerCase();
  const res = await fetch(`${buildBaseUrl()}/api/accounting/debts`, { cache: "no-store" });
  const data = res.ok ? await res.json() : { ok: false, vendors: [], summary: {}, aging: {} };

  const vendors = Array.isArray(data?.vendors) ? data.vendors : [];
  const filtered = q ? vendors.filter((v: any) => String(v.vendor_name || "").toLowerCase().includes(q)) : vendors;

  const summary = data?.summary || { receivables: 0, payables: 0, net: 0 };
  const aging = data?.aging || { bucket_0_30: 0, bucket_31_60: 0, bucket_60_plus: 0 };
  const customers = Array.isArray(data?.customers) ? data.customers : [];
  const customerAging = data?.customer_aging || { bucket_0_30: 0, bucket_31_60: 0, bucket_60_plus: 0 };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
          <p className="text-sm text-[color:var(--muted)]">Debt management and key balances</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[color:var(--muted)]">Receivables</div>
          <div className="text-xl font-semibold mt-1">{inr(summary.receivables || 0)}</div>
          <div className="text-xs text-[color:var(--muted)]">Unpaid by customers</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[color:var(--muted)]">Payables</div>
          <div className="text-xl font-semibold mt-1">{inr(summary.payables || 0)}</div>
          <div className="text-xs text-[color:var(--muted)]">Outstanding to vendors</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[color:var(--muted)]">Net</div>
          <div className="text-xl font-semibold mt-1">{inr(summary.net || 0)}</div>
          <div className="text-xs text-[color:var(--muted)]">Receivables − Payables</div>
        </div>
      </div>

      {/* Vendor Aging */}
      <div className="card p-4">
        <div className="text-sm font-semibold mb-2">Vendor Payables Aging</div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>0–30 days</span>
            <b>{inr(aging.bucket_0_30 || 0)}</b>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>31–60 days</span>
            <b>{inr(aging.bucket_31_60 || 0)}</b>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>60+ days</span>
            <b>{inr(aging.bucket_60_plus || 0)}</b>
          </div>
        </div>
      </div>

      {/* Customer Aging */}
      <div className="card p-4">
        <div className="text-sm font-semibold mb-2">Customer Receivables Aging</div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>0–30 days</span>
            <b>{inr(customerAging.bucket_0_30 || 0)}</b>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>31–60 days</span>
            <b>{inr(customerAging.bucket_31_60 || 0)}</b>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--glass-brd)] px-3 py-2">
            <span>60+ days</span>
            <b>{inr(customerAging.bucket_60_plus || 0)}</b>
          </div>
        </div>
      </div>

      {/* Search */}
      <form className="flex gap-2" action="/accounting" method="GET">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search vendor…"
          className="input w-full max-w-md"
        />
        <button className="btn-outline px-3 py-2">Search</button>
        {q && <a className="glass-btn px-3 py-2 rounded-2xl" href="/accounting">Clear</a>}
      </form>

      {/* Vendor Debt table */}
      <div
        id="debts"
        className={`card p-4 ${focus === "debts" ? "ring-2 ring-[color:var(--primary)] ring-offset-2 ring-offset-[color:var(--bg)]" : ""}`}
      >
        <div className="text-sm font-semibold mb-2">Vendor Debt (Purchases)</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Outstanding</th>
                <th>Last Transaction</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v: any) => (
                <tr key={v.vendor_key}>
                  <td>{v.vendor_name}</td>
                  <td><b>{inr(v.outstanding || 0)}</b></td>
                  <td>{v.last_tx ? new Date(v.last_tx).toLocaleDateString("en-IN") : "-"}</td>
                  <td>{v.status}</td>
                  <td>
                    <details>
                      <summary className="cursor-pointer text-sm">Recent bills</summary>
                      <div className="mt-2 text-xs space-y-1">
                        {(v.recent || []).length === 0 && <div className="muted">No recent bills</div>}
                        {(v.recent || []).map((r: any) => (
                          <div key={r.id}>
                            #{r.id}{r.bill_no ? ` • ${r.bill_no}` : ""} — {r.bill_date ? new Date(r.bill_date).toLocaleDateString("en-IN") : "-"} • Pending {inr(r.pending || 0)}
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6" style={{ color: "var(--muted)" }}>
                    No vendor debts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Debt table */}
      <div
        id="customer-debts"
        className={`card p-4 ${focus === "customers" ? "ring-2 ring-[color:var(--primary)] ring-offset-2 ring-offset-[color:var(--bg)]" : ""}`}
      >
        <div className="text-sm font-semibold mb-2">Customer Debt (Invoices)</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Outstanding</th>
                <th>Last Invoice</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((v: any) => (
                <tr key={v.customer_key}>
                  <td>{v.customer_name}</td>
                  <td><b>{inr(v.outstanding || 0)}</b></td>
                  <td>{v.last_tx ? new Date(v.last_tx).toLocaleDateString("en-IN") : "-"}</td>
                  <td>{v.status}</td>
                  <td>
                    <details>
                      <summary className="cursor-pointer text-sm">Recent invoices</summary>
                      <div className="mt-2 text-xs space-y-1">
                        {(v.recent || []).length === 0 && <div className="muted">No recent invoices</div>}
                        {(v.recent || []).map((r: any) => (
                          <div key={r.id}>
                            #{r.id}{r.invoice_no ? ` • ${r.invoice_no}` : ""} — {r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("en-IN") : "-"} • Pending {inr(r.pending || 0)}
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6" style={{ color: "var(--muted)" }}>
                    No customer debts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
