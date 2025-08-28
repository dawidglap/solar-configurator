// src/components_v2/canvas/hooks/useContainerSize.ts
'use client';

import { useEffect, useState } from 'react';

export function useContainerSize(
  ref: React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>
) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
