// app/reports/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const BarChart            = dynamic(() => import('recharts').then(m => m.BarChart),            { ssr: false });
const Bar                 = dynamic(() => import('recharts').then(m => m.Bar),                 { ssr: false });
const XAxis               = dynamic(() => import('recharts').then(m => m.XAxis),               { ssr: false });
const YAxis               = dynamic(() => import('recharts').then(m => m.YAxis),               { ssr: false });
const Tooltip             = dynamic(() => import('recharts').then(m => m.Tooltip),             { ssr: false });
// ✅ Fix Legend: return { default: m.Legend } to match next/dynamic expectations
const Legend              = dynamic(() => import('recharts').then(m => ({ default: m.Legend as any })), { ssr: false });
const LineChart           = dynamic(() => import('recharts').then(m => m.LineChart),           { ssr: false });
const Line                = dynamic(() => import('recharts').then(m => m.Line),                { ssr: false });
const CartesianGrid       = dynamic(() => import('recharts').then(m => m.CartesianGrid),       { ssr: false });
const ComposedChart       = dynamic(() => import('recharts').then(m => m.ComposedChart),       { ssr: false });

type DateRange = { from: string; to: string };
type DeadStockItem = { id: number; name: string; stock_qty: number; low_stock_threshold: number };
type MoversItem = { name: string; qty: number; revenue: number };
type Retention = { new_count: number; repeat_count: number };
type LowTrendPoint = { date: string; low_count: number };
type TaxMonth = { period: string; label: string; input_tax: number; output_tax: number; net_tax: number };
type TaxReport = {
  summary: { input_tax: number; output_tax: number; net_tax: number; status: "Payable" | "Credit" };
  months: TaxMonth[];
  from: string;
  to: string;
};

