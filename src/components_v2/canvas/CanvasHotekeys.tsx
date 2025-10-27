// src/components_v2/canvas/CanvasHotkeys.tsx
'use client';
import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { usePlannerV2Store } from '../state/plannerV2Store';

// helper — valuta se l'elemento attivo è campo di testo
function isTypingInField() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

export default function CanvasHotkeys() {
  // store actions/selectors che useremo (CanvasStage usa addRoof/addZone/select)
  const addRoof = usePlannerV2Store(s => s.addRoof);
  const addZone = usePlannerV2Store(s => s.addZone);
  const updateRoof = usePlannerV2Store(s => s.updateRoof);
  const layers = usePlannerV2Store(s => s.layers);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const select = usePlannerV2Store(s => s.select);

  // clipboard in-memory (non system clipboard)
  const clipRef = useRef<{
    type: 'roof'|'zone'|null;
    payload?: any;
  }>({ type: null });

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (isTypingInField()) return;

      const isMeta = ev.metaKey || ev.ctrlKey;
      const k = ev.key.toLowerCase();

      // COPY (Cmd/Ctrl + C)
      if (isMeta && k === 'c') {
        // prefer roof selection (selectedId refers to roofs in this app)
        if (selectedId) {
          const roof = layers.find(l => l.id === selectedId);
          if (roof) {
            ev.preventDefault();
            clipRef.current = {
              type: 'roof',
              payload: {
                points: roof.points.map((p: any) => ({ ...p })),
                name: roof.name,
                azimuthDeg: (roof as any).azimuthDeg,
              },
            };
            // optionally visual feedback: toast (not implemented here)
            return;
          }
        }

        // fallback: if you have a zone selection system, copy the zone similarly.
        // if no roof/zone selected => ignore and let browser handle copy
      }

      // PASTE (Cmd/Ctrl + V)
      if (isMeta && k === 'v') {
        const clip = clipRef.current;
        if (!clip || !clip.type) return; // nothing to paste

        ev.preventDefault();

        if (clip.type === 'roof' && clip.payload) {
          // duplicate roof: new id, slight offset
          const old = clip.payload;
          const dx = 20; const dy = 20; // px immagine
          const newPoints = old.points.map((p: any) => ({ x: p.x + dx, y: p.y + dy }));
          const newId = nanoid();
          addRoof({
            id: newId,
            name: `${old.name ?? 'Roof'} (copy)`,
            points: newPoints,
            azimuthDeg: old.azimuthDeg,
          });
          // select nuovo tetto
          select(newId);
          return;
        }

        if (clip.type === 'zone' && clip.payload) {
          // esempio: payload = { roofId, points }
          const { roofId, points } = clip.payload;
          // se il roofId esiste ancora -> addZone
          const roofExists = layers.some(l => l.id === roofId);
          if (roofExists) {
            const newId = nanoid();
            addZone({ id: newId, roofId, type: 'riservata', points: points.map((p:any)=>({x:p.x+10,y:p.y+10})) });
            return;
          } else {
            // fallback: incolla come nuova roof (opzionale) oppure notifica
            const newRoofId = nanoid();
            addRoof({ id: newRoofId, name: 'Roof from zone', points: points.map((p:any)=>({x:p.x+10,y:p.y+10})) });
            select(newRoofId);
            return;
          }
        }
      }
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true } as any);
  }, [addRoof, addZone, updateRoof, layers, selectedId, select]);

  return null;
}
