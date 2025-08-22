'use client';

import { useEffect, useState } from 'react';

export type GeocodeResult = { label: string; lat: number; lon: number };

export default function AddressSearch({
  onPick,
  value,
  onQueryChange,
  placeholder = 'Adresse suchen…',
  country = 'ch',
  language = 'de',
}: {
  onPick: (r: GeocodeResult) => void;
  value?: string;
  onQueryChange?: (q: string) => void;
  placeholder?: string;
  country?: string;
  language?: string;
}) {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const [q, setQ] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeocodeResult[]>([]);

  useEffect(() => setQ(value ?? ''), [value]);

  // debounce
  useEffect(() => {
    if (!q || !key) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
          q
        )}.json?key=${key}&limit=6&language=${language}&country=${country}`;
        const res = await fetch(url);
        const fc = await res.json();
        const list: GeocodeResult[] = (fc?.features ?? []).map((f: any) => {
          const coord =
            f?.center ??
            (Array.isArray(f?.geometry?.coordinates)
              ? f.geometry.coordinates
              : null);
          const lon = Number(coord?.[0]);
          const lat = Number(coord?.[1]);
          const label =
            f?.place_name_de ??
            f?.place_name ??
            f?.text ??
            f?.properties?.label ??
            f?.properties?.name ??
            `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          return { label, lat, lon };
        });
        setResults(list);
        setOpen(true);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, key, country, language]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          onQueryChange?.(v);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault();
            onPick(results[0]);
            setQ(results[0].label);
            onQueryChange?.(results[0].label);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border px-3 py-1.5 text-sm"
        title="Adresse suchen"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow">
          {loading && (
            <div className="px-3 py-2 text-xs text-neutral-500">Suche…</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.label}-${i}`}
              onClick={() => {
                onPick(r);
                setQ(r.label);
                onQueryChange?.(r.label);
                setOpen(false);
              }}
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-neutral-50"
              title={r.label}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
