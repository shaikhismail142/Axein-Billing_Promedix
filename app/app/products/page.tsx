// app/products/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { SelectionProvider } from "./_components/selection";
import { MasterCheckbox, RowCheckbox } from "./_components/checks";
import BulkTray from "./_components/BulkTray";
import AddCategoryButton from "./_components/AddCategoryButton";
import ProductsFilters from "./_components/ProductsFilters";

/* ---------- Types ---------- */
type Product = {
  id: number;
  name: string;
  sku?: string | null;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
  updated_at?: string | null;
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
  sort?: "id" | "name" | "sku" | "price" | "stock" | "category" | "expiry" | "least_bought";
  dir?: "asc" | "desc";
  low?: "1";
  category?: string;
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
function fmtUpdated(ts?: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

/* ---------- Data fetch ---------- */
async function fetchProducts(searchParams: PageParams): Promise<ProductsResponse> {
  const page = clamp(parseIntSafe(searchParams.page, 1), 1, 1_000_000);
  const perPage = clamp(parseIntSafe(searchParams.perPage, 20), 1, 200);
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const category = typeof searchParams.category === "string" ? searchParams.category.trim() : "";
  const sort = (typeof searchParams.sort === "string" ? searchParams.sort : "id") as
    | "id"
    | "name"
    | "sku"
    | "price"
    | "stock"
    | "category"
    | "expiry"
    | "least_bought";
  const dir = (typeof searchParams.dir === "string" ? searchParams.dir : "asc") as "asc" | "desc";
  const low = searchParams.low === "1" ? "1" : "";

  const qs = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
    sort,
    dir,
  });
  if (q) qs.set("q", q);
  if (category) qs.set("category", category);
  if (low) qs.set("low", low);

  const res = await fetch(`${buildBaseUrl()}/api/products?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Products API failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

async function fetchCategories(): Promise<string[]> {
  try {
    const res = await fetch(`${buildBaseUrl()}/api/categories`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((c: any) => String(c?.name || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
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
  const category = typeof searchParams.category === "string" ? searchParams.category : "";
  const sort = (typeof searchParams.sort === "string" ? searchParams.sort : "id") as
    | "id"
    | "name"
    | "sku"
    | "price"
    | "stock"
    | "category"
    | "expiry"
    | "least_bought";
  const dir = (typeof searchParams.dir === "string" ? searchParams.dir : "asc") as "asc" | "desc";
  const lowOnly = searchParams.low === "1";

  let data: ProductsResponse | null = null;
  let errorMsg = "";
  let categories: string[] = [];
  try {
    [data, categories] = await Promise.all([fetchProducts(searchParams), fetchCategories()]);
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
  if (category) baseQS.set("category", category);
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

  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (category) exportParams.set("category", category);
  if (lowOnly) exportParams.set("low", "1");
  const exportAllHref = `/api/products/export${exportParams.size ? `?${exportParams.toString()}` : ""}`;

  return (
    <div className="p-6 space-y-4 max-w-none w-full">
      <SelectionProvider>
        {/* Title + actions */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Products</h1>
            <p className="muted text-sm">Search by product, category, SKU, or HSN</p>
          </div>
          <div className="flex items-center gap-2">
            <Link className="px-3 py-2 rounded-xl border" href={exportAllHref}>
              Export CSV
            </Link>
            <Link className="px-3 py-2 rounded-xl border" href="/products/import">
              Import CSV
            </Link>
            <AddCategoryButton />
            <Link className="btn btn-primary" href="/products/new">
              New Product
            </Link>
          </div>
        </div>

        {/* Filters */}
        <ProductsFilters
          q={q}
          category={category}
          sort={sort}
          dir={dir}
          perPage={perPage}
          lowOnly={lowOnly}
          categories={categories}
        />
        <div className="flex items-center gap-2 justify-end">
          <Link
            className={`px-3 py-2 rounded-xl border ${lowOnly ? "bg-yellow-100 border-yellow-300" : ""}`}
            href={lowToggleHref}
          >
            {lowOnly ? "Showing Low-stock" : "Low-stock only"}
          </Link>
          <div className="hidden sm:block">
            <PerPagePicker qs={baseQS} value={perPage} />
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
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 1700 }}>
              <thead>
                <tr>
                  <th className="px-3 py-2 w-10">
                    <MasterCheckbox pageIds={items.map((i) => i.id)} />
                  </th>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">HSN</th>
                  <th className="px-3 py-2 text-left">Lot</th>
                  <th className="px-3 py-2 text-left">Expiry</th>
                  <th className="px-3 py-2 text-left">Price</th>
                  <th className="px-3 py-2 text-left">Stock</th>
                  <th className="px-3 py-2 text-left">Low Stock</th>
                  <th className="px-3 py-2 text-left">Last Edited</th>
                  <th
                    className="px-3 py-2 text-right"
                    style={{
                      position: "sticky",
                      right: 0,
                      background: "var(--surface-1)",
                      zIndex: 3,
                      boxShadow: "-8px 0 12px rgba(0,0,0,0.25)",
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const mat = materialFromSku(p.sku);
                  const isLow = p.stock_qty <= p.low_stock_threshold && p.low_stock_threshold > 0;
                  const formId = `row-${p.id}`;
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
                      <td className="px-3 py-2">
                        <select
                          name="category"
                          defaultValue={p.category ?? ""}
                          form={formId}
                          className="input"
                        >
                          <option value="">—</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">{p.hsn_code ?? "—"}</td>
                      <td className="px-3 py-2">{p.batch_no ?? "—"}</td>
                      <td className="px-3 py-2">
                        {p.exp_date ? new Date(p.exp_date).toLocaleDateString("en-IN") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          name="selling_price"
                          type="number"
                          step="0.01"
                          defaultValue={Number(p.price) || 0}
                          form={formId}
                          className="input"
                          style={{ width: 120, textAlign: "right" }}
                        />
                      </td>
                      <td className="px-3 py-2">{p.stock_qty}</td>
                      <td className={`px-3 py-2 ${isLow ? "text-red-600 font-semibold" : ""}`}>
                        {p.low_stock_threshold}
                      </td>
                      <td className="px-3 py-2">{fmtUpdated(p.updated_at)}</td>
                      <td
                        className="px-3 py-2 text-right"
                        style={{
                          position: "sticky",
                          right: 0,
                          background: "var(--surface-1)",
                          zIndex: 2,
                          boxShadow: "-8px 0 12px rgba(0,0,0,0.2)",
                        }}
                      >
                        <form id={formId} method="post" action={`/api/products/${p.id}`} className="inline-flex items-center gap-2">
                          <input type="hidden" name="_method" value="PATCH" />
                          <input type="hidden" name="return_to" value="/products" />
                          <button className="btn-outline" type="submit">Save</button>
                          <Link className="px-2 py-1 rounded-lg border" href={`/products/${p.id}/edit`}>Edit</Link>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-6 text-center" style={{ color: "var(--muted)" }}>
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
