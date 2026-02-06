export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import Link from "next/link";
import { headers } from "next/headers";
import { SelectionProvider } from "./_components/selection";
import { MasterCheckbox, RowCheckbox } from "./_components/checks";
import BulkTray from "./_components/BulkTray";
import { ensureActivated } from "@/app/lib/activation-guard";

/* ---------- Types ---------- */
type Invoice = {
  id: number;
  invoice_no: string;
  created_at: string;       // ISO
  total: number;
  pending_amount: number;
  payment_status?: string | null;
  customer_name: string | null;
};
type ApiResp = {
  items: Invoice[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};
type PageParams = {
  [k: string]: string | string[] | undefined;
  page?: string;
  perPage?: string;
  q?: string;
  sort?: "date" | "invoice" | "customer" | "total";
  dir?: "asc" | "desc";
  from?: string;
  to?: string;
  customerId?: string;
};

/* ---------- Helpers ---------- */
const fmtINR = (n: number) => `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;
function buildBaseUrl() {
  const hdrs = headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (!host) return "";
  return `${proto}://${host}`;
}
function nextDir(d: "asc" | "desc") { return d === "asc" ? "desc" : "asc"; }

/* ---------- Data fetch ---------- */
async function fetchInvoices(sp: PageParams): Promise<ApiResp> {
  const page = String(Math.max(1, Number(sp.page ?? 1)));
  const perPage = String(Math.min(200, Math.max(1, Number(sp.perPage ?? 20))));
  const qs = new URLSearchParams({ page, perPage });

  if (sp.q) qs.set("q", String(sp.q));
  if (sp.sort) qs.set("sort", String(sp.sort));
  if (sp.dir) qs.set("dir", String(sp.dir));
  if (sp.from) qs.set("from", String(sp.from));
  if (sp.to) qs.set("to", String(sp.to));
  if (sp.customerId) qs.set("customerId", String(sp.customerId));

  const res = await fetch(`${buildBaseUrl()}/api/invoices?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Invoices API failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

/* ---------- Small server subcomponents ---------- */
function Th({label, href, active, dir}:{label:string; href:string; active:boolean; dir:"asc"|"desc"}) {
  return (
    <th className="px-3 py-2 text-left">
      <Link href={href} className={`inline-flex items-center gap-1 ${active ? "font-semibold" : ""}`}>
        {label}
        {active && <span className="text-xs" style={{opacity:.7}}>{dir==="asc"?"▲":"▼"}</span>}
      </Link>
    </th>
  );
}
function PerPage({ qs, value }:{ qs:URLSearchParams; value:number }) {
  const mk=(n:number)=>{ const sp=new URLSearchParams(qs.toString()); sp.set("perPage",String(n)); sp.set("page","1"); return `/invoices?${sp.toString()}`; };
  const Btn = ({n}:{n:20|50|100}) => (
    <Link
      href={mk(n)}
      className="px-2 py-1 rounded-lg"
      style={{
        border: '1px solid var(--glass-brd)',
        background: value===n ? 'color-mix(in oklab, var(--bg) 75%, var(--text) 10%)' : 'transparent',
        color: 'var(--text)'
      }}
    >
      {n}
    </Link>
  );
  return (
    <div className="hidden sm:inline-flex items-center gap-1 text-sm">
      <span className="muted">Show</span>
      <Btn n={20} /><Btn n={50} /><Btn n={100} />
    </div>
  );
}

/* ---------- Page ---------- */
export default async function InvoicesPage({ searchParams }: { searchParams: PageParams }) {
  await ensureActivated(true);

  const q = typeof searchParams.q === "string" ? searchParams.q : "";
  const sort = (searchParams.sort as "date" | "invoice" | "customer" | "total") || "date";
  const dir  = (searchParams.dir as "asc" | "desc") || "desc";
  const from = typeof searchParams.from === "string" ? searchParams.from : "";
  const to   = typeof searchParams.to === "string" ? searchParams.to : "";

  let data: ApiResp | null = null;
  let errorMsg = "";
  try { data = await fetchInvoices(searchParams); }
  catch (e: any) { errorMsg = e?.message ?? "Failed to fetch invoices"; }

  const items = data?.items ?? [];
  const page = data?.page ?? 1;
  const perPage = data?.perPage ?? 20;
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  // base QS for links
  const baseQS = new URLSearchParams();
  baseQS.set("perPage", String(perPage));
  baseQS.set("sort", sort);
  baseQS.set("dir", dir);
  if (q) baseQS.set("q", q);
  if (from) baseQS.set("from", from);
  if (to) baseQS.set("to", to);

  const makeURL = (p: number) => {
    const sp = new URLSearchParams(baseQS.toString());
    sp.set("page", String(p));
    return `/invoices?${sp.toString()}`;
  };
  const sortHref = (key: "date" | "invoice" | "customer" | "total") => {
    const sp = new URLSearchParams(baseQS.toString());
    if (sort === key) sp.set("dir", nextDir(dir)); else { sp.set("sort", key); sp.set("dir","asc"); }
    sp.set("page","1");
    return `/invoices?${sp.toString()}`;
  };

  // CSV export from current filters
  const exportAllHref: string = (() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const qs = sp.toString();
    return `/api/invoices/export${qs ? `?${qs}` : ""}`;
  })();

  return (
    <div className="space-y-4">
      <SelectionProvider>
        {/* Title + actions (tokenized chrome) */}
        <div className="card" style={{ padding: 12 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ margin: 0, color: 'var(--text)' }}>Invoices</h1>

            <div className="flex items-center gap-2">
              <form action="/invoices" className="flex items-center gap-2 flex-wrap">
                <input className="input" name="q"    defaultValue={q}    placeholder="Search invoice or customer…" />
                <input className="input" name="from" type="date" defaultValue={from}/>
                <input className="input" name="to"   type="date" defaultValue={to}/>
                <input type="hidden" name="perPage" value={perPage} />
                <input type="hidden" name="sort" value={sort} />
                <input type="hidden" name="dir" value={dir} />
                <button className="btn-outline" type="submit">Apply</button>
              </form>

              <PerPage qs={baseQS} value={perPage} />

              {/* Use <a> for file download */}
              <a className="btn-outline" href={exportAllHref} download={`invoices_${from || "all"}_${to || "all"}.csv`}>
                Export CSV
              </a>

              <Link className="btn-primary" href="/billing">+ New Sale</Link>
            </div>
          </div>
        </div>

        {/* Error */}
        {!!errorMsg && (
          <div
            className="card"
            style={{
              padding: 12,
              borderColor: 'color-mix(in oklab, var(--danger) 40%, transparent)',
              background: 'color-mix(in oklab, var(--danger) 8%, transparent)',
              color: 'var(--text)'
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Couldn’t load invoices</div>
            <div className="muted">{errorMsg}</div>
          </div>
        )}

        {/* Table (token-based header + zebra + borders) */}
        {!errorMsg && (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="px-3 py-2" style={{ width: 40 }}><MasterCheckbox pageIds={items.map(i => i.id)} /></th>
                    <Th label="Invoice #"   href={sortHref("invoice")}  active={sort==="invoice"}  dir={dir} />
                    <Th label="Date/Time"   href={sortHref("date")}     active={sort==="date"}     dir={dir} />
                    <Th label="Customer"    href={sortHref("customer")} active={sort==="customer"} dir={dir} />
                    <Th label="Total"       href={sortHref("total")}    active={sort==="total"}    dir={dir} />
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                {items.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2"><RowCheckbox id={inv.id} /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Link href={`/invoices/${inv.id}`} className="underline">{inv.invoice_no}</Link>
                          {(() => {
                            const pending = Number(inv.pending_amount || 0);
                            const status = (inv.payment_status || "").toLowerCase();
                            const label = pending <= 0 ? "Paid" : status === "partial" ? "Partial" : "Pending";
                            const cls =
                              label === "Paid"
                                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200"
                                : label === "Partial"
                                ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                                : "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200";
                            return (
                              <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-2">{new Date(inv.created_at).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2">{inv.customer_name ?? "—"}</td>
                      <td className="px-3 py-2">{fmtINR(inv.total)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Link className="btn-outline" href={`/invoices/${inv.id}`}>View</Link>
                          <Link className="btn-outline" href={`/invoices/${inv.id}/print`} target="_blank">Print</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center muted">No invoices found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination + Bulk tray */}
        {!errorMsg && (
          <>
            <div className="flex items-center justify-between">
              <div className="muted text-sm">Page {page} of {totalPages} • {total} results</div>
              <div className="flex items-center gap-2">
                <Link
                  className="btn-outline"
                  style={{ opacity: page<=1 ? .5 : 1, pointerEvents: page<=1 ? 'none' : 'auto' }}
                  href={page<=1?"#":makeURL(page-1)}
                >
                  Prev
                </Link>
                <Link
                  className="btn-outline"
                  style={{ opacity: page>=totalPages ? .5 : 1, pointerEvents: page>=totalPages ? 'none' : 'auto' }}
                  href={page>=totalPages?"#":makeURL(page+1)}
                >
                  Next
                </Link>
              </div>
            </div>

            <BulkTray total={total} />
          </>
        )}
      </SelectionProvider>
    </div>
  );
}
