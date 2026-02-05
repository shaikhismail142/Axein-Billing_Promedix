// app/products/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { SelectionProvider } from "./_components/selection";
import { MasterCheckbox, RowCheckbox } from "./_components/checks";
import BulkTray from "./_components/BulkTray";

/* ---------- Types ---------- */
type Product = {
  id: number;
  name: string;
  sku?: string | null;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
  price: string | number;
  stock_qty: number;
  low_stock_threshold: number;
};

type ProductsResponse = {
  items: Product[];
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
  sort?: "id" | "name" | "sku" | "price" | "stock";
  dir?: "asc" | "desc";
  low?: "1";
};

/* ---------- Utils ---------- */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseIntSafe(v: unknown, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}
function buildBaseUrl() {
  const hdrs = headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (!host) return "";
  return `${proto}://${host}`;
}
function nextDir(current: "asc" | "desc") {
  return current === "asc" ? "desc" : "asc";
}
function materialFromSku(sku?: string | null) {
  if (!sku) return null;
  const t = sku.toUpperCase();
  if (t.includes("CPVC")) return "CPVC";
  if (t.includes("UPVC")) return "UPVC";
  if (t.includes("PVC")) return "PVC";
  if (t.includes("BRASS")) return "BRASS";
  if (t.includes("GI")) return "GI";
  return null;
}

