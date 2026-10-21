import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import {
  getHeatingOfferIssuedSnapshot,
  type HeatingOfferIssuedSnapshot,
} from "@/lib/offerSignatures";
import { resolveProjectType } from "@/lib/projectType";

export function assertHeatingOrderPreconditions(planning: any) {
  if (resolveProjectType(planning?.projectType) !== "heating") {
    throw new Error("Heating-Auftrag kann nur für ein Heizungsprojekt erstellt werden.");
  }
  if (safeString(planning?.offerSignatureStatus) !== "signed") {
    throw new Error("Das Heizungsangebot muss vor der Auftragserstellung unterschrieben sein.");
  }
  if (
    !toObjectIdOrNull(planning?.offerSignedPdfFileId) ||
    !safeString(planning?.offerSignedPdfSha256) ||
    !planning?.offerSignedAt
  ) {
    throw new Error("Das unterschriebene Heizungsangebot ist unvollständig.");
  }
  return getHeatingOfferIssuedSnapshot(planning);
}

export function buildHeatingOrderCommercialSummary(snapshot: HeatingOfferIssuedSnapshot) {
  const optionalTotalChf = snapshot.optionalItems.reduce(
    (sum, item) => sum + Number(item?.lineTotalNet ?? 0),
    0,
  );
  return {
    projectType: "heating" as const,
    items: [...snapshot.items, ...snapshot.optionalItems],
    issuedItems: [...snapshot.items, ...snapshot.optionalItems],
    catalogDocs: [],
    reportSummary: {
      paymentTerms: snapshot.paymentTerms,
      skontoPct: snapshot.skonto.percent,
      mwstIncluded: true,
      discountChf: snapshot.pricing.discount.fixedChf,
      discountPct: snapshot.pricing.discount.percent,
      discountFromPctChf: snapshot.pricing.discount.percentAmountChf,
      totalDiscountChf: snapshot.pricing.discount.totalChf,
    },
    partsTotalNet: snapshot.pricing.subtotalNet,
    optionalTotalChf,
    optionalItems: snapshot.optionalItems.map((item) => ({
      label: safeString(item?.name) || "Optionale Position",
      name: safeString(item?.name),
      note: "",
      description: "",
      qty: Number(item?.quantity ?? 0),
      unit: safeString(item?.unitLabel ?? item?.unit) || "Stk.",
      priceChf: Number(item?.lineTotalNet ?? 0),
    })),
    discountChf: snapshot.pricing.discount.fixedChf,
    discountPct: snapshot.pricing.discount.percent,
    discountFromPctChf: snapshot.pricing.discount.percentAmountChf,
    totalDiscountChf: snapshot.pricing.discount.totalChf,
    netAfterDiscountChf: snapshot.pricing.netAfterDiscount,
    vatRatePct: snapshot.pricing.vatRate,
    vatAmountChf: snapshot.pricing.vatAmount,
    grossPriceChf: snapshot.pricing.totalGross,
    mwstIncluded: true,
    automaticPvSubsidyChf: 0,
    manualAdditionalSubsidyChf: 0,
    subsidyChf: 0,
    totalInvestmentChf: snapshot.pricing.totalGross,
    taxSavingsChf: 0,
    effectiveCostChf: snapshot.pricing.totalGross,
  };
}

