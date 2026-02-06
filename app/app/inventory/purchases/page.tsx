export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import Link from "next/link";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}
function formatINR(n: unknown) {
  const num = typeof n === "number" ? n : Number(n ?? 0);
  if (!isFinite(num)) return "INR (Rs/-) 0.00";
  return `INR (Rs/-) ${num.toFixed(2)}`;
}

interface PurchaseRow {
  id?: string | number;
  purchase_id?: string | number;
  invoice_no?: string | null;
  bill_no?: string | null;
  vendor_name?: string | null;
  supplier_name?: string | null;
  purchase_date?: string | null;
  invoice_date?: string | null;
  created_at?: string | null;
  items_count?: number | null;
  total_amount?: number | null;
  grand_total?: number | null;
  amount_paid?: number | string | null;
  pending_amount?: number | string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  status?: string | null;
  meta?: any;
  [key: string]: any;
}

async function fetchPurchases(q: string, page: number, pageSize: number) {
  const origin = getBaseUrl();
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (q) params.set("q", q);
  const res = await fetch(`${origin}/api/purchases?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return { rows: [], total: 0 };
  const data = await res.json().catch(() => ({} as any));
  if (data?.rows && Number.isFinite(data?.total)) return { rows: data.rows as PurchaseRow[], total: Number(data.total) };
  // backward compat
  if (Array.isArray(data)) return { rows: data as PurchaseRow[], total: (data as any[]).length };
  if (Array.isArray(data?.data)) return { rows: data.data as PurchaseRow[], total: (data.data as any[]).length };
  return { rows: [], total: 0 };
}

export default async function PurchasesPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const q = (searchParams?.q ?? "").trim();
  const page = Math.max(1, Number(searchParams?.page ?? 1));
  const pageSize = 10;

  const { rows, total } = await fetchPurchases(q, page, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const makeHref = (nextPage: number, nextQ = q) => {
    const u = new URLSearchParams();
    if (nextQ) u.set("q", nextQ);
    u.set("page", String(nextPage));
    return `/inventory/purchases?${u.toString()}`;
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchases</h1>
          <p className="text-sm text-[color:var(--muted)]">View purchase bills and incoming stock</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/inventory/purchases/new" className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">
            New Purchase
          </Link>
        </div>
      </div>

      {/* Search */}
      <form className="flex gap-2" action="/inventory/purchases" method="GET">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by invoice no or id…"
          className="w-full max-w-md rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
        />
        <input type="hidden" name="page" value="1" />
        <button className="px-3 py-2 rounded-2xl border border-black/10 bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-black/5 bg-[color:var(--surface-1)] p-6 text-sm">
          <p className="mb-1 font-medium">No purchases found</p>
          <p className="text-[color:var(--muted)]">Create your first purchase to see it here.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-black/5 bg-[color:var(--surface-1)]">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[color:var(--muted)]">
                <tr className="border-b border-black/5">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Bill No</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const id = String(r.id ?? r.purchase_id ?? idx);
                  const date = r.invoice_date || r.purchase_date || r.created_at || "";
                  const vendor = r.vendor_name || r.supplier_name || r?.meta?.vendor_name || "-";
                  const bill = r.invoice_no || r.bill_no || "-";
                  const totalAmt = r.total_amount ?? r.grand_total ?? 0;
                  const status = r.status || (r?.meta?.posted ? "applied" : "draft");
                  const paidAmt = Number(r.amount_paid ?? r.meta?.amount_paid ?? 0);
                  const pending = Number(r.pending_amount ?? Math.max(Number(totalAmt || 0) - paidAmt, 0));
                  const payStatus = r.payment_status || (pending <= 0 ? "Paid" : paidAmt > 0 ? "Partial" : "Pending");
                  return (
                    <tr key={id} className="border-b border-black/5 hover:bg-black/5/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/inventory/purchases/${id}`} className="underline decoration-dotted">
                          {date ? new Date(date).toLocaleDateString("en-IN") : "-"}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{vendor}</td>
                      <td className="px-4 py-3">{bill}</td>
                      <td className="px-4 py-3 font-medium">{formatINR(totalAmt)}</td>
                      <td className="px-4 py-3 font-medium">{formatINR(pending)}</td>
                      <td className="px-4 py-3">{payStatus} · {status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pager */}
          <div className="flex items-center justify-between text-sm">
            <div className="text-[color:var(--muted)]">
              Showing {(page - 1) * 10 + 1}–{(page - 1) * 10 + rows.length} of {total}
            </div>
            <div className="flex gap-2">
              <Link
                href={makeHref(Math.max(1, page - 1))}
                className={`px-3 py-2 rounded-2xl border border-black/10 ${page <= 1 ? "pointer-events-none opacity-50" : "bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]"}`}
              >
                Prev
              </Link>
              <Link
                href={makeHref(Math.min(totalPages, page + 1))}
                className={`px-3 py-2 rounded-2xl border border-black/10 ${page >= totalPages ? "pointer-events-none opacity-50" : "bg-[color:var(--surface-1)] hover:bg-[color:var(--surface-2)]"}`}
              >
                Next
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
