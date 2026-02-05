"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

type Props = {
  q: string;
  category: string;
  sort: string;
  dir: string;
  perPage: number;
  lowOnly: boolean;
  categories: string[];
};

export default function ProductsFilters({
  q,
  category,
  sort,
  dir,
  perPage,
  lowOnly,
  categories,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const base = useMemo(() => new URLSearchParams(sp.toString()), [sp]);

  const apply = (patch: Record<string, string | null | undefined>) => {
    const qs = new URLSearchParams(base.toString());
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === undefined || v === "") qs.delete(k);
      else qs.set(k, v);
    });
    qs.set("page", "1");
    router.push(`/products?${qs.toString()}`);
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <form action="/products" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col">
          <label className="text-xs">Search</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name or category…"
            className="border rounded-lg px-3 py-2"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs">Category</label>
          <select
            name="category"
            defaultValue={category || ""}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => apply({ category: e.target.value })}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs">Sort</label>
          <select
            name="sort"
            defaultValue={sort}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => apply({ sort: e.target.value })}
          >
            <option value="id">Newest</option>
            <option value="name">Name</option>
            <option value="category">Category</option>
            <option value="price">Price</option>
            <option value="stock">Stock</option>
            <option value="expiry">Near Expiry</option>
            <option value="least_bought">Least Bought</option>
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs">Direction</label>
          <select
            name="dir"
            defaultValue={dir}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => apply({ dir: e.target.value })}
          >
            <option value="asc">A → Z / Low → High</option>
            <option value="desc">Z → A / High → Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input type="hidden" name="perPage" value={perPage} />
          {lowOnly && <input type="hidden" name="low" value="1" />}
          <button className="px-3 py-2 rounded-xl border" type="submit">
            Search
          </button>
          <a className="glass-btn px-3 py-2 rounded-2xl" href="/products">
            Clear Filters
          </a>
        </div>
      </form>
    </div>
  );
}
