'use client';

import PlannerShell from '@/components_v2/layout/PlannerShell';
import ResponsiveGuard from '@/components_v2/layout/ResponsiveGuard';

export default function PlannerV2Page() {
  return (
    <main className="min-h-screen w-full">
   <div className="mx-auto max-w-[1440px] px-4 py-2 ">
  <h1 className="mb-1 text-base font-semibold">SOLA <span className='text-xs font-light text-neutral-700'>planer_v2.0</span></h1>
  <p className="text-xs text-neutral-600">
    Ihre PV-Anlage gestalten
  </p>
</div>


      {/* ⬇️ blocco sotto 900px */}
      <ResponsiveGuard minWidth={900}>
        <PlannerShell />
      </ResponsiveGuard>
    </main>
  );
}
