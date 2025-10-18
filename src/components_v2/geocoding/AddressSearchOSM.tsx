// src/components_v2/geocoding/AddressSearchOSM.tsx
'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';

export type OSMResult = { label: string; lat: number; lon: number };

type Props = {
  onPick: (r: OSMResult) => void;
  placeholder?: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatches(label: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return label;
  try {
    const re = new RegExp(escapeRegExp(q), 'ig');
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(label)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (start > lastIndex) parts.push(label.slice(lastIndex, start));
      parts.push(<mark key={`${start}-${end}`} className="bg-yellow-200/60 rounded-sm px-0.5">{label.slice(start, end)}</mark>);
      lastIndex = end;
      // protezione da regex senza avanzamento
      if (re.lastIndex === start) re.lastIndex++;
    }
    if (lastIndex < label.length) parts.push(label.slice(lastIndex));
    return parts;
  } catch {
    return label;
  }
}


type Suggest = { label: string; lat: number; lon: number };

export default function AddressSearchOSM({ onPick, placeholder = 'Adresse suchen…' }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<Suggest[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Riferimenti: ancora (input) e dropdown (in portal)
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Nodo portal creato a runtime
  const [portalNode] = useState(() => {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.className = 'osm-dropdown-portal-root ';
      return el;
    }
    return null;
  });

  // Monta/smonta il portal node
  useEffect(() => {
    if (!portalNode || typeof document === 'undefined') return;
    document.body.appendChild(portalNode);
    return () => {
      try {
        document.body.removeChild(portalNode);
      } catch {}
    };
  }, [portalNode]);

  // Debounce ricerca
  useEffect(() => {
    setErr(null);
    if (!q || q.trim().length < 3) {
      setResults([]);
      setOpen(false);
      setActive(-1);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setLoading(true);
          const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(q)}` +
          `&format=json` +
          `&addressdetails=1` +
          `&limit=8` +
         `&countrycodes=ch`;  

         
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            // User-Agent consigliato da Nominatim (qui un fallback generico)
            'User-Agent': 'SOLA-Planner/1.0 (contact: your-email@example.com)',
          },
        });
  const json = await res.json();

// --- analizza la query utente per capire se ha scritto CAP o numero civico ---
const ql = q.trim().toLowerCase();
const capInQuery = (ql.match(/\b\d{4}\b/) || [null])[0];                 // es. "9450" oppure null
const houseTokenMatch = ql.match(/\b(\d{1,3}(?:[a-z]|(?:\.\d+)?)?)\b/);  // 4, 4a, 4.1, ecc.
let houseInQuery: string | null = houseTokenMatch ? houseTokenMatch[1] : null;
// se quel numero coincide con il CAP, non trattarlo come house number
if (houseInQuery && capInQuery && houseInQuery === capInQuery) houseInQuery = null;

// Costruiamo prima un array che può contenere Suggest | null
const tmp: Array<Suggest | null> = (json ?? []).map((r: any): Suggest | null => {
  const a = r.address || {};
  const street =
    a.road || a.pedestrian || a.footway || a.path || a.cycleway || a.residential;
  const number = a.house_number;
  const postcode = a.postcode;
  const city = a.city || a.town || a.village || a.hamlet || a.suburb;

  // ❗ Nuovo filtro:
  // - serve SEMPRE la via
  // - il numero civico è richiesto SOLO se l'utente lo ha scritto nella query
  if (!street) return null;
  if (houseInQuery && !number) return null;

  // "Schachenstrasse 4 9450 Lüchingen" | se manca il numero: "Schachenstrasse 9450 Lüchingen"
  const left = [street, number].filter(Boolean).join(' ');
  const right = [postcode, city].filter(Boolean).join(' ');
  const label = [left, right].filter(Boolean).join(' ') || (r.display_name as string);

  return {
    label,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
  };
});

// ✅ Type guard esplicito: ora è Suggest[]
const mapped: Suggest[] = tmp.filter((x: Suggest | null): x is Suggest => x !== null);

// ---- ORDINAMENTO PER RILEVANZA ----
const sorted = mapped.slice().sort((a, b) => {
  const al = a.label.toLowerCase();
  const bl = b.label.toLowerCase();

  // 1) startsWith query
  const aStarts = Number(al.startsWith(ql));
  const bStarts = Number(bl.startsWith(ql));
  if (aStarts !== bStarts) return bStarts - aStarts;

  // 2) CAP esatto
  if (capInQuery) {
    const aCap = Number(al.includes(capInQuery));
    const bCap = Number(bl.includes(capInQuery));
    if (aCap !== bCap) return bCap - aCap;
  }

  // 3) prima occorrenza della query (minore è meglio)
  const ai = al.indexOf(ql);
  const bi = bl.indexOf(ql);
  if (ai !== bi) return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);

  // 4) label più corta prima
  return a.label.length - b.label.length;
});

setResults(sorted);
setOpen(sorted.length > 0);
setActive(sorted.length ? 0 : -1);
} catch (e: any) {
  setErr(e?.message ?? 'Search error');
  setResults([]);
  setOpen(false);
  setActive(-1);
} finally {
  setLoading(false);
}
}, 250);
return () => clearTimeout(t);
}, [q]);





  // Calcola e applica la posizione del dropdown (fixed) sotto l'anchor
  const positionDropdown = useCallback(() => {
    if (!anchorRef.current || !dropdownRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const dd = dropdownRef.current;

    // Spazio minimo verso il basso; se non basta, apri sopra
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const above = r.bottom + 280 > viewportH && r.top > 280;

    dd.style.position = 'fixed';
    dd.style.top = `${above ? r.top - 8 : r.bottom + 4}px`;
    dd.style.left = `${r.left}px`;
    dd.style.width = `${r.width}px`;
    dd.style.zIndex = '1000000';
    dd.style.maxHeight = '260px';
    dd.style.overflowY = 'auto';
  }, []);

  // Riposiziona su open, scroll/resize
  useLayoutEffect(() => {
    if (!open) return;
    positionDropdown();
    const onScroll = () => positionDropdown();
    const onResize = () => positionDropdown();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, positionDropdown]);

  // Chiudi su click fuori
  useEffect(() => {
    if (!open) return;
    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (
        anchorRef.current?.contains(t) ||
        dropdownRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Keyboard navigation
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        setOpen(results.length > 0);
        return;
      }
      if (!open) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min((i < 0 ? -1 : i) + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max((i < 0 ? results.length : i) - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pickIdx = active >= 0 ? active : 0;
        const sel = results[pickIdx];
        if (sel) {
          onPick(sel);
          setOpen(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, results, active, onPick]
  );

  const renderDropdown = useMemo(() => {
    if (!portalNode) return null;
    if (!open) return null;

    const dropdown = (
      <div
        ref={dropdownRef}
        className="osm-dropdown shadow-lg rounded-xl border  border-black bg-neutral-900"
        role="listbox"
        aria-label="OSM suggestions"
      >
        {loading && (
          <div className="px-3 py-2 text-sm text-neutral-500">Wird geladen…</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-2 text-sm text-neutral-500">Kein Ergebnis</div>
        )}
        {!loading &&
          results.map((r, i) => (
            <div
              key={`${r.lat},${r.lon},${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                // onMouseDown per evitare blur dell’input prima del pick
                e.preventDefault();
                onPick(r);
                setOpen(false);
              }}
              onMouseEnter={() => setActive(i)}
              className={[
                'cursor-pointer px-3 py-2 text-sm select-none text-neutral-400',
                i === active ? 'bg-neutral-700' : 'hover:bg-neutral-600',
              ].join(' ')}
            >
              <div className="truncate" title={r.label}>
              {highlightMatches(r.label, q)}
           </div>
            </div>
          ))}
      </div>
    );

    return ReactDOM.createPortal(dropdown, portalNode);
  }, [portalNode, open, results, active, loading, onPick]);

  return (
    <div className="relative w-full">
      {/* Anchor che determina posizione del dropdown */}
      <div ref={anchorRef} className="osm-anchor">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setOpen(results.length > 0)}
          onKeyDown={onKeyDown}
          className="h-5 w-full bg-transparent border-0 outline-none  placeholder:text-neutral-400"
          aria-autocomplete="list"
          
          aria-controls="osm-suggestions"
        />
      </div>

      {/* Error piccolo inline (facoltativo) */}
      {err && <div className="mt-1 text-[11px] text-red-600">{err}</div>}

      {/* Dropdown in portal */}
      {renderDropdown}
    </div>
  );
}
