"use client";
// app/_components/AlertsBell.tsx
// Header bell for low-stock + expiry alerts

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type LowStockItem = {
  type: "low_stock";
  id: number;
  label: string;
  sku?: string | null;
  stock_qty: number;
  threshold: number;
  href: string;
};

type ExpiryItem = {
  type: "near_expiry" | "expired";
  product_id: number;
  product_name: string;
  batch_id: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  days_until: number;
  qty: number;
  href: string;
};

type DebtItem = {
  type: "debt";
  id: number;
  vendor_name: string;
  pending: number;
  last_tx?: string | null;
  href: string;
};

type AlertsPayload = {
  ok: boolean;
  near_expiry_days: number;
  counts: { low_stock: number; near_expiry: number; expired: number; debts?: number };
  items: { low_stock: LowStockItem[]; expiry: ExpiryItem[]; debts?: DebtItem[] };
  debts?: { total_pending: number };
};

function useAlerts(pollMs = 15000) {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const fetcher = async () => {
    try {
      const r = await fetch("/api/alerts", { cache: "no-store" });
      if (!r.ok) throw new Error("alerts fetch failed");
      const j = (await r.json()) as AlertsPayload;
      setData(j);
    } catch (e) {
      // best-effort: keep previous
      console.warn("alerts fetch error", e);
    }
  };

  useEffect(() => {
    fetcher();
    timer.current = window.setInterval(fetcher, pollMs) as unknown as number;
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [pollMs]);

  return { data, open, setOpen } as const;
}

export default function AlertsBell() {
  const { data, open, setOpen } = useAlerts();
  const total = useMemo(() => {
    if (!data?.counts) return 0;
    return (
      (data.counts.low_stock || 0) +
      (data.counts.near_expiry || 0) +
      (data.counts.expired || 0) +
      (data.counts.debts || 0)
    );
  }, [data]);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm shadow-sm"
        style={{ border: "1px solid var(--glass-brd)", background: "var(--glass-bg)", color: "var(--text)" }}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Alerts"
      >
        <span aria-hidden>🔔</span>
        {total > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full text-xs flex items-center justify-center px-1"
            style={{ background: "var(--primary)", color: "white" }}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-96 max-w-[90vw] rounded-2xl p-2 shadow-xl z-50"
          style={{ background: "var(--surface-1)", border: "1px solid var(--glass-brd)" }}
        >
          <Section title="Low stock" emptyText="No low-stock items" hrefAll="/products?low=1" count={data?.counts.low_stock || 0}>
            {data?.items.low_stock?.map((it) => (
              <Row key={`low-${it.id}`} href={it.href}
                   title={it.label}
                   subtitle={it.sku ? `SKU: ${it.sku}` : undefined}
                   right={`${it.stock_qty} / ${it.threshold}`}
              />
            ))}
          </Section>

          <div className="my-1 h-px" style={{ background: "var(--glass-brd)" }} />

          <Section title="Expiry" emptyText="No near/expired batches" hrefAll="/inventory/expiry"
                   count={(data?.counts.near_expiry || 0) + (data?.counts.expired || 0)}>
            {data?.items.expiry?.map((it) => (
              <Row key={`exp-${it.batch_id}`} href={it.href}
                   title={it.product_name}
                   subtitle={`Batch ${it.batch_no || "—"}`}
                   right={it.type === "expired" ? `Expired ${Math.abs(it.days_until)}d` : `${it.days_until}d left`}
                   rightClass={it.type === "expired" ? "text-red-600" : it.days_until <= 7 ? "text-red-600" : "text-yellow-700"}
              />
            ))}
          </Section>

          <div className="my-1 h-px" style={{ background: "var(--glass-brd)" }} />

          <Section
            title="Vendor Debts"
            emptyText="No pending vendor bills"
            hrefAll="/accounting?focus=debts#debts"
            count={data?.counts.debts || 0}
          >
            {(data?.items.debts || []).map((it) => (
              <Row
                key={`debt-${it.id}`}
                href={it.href}
                title={it.vendor_name}
                subtitle={it.last_tx ? `Last bill: ${new Date(it.last_tx).toLocaleDateString("en-IN")}` : undefined}
                right={`INR (Rs/-) ${Number(it.pending || 0).toFixed(2)}`}
              />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, emptyText, hrefAll, count, children }:{ title:string; emptyText:string; hrefAll:string; count:number; children: React.ReactNode }){
  return (
    <section className="p-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="font-medium">{title}</div>
        <span className="text-xs opacity-70">({count})</span>
        <Link className="ml-auto text-xs underline hover:opacity-80" href={hrefAll}>View all</Link>
      </div>
      <div className="space-y-1 max-h-64 overflow-auto">
        {count === 0 ? (
          <div className="text-sm opacity-60 px-2 py-3">{emptyText}</div>
        ) : children}
      </div>
    </section>
  );
}

function Row({ href, title, subtitle, right, rightClass }: { href:string; title:string; subtitle?:string; right?:string; rightClass?:string }){
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:opacity-90" style={{ background: "var(--surface-2)" }}>
      <div className="min-w-0">
        <div className="truncate text-sm" style={{ color: "var(--text)" }}>{title}</div>
        {subtitle && <div className="text-xs opacity-70 truncate">{subtitle}</div>}
      </div>
      {right && <div className={`ml-auto text-xs ${rightClass || "opacity-80"}`}>{right}</div>}
    </Link>
  );
}
