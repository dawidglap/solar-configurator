// src/components_v2/canvas/panels/PanelHotkeys.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { usePlannerV2Store } from '../../state/plannerV2Store';

type Props = {
  disabled: any;
  /** Modalità controllata (singolo pannello): se presente, usa queste props */
  selectedPanelId?: string;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  
};

/** Clipboard interna (ids dei pannelli copiati) */
let PANEL_CLIPBOARD: string[] = [];

/**
 * Registra hotkeys per pannelli.
 * - Senza props: usa la selezione dallo store (multi-select).
 * - Con props: gestisce Delete / Duplica / Copy/Paste sul singolo `selectedPanelId`.
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

  // guard su step/tool
  const step = usePlannerV2Store((s) => (s as any).step ?? (s as any).ui?.step);
  const tool = usePlannerV2Store((s) => (s as any).tool ?? (s as any).ui?.tool);

  // mappa id -> panel (utile per verificare esistenza e roof)
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  const useControlled = !!props.selectedPanelId && !!props.onDelete && !!props.onDuplicate;

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Limita alle condizioni operative (come prima)
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;
      if (isTextTarget(e.target)) return;
      if (props.disabled) return;


      // ===== Modalità CONTROLLATA (singolo pannello via props) =====
      if (useControlled) {
        const id = props.selectedPanelId!;

        // Copy
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          PANEL_CLIPBOARD = [id];
          return;
        }

        // Paste → duplica il corrente (o quello copiato)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          // in modalità controllata non gestiamo multi-paste: duplichiamo il corrente
          props.onDuplicate!(id);
          return;
        }

        // Delete / Backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          props.onDelete!(id);
          return;
        }

        // (opzionale) Cmd/Ctrl+D come alias di paste/duplicate
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          props.onDuplicate!(id);
          return;
        }

        return;
      }

      // ===== Modalità STORE (multi-select) =====

      // ESC → clear
      if (e.key === 'Escape') {
        if (selectedIds.length) {
          e.preventDefault();
          clearPanelSelection();
        }
        return;
      }

      // Cmd/Ctrl + A → select all (stessa falda del primo selezionato; fallback: tutti)
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

      // Cmd/Ctrl + C → copia selezione corrente nella clipboard
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        PANEL_CLIPBOARD = [...selectedIds];
        return;
      }

      // Cmd/Ctrl + V → incolla = duplica elementi in clipboard con offset a cascata
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const toPaste = (PANEL_CLIPBOARD ?? []).filter((id) => panelById.has(id));
        if (!toPaste.length && selectedIds.length) {
          // fallback: se non c'è nulla copiato, duplica la selezione corrente
          toPaste.push(...selectedIds);
        }
        if (!toPaste.length) return;

        const newIds: string[] = [];
        let k = 0;
        for (const id of toPaste) {
          // offset progressivo: 18px, 36px, 54px...
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
        }
        if (newIds.length) setSelectedPanels(newIds);
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

      // (opzionale) Cmd/Ctrl + D → duplica selezione (alias di incolla/duplica)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        const newIds: string[] = [];
        let k = 0;
        for (const id of selectedIds) {
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
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
