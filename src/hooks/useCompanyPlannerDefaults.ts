"use client";

import { useQuery } from "@tanstack/react-query";
import type { CompanyPlannerDefaultsV1 } from "@/lib/planning/companyPlannerDefaults";

export type CompanyPlannerDefaultsResponse = {
  ok: true;
  plannerDefaults: CompanyPlannerDefaultsV1;
  configured: boolean;
  canEdit: boolean;
};

export async function fetchCompanyPlannerDefaults(): Promise<CompanyPlannerDefaultsResponse> {
  const response = await fetch("/api/company-profile/planner-defaults", {
    credentials: "include",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Planungsstandards konnten nicht geladen werden.");
  }
  return data as CompanyPlannerDefaultsResponse;
}

export function useCompanyPlannerDefaults() {
  return useQuery({
    queryKey: ["company-planner-defaults"],
    queryFn: fetchCompanyPlannerDefaults,
    staleTime: 60_000,
  });
}

