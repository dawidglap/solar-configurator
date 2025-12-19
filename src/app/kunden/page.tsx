// src/app/kunden/page.tsx
"use client";

import { useMemo, useState } from "react";
import { FiSettings, FiMoreVertical } from "react-icons/fi";

type CustomerRow = {
  id: string;
  name: string;
  plz: string;
  phone: string;
  type: string; // Privat / Firma...
  owner: string;
  status: string; // gewonnen ...
};

export default function KundenPage() {
  const rows = useMemo<CustomerRow[]>(
    () => [
      {
        id: "1",
        name: "Emil Egger",
        plz: "9445 Rebstein",
        phone: "071 546 73 32",
        type: "Privat",
        owner: "Edina Mustafic",
        status: "gewonnen",
      },
      {
        id: "2",
        name: "Emil Egger",
        plz: "9445 Rebstein",
        phone: "071 546 73 32",
        type: "Privat",
        owner: "Edina Mustafic",
        status: "gewonnen",
      },
    ],
    []
  );

  const [openMenuId, setOpenMenuId] = useState<string | null>("2"); // solo per far vedere il menu come nello screenshot

  return (
    <div
      className="w-full"
      style={{
        paddingLeft: "calc(var(--sb, 224px) + 32px)",
        paddingRight: "32px",
        paddingTop: "28px",
        paddingBottom: "28px",
      }}
    >
      {/* Title */}
      <div className="mb-10">
        <h1 className="text-[44px] font-light tracking-tight text-white/90">
          Kunden
        </h1>
      </div>

      {/* Header row */}
      <div className="relative">
        <div className="grid grid-cols-[2.2fr_1.8fr_1.9fr_1.2fr_2.6fr_1.2fr_44px] items-end gap-4 text-white/85">
          <HeaderCell>
            <span>Name</span>
            <span className="ml-4 text-white/70">(147)</span>
          </HeaderCell>
          <HeaderCell>PLZ</HeaderCell>
          <HeaderCell>Telefon</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Verantwortlich</HeaderCell>
          <HeaderCell>Status</HeaderCell>

          <div className="flex justify-end">
            <button
              className="rounded-full p-2 text-white/80 hover:text-white hover:bg-white/10 transition"
              aria-label="Einstellungen"
              title="Einstellungen"
              type="button"
            >
              <FiSettings className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* underline */}
        <div className="mt-3 h-px w-full bg-white/70" />
      </div>

      {/* Rows */}
      <div className="mt-4 space-y-5">
        {rows.map((r) => (
          <CustomerRowItem
            key={r.id}
            row={r}
            menuOpen={openMenuId === r.id}
            onToggleMenu={() =>
              setOpenMenuId((cur) => (cur === r.id ? null : r.id))
            }
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------- components -------------------- */

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[18px] font-medium tracking-wide">{children}</div>
  );
}

function CustomerRowItem({
  row,
  menuOpen,
  onToggleMenu,
}: {
  row: CustomerRow;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  return (
    <div className="relative">
      <div
        className={[
          "grid grid-cols-[2.2fr_1.8fr_1.9fr_1.2fr_2.6fr_1.2fr_44px] items-center gap-4",
          "rounded-xl border border-white/70 bg-white/10 backdrop-blur-xl",
          "shadow-[0_0_25px_rgba(0,0,0,0.25)]",
        ].join(" ")}
      >
        {/* inner subtle border like screenshot */}
        <div className="col-span-full rounded-xl border border-white/15 px-5 py-5">
          <div className="grid grid-cols-[2.2fr_1.8fr_1.9fr_1.2fr_2.6fr_1.2fr_44px] items-center gap-4">
            <Cell className="text-white/90">{row.name}</Cell>
            <Cell className="text-white/85">{row.plz}</Cell>
            <Cell className="text-white/85">{row.phone}</Cell>
            <Cell className="text-white/85">{row.type}</Cell>
            <Cell className="text-white/85">{row.owner}</Cell>
            <Cell className="text-emerald-300">{row.status}</Cell>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onToggleMenu}
                className="rounded-full p-2 text-white/85 hover:bg-white/10 hover:text-white transition"
                aria-label="Mehr"
                title="Mehr"
              >
                <FiMoreVertical className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dropdown menu (UI only) */}
      {menuOpen && (
        <div className="absolute right-0 top-[82px] z-50 w-[260px] overflow-hidden rounded-md border border-white/25 bg-white/95 text-black shadow-xl">
          <button
            type="button"
            className="w-full px-5 py-4 text-left text-[18px] text-black/75 hover:bg-black/5 transition"
          >
            Öffnen
          </button>
          <div className="h-px bg-black/15" />
          <button
            type="button"
            className="w-full px-5 py-4 text-left text-[18px] text-black/75 hover:bg-black/5 transition"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function Cell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={["text-[18px]", className].join(" ")}>{children}</div>;
}
