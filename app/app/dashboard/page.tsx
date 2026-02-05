// app/dashboard/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import AnalogClockIST from '@/app/components/AnalogClockIST';

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

/** Nice y-axis scaling */
function niceMax(v: number) {
  if (!isFinite(v) || v <= 0) return 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow10;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow10;
}
function yTicks(max: number, count = 4) {
  const top = niceMax(max);
  const step = top / count;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
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

  const lineRef = useRef<HTMLCanvasElement>(null);
  const pieRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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

  useEffect(() => {
    if (!data) return;
    setupLine(lineRef.current, data.daily, hoverIdx, setHoverIdx, theme);
    const top = [...data.breakdown]
      .sort((a, b) => (rankMode === 'qty' ? b.qty - a.qty : b.total - a.total))
      .slice(0, 8);
    drawPie(pieRef.current, top, theme, rankMode);
  }, [data, hoverIdx, theme, rankMode]);

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
      {/* Header row: IST Clock */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 12px' }}>
        <AnalogClockIST size={200} />
      </div>

      {/* Range & Mode controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 12px', flexWrap: 'wrap' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
          <div>
            <CanvasHiDPI ref={lineRef} width={700} height={340} />
            <div style={{ marginTop: 8, color: 'var(--muted)' }}>Line: Daily Sales (₹) with 7-day avg & tooltip</div>
          </div>
          <div>
            <CanvasHiDPI ref={pieRef} width={340} height={300} />
            <div style={{ marginTop: 8, color: 'var(--muted)' }}>Pie: % Share by Product (top 8)</div>
          </div>
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

/** HiDPI-safe canvas with forwardRef */
const CanvasHiDPI = forwardRef<HTMLCanvasElement, React.ComponentProps<'canvas'>>(function CanvasHiDPI(props, ref) {
  const { width = 600, height = 300, ...rest } = props as any;
  const localRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ((ref as React.RefObject<HTMLCanvasElement>)?.current ?? localRef.current) as HTMLCanvasElement | null;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [ref, width, height]);
  return <canvas ref={(ref as any) ?? localRef} {...rest} />;
});

/** ---- Line chart & pie ---- */
function setupLine(
  canvas: HTMLCanvasElement | null,
  daily: Daily[],
  _hoverIdx: number | null,
  setHover: (i: number | null) => void,
  theme: { text:string; muted:string; primary:string; primary600:string; success:string; border:string; thead:string; popBg:string; popText:string }
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = (canvas as any).style?.width ? parseInt((canvas as any).style.width, 10) : canvas.width;
  const H = (canvas as any).style?.height ? parseInt((canvas as any).style.height, 10) : canvas.height;

  const padLeft = 56, padRight = 24, padTop = 16, padBottom = 36;
  ctx.clearRect(0, 0, W, H);

  const xs = daily.map((d) => d.day);
  const ys = daily.map((d) => Number(d.total || 0));
  const N = ys.length || 1;

  // y-scale
  const yMaxRaw = Math.max(1, ...ys, 0);
  const yMax = niceMax(yMaxRaw);
  const yTickVals = yTicks(yMax, 4);

  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const xAt = (i: number) => padLeft + (i * plotW) / Math.max(1, N - 1);
  const yAt = (v: number) => padTop + (plotH - (v / yMax) * plotH);

  // grid + axes
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  yTickVals.forEach((t) => {
    const y = yAt(t);
    ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(W - padRight, y); ctx.stroke();
  });
  ctx.strokeStyle = 'rgba(100,116,139,0.6)';
  ctx.beginPath(); ctx.moveTo(padLeft, H - padBottom); ctx.lineTo(W - padRight, H - padBottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, H - padBottom); ctx.stroke();

  // y tick labels
  ctx.fillStyle = theme.muted;
  ctx.font = '12px system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  yTickVals.forEach((t) => ctx.fillText('₹' + fmtINRCompact(t), padLeft - 8, yAt(t)));

  // x labels
  const xLabelIdxs = N <= 3 ? [...Array(N).keys()] : [0, Math.floor((N - 1) / 2), N - 1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.muted;
  xLabelIdxs.forEach((i) => ctx.fillText(fmtDateShort(xs[i]), xAt(i), H - padBottom + 6));

  // area under curve
  ctx.beginPath();
  ys.forEach((y, i) => { const X = xAt(i), Y = yAt(y); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
  ctx.lineTo(xAt(N - 1), H - padBottom);
  ctx.lineTo(xAt(0), H - padBottom);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, padTop, 0, H - padBottom);
  g.addColorStop(0, `${theme.primary}2E`);
  g.addColorStop(1, `${theme.primary}05`);
  ctx.fillStyle = g; ctx.fill();

  // main line
  ctx.beginPath();
  ys.forEach((y, i) => { const X = xAt(i), Y = yAt(y); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
  ctx.strokeStyle = theme.primary; ctx.lineWidth = 2; ctx.stroke();

  // points
  ctx.fillStyle = theme.primary;
  ys.forEach((y, i) => { const X = xAt(i), Y = yAt(y); ctx.beginPath(); ctx.arc(X, Y, 2.5, 0, Math.PI * 2); ctx.fill(); });

  // moving average (7)
  const ma = movingAvg(ys, 7);
  if (ma.length) {
    ctx.beginPath();
    for (let i = 0; i < ma.length; i++) {
      const X = xAt(i + 6), Y = yAt(ma[i]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = cssVar('--success', '#22c55e'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }

  // last-day label & peak marker
  if (N > 0) {
    const lastX = xAt(N - 1), lastY = yAt(ys[N - 1]);
    labelBubble(ctx, `₹${Number(ys[N - 1]).toFixed(0)}`, lastX, lastY - 10, 'right', { popBg: theme.popBg, popText: theme.popText });
    const peakIdx = ys.indexOf(Math.max(...ys));
    const peakX = xAt(peakIdx), peakY = yAt(ys[peakIdx]);
    ctx.fillStyle = theme.text; (ctx as any).globalAlpha = 0.08; ctx.beginPath(); ctx.arc(peakX, peakY, 10, 0, Math.PI * 2); ctx.fill(); (ctx as any).globalAlpha = 1;
  }

  // hover interactions
  function onMove(ev: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = Math.abs(mx - xAt(i));
      if (dx < best) { best = dx; nearest = i; }
    }
    setHover(nearest);
    ctx.clearRect(0, 0, W, H);
    setupLine(canvas, daily, null, setHover, theme); // base
    const X = xAt(nearest), Y = yAt(ys[nearest]);
    ctx.strokeStyle = 'rgba(148,163,184,0.35)'; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(X, padTop); ctx.lineTo(X, H - padBottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = theme.primary; ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill();
    labelBubble(ctx, `${fmtDateShort(xs[nearest])} • ₹${Number(ys[nearest]).toFixed(2)}`, X, Y - 14, 'auto', { popBg: theme.popBg, popText: theme.popText });
  }
  function onLeave() { setHover(null); ctx.clearRect(0, 0, W, H); setupLine(canvas, daily, null, setHover, theme); }

  canvas.onmousemove = onMove;
  canvas.onmouseleave = onLeave;
}

function labelBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right' | 'auto' = 'auto',
  theme: { popBg:string; popText:string }
) {
  ctx.font = '12px system-ui';
  const pad = 6;
  const m = ctx.measureText(text);
  const w = m.width + pad * 2;
  const h = 22;
  let bx = x - w / 2;
  const by = y - h - 6;
  if (align === 'left') bx = x - w;
  else if (align === 'right') bx = x - w + 2;

  ctx.fillStyle = theme.popBg;
  ctx.beginPath();
  if ((ctx as any).roundRect) (ctx as any).roundRect(bx, by, w, h, 6);
  else ctx.rect(bx, by, w, h);
  ctx.fill();

  ctx.fillStyle = theme.popText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5);
}

function ellipsize(label: string, max = 24) { const s = String(label ?? ''); return s.length > max ? s.slice(0, max - 1) + '…' : s; }

function drawPie(
  canvas: HTMLCanvasElement | null,
  rows: BreakdownRow[],
  theme: { text:string; muted:string; primary:string; primary600:string },
  mode: TopMode
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;

  const W = (canvas as any).style?.width ? parseInt((canvas as any).style.width, 10) : canvas.width;
  const H = (canvas as any).style?.height ? parseInt((canvas as any).style.height, 10) : canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad = 14, legendW = 152, leftW = W - legendW - pad * 3;
  const cx = pad + leftW / 2, cy = H / 2, r = Math.min(leftW / 2 - 4, H / 2 - 20);

  const qtyVals = rows.map((r) => r.qty || 0);
  const vals = (mode === 'qty' ? qtyVals : rows.map(r => r.total || 0));
  const total = vals.reduce((a, b) => a + b, 0);

  if (!total) {
    ctx.fillStyle = cssVar('--muted', '#64748b'); ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No data', cx, cy); return;
  }

  const colors = [
    cssVar('--primary', '#3b82f6'),
    cssVar('--success', '#22c55e'),
    '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899',
  ];

  let a0 = -Math.PI / 2;
  rows.forEach((row, i) => {
    const frac = vals[i] / total; if (!isFinite(frac) || frac <= 0) return;
    const a1 = a0 + frac * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = colors[i % colors.length]; ctx.fill();
    ctx.strokeStyle = 'rgba(17,24,39,0.06)'; ctx.lineWidth = 1; ctx.stroke();
    a0 = a1;
  });

  const legendX = pad + leftW + pad; let y = 20;
  ctx.font = '12px system-ui';
  rows.forEach((row, i) => {
    const frac = vals[i] / total; if (frac <= 0) return;
    const pct = (frac * 100).toFixed(1) + '%';
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(legendX, y - 9, 10, 10);
    ctx.fillStyle = cssVar('--text', '#111827');
    const label = `${ellipsize(row.name)} — ${pct}`;
    ctx.save(); ctx.beginPath(); ctx.rect(legendX + 16, y - 12, legendW - 24, 18); ctx.clip();
    ctx.fillText(label, legendX + 16, y); ctx.restore();
    y += 18;
  });
}
