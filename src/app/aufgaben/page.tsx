// src/app/aufgaben/page.tsx
"use client";

import { useMemo } from "react";
import { FiSettings, FiChevronDown } from "react-icons/fi";

type TaskRow = {
  id: string;
  name: string;
  createdAt: string;
  dueAt: string;
  assignedTo: string;
  createdBy: string;
  status: string;
  title: string;
  badge: number;
};

export default function AufgabenPage() {
  const rows = useMemo<TaskRow[]>(
    () => [
      {
        id: "1",
        name: "Emil Egger",
        createdAt: "15.11.2025",
        dueAt: "15.11.2025",
        assignedTo: "Edin Mustafic",
        createdBy: "Edin Mustafic",
        status: "Offen",
        title: "Nachfassen",
        badge: 1,
      },
      {
        id: "2",
        name: "Emil Egger",
        createdAt: "15.11.2025",
        dueAt: "15.11.2025",
        assignedTo: "Edin Mustafic",
        createdBy: "Edin Mustafic",
        status: "Offen",
        title: "Anrufen",
        badge: 1,
      },
    ],
    []
  );

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
          Aufgaben
        </h1>
      </div>

      {/* Header */}
      <div className="relative">
        <div className="grid grid-cols-[1.3fr_1.2fr_1.0fr_1.15fr_1.05fr_0.9fr_1.2fr_44px] items-end gap-4 text-white/85">
          <HeaderCell>Name</HeaderCell>
          <HeaderCell>Erstellt am</HeaderCell>
          <HeaderCell>Fällig am</HeaderCell>
          <HeaderCell>Zugewiesen an</HeaderCell>
          <HeaderCell>Erstellt von</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Titel</HeaderCell>

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

        <div className="mt-3 h-px w-full bg-white/70" />
      </div>

      {/* Rows */}
      <div className="mt-4 space-y-5">
        {rows.map((r) => (
          <TaskRowItem key={r.id} row={r} />
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

function TaskRowItem({ row }: { row: TaskRow }) {
  return (
    <div
      className={[
        "rounded-xl border border-white/70 bg-white/10 backdrop-blur-xl",
        "shadow-[0_0_25px_rgba(0,0,0,0.25)]",
      ].join(" ")}
    >
      <div className="rounded-xl border border-white/15 px-5 py-5">
        <div className="grid grid-cols-[1.3fr_1.2fr_1.0fr_1.15fr_1.05fr_0.9fr_1.2fr_44px] items-center gap-4">
          <Cell className="text-white/90">{row.name}</Cell>
          <Cell className="text-white/85">{row.createdAt}</Cell>
          <Cell className="text-white/85">{row.dueAt}</Cell>
          <Cell className="text-white/85">{row.assignedTo}</Cell>
          <Cell className="text-white/85">{row.createdBy}</Cell>
          <Cell className="text-white/85">{row.status}</Cell>

          {/* Title + badge + caret */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative inline-flex items-center">
              <span className="text-[18px] text-white/90">{row.title}</span>

              {row.badge > 0 && (
                <span className="ml-3 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                  {row.badge}
                </span>
              )}
            </div>

            {/* caret placeholder */}
            <button
              type="button"
              className="rounded-full p-2 text-white/85 hover:bg-white/10 hover:text-white transition"
              aria-label="Dropdown"
              title="Dropdown"
            >
              <FiChevronDown className="h-5 w-5" />
            </button>
          </div>

          {/* right empty slot like spacing */}
          <div />
        </div>
      </div>
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
  return (
    <div
      className={[
        "text-[18px] whitespace-nowrap overflow-hidden text-ellipsis",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
