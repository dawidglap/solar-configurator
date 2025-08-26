'use client';
import { useEffect, useState } from 'react';

let cache: Record<string, HTMLImageElement | 'loading' | 'error'> = {};

export function usePanelTexture(url?: string) {
    const [img, setImg] = useState<HTMLImageElement | null>(null);

    useEffect(() => {
        if (!url) { setImg(null); return; }
        const cached = cache[url];
        if (cached && cached !== 'loading' && cached !== 'error') {
            setImg(cached as HTMLImageElement);
            return;
        }
        if (cached === 'loading') return;

        cache[url] = 'loading';
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => { cache[url!] = el; setImg(el); };
        el.onerror = () => { cache[url!] = 'error'; setImg(null); };
        el.src = url;
    }, [url]);

    return img;
}
