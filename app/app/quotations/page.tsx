// app/quotations/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  quotation_number: string | null;
  quotation_date: string | null;
  valid_until: string | null;
  customer_name: string | null;
  total_amount: number | null;
  meta?: any;
};

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN") : "");
const fmtINR = (n: number) => {
  const parts = n.toFixed(2).split(".");
  let x = parts[0];
  const last3 = x.slice(-3);
  const other = x.slice(0, -3);
  if (other) x = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `INR (Rs/-) ${x}.${parts[1]}`;
};

async function fetchRows(q: string) {
  const url = new URL(`${process.env.NEXT_PUBLIC_BASE_URL}/api/quotations`);
  if (q) url.searchParams.set("q", q);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return { error: `Failed to load (status ${res.status})`, rows: [] as Row[] };
  const data = await res.json();
  return { rows: (data?.data as Row[]) ?? [], error: null as string | null };
}

export default async function Page({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams?.q ?? "").trim();
  const { rows, error } = await fetchRows(q);

  return (
    <div className="container">
      {/* Header / Actions */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Quotations</h1>
          <p className="muted text-sm">Search by customer name or quotation number</p>
        </div>
        <div className="no-print flex items-center gap-2">
          <Link href="/quotations/new" className="btn-primary px-3 py-2 rounded-2xl text-sm">
            + New Quotation
          </Link>
        </div>
      </div>

      {/* Search */}
      <form method="get" action="/quotations" className="no-print mb-3">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search (customer or number)…"
            className="w-[360px]"
          />
          <button className="btn-outline px-3 py-2 rounded-2xl">Search</button>
          {q && (
            <Link href="/quotations" className="glass-btn px-3 py-2 rounded-2xl">
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr className="text-left">
              <th className="w-40">Quotation #</th>
              <th>Date</th>
              <th>Valid Until</th>
              <th>Customer</th>
              <th className="w-48">Est. Amount</th>
              <th className="w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/quotations/${r.id}`} className="underline">
                    {r.quotation_number ?? `#${r.id}`}
                  </Link>
                </td>
                <td>{fmtDate(r.quotation_date)}</td>
                <td>{fmtDate(r.valid_until)}</td>
                <td>{r.customer_name ?? "-"}</td>
                <td>{fmtINR(Number(r.total_amount ?? 0))}</td>
                <td>
                  <div className="flex gap-2">
                    <Link href={`/quotations/${r.id}`} className="glass-btn px-2 py-1">
                      View
                    </Link>
                    <Link href={`/api/quotations/${r.id}/pdf`} className="glass-btn px-2 py-1">
                      PDF
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  {error ? (
                    <span className="text-red-600">{error}</span>
                  ) : q ? (
                    <span>No results for “{q}”.</span>
                  ) : (
                    <span>No quotations yet. Click “New Quotation”.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
