'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FiMonitor, FiChevronRight } from 'react-icons/fi';

export default function ResponsiveGuard({
  minWidth = 900,
  children,
}: {
  minWidth?: number;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Evita flash SSR: finché width è null, non blocchiamo
  if (width !== null && width < minWidth) {
    return (
      <div className="flex min-h-[calc(100vh-0px)] w-full items-center justify-center bg-neutral-50">
        <div className="mx-4 max-w-xl rounded-2xl border bg-white p-6 text-center shadow">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
            <FiMonitor className="h-6 w-6 text-neutral-700" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">
            Dieses Planungswerkzeug ist nur auf Tablet & Desktop verfügbar
          </h2>
          <p className="mx-auto mb-4 max-w-md text-sm text-neutral-600">
            Bitte verwenden Sie ein größeres Display (≥ {minWidth}px Breite), um den PV-Editor zu öffnen.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
            title="Zur Startseite"
          >
            Zur Startseite <FiChevronRight />
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