function toISODate(d: Date) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function todayISO() { return toISODate(new Date()); }
function ndaysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISODate(d); }
function inr(n: number) { return `INR (Rs/-) ${Number(n || 0).toFixed(2)}`; }

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function ReportsPage() {
  const [range, setRange] = useState<DateRange>({ from: ndaysAgoISO(30), to: todayISO() });
  const [deadDays, setDeadDays] = useState<number>(30);
  const [deadPage, setDeadPage] = useState<number>(1);
  const [deadPerPage] = useState<number>(50);
  const [deadTotalPages, setDeadTotalPages] = useState<number>(1);
  const [deadTotal, setDeadTotal] = useState<number>(0);

  const [deadStock, setDeadStock] = useState<DeadStockItem[]>([]);
  const [movers, setMovers] = useState<MoversItem[]>([]);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [lowTrend, setLowTrend] = useState<LowTrendPoint[]>([]);
  const [taxReport, setTaxReport] = useState<TaxReport | null>(null);
  const [taxGroup, setTaxGroup] = useState<"month" | "quarter">("month");
  const [includeDraftPurchases, setIncludeDraftPurchases] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  // Keep deps simple & stable for theme recalculation
  const depKey = typeof window !== 'undefined' ? document.documentElement.className : '';
  const theme = useMemo(() => ({
    text: cssVar('--text', '#111827'),
    muted: cssVar('--muted', '#64748b'),
    primary: cssVar('--primary', '#3b82f6'),
    success: cssVar('--success', '#22c55e'),
    danger: cssVar('--danger', '#ef4444'),
    warning: cssVar('--warning', '#f59e0b'),
  }), [depKey]);

  const loadAll = useCallback(async () => {
    setBusy(true);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      const taxQs = `${qs}&group=${taxGroup}&includeDraft=${includeDraftPurchases ? 1 : 0}`;
      const [ds, mv, re, lt, tx] = await Promise.all([
        fetch(`/api/reports/dead-stock?days=${deadDays}&page=${deadPage}&perPage=${deadPerPage}`).then(r => r.json()),
        fetch(`/api/reports/movers?${qs}`).then(r => r.json()),
        fetch(`/api/reports/customers/retention?${qs}`).then(r => r.json()),
        fetch(`/api/reports/low-stock-trends?${qs}`).then(r => r.json()),
        fetch(`/api/reports/tax?${taxQs}`).then(r => r.json()),
      ]);
      setDeadStock(Array.isArray(ds?.items) ? ds.items : []);
      setDeadTotalPages(Number(ds?.totalPages || 1));
      setDeadTotal(Number(ds?.total || 0));
      const mvItems = Array.isArray(mv?.items)
        ? mv.items.map((it: any) => ({
            ...it,
            qty: Number(it.qty || 0),
            revenue: Number(it.revenue || 0),
          }))
        : [];
      setMovers(mvItems);
      setRetention(re ?? null);
      setLowTrend(Array.isArray(lt?.items) ? lt.items : []);
      if (tx?.ok) {
        setTaxReport({
          summary: tx.summary,
          months: Array.isArray(tx.months) ? tx.months : [],
          from: tx.from,
          to: tx.to,
        });
      }
    } catch (e) {
      // non-fatal UI: keep previous state visible
      console.error('Failed to load reports:', e);
    } finally {
      setBusy(false);
    }
  }, [range.from, range.to, deadDays, deadPage, deadPerPage, taxGroup, includeDraftPurchases]);

  useEffect(() => {
    setDeadPage(1);
  }, [deadDays]);

  // Single effect, correctly depends on loadAll
  useEffect(() => { loadAll(); }, [loadAll]);

  const fast = useMemo(
    () => movers.slice().sort((a, b) => b.qty - a.qty).slice(0, 10),
    [movers]
  );
  const slow = useMemo(
    () => movers.slice().sort((a, b) => a.qty - b.qty).slice(0, 10),
    [movers]
  );

  const totals = useMemo(() => {
    const totalQty = movers.reduce((a, b) => a + Number(b.qty || 0), 0);
    const totalRevenue = movers.reduce((a, b) => a + Number(b.revenue || 0), 0);
    const deadCount = deadStock.length;
    const rep = retention?.repeat_count || 0;
    const neu = retention?.new_count || 0;
    return { totalQty, totalRevenue, deadCount, rep, neu };
  }, [movers, deadStock, retention]);

  const taxSummary = taxReport?.summary;
  const taxStatusLabel = taxSummary?.status === "Payable" ? "GST Payable" : "ITC Credit";
  const taxStatusColor = taxSummary?.status === "Payable" ? theme.warning : theme.success;
  const taxPrintUrl = `/reports/tax/print?from=${range.from}&to=${range.to}&group=${taxGroup}&includeDraft=${includeDraftPurchases ? 1 : 0}`;
  const taxCsvUrl = `/api/reports/tax/export?format=csv&from=${range.from}&to=${range.to}&group=${taxGroup}&includeDraft=${includeDraftPurchases ? 1 : 0}`;
  const taxExcelUrl = `/api/reports/tax/export?format=excel&from=${range.from}&to=${range.to}&group=${taxGroup}&includeDraft=${includeDraftPurchases ? 1 : 0}`;

  return (
    <div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <h1 style={{ margin: 0 }}>Reports</h1>
          <div style={{ display:'flex', gap:8, flexWrap: 'wrap' }}>
            <div className="card" style={{ padding:8 }}>
              <label style={{ fontSize:12, color:'var(--muted)' }}>From</label>
              <input
                className="input"
                type="date"
                value={range.from}
                onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              />
            </div>
            <div className="card" style={{ padding:8 }}>
              <label style={{ fontSize:12, color:'var(--muted)' }}>To</label>
              <input
                className="input"
                type="date"
                value={range.to}
                onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              />
            </div>
            <div className="card" style={{ padding:8 }}>
              <label style={{ fontSize:12, color:'var(--muted)' }}>
                Dead stock (no sales in last N days)
              </label>
              <input
                className="input"
                type="number"
                min={7}
                step={1}
                value={deadDays}
                onChange={e => setDeadDays(Number(e.target.value) || 30)}
              />
            </div>
            <button className="btn" onClick={loadAll} disabled={busy}>
              {busy ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12, marginTop:12 }}>
          <div className="card" style={{ padding:12 }}>
            <div className="muted">Total Revenue</div>
            <b style={{ fontSize:20 }}>{inr(totals.totalRevenue)}</b>
          </div>
          <div className="card" style={{ padding:12 }}>
            <div className="muted">Total Qty Sold</div>
            <b style={{ fontSize:20 }}>{totals.totalQty}</b>
          </div>
          <div className="card" style={{ padding:12 }}>
            <div className="muted">Dead Stock Items</div>
            <b style={{ fontSize:20 }}>{totals.deadCount}</b>
          </div>
          <div className="card" style={{ padding:12 }}>
            <div className="muted">Repeat vs New</div>
            <b style={{ fontSize:20 }}>{totals.rep} / {totals.neu}</b>
          </div>
        </div>

        {/* Tax summary */}
        <div className="card" style={{ padding:12, marginTop:12 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div>
              <h3 style={{ marginTop:0 }}>GST Tax Summary</h3>
              <div className="muted text-xs">
                Output GST = tax collected on sales • Input GST = tax paid on purchases (ITC)
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs muted">Grouping</label>
              <select
                className="input"
                value={taxGroup}
                onChange={(e) => setTaxGroup(e.target.value as "month" | "quarter")}
              >
                <option value="month">Monthly</option>
                <option value="quarter">Quarterly</option>
              </select>
              <label className="text-xs muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={includeDraftPurchases}
                  onChange={(e) => setIncludeDraftPurchases(e.target.checked)}
                />
                Include draft purchases
              </label>
              <a className="btn" href={taxPrintUrl} target="_blank" rel="noreferrer">Print Tax Report</a>
              <a className="btn" href={taxCsvUrl}>Export CSV</a>
              <a className="btn" href={taxExcelUrl}>Export Excel</a>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:12, marginTop:12 }}>
            <div className="card" style={{ padding:10 }}>
              <div className="muted">Output GST (Sales)</div>
              <b style={{ fontSize:18 }}>{inr(taxSummary?.output_tax || 0)}</b>
            </div>
            <div className="card" style={{ padding:10 }}>
              <div className="muted">Input GST (Purchases / ITC)</div>
              <b style={{ fontSize:18 }}>{inr(taxSummary?.input_tax || 0)}</b>
            </div>
            <div className="card" style={{ padding:10 }}>
              <div className="muted">{taxStatusLabel}</div>
              <b style={{ fontSize:18, color: taxStatusColor }}>{inr(Math.abs(taxSummary?.net_tax || 0))}</b>
            </div>
          </div>
          <div className="muted text-xs" style={{ marginTop: 8 }}>
            Draft purchases are {includeDraftPurchases ? "included" : "excluded"} in Input GST.
          </div>
        </div>

        {/* Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
          <div className="card" style={{ padding:12 }}>
            <h3 style={{ marginTop:0 }}>Fast Movers (Top 10 by Qty)</h3>
            <div style={{ width:'100%', height:300 }}>
              <ResponsiveContainer>
                <BarChart data={fast}>
                  <XAxis dataKey="name" hide />
                  <YAxis stroke={theme.muted} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="qty" name="Qty" fill={theme.primary} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ padding:12 }}>
            <h3 style={{ marginTop:0 }}>Slow Movers (Bottom 10 by Qty)</h3>
            <div style={{ width:'100%', height:300 }}>
              <ResponsiveContainer>
                <BarChart data={slow}>
                  <XAxis dataKey="name" hide />
                  <YAxis stroke={theme.muted} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="qty" name="Qty" fill={theme.warning} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ padding:12 }}>
            <h3 style={{ marginTop:0 }}>Repeat vs New Customers</h3>
            {(() => {
              const rep = retention?.repeat_count || 0;
              const neu = retention?.new_count || 0;
              const total = rep + neu || 1;
              const repPct = Math.round((rep / total) * 100);
              const neuPct = 100 - repPct;
              return (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="muted">Repeat</span>
                    <span><b>{rep}</b> ({repPct}%)</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="muted">New</span>
                    <span><b>{neu}</b> ({neuPct}%)</span>
                  </div>
                  <div className="glass" style={{ height: 12, borderRadius: 999, overflow: 'hidden', marginTop: 10 }}>
                    <div
                      style={{
                        width: `${repPct}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${theme.primary}, ${theme.success})`,
                      }}
                    />
                  </div>
                  <div className="muted text-xs mt-2">
                    Retention rate: <b>{repPct}%</b> of customers in this range are repeat buyers.
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="card" style={{ padding:12 }}>
            <h3 style={{ marginTop:0 }}>Low-stock Trend (signals)</h3>
            <div style={{ width:'100%', height:300 }}>
              <ResponsiveContainer>
                <LineChart data={lowTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.muted} />
                  <XAxis dataKey="date" stroke={theme.muted} />
                  <YAxis stroke={theme.muted} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="low_count" name="Low-stock items sold that day" stroke={theme.danger} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ padding:12, gridColumn: '1 / -1' }}>
            <h3 style={{ marginTop:0 }}>GST Computation (Output vs Input)</h3>
            <div className="muted text-xs" style={{ marginBottom: 6 }}>
              Net GST = Output − Input (draft purchases are excluded)
            </div>
            <div style={{ width:'100%', height:320 }}>
              <ResponsiveContainer>
                <ComposedChart data={taxReport?.months || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.muted} />
                  <XAxis dataKey="label" stroke={theme.muted} />
                  <YAxis stroke={theme.muted} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="output_tax" name="Output GST (Sales)" fill={theme.primary} />
                  <Bar dataKey="input_tax" name="Input GST (Purchases)" fill={theme.warning} />
                  <Line type="monotone" dataKey="net_tax" name="Net GST" stroke={theme.success} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Dead Stock table */}
        <div className="card" style={{ padding:12, marginTop:12 }}>
          <h3 style={{ marginTop:0 }}>Dead Stock (no sales in last {deadDays} days)</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width:60 }}>ID</th>
                  <th>Name</th>
                  <th style={{ width:120, textAlign:'right' }}>Stock</th>
                  <th style={{ width:160, textAlign:'right' }}>Low Threshold</th>
                </tr>
              </thead>
              <tbody>
                {deadStock.map(p => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                    <td style={{ textAlign:'right' }}>{p.stock_qty}</td>
                    <td style={{ textAlign:'right' }}>{p.low_stock_threshold}</td>
                  </tr>
                ))}
                {deadStock.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">Nothing qualifies as dead stock 🎉</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <div className="muted">
              Page {deadPage} of {deadTotalPages} • {deadTotal} items
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn"
                onClick={() => setDeadPage((p) => Math.max(1, p - 1))}
                disabled={deadPage <= 1}
              >
                Prev
              </button>
              <button
                className="btn"
                onClick={() => setDeadPage((p) => Math.min(deadTotalPages, p + 1))}
                disabled={deadPage >= deadTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