/* ---------- Data fetch ---------- */
async function fetchProducts(searchParams: PageParams): Promise<ProductsResponse> {
  const page = clamp(parseIntSafe(searchParams.page, 1), 1, 1_000_000);
  const perPage = clamp(parseIntSafe(searchParams.perPage, 20), 1, 200);
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const sort = (typeof searchParams.sort === "string" ? searchParams.sort : "id") as
    | "id"
    | "name"
    | "sku"
    | "price"
    | "stock";
  const dir = (typeof searchParams.dir === "string" ? searchParams.dir : "asc") as "asc" | "desc";
  const low = searchParams.low === "1" ? "1" : "";

  const qs = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
    sort,
    dir,
  });
  if (q) qs.set("q", q);
  if (low) qs.set("low", low);

  const res = await fetch(`${buildBaseUrl()}/api/products?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Products API failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

/* ---------- Small server components ---------- */
function SortableTh({
  label,
  active,
  dir,
  href,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  href: string;
}) {
  return (
    <th className="px-3 py-2 text-left">
      <Link
        href={href}
        className={`inline-flex items-center gap-1 ${active ? "font-semibold" : ""}`}
        title={`Sort by ${label}`}
      >
        {label}
        {active && <span className="text-xs opacity-70">{dir === "asc" ? "▲" : "▼"}</span>}
      </Link>
    </th>
  );
}

function PerPagePicker({ qs, value }: { qs: URLSearchParams; value: number }) {
  const mk = (pp: number) => {
    const sp = new URLSearchParams(qs.toString());
    sp.set("perPage", String(pp));
    sp.set("page", "1");
    return `/products?${sp.toString()}`;
  };
  const chipStyle = (active: boolean) => ({
    border: "1px solid var(--glass-brd)",
    background: active ? "color-mix(in oklab, var(--primary) 12%, var(--surface-1))" : "transparent",
    color: "var(--text)",
    borderRadius: 10,
    padding: "4px 8px",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 12,
  });
  return (
    <div className="inline-flex items-center gap-1 text-sm">
      <span style={{ color: "var(--muted)" }}>Show</span>
      <Link style={chipStyle(value === 20)} href={mk(20)}>
        20
      </Link>
      <Link style={chipStyle(value === 50)} href={mk(50)}>
        50
      </Link>
      <Link style={chipStyle(value === 100)} href={mk(100)}>
        100
      </Link>
    </div>
  );
}

/* ---------- Page ---------- */
export default async function ProductsPage({ searchParams }: { searchParams: PageParams }) {
  const q = typeof searchParams.q === "string" ? searchParams.q : "";
  const sort = (typeof searchParams.sort === "string" ? searchParams.sort : "id") as
    | "id"
    | "name"
    | "sku"
    | "price"
    | "stock";
  const dir = (typeof searchParams.dir === "string" ? searchParams.dir : "asc") as "asc" | "desc";
  const lowOnly = searchParams.low === "1";

  let data: ProductsResponse | null = null;
  let errorMsg = "";
  try {
    data = await fetchProducts(searchParams);
  } catch (err: any) {
    errorMsg = err?.message || "Failed to load products";
  }

  const page = data?.page ?? 1;
  const perPage = data?.perPage ?? 20;
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  // shared query state
  const baseQS = new URLSearchParams();
  baseQS.set("perPage", String(perPage));
  baseQS.set("sort", sort);
  baseQS.set("dir", dir);
  if (q) baseQS.set("q", q);
  if (lowOnly) baseQS.set("low", "1");

  const makeURL = (p: number) => {
    const sp = new URLSearchParams(baseQS.toString());
    sp.set("page", String(p));
    return `/products?${sp.toString()}`;
  };

  // sort header links
  const sortHref = (key: "id" | "name" | "sku" | "price" | "stock") => {
    const sp = new URLSearchParams(baseQS.toString());
    if (sort === key) {
      sp.set("dir", nextDir(dir));
    } else {
      sp.set("sort", key);
      sp.set("dir", "asc");
    }
    sp.set("page", "1");
    return `/products?${sp.toString()}`;
  };

  // low-stock toggle href (avoid inline functions in JSX)
  const lowToggleHref = (() => {
    const sp = new URLSearchParams(baseQS.toString());
    sp.set("page", "1");
    if (lowOnly) sp.delete("low");
    else sp.set("low", "1");
    return `/products?${sp.toString()}`;
  })();

  const exportAllHref = `/api/products/export${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <SelectionProvider>
        {/* Title + actions */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Products</h1>

          <div className="flex items-center gap-2">
            {/* Search */}
            <form action="/products" className="flex items-center gap-2">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search products…"
                className="border rounded-lg px-3 py-2"
              />
              <input type="hidden" name="perPage" value={perPage} />
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
              {lowOnly && <input type="hidden" name="low" value="1" />}
              <button className="px-3 py-2 rounded-xl border" type="submit">
                Search
              </button>
            </form>

            {/* Low stock toggle */}
            <Link
              className={`px-3 py-2 rounded-xl border ${
                lowOnly ? "bg-yellow-100 border-yellow-300" : ""
              }`}
              href={lowToggleHref}
            >
              {lowOnly ? "Showing Low-stock" : "Low-stock only"}
            </Link>

            {/* Per-page (link-based) */}
            <div className="hidden sm:block">
              <PerPagePicker qs={baseQS} value={perPage} />
            </div>

            {/* Export ALL filtered (BulkTray handles selected) */}
            <Link className="px-3 py-2 rounded-xl border" href={exportAllHref}>
              Export CSV
            </Link>

            <Link className="px-3 py-2 rounded-xl border" href="/products/import">
              Import CSV
            </Link>

            <Link className="px-3 py-2 rounded-xl bg-blue-600 text-white" href="/products/new">
              New Product
            </Link>
          </div>
        </div>

        {/* Error */}
        {!!errorMsg && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
            <div className="font-semibold mb-1">Couldn’t load products</div>
            <div className="text-sm">{errorMsg}</div>
            <div className="mt-2">
              <Link className="underline" href="/products">
                Try again
              </Link>
            </div>
          </div>
        )}

        {/* Table */}
        {!errorMsg && (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <MasterCheckbox pageIds={items.map((i) => i.id)} />
                  </th>
                  <SortableTh label="ID" active={sort === "id"} dir={dir} href={sortHref("id")} />
                  <SortableTh label="Name" active={sort === "name"} dir={dir} href={sortHref("name")} />
                  <SortableTh label="SKU" active={sort === "sku"} dir={dir} href={sortHref("sku")} />
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">HSN</th>
                  <th className="px-3 py-2 text-left">Lot</th>
                  <th className="px-3 py-2 text-left">Expiry</th>
                  <SortableTh label="Price" active={sort === "price"} dir={dir} href={sortHref("price")} />
                  <SortableTh label="Stock" active={sort === "stock"} dir={dir} href={sortHref("stock")} />
                  <th className="px-3 py-2 text-left">Low Stock</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(even)]:bg-gray-50/40 dark:[&>tr:nth-child(even)]:bg-slate-800/40">
                {items.map((p) => {
                  const mat = materialFromSku(p.sku);
                  const isLow = p.stock_qty <= p.low_stock_threshold && p.low_stock_threshold > 0;
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2 align-middle">
                        <RowCheckbox id={p.id} />
                      </td>
                      <td className="px-3 py-2">{p.id}</td>
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2">
                        {p.sku ?? "—"}
                        {mat && (
                          <span className="ml-2 text-[10px] rounded-full px-2 py-[2px] border">
                            {mat}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{p.category ?? "—"}</td>
                      <td className="px-3 py-2">{p.hsn_code ?? "—"}</td>
                      <td className="px-3 py-2">{p.batch_no ?? "—"}</td>
                      <td className="px-3 py-2">
                        {p.exp_date ? new Date(p.exp_date).toLocaleDateString("en-IN") : "—"}
                      </td>
                      <td className="px-3 py-2">{inr.format(Number(p.price) || 0)}</td>
                      <td className="px-3 py-2">{p.stock_qty}</td>
                      <td className={`px-3 py-2 ${isLow ? "text-red-600 font-semibold" : ""}`}>
                        {p.low_stock_threshold}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link className="px-2 py-1 rounded-lg border" href={`/products/${p.id}/edit`}>
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center" style={{ color: "var(--muted)" }}>
                      No products found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!errorMsg && (
          <div className="flex items-center justify-between">
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Page {page} of {totalPages} • {total} results
            </div>
            <div className="flex items-center gap-2">
              <Link
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : 0}
                className={`px-3 py-2 rounded-xl border ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
                href={page <= 1 ? "#" : makeURL(page - 1)}
              >
                Prev
              </Link>
              <Link
                aria-disabled={page >= totalPages}
                tabIndex={page >= totalPages ? -1 : 0}
                className={`px-3 py-2 rounded-xl border ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
                href={page >= totalPages ? "#" : makeURL(page + 1)}
              >
                Next
              </Link>
            </div>
          </div>
        )}

        {/* Bulk tray */}
        {!errorMsg && <BulkTray total={total} q={q} />}
      </SelectionProvider>
    </div>
  );
}
