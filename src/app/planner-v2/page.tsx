'use client';

import PlannerShell from '@/components_v2/layout/PlannerShell';
import ResponsiveGuard from '@/components_v2/layout/ResponsiveGuard';

export default function PlannerV2Page() {
  return (
    <main className="min-h-screen w-full">



      {/* ⬇️ blocco sotto 900px */}
      <ResponsiveGuard minWidth={900}>
        <PlannerShell />
      </ResponsiveGuard>
    </main>
  );
}
