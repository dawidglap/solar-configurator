// src/components_v2/geocoding/AddressSearchOSM.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom";

export type OSMResult = { label: string; lat: number; lon: number };

type Props = {
  placeholder?: string;
  value?: string;
  onChangeText?: (v: string) => void;
  onPick: (r: any) => void;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rimuove HTML (es. <b>) da stringhe GeoAdmin e normalizza spazi */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Evidenzia la query nel testo (dark-friendly) */
function highlightMatches(label: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return label;
  try {
    const re = new RegExp(escapeRegExp(q), "ig");
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(label))) {
      const s = m.index,
        e = s + m[0].length;
      if (s > last) parts.push(label.slice(last, s));
      parts.push(
        <mark
          key={`${s}-${e}`}
          className="rounded-[2px] px-0.5 bg-emerald-400/80 ring-1 ring-emerald-400/30"
        >
          {label.slice(s, e)}
        </mark>,
      );
      last = e;
      if (re.lastIndex === s) re.lastIndex++; // anti-loop
    }
    if (last < label.length) parts.push(label.slice(last));
    return parts;
  } catch {
    return label;
  }
}

type Suggest = {
  label: string;
  lat: number;
  lon: number;
  postcode?: string;
  number?: string;
};

export default function AddressSearchOSM({
  onPick,
  placeholder = "Adresse suchen…",
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<Suggest[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // anchor + dropdown (portal)
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [portalNode] = useState(() => {
    if (typeof document !== "undefined") {
      const el = document.createElement("div");
      el.className = "osm-dropdown-portal-root";
      return el;
    }
    return null;
  });

  // ----------- pick centrale: aggiorna input + chiude dropdown + chiama onPick ----------
  const handlePick = useCallback(
    (r: Suggest) => {
      // mostra l’indirizzo completo nella barra
      setQ(r.label);

      // callback verso il padre (TopbarAddressSearch)
      onPick(r);

      // chiudi lista & reset
      setOpen(false);
      setResults([]);
      setActive(-1);
    },
    [onPick],
  );

  useEffect(() => {
    if (!portalNode || typeof document === "undefined") return;
    document.body.appendChild(portalNode);
    return () => {
      try {
        document.body.removeChild(portalNode);
      } catch {}
    };
  }, [portalNode]);

  // ---------- FETCH: GeoAdmin SearchServer (come Sonnendach) ----------
  useEffect(() => {
    setErr(null);
    const qTrim = q.trim();
    if (qTrim.length < 3) {
      setResults([]);
      setOpen(false);
      setActive(-1);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          `https://api3.geo.admin.ch/rest/services/api/SearchServer` +
          `?type=locations&searchText=${encodeURIComponent(qTrim)}` +
          `&lang=de&sr=4326&limit=12`;

        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const json = await res.json();

        // Map GeoAdmin → Suggest (pulisce HTML dalla label)
        const parsed: Suggest[] = (json?.results ?? [])
          .map((r: any) => {
            const a = r?.attrs ?? {};
            const labelHtml: string = a.label || a.detail || r.label || "";
            const label = stripHtml(labelHtml);
            const lat = Number(a.lat ?? r.y);
            const lon = Number(a.lon ?? r.x);

            // estrazioni dal testo pulito
            const mPost = label.match(/\b(\d{4})\b/);
            const mNum = label.match(/\b(\d{1,3}(?:[a-z]|(?:\.\d+)?)?)\b/);
            const postcode = mPost ? mPost[1] : undefined;
            const number = mNum ? mNum[1] : undefined;

            return Number.isFinite(lat) && Number.isFinite(lon) && label
              ? { label, lat, lon, postcode, number }
              : null;
          })
          .filter((x: Suggest | null): x is Suggest => !!x);

        // Intenzione utente (prefisso CAP + civico)
        const ql = qTrim.toLowerCase();
        const tokens = ql.split(/\s+/);

        // prefisso CAP: ultima “parola” 2–4 cifre (9, 94, 944, 9445)
        const lastTok = tokens.at(-1) || "";
        const capPrefix = /^\d{2,4}$/.test(lastTok) ? lastTok : null;

        // civico: prima occorrenza “6”, “6a”, “6.1” (max 4-5 char), ignorando CAP
        let houseInQuery: string | null = null;
        for (const tkn of tokens) {
          if (/^\d{1,3}[a-z]?$/.test(tkn) || /^\d{1,3}\.\d+$/.test(tkn)) {
            houseInQuery = tkn;
            break;
          }
        }
        if (houseInQuery && capPrefix && houseInQuery === capPrefix)
          houseInQuery = null;

        // Filtri: prefisso CAP (se presente e presente nel risultato) + civico parziale
        const filtered = parsed.filter((it) => {
          if (
            capPrefix &&
            it.postcode &&
            !String(it.postcode).startsWith(capPrefix)
          )
            return false;
          if (houseInQuery) {
            if (!it.number) return false;
            const n = String(it.number).toLowerCase();
            if (!(n === houseInQuery || n.startsWith(houseInQuery)))
              return false;
          }
          return true;
        });

        // Ordinamento: CAP più specifico > begins-with > occorrenza > label corta
        const sorted = filtered.sort((a, b) => {
          const al = a.label.toLowerCase(),
            bl = b.label.toLowerCase();

          const specA = capPrefix
            ? a.postcode?.startsWith(capPrefix)
              ? (a.postcode?.length ?? 0)
              : 0
            : 0;
          const specB = capPrefix
            ? b.postcode?.startsWith(capPrefix)
              ? (b.postcode?.length ?? 0)
              : 0
            : 0;
          if (specA !== specB) return specB - specA;

          const aStarts = Number(al.startsWith(ql)),
            bStarts = Number(bl.startsWith(ql));
          if (aStarts !== bStarts) return bStarts - aStarts;

          const ai = al.indexOf(ql),
            bi = bl.indexOf(ql);
          if (ai !== bi)
            return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);

          return a.label.length - b.label.length;
        });

        setResults(sorted);
        setOpen(sorted.length > 0);
        setActive(sorted.length ? 0 : -1);
      } catch (e: any) {
        setErr(e?.message ?? "Search error");
        setResults([]);
        setOpen(false);
        setActive(-1);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [q]);

  // Posizionamento dropdown (fixed)
  const positionDropdown = useCallback(() => {
    if (!anchorRef.current || !dropdownRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const dd = dropdownRef.current;
    const viewportH =
      window.innerHeight || document.documentElement.clientHeight;
    const above = r.bottom + 280 > viewportH && r.top > 280;

    dd.style.position = "fixed";
    dd.style.top = `${above ? r.top - 8 : r.bottom + 4}px`;
    dd.style.left = `${r.left}px`;
    dd.style.width = `${r.width}px`;
    dd.style.zIndex = "1000000";
    dd.style.maxHeight = "260px";
    dd.style.overflowY = "auto";
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionDropdown();
    const onScroll = () => positionDropdown();
    const onResize = () => positionDropdown();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, positionDropdown]);

  // Chiudi su click fuori
  useEffect(() => {
    if (!open) return;
    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (anchorRef.current?.contains(t) || dropdownRef.current?.contains(t))
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Keyboard nav
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        setOpen(results.length > 0);
        return;
      }
      if (!open) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min((i < 0 ? -1 : i) + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max((i < 0 ? results.length : i) - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pickIdx = active >= 0 ? active : 0;
        const sel = results[pickIdx];
        if (sel) {
          handlePick(sel);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, results, active, handlePick],
  );

  const renderDropdown = useMemo(() => {
    if (!portalNode || !open) return null;

    const dropdown = (
      <div
        ref={dropdownRef}
        className="osm-dropdown shadow-lg rounded-xl border border-white/10 bg-neutral-900 text-xs"
        role="listbox"
        aria-label="OSM suggestions"
      >
        {loading && (
          <div className="px-3 py-2 text-sm text-neutral-500">
            Wird geladen…
          </div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-2 text-sm text-neutral-500">
            Kein Ergebnis
          </div>
        )}
        {!loading &&
          results.map((r, i) => (
            <div
              key={`${r.lat},${r.lon},${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // evita blur prima del pick
                handlePick(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={[
                "cursor-pointer px-3 py-2 text-xs select-none text-neutral-200",
                i === active ? "bg-neutral-700" : "hover:bg-neutral-700/70",
              ].join(" ")}
            >
              {/* niente truncate forzato: consentiamo andare a capo se serve */}
              <div className="whitespace-normal leading-5">
                {highlightMatches(r.label, q)}
              </div>
            </div>
          ))}
      </div>
    );

    return ReactDOM.createPortal(dropdown, portalNode);
  }, [portalNode, open, results, active, loading, handlePick, q]);

  return (
    <div className="relative w-full">
      <div ref={anchorRef} className="osm-anchor">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setOpen(results.length > 0)}
          onKeyDown={onKeyDown}
          className="h-5 w-full bg-transparent border-0 outline-none placeholder:text-neutral-400 text-xs"
          aria-autocomplete="list"
          aria-controls="osm-suggestions"
        />
      </div>

      {err && <div className="mt-1 text-[11px] text-red-600">{err}</div>}

      {renderDropdown}
    </div>
  );
}
