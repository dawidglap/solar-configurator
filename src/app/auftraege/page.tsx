"use client";

import { useMemo, useRef, useState } from "react";
import { FiFileText, FiLayers, FiMessageSquare, FiBell } from "react-icons/fi";

type ColumnId =
  | "leads"
  | "terminiert"
  | "erstellt"
  | "offeriert"
  | "gewonnen"
  | "verloren";

type Column = {
  id: ColumnId;
  title: string;
  kpiTop: string;
  kpiLabel: string;
  kpiSub: string;
  accentClass: string;
  cardBorder?: string;
};

type Card = {
  id: string;
  title: string;
  amount: string;
  owner: string;
  date: string;
  alerts: number;
};

type DragState = null | {
  cardId: string;
  fromCol: ColumnId;
};

const DEFAULT_COLUMNS: ColumnId[] = [
  "leads",
  "terminiert",
  "erstellt",
  "offeriert",
  "gewonnen",
  "verloren",
];

export default function AuftraegePage() {
  const columns = useMemo<Record<ColumnId, Column>>(
    () => ({
      leads: {
        id: "leads",
        title: "Leads",
        kpiTop: "0 CHF",
        kpiLabel: "Leads",
        kpiSub: "(0)",
        accentClass: "text-sky-200",
      },
      terminiert: {
        id: "terminiert",
        title: "Terminiert",
        kpiTop: "0 CHF",
        kpiLabel: "Terminiert",
        kpiSub: "(0)",
        accentClass: "text-indigo-200",
      },
      erstellt: {
        id: "erstellt",
        title: "Erstellt",
        kpiTop: "0 CHF",
        kpiLabel: "Erstellt",
        kpiSub: "(0) Entwurf (0)",
        accentClass: "text-white/70",
      },
      offeriert: {
        id: "offeriert",
        title: "Offeriert",
        kpiTop: "0 CHF",
        kpiLabel: "Offeriert",
        kpiSub: "(0)",
        accentClass: "text-amber-200",
      },
      gewonnen: {
        id: "gewonnen",
        title: "Gewonnen",
        kpiTop: "0 CHF",
        kpiLabel: "Gewonnen",
        kpiSub: "(0)",
        accentClass: "text-emerald-200",
        cardBorder: "border-emerald-300/55",
      },
      verloren: {
        id: "verloren",
        title: "Verloren",
        kpiTop: "0 CHF",
        kpiLabel: "Verloren",
        kpiSub: "(0)",
        accentClass: "text-rose-200",
        cardBorder: "border-rose-300/55",
      },
    }),
    []
  );

  // ✅ cards state locale (refresh reset)
  const [cardsByCol, setCardsByCol] = useState<Record<ColumnId, Card[]>>(
    () => ({
      leads: [mkCard("l1"), mkCard("l2"), mkCard("l3")],
      terminiert: [mkCard("t1"), mkCard("t2")],
      erstellt: [mkCard("e1"), mkCard("e2")],
      offeriert: [mkCard("o1"), mkCard("o2"), mkCard("o3")],
      gewonnen: [mkCard("g1"), mkCard("g2")],
      verloren: [mkCard("v1")],
    })
  );

  // drag state (singola card)
  const dragRef = useRef<DragState>(null);

  function onCardDragStart(cardId: string, fromCol: ColumnId) {
    dragRef.current = { cardId, fromCol };
  }
  function onCardDragEnd() {
    dragRef.current = null;
  }

  // Drop su colonna (append alla fine)
  function onDropToColumn(targetCol: ColumnId) {
    const st = dragRef.current;
    if (!st) return;

    const { cardId, fromCol } = st;
    if (!cardId) return;

    setCardsByCol((prev) => moveCard(prev, fromCol, targetCol, cardId, null));
  }

  // Drop tra card (inserisci prima della card target)
  function onDropBeforeCard(targetCol: ColumnId, beforeCardId: string) {
    const st = dragRef.current;
    if (!st) return;

    const { cardId, fromCol } = st;
    setCardsByCol((prev) =>
      moveCard(prev, fromCol, targetCol, cardId, beforeCardId)
    );
  }

  return (
    <div
      className="w-full"
      style={{
        paddingLeft: "calc(var(--sb, 224px) + 20px)",
        paddingRight: "20px",
        paddingTop: "18px",
        paddingBottom: "18px",
      }}
    >
      {/* KPI row: compatta e sempre su una riga (6 colonne) */}
      <div className="mb-3 grid grid-cols-6 gap-2">
        {DEFAULT_COLUMNS.map((id) => (
          <KpiTop
            key={id}
            top={columns[id].kpiTop}
            label={columns[id].kpiLabel}
            sub={columns[id].kpiSub}
            accentClass={columns[id].accentClass}
          />
        ))}
      </div>

      {/* Board: NO scroll orizzontale */}
      <div className="grid grid-cols-6 gap-3">
        {DEFAULT_COLUMNS.map((colId, idx) => (
          <div key={colId} className="relative">
            {/* separatore verticale sottile tra colonne */}
            {idx !== 0 && (
              <div className="pointer-events-none absolute -left-2 top-0 h-full w-px bg-white/20" />
            )}

            {/* header colonna */}
            <div className="mb-2 text-[13px] font-medium text-white/80">
              {columns[colId].title}
            </div>

            {/* drop zone: tutta colonna */}
            <div
              className="min-h-[540px] space-y-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropToColumn(colId)}
            >
              {cardsByCol[colId].map((card) => (
                <div
                  key={card.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropBeforeCard(colId, card.id)}
                >
                  <ProjectCard
                    card={card}
                    borderAccent={columns[colId].cardBorder}
                    onDragStart={() => onCardDragStart(card.id, colId)}
                    onDragEnd={onCardDragEnd}
                  />
                </div>
              ))}

              {/* area vuota per droppare in fondo */}
              <div className="h-6 rounded-lg border border-dashed border-white/10" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[12px] text-white/50">
        Tipp: Ziehe einzelne Karten per Drag & Drop zwischen den Spalten. (Nur
        lokal)
      </div>
    </div>
  );
}

/* -------------------- components -------------------- */

function KpiTop({
  top,
  label,
  sub,
  accentClass,
}: {
  top: string;
  label: string;
  sub: string;
  accentClass: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[14px] font-medium text-white/90">{top}</div>
      <div
        className={["mt-0.5 text-[13px] font-medium", accentClass].join(" ")}
      >
        {label}
      </div>
      <div className="mt-0.5 text-[12px] text-white/55 line-clamp-1">{sub}</div>
    </div>
  );
}

function ProjectCard({
  card,
  borderAccent,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  borderAccent?: string;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        "select-none cursor-grab active:cursor-grabbing",
        "rounded-xl border bg-white/10 backdrop-blur-xl",
        "shadow-[0_0_18px_rgba(0,0,0,0.30)] ring-1 ring-white/10",
        borderAccent ? borderAccent : "border-white/20",
        "hover:border-white/35 transition",
      ].join(" ")}
      title="Drag mich"
    >
      {/* padding più piccolo */}
      <div className="rounded-xl border border-white/10 px-3 py-2.5">
        {/* riga top */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-white/90">
              {card.title}
            </div>
            <div className="mt-0.5 text-[11px] text-white/65">
              {card.amount}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-white/65">
              {card.owner}
            </div>
          </div>
          <div className="shrink-0 text-[11px] text-white/60">{card.date}</div>
        </div>

        {/* icons row (piccole) */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white/70">
            <FiFileText className="h-4 w-4" />
            <FiLayers className="h-4 w-4" />
            <FiMessageSquare className="h-4 w-4" />
            <div className="relative">
              <FiBell className="h-4 w-4" />
              {card.alerts > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {card.alerts}
                </span>
              )}
            </div>
          </div>

          {/* piccolo placeholder circle */}
          <div className="h-6 w-6 rounded-full border border-white/15 bg-black/20" />
        </div>
      </div>
    </div>
  );
}

/* -------------------- state helpers -------------------- */

function moveCard(
  prev: Record<ColumnId, Card[]>,
  fromCol: ColumnId,
  toCol: ColumnId,
  cardId: string,
  beforeCardId: string | null
) {
  // trova card
  const fromList = prev[fromCol];
  const card = fromList.find((c) => c.id === cardId);
  if (!card) return prev;

  // se droppo sulla stessa colonna e stessa posizione, proviamo comunque a riordinare
  const next: Record<ColumnId, Card[]> = {
    ...prev,
    [fromCol]: prev[fromCol].filter((c) => c.id !== cardId),
  };

  const targetList = [...next[toCol]];

  if (beforeCardId) {
    const idx = targetList.findIndex((c) => c.id === beforeCardId);
    if (idx === -1) targetList.push(card);
    else targetList.splice(idx, 0, card);
  } else {
    targetList.push(card);
  }

  next[toCol] = targetList;
  return next;
}

function mkCard(id: string): Card {
  return {
    id,
    title: "Emil Egger-23.7kWp",
    amount: "0.00 CHF",
    owner: "Cengiz Cokicli",
    date: "23.04.25",
    alerts: 3,
  };
}
