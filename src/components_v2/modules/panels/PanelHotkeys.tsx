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
 *
 * In più: intercetta anche la S per il tool “snow guard” quando siamo nello step building.
 */
export default function PanelHotkeys(props: Props) {
  // 🔹 destrutturiamo i props per avere deps pulite
  const {
    disabled,
    selectedPanelId,
    onDelete,
    onDuplicate,
  } = props;

  // ====== Store (fallback / multi-select) ======
  const panels = usePlannerV2Store((s) => s.panels);
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);

  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);

  const deletePanelFromStore = usePlannerV2Store((s) => s.deletePanel);
  const deletePanelsBulk = usePlannerV2Store((s) => s.deletePanelsBulk);
  const duplicatePanelInStore = usePlannerV2Store((s) => s.duplicatePanel);

  // step/tool globali
  const step = usePlannerV2Store((s) => (s as any).step ?? (s as any).ui?.step);
  const tool = usePlannerV2Store((s) => (s as any).tool ?? (s as any).ui?.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  // mappa id -> panel (utile per verificare esistenza)
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  const useControlled =
    !!selectedPanelId && !!onDelete && !!onDuplicate;

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el as any).isContentEditable)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 0) se stai scrivendo, esci
      if (isTextTarget(e.target)) return;
      if (disabled) return;

      const key = e.key;

      // 1) HOTKEY TOOL: S → snow guard (solo building)
      if ((key === 's' || key === 'S') && step === 'building') {
        e.preventDefault();
        e.stopPropagation();
        setTool('draw-snow-guard' as any);
        return;
      }

      // gestione pannelli solo in step "modules" e tool "select"
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;

      // ===== Modalità CONTROLLATA (singolo pannello via props) =====
      if (useControlled) {
        const id = selectedPanelId!;
        const panel = panelById.get(id);
        if (!panel) return;

        // Copy
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') {
          e.preventDefault();
          PANEL_CLIPBOARD = [id];
          return;
        }

        // Paste → duplica il corrente
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'v') {
          e.preventDefault();
          onDuplicate!(id);
          return;
        }

        // Delete / Backspace
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          onDelete!(id);
          return;
        }

        // Cmd/Ctrl+D → duplica
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
          e.preventDefault();
          onDuplicate!(id);
          return;
        }

        return;
      }

      // ===== Modalità STORE (multi-select) =====

      // Cmd/Ctrl + A → select all
      if ((key === 'a' || key === 'A') && (e.metaKey || e.ctrlKey)) {
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

      // Cmd/Ctrl + C → copia
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        PANEL_CLIPBOARD = [...selectedIds];
        return;
      }

      // Cmd/Ctrl + V → incolla / duplica
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'v') {
        e.preventDefault();
        const toPaste = (PANEL_CLIPBOARD ?? []).filter((id) => panelById.has(id));
        if (!toPaste.length && selectedIds.length) {
          toPaste.push(...selectedIds);
        }
        if (!toPaste.length) return;

        const newIds: string[] = [];
        let k = 0;
        for (const id of toPaste) {
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }

      // DELETE / BACKSPACE → elimina selezione
      if (key === 'Delete' || key === 'Backspace') {
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

      // Cmd/Ctrl + D → duplica selezione
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
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
    // props destrutturati
    disabled,
    selectedPanelId,
    onDelete,
    onDuplicate,
    // altri
    useControlled,
    panels,
    selectedIds,
    step,
    tool,
    setTool,
    panelById,
    setSelectedPanels,
    deletePanelFromStore,
    deletePanelsBulk,
    duplicatePanelInStore,
  ]);

  return null;
}
