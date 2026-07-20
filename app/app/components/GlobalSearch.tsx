"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type SearchResult = {
  kind: "product" | "customer" | "invoice" | "quotation" | "purchase";
  id: number;
  title: string;
  subtitle: string;
  href: string;
};

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  product: "Products",
  customer: "Customers",
  invoice: "Invoices",
  quotation: "Quotations",
  purchase: "Purchases",
};

export default function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setItems([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await response.json();
        if (response.ok) {
          setItems(Array.isArray(json?.items) ? json.items : []);
          setActive(0);
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setItems([]);
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<SearchResult["kind"], SearchResult[]>();
    for (const item of items) map.set(item.kind, [...(map.get(item.kind) || []), item]);
    return Array.from(map.entries());
  }, [items]);

  function go(item: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setOpen(true)}
        title="Search everything (Ctrl/Cmd + K)"
      >
        <Search size={16} />
        <span className="hidden md:inline">Search</span>
        <kbd className="hidden lg:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="global-search-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="global-search-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Search AxEin"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="global-search-input-row">
              <Search size={20} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((value) => Math.min(value + 1, Math.max(0, items.length - 1)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((value) => Math.max(0, value - 1));
                  }
                  if (event.key === "Enter" && items[active]) go(items[active]);
                }}
                placeholder="Search product, customer, invoice, quotation or purchase…"
                aria-label="Search"
              />
              {busy ? <span className="global-search-loading">Searching…</span> : null}
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close search">
                <X size={18} />
              </button>
            </div>

            <div className="global-search-results">
              {query.trim().length < 2 ? (
                <div className="global-search-empty">Type at least 2 characters. Search also checks item names, SKU, phone, GSTIN and document numbers.</div>
              ) : !busy && items.length === 0 ? (
                <div className="global-search-empty">No matching records found.</div>
              ) : (
                groups.map(([kind, rows]) => (
                  <div key={kind} className="global-search-group">
                    <div className="global-search-group-label">{KIND_LABEL[kind]}</div>
                    {rows.map((item) => {
                      const itemIndex = items.indexOf(item);
                      return (
                        <button
                          type="button"
                          key={`${item.kind}-${item.id}`}
                          className={`global-search-result ${itemIndex === active ? "is-active" : ""}`}
                          onMouseEnter={() => setActive(itemIndex)}
                          onClick={() => go(item)}
                        >
                          <span className="global-search-result-title">{item.title}</span>
                          <span className="global-search-result-subtitle">{item.subtitle}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <footer className="global-search-footer">↑↓ Navigate · Enter Open · Esc Close</footer>
          </section>
        </div>
      )}
    </>
  );
}
