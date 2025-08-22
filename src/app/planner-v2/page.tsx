'use client';

import PlannerShell from '@/components_v2/layout/PlannerShell';
import ResponsiveGuard from '@/components_v2/layout/ResponsiveGuard';

export default function PlannerV2Page() {
  return (
    <main className="min-h-screen w-full">
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <h1 className="mb-3 text-xl font-semibold">Planner V2 (Beta)</h1>
        <p className="mb-4 text-sm text-neutral-600">
          Canva-ähnlicher Editor für PV-Planung – Rastermodus auf Screenshot.
        </p>
      </div>

      {/* ⬇️ blocco sotto 900px */}
      <ResponsiveGuard minWidth={900}>
        <PlannerShell />
      </ResponsiveGuard>
    </main>
  );
}
