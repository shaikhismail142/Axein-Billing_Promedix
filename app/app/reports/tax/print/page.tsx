export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { pool } from "@/lib/db";
import { getTaxReport } from "@/app/lib/tax-report";

function inr(n: number) {
  const v = Number(n || 0);
  return `INR (Rs/-) ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function TaxPrintPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; group?: string; includeDraft?: string };
}) {
  const group = searchParams?.group === "quarter" ? "quarter" : "month";
  const includeDraft = searchParams?.includeDraft === "1";
  const { from, to, summary, months } = await getTaxReport(searchParams?.from, searchParams?.to, {
    group,
    includeDraft,
  });

  const bizRs = await pool.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
  const biz = bizRs.rows?.[0]?.value_json || {};

  const statusLabel = summary.status === "Payable" ? "GST Payable" : "ITC Credit";
  const statusColor = summary.status === "Payable" ? "#b45309" : "#065f46";

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>GST Summary {from} to {to}</title>
        <style>{`
          @page { size: A4; margin: 12mm; }
          @media print {
            .noprint { display: none !important; }
          }
          body { font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 24px; color: #0b1220; }
          h1,h2,h3 { margin: 0; }
          .muted { color: #64748b; }
          .header { border-radius: 14px; overflow: hidden; border: 1px solid #e5e7eb; }
          .header-top { background: #1f4a8f; color: #fff; padding: 16px 18px; display:flex; justify-content:space-between; gap:12px; }
          .title { font-size: 22px; font-weight: 700; letter-spacing: 0.08em; }
          .summary { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin-top: 12px; }
          .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border-top: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
          th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
          .right { text-align: right; }
        `}</style>
      </head>
      <body>
        <div className="noprint" style={{ marginBottom: 12 }}>
          <button id="printBtn" style={{ border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 6 }}>Print</button>
          <script
            dangerouslySetInnerHTML={{
              __html: `
                addEventListener('load', () => {
                  const b = document.getElementById('printBtn');
                  if (b) b.addEventListener('click', () => window.print());
                });
              `,
            }}
          />
        </div>

        <div className="header">
          <div className="header-top">
            <div>
              <div className="title">GST SUMMARY</div>
              <div style={{ marginTop: 6, fontWeight: 600 }}>{biz.name || "Your Business"}</div>
              {biz.address && <div style={{ opacity: 0.85 }}>{biz.address}</div>}
              {biz.gstin && <div>GSTIN: {biz.gstin}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div><b>Period:</b> {from} to {to}</div>
              <div><b>Grouping:</b> {group === "quarter" ? "Quarterly" : "Monthly"}</div>
              <div><b>Draft Purchases:</b> {includeDraft ? "Included" : "Excluded"}</div>
              <div><b>Generated:</b> {new Date().toLocaleString("en-IN")}</div>
            </div>
          </div>
        </div>

        <div className="summary">
          <div className="card">
            <div className="muted">Output GST (Sales)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{inr(summary.output_tax)}</div>
          </div>
          <div className="card">
            <div className="muted">Input GST (Purchases / ITC)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{inr(summary.input_tax)}</div>
          </div>
          <div className="card">
            <div className="muted">{statusLabel}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: statusColor }}>{inr(Math.abs(summary.net_tax))}</div>
          </div>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          Output GST = tax collected on invoices. Input GST = tax paid on purchases (eligible ITC). Net = Output − Input.
          Draft purchases are {includeDraft ? "included" : "excluded"}.
        </div>

        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th className="right">Output GST</th>
              <th className="right">Input GST</th>
              <th className="right">Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period}>
                <td>{m.label}</td>
                <td className="right">{inr(m.output_tax)}</td>
                <td className="right">{inr(m.input_tax)}</td>
                <td className="right">{inr(m.net_tax)}</td>
              </tr>
            ))}
            {months.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">No tax data for the selected period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </body>
    </html>
  );
}
