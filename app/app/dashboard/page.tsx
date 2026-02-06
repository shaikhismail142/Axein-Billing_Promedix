// app/dashboard/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import AnalogClockIST from '@/app/components/AnalogClockIST';

const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const ComposedChart       = dynamic(() => import('recharts').then(m => m.ComposedChart), { ssr: false });
const Bar                 = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false });
const Line                = dynamic(() => import('recharts').then(m => m.Line), { ssr: false });
const XAxis               = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false });
const YAxis               = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false });
const Tooltip             = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false });
const CartesianGrid       = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false });
const Legend              = dynamic(() => import('recharts').then(m => ({ default: m.Legend as any })), { ssr: false });

type Daily = { day: string; total: number };
type BreakdownRowRaw = Record<string, unknown>;
type BreakdownRow = { name: string; qty: number; total: number };
type Today = { sales_total: number; gross_profit: number };
type TopMode = 'qty' | 'total';
type TopRowData = BreakdownRow & { share: number; mode: TopMode };

type Range =
  | { kind: 'preset'; days: 7 | 14 | 30 | 90 }
  | { kind: 'custom'; from: string; to: string };

function todayISO() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
function addDaysISO(baseISO: string, days: number) { const d = new Date(baseISO+'T00:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function fmtINR(n: number) { return '₹' + Number(n || 0).toFixed(2); }
const fmtINRCompact = (n: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDateShort = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });

/** Read a CSS var from :root (fallback if missing) */
function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Simple 7-day moving average */
function movingAvg(values: number[], window = 7) {
  if (values.length < window) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out.push(sum / window);
  }
  return out;
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>({ kind: 'preset', days: 14 });
  const [rankMode, setRankMode] = useState<TopMode>('qty'); // manual control via UI + hotkey
  const [data, setData] = useState<{ daily: Daily[]; breakdown: BreakdownRow[]; today: Today } | null>(null);

  const { fromISO, toISO } = useMemo(() => {
    if (range.kind === 'preset') {
      const to = todayISO();
      const from = addDaysISO(to, -range.days + 1);
      return { fromISO: from, toISO: to };
    }
    return { fromISO: range.from, toISO: range.to };
  }, [range]);

  // BONUS: hotkey "t" toggles ranking mode qty/total
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 't') setRankMode((m) => (m === 'qty' ? 'total' : 'qty'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const url = new URL('/api/analytics/sales', window.location.origin);
    url.searchParams.set('from', fromISO);
    url.searchParams.set('to', toISO);
    fetch(url.toString(), { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) =>
        setData({
          daily: Array.isArray(j?.daily) ? j.daily : [],
          breakdown: normalizeBreakdown(j),
          today: j?.today ?? { sales_total: 0, gross_profit: 0 },
        })
      )
      .catch(() => setData({ daily: [], breakdown: [], today: { sales_total: 0, gross_profit: 0 } }));
  }, [fromISO, toISO]);

  // Derived stats for the range
  const series = data?.daily ?? [];
  const values = series.map((d) => Number(d.total || 0));
  const totalRange = values.reduce((a, b) => a + b, 0);
  const activeDays = values.filter((v) => v > 0).length;
  const bestIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  const bestLabel = bestIdx >= 0 ? `${fmtDateShort(series[bestIdx].day)} • ${fmtINR(values[bestIdx])}` : '—';
  const avgPerDay = values.length ? totalRange / values.length : 0;

  // Theme colors (resolved from CSS vars) with stable dependency
  const depKey = typeof window !== 'undefined' ? document.documentElement.className : '';
  const theme = useMemo(() => ({
    text: cssVar('--text', '#111827'),
    muted: cssVar('--muted', '#64748b'),
    primary: cssVar('--primary', '#3b82f6'),
    primary600: cssVar('--primary-600', '#2563eb'),
    success: cssVar('--success', '#22c55e'),
    border: cssVar('--border', 'rgba(148,163,184,0.25)'),
    thead: cssVar('--thead', 'rgba(241,245,249,0.92)'),
    popBg: cssVar('--popover-bg', 'rgba(17,24,39,0.85)'),
    popText: cssVar('--popover-text', '#fff'),
  }), [depKey]);

  const chartData = useMemo(() => {
    const ma = movingAvg(values, 7);
    return series.map((d, i) => ({
      day: fmtDateShort(d.day),
      total: Number(d.total || 0),
      avg7: i >= 6 ? Number(ma[i - 6]?.toFixed(2) || 0) : null,
    }));
  }, [series, values]);

  const salesToday = data?.today.sales_total ?? 0;
  const profitToday = data?.today.gross_profit ?? 0;
  const pct = salesToday > 0 ? (profitToday / salesToday) * 100 : 0;

  const top3 = useMemo<TopRowData[]>(() => {
    const rows = data?.breakdown ?? [];
    const denom = rows.reduce((a, r) => a + (rankMode === 'qty' ? r.qty : r.total), 0) || 1;
    const sorted = [...rows].sort((a, b) => (rankMode === 'qty' ? b.qty - a.qty : b.total - a.total));
    return sorted.slice(0, 3).map((r) => ({ ...r, share: ((rankMode === 'qty' ? r.qty : r.total) / denom) * 100, mode: rankMode }));
  }, [data?.breakdown, rankMode]);

  return (
    <div className="container">
      {/* Header / Hero */}
      <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Dashboard</h1>
          <div className="muted" style={{ marginTop: 4 }}>At‑a‑glance sales and inventory insights.</div>
        </div>
        <div className="glass" style={{ padding: 8, borderRadius: 16 }}>
          <AnalogClockIST size={140} />
        </div>
      </div>

      {/* Range & Mode controls */}
      <div className="card" style={{ padding: 12, margin: '8px 0 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12 }}>Range:</span>
        <button className="glass-btn" onClick={() => setRange({ kind: 'preset', days: 7 })}  aria-pressed={range.kind==='preset'&&range.days===7}>7d</button>
        <button className="glass-btn" onClick={() => setRange({ kind: 'preset', days: 14 })} aria-pressed={range.kind==='preset'&&range.days===14}>14d</button>
        <button className="glass-btn" onClick={() => setRange({ kind: 'preset', days: 30 })} aria-pressed={range.kind==='preset'&&range.days===30}>30d</button>
        <button className="glass-btn" onClick={() => setRange({ kind: 'preset', days: 90 })} aria-pressed={range.kind==='preset'&&range.days===90}>90d</button>

        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Custom:</span>
        <input type="date" value={range.kind==='custom'?range.from:fromISO}
          onChange={(e)=>setRange({kind:'custom',from:e.target.value,to:range.kind==='custom'?range.to:toISO})}/>
        <span aria-hidden>→</span>
        <input type="date" value={range.kind==='custom'?range.to:toISO}
          onChange={(e)=>setRange({kind:'custom',from:range.kind==='custom'?range.from:fromISO,to:e.target.value})}/>

        {/* Ranking mode dropdown */}
        <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>Top products by</span>
          <select
            value={rankMode}
            onChange={(e)=>setRankMode(e.target.value as TopMode)}
            aria-label="Top products ranking mode"
          >
            <option value="qty">Quantity</option>
            <option value="total">Amount</option>
          </select>
        </div>

        <div className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          Showing: <b>{fromISO}</b> → <b>{toISO}</b>
        </div>
      </div>

      {/* Today KPIs */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Today</h2>
          <span className="muted" style={{ fontSize: 12 }}>live snapshot</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <KPI label="Sales (₹)" value={fmtINR(salesToday)} />
          <KPI label="Profit (₹)" value={fmtINR(profitToday)} />
          <KPI label="Profit (%)" value={`${pct.toFixed(1)}%`} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <Slider value={pct} />
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Top Products ({fromISO} → {toISO})</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            ranking by {rankMode === 'qty' ? 'quantity' : 'amount'}
          </div>
        </div>
        {top3.length === 0 ? (
          <div className="muted" style={{ paddingTop: 8 }}>No sales in this period.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {top3.map((r) => <TopRow key={r.name} row={r} />)}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>Daily Totals ({fromISO} → {toISO})</h3>

        {/* Range KPIs above the line */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <MiniKPI label="Total in range" value={`₹${fmtINRCompact(totalRange)}`} />
          <MiniKPI label="Avg / day" value={fmtINR(avgPerDay)} />
          <MiniKPI label="Best day" value={bestLabel} />
          <MiniKPI label="Active days" value={`${activeDays}/${values.length || 0}`} />
        </div>

        <div style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
              <XAxis dataKey="day" stroke={theme.muted} />
              <YAxis stroke={theme.muted} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" name="Daily Sales" fill={theme.primary} radius={[6, 6, 0, 0]} />
              <Line type="monotone" dataKey="avg7" name="7‑day Avg" stroke={theme.success} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 8, color: 'var(--muted)' }}>
          Bars: daily sales amount • Line: 7‑day moving average
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers & small UI ---------- */
function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass" style={{ padding: 12, borderRadius: 12, minWidth: 180, display: 'grid', gap: 4 }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
function MiniKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass" style={{ padding: 10, borderRadius: 12, minWidth: 180 }}>
      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}
function Slider({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const left = `linear-gradient(90deg, ${cssVar('--success','#22c55e')}, ${cssVar('--primary','#3b82f6')})`;
  return (
    <div className="glass" style={{ height: 12, borderRadius: 999, overflow: 'hidden' }} title={`${pct.toFixed(1)}%`}>
      <div style={{ width: `${pct}%`, height: '100%', background: left }} />
    </div>
  );
}

function TopRow({ row }: { row: TopRowData }) {
  const title = row.name;
  const qty = row.qty;
  const amt = row.total;
  const share = Math.max(0, Math.min(100, row.share));
  return (
    <div className="glass" style={{ padding: 10, borderRadius: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700 }} title={title}>
          {title}
        </div>
        <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'color-mix(in oklab, var(--text) 10%, transparent)', overflow: 'hidden' }}>
          <div style={{ width: `${share}%`, height: '100%', background: `linear-gradient(90deg, ${cssVar('--primary','#3b82f6')}, ${cssVar('--primary-600','#2563eb')})` }} />
        </div>
      </div>
      <div className="muted" style={{ textAlign: 'right' }}>Qty: <b>{qty}</b></div>
      <div style={{ textAlign: 'right', minWidth: 110 }}>{fmtINR(amt)} <span className="muted">({share.toFixed(1)}%)</span></div>
    </div>
  );
}

function normalizeBreakdown(j: unknown): BreakdownRow[] {
  const raw: BreakdownRowRaw[] =
    (Array.isArray((j as any)?.breakdown) && (j as any).breakdown) ||
    (Array.isArray((j as any)?.data) && (j as any).data) ||
    [];
  return raw.map((r) => ({
    name: String((r as any).name ?? (r as any).product_name ?? (r as any).description ?? 'Unknown'),
    qty: Number((r as any).qty ?? (r as any).total_qty ?? (r as any).units ?? 0),
    total: Number((r as any).total ?? (r as any).amount ?? (r as any).sales_total ?? 0),
  }));
}
