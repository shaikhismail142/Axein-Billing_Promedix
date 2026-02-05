export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import Link from "next/link";
import { ensureActivated } from "@/app/lib/activation-guard";

export default async function InventoryHome() {
  await ensureActivated(true);

  return (
    <main className="container space-y-4">
      <div className="card p-4">
        <h1 className="text-xl font-bold">Inventory</h1>
        <p className="muted mt-1 text-sm">
          Core inventory tools: stock adjustments, purchases, batches/lots, and settings.
        </p>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <div className="glass p-4 rounded-2xl">
            <h2 className="font-semibold">Stock</h2>
            <ul className="mt-2 list-disc ml-5">
              <li><Link href="/inventory/adjustments" className="underline">Adjustments</Link> (stock in/out, damage, promo)</li>
              <li><Link href="/products" className="underline">Products</Link> (view stock on hand)</li>
            </ul>
          </div>

          <div className="glass p-4 rounded-2xl">
            <h2 className="font-semibold">Purchasing</h2>
            <ul className="mt-2 list-disc ml-5">
              <li><Link href="/inventory/purchases" className="underline">Purchases</Link> (draft → applied)</li>
              <li><Link href="/inventory/batches" className="underline">Batches / Lots</Link> (expiry, mfg)</li>
            </ul>
          </div>

          <div className="glass p-4 rounded-2xl">
            <h2 className="font-semibold">Reports</h2>
            <ul className="mt-2 list-disc ml-5">
              <li><Link href="/inventory/low-stock" className="underline">Low Stock</Link></li>
              <li><Link href="/inventory/expiry" className="underline">Near Expiry</Link></li>
            </ul>
          </div>

          <div className="glass p-4 rounded-2xl">
            <h2 className="font-semibold">Settings</h2>
            <ul className="mt-2 list-disc ml-5">
              <li><Link href="/inventory/settings" className="underline">Inventory Settings</Link> (negative stock, alerts)</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
