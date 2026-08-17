import { safeString } from "@/lib/api-session";

export const BADGE_SIGNATURE_STATUSES = [
  "none",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
] as const;

export type BadgeSignatureStatus = (typeof BADGE_SIGNATURE_STATUSES)[number];
export type VollmachtStatus = "not_required" | "pending" | "submitted";

function iso(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = safeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeBadgeSignatureStatus(value: unknown): BadgeSignatureStatus {
  const normalized = safeString(value).toLowerCase() as BadgeSignatureStatus;
  return BADGE_SIGNATURE_STATUSES.includes(normalized) ? normalized : "none";
}

export function derivePlanningBadgeFields(planning: any) {
  const vollmachtRequired = planning?.data?.parts?.formDocuments?.vollmacht !== false;
  const vollmachtSubmittedAt = iso(planning?.vollmachtSubmittedAt);
  const vollmachtStatus: VollmachtStatus = !vollmachtRequired
    ? "not_required"
    : vollmachtSubmittedAt
      ? "submitted"
      : "pending";

  const signaturePlace = safeString(
    planning?.offerSignaturePlace ?? planning?.signaturePlace,
  ).toLowerCase();
  const signedAt = iso(planning?.offerSignedAt ?? planning?.signedAt);
  const storedWithdrawalUntil = iso(planning?.withdrawalUntil);
  const withdrawalUntil = signaturePlace === "onsite_customer"
    ? signedAt
      ? new Date(new Date(signedAt).getTime() + 14 * 86_400_000).toISOString()
      : storedWithdrawalUntil
    : null;

  return {
    vollmachtRequired,
    vollmachtStatus,
    vollmachtSubmittedAt,
    withdrawalUntil,
  };
}

export function deriveLinkedSignatureStatus(planning: any): BadgeSignatureStatus {
  const offerStatus = normalizeBadgeSignatureStatus(planning?.offerSignatureStatus);
  return offerStatus !== "none"
    ? offerStatus
    : normalizeBadgeSignatureStatus(planning?.signatureStatus);
}
