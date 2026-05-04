"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { plannerApiFetch } from "@/lib/planner-api";

export type TrashType = "planning" | "customer" | "task";
export type TrashFilterType = "all" | TrashType;

export type TrashItem = {
  id: string;
  type: TrashType;
  title: string;
  subtitle?: string;
  deletedAt: string;
  deletedByName?: string;
  deletedByEmail?: string;
  original: Record<string, unknown>;
};

export type TrashPermissions = {
  canViewTrash: boolean;
  canRestore: boolean;
  canPermanentDelete: boolean;
};

export type TrashFilters = {
  type?: TrashFilterType;
  q?: string;
};

type TrashResponse = {
  ok: true;
  items: TrashItem[];
  permissions: TrashPermissions;
};

function buildTrashQuery(filters?: TrashFilters) {
  const params = new URLSearchParams();

  if (filters?.type && filters.type !== "all") {
    params.set("type", filters.type);
  }

  if (filters?.q?.trim()) {
    params.set("q", filters.q.trim());
  }

  const query = params.toString();
  return `/trash${query ? `?${query}` : ""}`;
}

function invalidateTaskRelatedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["trash"] });
  queryClient.invalidateQueries({ queryKey: ["plannings"] });
  queryClient.invalidateQueries({ queryKey: ["customers"] });
  queryClient.invalidateQueries({ queryKey: ["tasks"] });
  queryClient.invalidateQueries({ queryKey: ["projects"] });
}

export function useTrash(filters?: TrashFilters) {
  return useQuery({
    queryKey: ["trash", filters || {}],
    queryFn: () => plannerApiFetch<TrashResponse>(buildTrashQuery(filters)),
  });
}

export function useRestoreTrashItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: TrashType; id: string }) =>
      plannerApiFetch<{ ok: true }>(`/trash/${type}/${id}/restore`, {
        method: "POST",
      }),
    onSuccess: () => {
      invalidateTaskRelatedQueries(queryClient);
    },
  });
}

export function usePermanentDeleteTrashItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: TrashType; id: string }) =>
      plannerApiFetch<{ ok: true }>(`/trash/${type}/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateTaskRelatedQueries(queryClient);
    },
  });
}
