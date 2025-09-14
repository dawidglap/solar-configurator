// src/components_v2/canvas/panels/PanelHotkeys.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { usePlannerV2Store } from '../../state/plannerV2Store';

export default function PanelHotkeys() {
  const panels = usePlannerV2Store(s => s.panels);
  const selectedIds = usePlannerV2Store(s => s.selectedPanelIds);

  const setSelectedPanels = usePlannerV2Store(s => s.setSelectedPanels);
  const clearPanelSelection = usePlannerV2Store(s => s.clearPanelSelection);

  const deletePanel = usePlannerV2Store(s => s.deletePanel);
  const deletePanelsBulk = usePlannerV2Store(s => s.deletePanelsBulk);
  const duplicatePanel = usePlannerV2Store(s => s.duplicatePanel);

  // se hai step/tool, tieni i guard; altrimenti toglili pure
  const step = usePlannerV2Store(s => (s as any).ui?.step ?? (s as any).step);
  const tool = usePlannerV2Store(s => (s as any).ui?.tool ?? (s as any).tool);

  // mappa id -> panel per accesso rapido
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;

      // ESC → clear
      if (e.key === 'Escape') {
        if (selectedIds.length) {
          e.preventDefault();
          clearPanelSelection();
        }
        return;
      }

      // Cmd/Ctrl+A → select all (della stessa falda del primo selezionato; fallback: tutti)
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();

        let targetRoofId: string | undefined;
        if (selectedIds.length) {
          const first = panelById.get(selectedIds[0]);
          targetRoofId = first?.roofId;
        }

        const ids = panels
          .filter(p => (targetRoofId ? p.roofId === targetRoofId : true))
          .map(p => p.id);

        setSelectedPanels(ids);
        return;
      }

      // DELETE / BACKSPACE → elimina selezione (multi o singolo)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        if (deletePanelsBulk) {
          deletePanelsBulk(selectedIds);
        } else if (selectedIds.length === 1) {
          deletePanel(selectedIds[0]);
        } else {
          selectedIds.forEach(id => deletePanel(id));
        }
        setSelectedPanels([]);
        return;
      }

      // D / d → duplica selezione (tutti)
      if (e.key === 'd' || e.key === 'D') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        const newIds: string[] = [];
        for (const id of selectedIds) {
          const nid = duplicatePanel(id, 18);
          if (nid) newIds.push(nid);
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    panels,
    selectedIds,
    step,
    tool,
    panelById,
    clearPanelSelection,
    setSelectedPanels,
    deletePanel,
    deletePanelsBulk,
    duplicatePanel,
  ]);

  return null;
}
