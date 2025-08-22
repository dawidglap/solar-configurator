'use client';

import dynamic from 'next/dynamic';

const KonvaCanvas = dynamic(() => import('./KonvaCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Canvas lädt…
    </div>
  ),
});

export default function CanvasStage() {
  return <KonvaCanvas />;
}
