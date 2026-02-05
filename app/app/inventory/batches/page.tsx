// app/inventory/batches/page.tsx
import BatchesClient from "./_components/BatchesClient";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;                 // number (valid)
export const fetchCache = "force-no-store";

export type Batch = {
  id: string;
  product_id: string;
  product_name: string | null;
  sku: string | null;
  batch_no: string;
  mfg_date: string | null;
  exp_date: string | null;
  qty: string;
  cost_price: string | null;
  mrp: string | null;
  supplier_id: string | null;
  days_left: number | null;
};

export type ApiResp = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: Batch[];
  prefs: { near_expiry_days: number };
};

type PageProps = {
  searchParams?: {
    page?: string;
    q?: string;
    expiry?: "all" | "near" | "expired";
    onlyQty?: "true" | "false";
  };
};

// Build a safe absolute origin for server-side fetches
function getOrigin() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host =
    h.get("x-forwarded-host") ||
    h.get("host") ||
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\//, "") ||
    "localhost:3000";
  return `${proto}://${host}`;
}

async function getBatches(searchParams: PageProps["searchParams"]): Promise<ApiResp> {
  const page    = searchParams?.page    ?? "1";
  const q       = searchParams?.q       ?? "";
  const expiry  = searchParams?.expiry  ?? "all";
  const onlyQty = searchParams?.onlyQty ?? "true";

  const qs = new URLSearchParams({
    page,
    pageSize: "20",
    q,
    expiry,
    onlyQty,
  });

  const origin = getOrigin();
  const url = `${origin}/api/batches?${qs.toString()}`;

  // Choose ONE strategy; here we use no-store only.
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    console.error("[/inventory/batches] /api/batches failed", res.status, await res.text());
    return {
      ok: false,
      page: Number(page) || 1,
      pageSize: 20,
      total: 0,
      items: [],
      prefs: { near_expiry_days: 30 },
    };
  }

  return res.json();
}

export default async function BatchesPage({ searchParams }: PageProps) {
  const initialData = await getBatches(searchParams);

  const current = {
    page: searchParams?.page ?? "1",
    q: searchParams?.q ?? "",
    expiry: (searchParams?.expiry as "all" | "near" | "expired") ?? "all",
    onlyQty: (searchParams?.onlyQty as "true" | "false") ?? "true",
  };

  return <BatchesClient initialData={initialData} current={current} />;
}
