import { getDb } from '@/app/lib/db';
import { DateTime } from 'luxon';

// Returns prefix like "QTN-25-26"
function currentFyPrefixIST() {
  const now = DateTime.now().setZone('Asia/Kolkata');
  const y = now.year;
  const m = now.month;
  const startYear = m >= 4 ? y : y - 1;
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, '0');
  const startYearShort = (startYear % 100).toString().padStart(2, '0');
  return `QTN-${startYearShort}-${endYearShort}`;
}

export async function generateQuotationNumber() {
  const db = await getDb();
  const prefix = currentFyPrefixIST();
  const { rows } = await db.query(
    `select quotation_number from quotations
     where quotation_number like $1 || '%'
     order by quotation_number desc
     limit 1`,
    [prefix]
  );
  let next = 1;
  if (rows.length) {
    const last = rows[0].quotation_number;           // QTN-25-26-00012
    const n = parseInt(last.split('-').pop() || '0', 10);
    next = n + 1;
  }
  return `${prefix}-${String(next).padStart(5, '0')}`;
}
