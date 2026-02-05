// app/activate/page.tsx
import 'server-only';
import LicensePanel from './_components/LicensePanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ActivatePage() {
  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Product Activation</h1>
      <LicensePanel />
    </main>
  );
}
