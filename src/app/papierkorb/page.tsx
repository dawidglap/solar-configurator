"use client";

import { useDeferredValue, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  FolderKanban,
  ListTodo,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { ApiError } from "@/lib/planner-api";
import {
  TrashFilters,
  TrashItem,
  TrashType,
  usePermanentDeleteTrashItem,
  useRestoreTrashItem,
  useTrash,
} from "@/hooks/useTrash";

type ConfirmAction =
  | { mode: "restore"; item: TrashItem }
  | { mode: "delete"; item: TrashItem }
  | null;

const FILTERS: Array<{ key: TrashFilters["type"]; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "planning", label: "Projekte" },
  { key: "customer", label: "Kunden" },
  { key: "task", label: "Aufgaben" },
];

function formatDeletedAt(value?: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function itemTypeLabel(type: TrashType) {
  if (type === "planning") return "Projekt";
  if (type === "customer") return "Kunde";
  return "Aufgabe";
}

function itemIcon(type: TrashType) {
  if (type === "planning") return FolderKanban;
  if (type === "customer") return Users;
  return ListTodo;
}

export default function PapierkorbPage() {
  const [type, setType] = useState<TrashFilters["type"]>("all");
  const [search, setSearch] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const deferredSearch = useDeferredValue(search);

  const filters = useMemo(
    () => ({
      type,
      q: deferredSearch.trim() || undefined,
    }),
    [deferredSearch, type],
  );

  const trashQuery = useTrash(filters);
  const restoreMutation = useRestoreTrashItem();
  const permanentDeleteMutation = usePermanentDeleteTrashItem();

  const busyId =
    restoreMutation.variables?.id || permanentDeleteMutation.variables?.id || null;

  const error = trashQuery.error as ApiError | null;
  const noPermission =
    error?.status === 403 || trashQuery.data?.permissions?.canViewTrash === false;

  const handleConfirm = async () => {
    if (!confirmAction) return;

    try {
      if (confirmAction.mode === "restore") {
        await restoreMutation.mutateAsync({
          type: confirmAction.item.type,
          id: confirmAction.item.id,
        });
        toast.success("Element wurde wiederhergestellt.");
      } else {
        await permanentDeleteMutation.mutateAsync({
          type: confirmAction.item.type,
          id: confirmAction.item.id,
        });
        toast.success("Element wurde endgültig gelöscht.");
      }

      setConfirmAction(null);
    } catch (mutationError: any) {
      toast.error(
        mutationError?.message ||
          (confirmAction.mode === "restore"
            ? "Wiederherstellung fehlgeschlagen."
            : "Endgültiges Löschen fehlgeschlagen."),
      );
    }
  };

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
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <h1 className="text-[44px] font-light tracking-tight text-white/90">
            Papierkorb
          </h1>
          <p className="mt-2 text-base text-white/65">
            Gelöschte Elemente können innerhalb von 30 Tagen wiederhergestellt
            werden.
          </p>
        </div>

        <div className="glass-panel flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Im Papierkorb suchen..."
                className="glass-input h-10 w-full pl-9"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => {
                const active = filter.key === type;
                return (
                  <button
                    key={String(filter.key)}
                    type="button"
                    onClick={() => setType(filter.key)}
                    className={[
                      "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {trashQuery.isLoading ? (
          <StatePanel
            title="Papierkorb wird geladen..."
            text="Bitte kurz warten."
          />
        ) : noPermission ? (
          <StatePanel
            title="Kein Zugriff auf den Papierkorb."
            text="Nur Inhaber und Administratoren können gelöschte Elemente verwalten."
            danger
          />
        ) : trashQuery.isError ? (
          <StatePanel
            title="Papierkorb konnte nicht geladen werden."
            text={error?.message || "Bitte später erneut versuchen."}
            danger
          />
        ) : trashQuery.data?.items?.length ? (
          <div className="grid gap-4">
            {trashQuery.data.items.map((item) => (
              <TrashCard
                key={`${item.type}:${item.id}`}
                item={item}
                busy={busyId === item.id}
                canRestore={!!trashQuery.data?.permissions?.canRestore}
                canPermanentDelete={
                  !!trashQuery.data?.permissions?.canPermanentDelete
                }
                onRestore={() => setConfirmAction({ mode: "restore", item })}
                onPermanentDelete={() =>
                  setConfirmAction({ mode: "delete", item })
                }
              />
            ))}
          </div>
        ) : deferredSearch.trim() ? (
          <StatePanel
            title="Keine gelöschten Elemente gefunden."
            text="Passe deine Suche oder den Filter an."
          />
        ) : (
          <StatePanel
            title="Der Papierkorb ist leer."
            text="Gelöschte Projekte, Kunden und Aufgaben erscheinen hier."
          />
        )}
      </div>

      {confirmAction && (
        <ConfirmDialog
          mode={confirmAction.mode}
          item={confirmAction.item}
          loading={restoreMutation.isPending || permanentDeleteMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

function TrashCard({
  item,
  busy,
  canRestore,
  canPermanentDelete,
  onRestore,
  onPermanentDelete,
}: {
  item: TrashItem;
  busy: boolean;
  canRestore: boolean;
  canPermanentDelete: boolean;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  const Icon = itemIcon(item.type);

  return (
    <div className="glass-panel-elevated p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium text-white/90">{item.title}</h2>
              <span className="status-badge-neutral">
                {itemTypeLabel(item.type)}
              </span>
            </div>

            {item.subtitle ? (
              <p className="mt-1 text-sm text-white/65">{item.subtitle}</p>
            ) : null}

            <div className="mt-3 grid gap-1 text-sm text-white/60">
              <p>Gelöscht am: {formatDeletedAt(item.deletedAt)}</p>
              <p>
                Gelöscht von:{" "}
                {item.deletedByName || item.deletedByEmail || "Unbekannt"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRestore}
            disabled={!canRestore || busy}
            className="glass-button-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Wiederherstellen</span>
          </button>

          <button
            type="button"
            onClick={onPermanentDelete}
            disabled={!canPermanentDelete || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/16 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>Endgültig löschen</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatePanel({
  title,
  text,
  danger = false,
}: {
  title: string;
  text: string;
  danger?: boolean;
}) {
  return (
    <div className="glass-panel-elevated flex min-h-[240px] flex-col items-center justify-center p-8 text-center">
      <div
        className={[
          "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl",
          danger ? "bg-destructive/12 text-destructive" : "bg-primary/10 text-primary",
        ].join(" ")}
      >
        {danger ? (
          <AlertTriangle className="h-5 w-5" />
        ) : (
          <Trash2 className="h-5 w-5" />
        )}
      </div>
      <h2 className="text-xl font-medium text-white/90">{title}</h2>
      <p className="mt-2 max-w-xl text-sm text-white/65">{text}</p>
    </div>
  );
}

function ConfirmDialog({
  mode,
  item,
  loading,
  onCancel,
  onConfirm,
}: {
  mode: "restore" | "delete";
  item: TrashItem;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isDelete = mode === "delete";

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-panel-elevated w-full max-w-md p-6">
        <div className="flex items-start gap-3">
          <div
            className={[
              "mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-2xl",
              isDelete
                ? "bg-destructive/12 text-destructive"
                : "bg-primary/12 text-primary",
            ].join(" ")}
          >
            {isDelete ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <RotateCcw className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <h3 className="text-lg font-medium text-white/90">
              {isDelete ? "Endgültig löschen?" : "Element wiederherstellen?"}
            </h3>
            <p className="mt-2 text-sm text-white/65">
              {isDelete
                ? "Diese Aktion kann nicht rückgängig gemacht werden. Das Element wird dauerhaft entfernt."
                : "Dieses Element wird wieder in der normalen Übersicht angezeigt."}
            </p>
            <p className="mt-3 text-sm text-white/50">{item.title}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="glass-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Abbrechen
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={
              isDelete
                ? "inline-flex items-center rounded-lg border border-destructive/35 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                : "glass-button-primary disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {loading
              ? "Läuft..."
              : isDelete
                ? "Endgültig löschen"
                : "Wiederherstellen"}
          </button>
        </div>
      </div>
    </div>
  );
}
