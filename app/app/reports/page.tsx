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
const PieChart            = dynamic(() => import('recharts').then(m => m.PieChart),            { ssr: false });
const Pie                 = dynamic(() => import('recharts').then(m => m.Pie),                 { ssr: false });
const LineChart           = dynamic(() => import('recharts').then(m => m.LineChart),           { ssr: false });
const Line                = dynamic(() => import('recharts').then(m => m.Line),                { ssr: false });
const CartesianGrid       = dynamic(() => import('recharts').then(m => m.CartesianGrid),       { ssr: false });

type DateRange = { from: string; to: string };
type DeadStockItem = { id: number; name: string; stock_qty: number; low_stock_threshold: number };
type MoversItem = { name: string; qty: number; revenue: number };
type Retention = { new_count: number; repeat_count: number };
type LowTrendPoint = { date: string; low_count: number };

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
      const [ds, mv, re, lt] = await Promise.all([
        fetch(`/api/reports/dead-stock?days=${deadDays}&page=${deadPage}&perPage=${deadPerPage}`).then(r => r.json()),
        fetch(`/api/reports/movers?${qs}`).then(r => r.json()),
        fetch(`/api/reports/customers/retention?${qs}`).then(r => r.json()),
        fetch(`/api/reports/low-stock-trends?${qs}`).then(r => r.json()),
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
    } catch (e) {
      // non-fatal UI: keep previous state visible
      console.error('Failed to load reports:', e);
    } finally {
      setBusy(false);
    }
  }, [range.from, range.to, deadDays, deadPage, deadPerPage]);

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
            <div style={{ width:'100%', height:300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Repeat', value: retention?.repeat_count || 0 },
                      { name: 'New', value: retention?.new_count || 0 },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={120}
                    label
                    fill={theme.primary}
                  />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
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
