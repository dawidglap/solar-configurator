"use client";

import { useQuery } from "@tanstack/react-query";
import { plannerApiFetch } from "@/lib/planner-api";

type MeResponse = {
  ok: true;
  user?: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    isPlatformSuperAdmin?: boolean;
  };
  session?: {
    activeCompanyId?: string | null;
    activeRole?: string | null;
    role?: string | null;
    activeCompanyRole?: string | null;
    membershipRole?: string | null;
    isPlatformSuperAdmin?: boolean;
  };
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => plannerApiFetch<MeResponse>("/me"),
  });
}
