// src/components_v2/canvas/RoofEditorLayer.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Circle as KonvaCircle } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };

export default function RoofEditorLayer() {
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const roof       = usePlannerV2Store((s) => s.layers.find((l) => l.id === s.selectedId));
  const updateRoof = usePlannerV2Store((s) => s.updateRoof);
  const snap       = usePlannerV2Store((s) => s.snapshot);

  // editabile solo se: selezione valida, >=3 punti e bounds noti
  if (!selectedId || !roof || (roof.points?.length ?? 0) < 3 || !snap.width || !snap.height) {
    return null;
  }

  const W = snap.width!;
  const H = snap.height!;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // ---- Stato UI locale per drag fluido (non tocchiamo lo store durante il drag)
  const [livePts, setLivePts] = useState<Pt[] | null>(null);

  // se cambia il tetto selezionato o i punti nello store, resetta il live
  useEffect(() => {
    setLivePts(null);
  }, [roof.id, roof.points]);

  // i punti da disegnare: live se esiste, altrimenti quelli dello store
  const points: Pt[] = useMemo(() => (livePts ?? (roof.points as Pt[])), [livePts, roof.points]);

  return (
    <>
      {points.map((p, i) => (
        <KonvaCircle
          key={i}
          x={p.x}   // posizioni in coordinate "immagine" (locali al Group)
          y={p.y}
          radius={5}
          fill="#ffffff"
          stroke="#0ea5e9"
          strokeWidth={1.5}
          draggable
          onDragStart={() => {
            // snapshot iniziale per UI: copia profonda dei punti store
            if (!livePts) setLivePts((roof.points as Pt[]).map(q => ({ ...q })));
          }}
          onDragMove={(e) => {
            const node = e.target;
            const parent = node.getParent();
            if (!parent) return; // ← guardia: parent può essere null

            const abs = node.getAbsolutePosition();

            // Converti ABS(Stage) -> LOCAL(Group) usando l'inversa del transform del parent
            const inv = parent.getAbsoluteTransform().copy();
            inv.invert();
            const local = inv.point(abs);

            const cx = clamp(local.x, 0, W);
            const cy = clamp(local.y, 0, H);

            // 1) Posiziona il nodo in coordinate locali (evita “teletrasporti”)
            node.position({ x: cx, y: cy });

            // 2) Aggiorna la copia locale (UI) per far ridisegnare il cerchio al punto corretto
            setLivePts((prev) => {
              const base = prev ?? (roof.points as Pt[]).map(q => ({ ...q }));
              const next = base.map((pt, idx) => (idx === i ? { x: cx, y: cy } : pt));
              return next;
            });
          }}
          onDragEnd={(e) => {
            // commit definitivo nello store in coordinate immagine clampate
            const node = e.target;
            const parent = node.getParent();
            if (!parent) return; // ← guardia: parent può essere null

            const abs = node.getAbsolutePosition();

            const inv = parent.getAbsoluteTransform().copy();
            inv.invert();
            const local = inv.point(abs);

            const cx = clamp(local.x, 0, W);
            const cy = clamp(local.y, 0, H);

            const commit = (livePts ?? (roof.points as Pt[])).map((pt, idx) =>
              idx === i ? { x: cx, y: cy } : pt
            );

            updateRoof(roof.id, { points: commit });
            setLivePts(null); // rientra in “controlled by store”
          }}
          onMouseEnter={(e) => {
            const st = e.target.getStage();
            if (st?.container()) st.container().style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            const st = e.target.getStage();
            if (st?.container()) st.container().style.cursor = 'default';
          }}
          hitStrokeWidth={14}
          perfectDrawEnabled={false}
          shadowBlur={2}
          shadowColor="#ffffff"
          shadowOpacity={0.9}
        />
      ))}
    </>
  );
}