export function buildHeatingOrderDocumentPlanning(
  planning: any,
  snapshot: HeatingOfferIssuedSnapshot,
) {
  const customer = snapshot.customer;
  const objectAddress = snapshot.objectAddress;
  const isCompany = customer.type === "company";
  return {
    _id: planning?._id,
    companyId: planning?.companyId,
    customerId: null,
    projectType: "heating",
    planningNumber: snapshot.offerNumber,
    title: "Heizungsauftrag",
    orderStatus: "generated",
    orderId: safeString(planning?.orderId),
    offerSignatureStatus: "signed",
    offerSignedAt: planning?.offerSignedAt,
    summary: { customerName: customer.name },
    commercial: {
      stage: safeString(planning?.commercial?.stage),
      valueChf: snapshot.pricing.totalGross,
    },
    data: {
      profile: {
        customerType: customer.type,
        type: customer.type,
        companyName: isCompany ? customer.companyName || customer.name : "",
        firstName: isCompany ? "" : customer.name,
        lastName: "",
        contactEmail: customer.email,
        contactPhone: customer.phone,
        salutation: customer.salutation,
        street: customer.address.street,
        streetNo: customer.address.houseNumber,
        zip: customer.address.zip,
        city: customer.address.city,
        buildingStreet: objectAddress.street,
        buildingStreetNo: objectAddress.houseNumber,
        buildingZip: objectAddress.zip,
        buildingCity: objectAddress.city,
      },
      parts: {
        items: [
          ...snapshot.items.map((item) => ({ ...item, optional: false })),
          ...snapshot.optionalItems.map((item) => ({ ...item, optional: true })),
        ],
        reportSections: {
          projektuebersicht: false,
          technischeEckdaten: true,
          analyse: false,
        },
        formDocuments: { vollmacht: false },
      },
      angebot: { payments: snapshot.payments },
      reportOptions: {
        paymentTerms: snapshot.paymentTerms,
        payments: snapshot.payments,
        skontoPct: snapshot.skonto.percent,
        skontoDays: snapshot.skonto.days,
        discountChf: snapshot.pricing.discount.fixedChf,
        discountPct: snapshot.pricing.discount.percent,
        mwstIncluded: true,
      },
    },
  };
}

export function buildHeatingOrderContractSnapshot(args: {
  planning: any;
  snapshot: HeatingOfferIssuedSnapshot;
}) {
  return {
    schemaVersion: 1,
    projectType: "heating" as const,
    planningId: mongoIdToString(args.planning?._id),
    issuedOffer: {
      offerNumber: args.snapshot.offerNumber,
      issuedAt: args.snapshot.issuedAt,
      snapshotFileId: args.snapshot.pdfFileId,
      snapshotPdfSha256: args.snapshot.pdfSha256,
      signedFileId: mongoIdToString(args.planning?.offerSignedPdfFileId),
      signedPdfSha256: safeString(args.planning?.offerSignedPdfSha256),
      signedAt:
        args.planning?.offerSignedAt instanceof Date
          ? args.planning.offerSignedAt.toISOString()
          : safeString(args.planning?.offerSignedAt),
    },
    customer: args.snapshot.customer,
    objectAddress: args.snapshot.objectAddress,
    items: args.snapshot.items,
    optionalItems: args.snapshot.optionalItems,
    pricing: args.snapshot.pricing,
    paymentTerms: args.snapshot.paymentTerms,
    payments: args.snapshot.payments,
    skonto: args.snapshot.skonto,
    validity: args.snapshot.validity,
  };
}

export function buildHeatingAuftragRecord(args: {
  companyId: unknown;
  planningId: unknown;
  customerId: unknown;
  orderId: string;
  planning: any;
  snapshot: HeatingOfferIssuedSnapshot;
  orderSnapshotFileId: unknown;
  actor: unknown;
  now: Date;
}) {
  return {
    companyId: args.companyId,
    planningId: args.planningId,
    customerId: toObjectIdOrNull(args.customerId),
    orderId: args.orderId,
    projectType: "heating" as const,
    status: "aktiv" as const,
    currentStepKey: "gewonnen",
    completedAt: null,
    contractTotalGrossChf: args.snapshot.pricing.totalGross,
    currency: "CHF",
    heatingOrderSnapshot: buildHeatingOrderContractSnapshot({
      planning: args.planning,
      snapshot: args.snapshot,
    }),
    issuedOfferSnapshotFileId: toObjectIdOrNull(args.snapshot.pdfFileId),
    signedOfferFileId: toObjectIdOrNull(args.planning?.offerSignedPdfFileId),
    orderSnapshotFileId: args.orderSnapshotFileId,
    createdAt: args.now,
    updatedAt: args.now,
    createdBy: args.actor,
  };
}
