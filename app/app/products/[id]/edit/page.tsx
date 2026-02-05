// app/products/[id]/edit/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import EditForm from "./EditForm";

type ProductApi = {
  ok: boolean;
  error?: string;
  id: number;
  name: string;
  category?: string;
  selling_price?: number;
  stock_qty?: number;
  low_stock_threshold?: number;
  sku?: string;
  brand?: string;
  hsn_code?: string;
  unit?: string;
  exp_date?: string | null;
  notes?: string;
};

function baseUrl() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

async function fetchProduct(id: number): Promise<ProductApi> {
  const res = await fetch(`${baseUrl()}/api/products/${id}`, { cache: "no-store" });
  // If API fails, surface a consistent shape so the page can render an error panel
  if (!res.ok) {
    let msg = "";
    try {
      msg = await res.text();
    } catch {}
    return { ok: false, error: msg || `HTTP ${res.status}`, id, name: "" };
  }
  return (await res.json()) as ProductApi;
}

// Default export must be a React component (App Router rule)
export default async function Page({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
          Invalid product id.
        </div>
        <div className="mt-4">
          <Link className="px-3 py-2 rounded-xl border" href="/products">
            Back
          </Link>
        </div>
      </div>
    );
  }

  const data = await fetchProduct(id);

  if (!data.ok) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Edit Product</h1>
          <Link className="px-3 py-2 rounded-xl border" href="/products">
            Back
          </Link>
        </div>

        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold mb-1">Couldn’t load product</div>
          <div className="text-sm">{data.error || "Unknown error"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit Product</h1>
        <Link className="px-3 py-2 rounded-xl border" href="/products">
          Back
        </Link>
      </div>

      <EditForm
        id={data.id}
        name={data.name}
        category={data.category ?? ""}
        selling_price={data.selling_price ?? 0}
        stock_qty={data.stock_qty ?? 0}
        low_stock_threshold={data.low_stock_threshold ?? 0}
        sku={data.sku ?? ""}
        brand={data.brand ?? ""}
        hsn_code={data.hsn_code ?? ""}
        unit={data.unit ?? ""}
        exp_date={data.exp_date ?? ""}
        notes={data.notes ?? ""}
      />
    </div>
  );
}
