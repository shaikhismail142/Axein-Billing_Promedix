"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  const [qVal, setQVal] = useState(q);
  const [catVal, setCatVal] = useState(category);
  const [sortVal, setSortVal] = useState(sort);
  const [dirVal, setDirVal] = useState(dir);

  useEffect(() => {
    setQVal(q);
    setCatVal(category);
    setSortVal(sort);
    setDirVal(dir);
  }, [q, category, sort, dir]);

  const buildUrl = useMemo(() => {
    return (next?: Partial<{ q: string; category: string; sort: string; dir: string }>) => {
      const merged = {
        q: qVal,
        category: catVal,
        sort: sortVal,
        dir: dirVal,
        ...(next || {}),
      };
      const qs = new URLSearchParams();
      const qClean = merged.q?.trim() || "";
      if (qClean) qs.set("q", qClean);
      if (merged.category) qs.set("category", merged.category);
      if (merged.sort) qs.set("sort", merged.sort);
      if (merged.dir) qs.set("dir", merged.dir);
      if (perPage) qs.set("perPage", String(perPage));
      if (lowOnly) qs.set("low", "1");
      qs.set("page", "1");
      return `/products?${qs.toString()}`;
    };
  }, [qVal, catVal, sortVal, dirVal, perPage, lowOnly]);

  const apply = (next?: Partial<{ q: string; category: string; sort: string; dir: string }>) => {
    router.push(buildUrl(next));
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: qVal });
        }}
      >
        <div className="flex flex-col">
          <label className="text-xs">Search</label>
          <input
            name="q"
            value={qVal}
            onChange={(e) => setQVal(e.target.value)}
            placeholder="Search by name or category…"
            className="border rounded-lg px-3 py-2"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs">Category</label>
          <select
            name="category"
            value={catVal || ""}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => {
              const v = e.target.value;
              setCatVal(v);
              apply({ category: v });
            }}
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
            value={sortVal}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => {
              const v = e.target.value;
              setSortVal(v);
              apply({ sort: v });
            }}
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
            value={dirVal}
            className="border rounded-lg px-3 py-2"
            onChange={(e) => {
              const v = e.target.value;
              setDirVal(v);
              apply({ dir: v });
            }}
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
