'use client';

import { useEffect, useRef } from 'react';

function isTypingInField() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

export default function PanelHotkeys({
  selectedPanelId,
  onDelete,
  onDuplicate,
}: {
  selectedPanelId?: string;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const idRef = useRef<string | undefined>(selectedPanelId);
  const onDeleteRef = useRef(onDelete);
  const onDuplicateRef = useRef(onDuplicate);

  useEffect(() => { idRef.current = selectedPanelId; }, [selectedPanelId]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);
  useEffect(() => { onDuplicateRef.current = onDuplicate; }, [onDuplicate]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const id = idRef.current;
      if (!id) return;
      if (isTypingInField()) return;

      const k = ev.key;

      // Delete / Backspace
      if (k === 'Backspace' || k === 'Delete' || k === 'Del' || k === 'U+007F') {
        ev.preventDefault();
        onDeleteRef.current(id);
        return;
      }

      // Duplica: tasto "d" (senza meta/ctrl/alt/shift)
      if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && k.toLowerCase() === 'd') {
        ev.preventDefault();
        onDuplicateRef.current(id);
        return;
      }
    };

    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as any);
  }, []);

  return null;
}
