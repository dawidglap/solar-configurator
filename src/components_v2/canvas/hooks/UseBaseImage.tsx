'use client';

import { useEffect, useState } from 'react';

type Size = { w: number; h: number };

/**
 * Carica l'immagine di sfondo e calcola il "cover fit" per centrarla nello stage.
 * Chiama onCoverComputed(cover, ox, oy) quando img o size cambiano.
 */
export function useBaseImage({
  url,
  size,
  onCoverComputed,
}: {
  url?: string | null;
  size: Size;
  onCoverComputed?: (cover: number, ox: number, oy: number) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  // load image
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = url;
    return () => setImg(null);
  }, [url]);

  // compute cover + centered offsets
  useEffect(() => {
    if (!img || !size.w || !size.h) return;
    const cover = Math.max(size.w / img.naturalWidth, size.h / img.naturalHeight);
    const sw = img.naturalWidth * cover;
    const sh = img.naturalHeight * cover;
    const ox = (size.w - sw) / 2;
    const oy = (size.h - sh) / 2;
    onCoverComputed?.(cover, ox, oy);
  }, [img, size.w, size.h, onCoverComputed]);

  return { img };
}
