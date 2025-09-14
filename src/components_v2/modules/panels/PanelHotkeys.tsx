// src/components_v2/canvas/panels/PanelHotkeys.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { usePlannerV2Store } from '../../state/plannerV2Store';

type Props = {
  /** Modalità controllata (singolo pannello): se presente, usa queste props */
  selectedPanelId?: string;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
};

/**
 * Registra hotkeys per pannelli.
 * - Senza props: usa la selezione dal global store (multi-select come prima).
 * - Con props: gestisce Delete/Duplica sul singolo `selectedPanelId` passato dal parent.
 */
export default function PanelHotkeys(props: Props) {
  // ====== Store (fallback / multi-select) ======
  const panels = usePlannerV2Store((s) => s.panels);
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);

  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);
  const clearPanelSelection = usePlannerV2Store((s) => s.clearPanelSelection);

  const deletePanelFromStore = usePlannerV2Store((s) => s.deletePanel);
  const deletePanelsBulk = usePlannerV2Store((s) => s.deletePanelsBulk);
  const duplicatePanelInStore = usePlannerV2Store((s) => s.duplicatePanel);

  // se hai step/tool nello store, mantieni i guard
  const step = usePlannerV2Store((s) => (s as any).ui?.step ?? (s as any).step);
  const tool = usePlannerV2Store((s) => (s as any).ui?.tool ?? (s as any).tool);

  // mappa id -> panel per accesso rapido (serve per Cmd/Ctrl+A)
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  const useControlled = !!props.selectedPanelId && !!props.onDelete && !!props.onDuplicate;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Limita alle condizioni operative (come prima)
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;

      // ===== Modalità CONTROLLATA (singolo pannello via props) =====
      if (useControlled) {
        const id = props.selectedPanelId!;
        // Nessun ESC/Cmd+A in questa modalità (sono funzioni da multi-select)
        // Delete / Backspace → elimina
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          props.onDelete!(id);
          return;
        }
        // Cmd/Ctrl + D → duplica
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          props.onDuplicate!(id);
          return;
        }
        return;
      }

      // ===== Modalità STORE (multi-select, comportamento originale) =====

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
          .filter((p) => (targetRoofId ? p.roofId === targetRoofId : true))
          .map((p) => p.id);

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
          deletePanelFromStore(selectedIds[0]);
        } else {
          selectedIds.forEach((id) => deletePanelFromStore(id));
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
          const nid = duplicatePanelInStore(id, 18);
          if (nid) newIds.push(nid);
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    // props (modalità controllata)
    useControlled,
    props.selectedPanelId,
    props.onDelete,
    props.onDuplicate,
    // store (modalità multi-select)
    panels,
    selectedIds,
    step,
    tool,
    panelById,
    clearPanelSelection,
    setSelectedPanels,
    deletePanelFromStore,
    deletePanelsBulk,
    duplicatePanelInStore,
  ]);

  return null;
}
