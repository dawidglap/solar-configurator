'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type OverlayPortalProps = {
  children?: React.ReactNode;
  /** id del nodo DOM dove montare l'overlay (unico per l'app) */
  containerId?: string;
  /** className applicata al container creato (fixed + z-index + pointer policy) */
  className?: string;
};

/**
 * Portal per montare overlay globali sopra la mappa (toolbar, sheet, banners, ecc.).
 * PR-0/B: non viene ancora usato in pagina, è solo infrastruttura pronta.
 *
 * Nota: di default il container ha pointer-events:none; i figli possono
 * sovrascrivere con pointer-events:auto per diventare cliccabili.
 */
export default function OverlayPortal({
  children,
  containerId = 'planner-overlay-root',
  className = 'pointer-events-none fixed inset-0 z-[100]',
}: OverlayPortalProps) {
  const [mounted, setMounted] = useState(false);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let el = document.getElementById(containerId) as HTMLDivElement | null;

    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.className = className;
      document.body.appendChild(el);
    } else {
      // idempotente: assicura className coerente
      el.className = className;
    }

    elRef.current = el;
    setMounted(true);

    // Non smontiamo il container su unmount (SPA): può essere riutilizzato.
    // Se un dom-clean profondo servirà, lo gestiremo in un util separato.
  }, [containerId, className]);

  if (!mounted || !elRef.current) return null;
  return createPortal(children, elRef.current);
}
