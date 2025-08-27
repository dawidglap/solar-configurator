'use client';

import { useEffect, useState } from 'react';

export type OSMResult = { label: string; lat: number; lon: number };

export default function AddressSearchOSM({
  onPick,
  placeholder = 'Adresse suchen…',
}: {
  onPick: (r: OSMResult) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<OSMResult[]>([]);

  // debounce
  useEffect(() => {
    if (!q || q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(q)}` +
          `&format=json&addressdetails=1&limit=6&countrycodes=ch&accept-language=de`;

        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' },
        });
        const data: any[] = await res.json();
        const list: OSMResult[] = data.map((d) => ({
          lat: Number(d.lat),
          lon: Number(d.lon),
          label: d.display_name as string,
        }));
        setResults(list);
        setOpen(true);
        setActive(-1);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const select = (r: OSMResult) => {
    onPick(r);
    setQ(r.label);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((p) => (p < results.length - 1 ? p + 1 : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((p) => (p > 0 ? p - 1 : results.length - 1));
          } else if (e.key === 'Enter' && results.length > 0) {
            e.preventDefault();
            select(results[active >= 0 ? active : 0]);
          }
        }}
        placeholder={placeholder}
        className="w-full border px-3 py-1.5 text-sm text-center rounded-full"
        title="Adresse suchen"
      />

      {open && (results.length > 0 || loading) && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-white shadow">
          {loading && (
            <li className="px-3 py-2 text-xs text-neutral-500">Suche…</li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              onClick={() => select(r)}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-neutral-50 ${
                i === active ? 'bg-neutral-50' : ''
              }`}
              title={r.label}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
