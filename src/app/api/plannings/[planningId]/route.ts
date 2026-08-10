// src/app/api/plannings/[planningId]/route.ts
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import { activeDocumentFilter, buildSoftDeleteFields } from "@/lib/trash";
import {
  buildInitialStageHistoryEntry,
  buildStageHistoryForTransition,
  ensurePlanningIndexes,
  getPipelineStageTypeByKey,
  getWonStageKey,
  ensurePlanningStageHistoryMigration,
  normalizeStageHistory,
} from "@/lib/plannings";
import { getSessionUserName } from "@/lib/tasks";
import { ensureExecutionTasksForWonPlanning } from "@/lib/executionTasks";
import { normalizeOrderFields } from "@/lib/orders";
import {
  createInvoicesForOrderIfMissing,
  ensureInvoiceIndexes,
  getInvoicesCollection,
  normalizeInvoice,
  resyncOrderInvoices,
  validatePlanningPayments,
} from "@/lib/invoices";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  hasResolvableObjectAddress,
  objectAddressChanged,
  resolveGeoAdminProperty,
} from "@/lib/geoAdmin";

export const runtime = "nodejs";

/* ----------------------------- Session helpers ---------------------------- */

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

function readSession(req: Request, secret: string) {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/* -------------------------------- Helpers -------------------------------- */

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStringArray(v: any) {
  return Array.isArray(v)
    ? v.map((x) => safeString(x)).filter(Boolean)
    : [];
}

function toObjectIdOrNull(v: any) {
  try {
    if (!v) return null;
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

function firstNonEmpty(...values: any[]) {
  for (const v of values) {
    const s = safeString(v);
    if (s) return s;
  }
  return "";
}

const AUTO_DEMOLITION_ITEM_ID = "auto-demolition-ist";

function safeBoolean(v: any, fallback = false) {
  return typeof v === "boolean" ? v : fallback;
}

function hasOwn(obj: any, key: string) {
  return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function stableJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function preserveLoosePartsItems(items: any) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      ...item,
      // Keep these fields permissive on purpose:
      // - catalogItemId may be missing/null/empty
      // - category / brand may be empty strings
      // - source may be planner | catalog | custom (or legacy values)
      ...(Object.prototype.hasOwnProperty.call(item, "catalogItemId")
        ? { catalogItemId: item.catalogItemId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "category")
        ? { category: item.category }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "brand")
        ? { brand: item.brand }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "source")
        ? { source: item.source }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "costNet")
        ? { costNet: safeNumber(item.costNet, 0) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "discountPct")
        ? { discountPct: safeNumber(item.discountPct, 0) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "discountChf")
        ? { discountChf: safeNumber(item.discountChf, 0) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "discountMode")
        ? { discountMode: safeString(item.discountMode) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "pinned")
        ? { pinned: item.pinned === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "optional")
        ? { optional: item.optional === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "longDescription")
        ? { longDescription: safeString(item.longDescription) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "features")
        ? { features: safeStringArray(item.features) }
        : {}),
    }));
}

async function upsertPinnedCatalogItems(db: any, companyId: string, items: any[]) {
  if (!companyId || !Array.isArray(items) || items.length === 0) return;

  const catalogItems = db.collection("catalogItems");
  const now = new Date();

  for (const item of items) {
    if (item?.pinned !== true) continue;

    const name = safeString(item?.name ?? item?.beschreibung);
    if (!name) continue;

    await catalogItems.updateOne(
      {
        companyId,
        name,
      },
      {
        $setOnInsert: {
          companyId,
          category: safeString(item?.category ?? item?.kategorie),
          brand: safeString(item?.brand ?? item?.marke),
          name,
          unit: safeString(item?.unit) || "piece",
          unitLabel: safeString(item?.unitLabel) || "Stk.",
          priceNet: safeNumber(
            item?.unitPriceNet ??
              item?.unitPrice ??
              item?.einzelpreis ??
              item?.priceNet ??
              item?.priceChf,
            0,
          ),
          costNet: safeNumber(item?.costNet, 0),
          longDescription: safeString(item?.longDescription),
          features: safeStringArray(item?.features),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }
}

function syncDemolitionItem(existingItems: any[], ist: any) {
  const demolitionNeeded = safeBoolean(ist?.demolitionNeeded);

  const withoutAutoDemolition = existingItems.filter((item) => {
    return (
      safeString(item?.id) !== AUTO_DEMOLITION_ITEM_ID &&
      safeString(item?.source) !== "auto-ist-demolition"
    );
  });

  if (!demolitionNeeded) {
    return withoutAutoDemolition;
  }

  const existingAutoItem = existingItems.find((item) => {
    return (
      safeString(item?.id) === AUTO_DEMOLITION_ITEM_ID ||
      safeString(item?.source) === "auto-ist-demolition"
    );
  });

  const quantity =
    typeof existingAutoItem?.quantity === "number"
      ? existingAutoItem.quantity
      : 1;

  const unitPriceNet =
    typeof existingAutoItem?.unitPriceNet === "number"
      ? existingAutoItem.unitPriceNet
      : 0;

  const notes = firstNonEmpty(
    ist?.demolitionNotes,
    ist?.demolitionDetails,
    ist?.notes
  );

  const demolitionItem = {
    ...existingAutoItem,

    id: AUTO_DEMOLITION_ITEM_ID,
    category: "Demontage",
    brand: "",
    model: "",
    name: "Demontage / Rückbau bestehende Anlage",

    quantity,
    unit: "Pauschal",
    unitLabel: "Pauschal",

    unitPriceNet,
    lineTotalNet: Number((quantity * unitPriceNet).toFixed(2)),

    source: "auto-ist-demolition",
    autoGenerated: true,
    notes,
  };

  return [...withoutAutoDemolition, demolitionItem];
}

function buildCustomerNameFromProfile(profile: any) {
  const businessName = firstNonEmpty(
    profile?.businessName,
    profile?.companyName,
    profile?.company
  );
  if (businessName) return businessName;

  const fullName = [
    safeString(profile?.contactFirstName),
    safeString(profile?.contactLastName),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || safeString(profile?.name) || "";
}

function extractCityFromAddress(address: any) {
  const a = safeString(address);
  if (!a) return "";

  const parts = a.split(",");
  const lastPart = parts[parts.length - 1]?.trim() || "";

  const match = lastPart.match(/^(\d{4})\s+(.+)$/);
  if (match) return match[2].trim();

  return lastPart;
}

function deriveProjectTitleFromData(profile: any, ist: any) {
  const businessName = firstNonEmpty(
    profile?.businessName,
    profile?.companyName,
    profile?.company
  );

  const privateName = firstNonEmpty(
    [safeString(profile?.contactFirstName), safeString(profile?.contactLastName)]
      .filter(Boolean)
      .join(" "),
    profile?.name
  );

  const displayName = businessName || privateName;

  const city = firstNonEmpty(
    profile?.city,
    profile?.place,
    profile?.location,
    profile?.postalCity,
    profile?.addressCity,
    ist?.city,
    ist?.place,
    ist?.location,
    extractCityFromAddress(profile?.address),
    extractCityFromAddress(ist?.address)
  );

  if (displayName && city) return `PV ${displayName} - ${city}`;
  if (displayName) return `PV ${displayName}`;
  return "";
}

function shouldAutoRenameTitle(existingTitle: string) {
  const t = safeString(existingTitle).toLowerCase();
  return !t || t === "neues projekt" || t === "unbenanntes projekt";
}

function deriveSummaryFromPlanner(docLike: any) {
  const data = docLike?.data ?? {};
  const existingSummary = docLike?.summary ?? {};

  const planner = data?.planner ?? {};

  const panels = Array.isArray(planner?.panels)
    ? planner.panels
    : Array.isArray(data?.panels)
      ? data.panels
      : [];

  const layers = Array.isArray(planner?.layers)
    ? planner.layers
    : Array.isArray(data?.layers)
      ? data.layers
      : [];

  const catalogPanels = Array.isArray(planner?.catalogPanels)
    ? planner.catalogPanels
    : Array.isArray(data?.catalogPanels)
      ? data.catalogPanels
      : [];

  const selectedPanelId =
    safeString(existingSummary.selectedPanelId) ||
    safeString(planner?.selectedPanelId) ||
    safeString(data?.selectedPanelId);

  const selectedPanel = catalogPanels.find(
    (p: any) => safeString(p?.id) === selectedPanelId
  );

  const moduleCount = panels.length;

  const panelWp =
    typeof selectedPanel?.wp === "number"
      ? selectedPanel.wp
      : 0;

  const dcPowerKw =
    moduleCount > 0 && panelWp > 0
      ? Number(((moduleCount * panelWp) / 1000).toFixed(2))
      : typeof existingSummary.dcPowerKw === "number"
        ? existingSummary.dcPowerKw
        : 0;

  return {
    customerName:
      safeString(existingSummary.customerName) ||
      buildCustomerNameFromProfile(data?.profile),

    moduleCount,
    selectedPanelId,
    dcPowerKw,
    roofCount: layers.length,

    hasSnapshot:
      typeof planner?.snapshot === "object"
        ? true
        : typeof existingSummary.hasSnapshot === "boolean"
          ? existingSummary.hasSnapshot
          : false,

    lastCalculatedAt: new Date().toISOString(),
  };
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

/* -------------------------------- OPTIONS -------------------------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* --------------------------------- PATCH --------------------------------- */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  if (!planningId) {
    return jsonResponse(
      origin,
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      500
    );
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));

  let profile = body?.profile;
  const ist = body?.ist;
  const planner = body?.planner;

  const title = body?.title;
  const customerId = body?.customerId;
  const planningNumber = body?.planningNumber;
  const commercial = body?.commercial;
  const summary = body?.summary;
  const parts = body?.parts;
  const angebot =
    body?.angebot ??
    body?.data?.angebot ??
    body?.["data.angebot"];
  const invoiceSyncRequestedFieldPresent =
    hasOwn(body?.angebot, "invoiceSyncRequestedAt") ||
    hasOwn(body?.data?.angebot, "invoiceSyncRequestedAt") ||
    hasOwn(body, "invoiceSyncRequestedAt");
  const invoiceSyncRequestedAt = safeString(
    angebot?.invoiceSyncRequestedAt ??
      body?.data?.angebot?.invoiceSyncRequestedAt ??
      body?.invoiceSyncRequestedAt,
  );

  // NEW: support Bericht / reportOptions payload
  const reportOptions =
    body?.reportOptions ??
    body?.data?.reportOptions ??
    body?.["data.reportOptions"];

  const hasPlannerPayload =
    (profile && typeof profile === "object") ||
    (ist && typeof ist === "object") ||
    (planner && typeof planner === "object") ||
    (parts && typeof parts === "object") ||
    (angebot && typeof angebot === "object") ||
    (reportOptions && typeof reportOptions === "object");

  const hasCrmPayload =
    typeof title === "string" ||
    typeof customerId === "string" ||
    typeof planningNumber === "string" ||
    (commercial && typeof commercial === "object") ||
    (summary && typeof summary === "object");

  if (!hasPlannerPayload && !hasCrmPayload) {
    return jsonResponse(
      origin,
      {
        ok: false,
        error:
          "Send planner data ({ profile }, { ist }, { planner }, { parts }, { reportOptions }) or CRM fields ({ title, customerId, planningNumber, commercial, summary })",
      },
      400
    );
  }

  const setObj: Record<string, any> = { updatedAt: new Date() };
  let normalizedItemsForCatalog: any[] | null = null;


  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const plannings = db.collection("plannings");
    const customers = db.collection("customers");
    const companies = db.collection("companies");
    const invoices = getInvoicesCollection(db);
    const activeCompanyObjectId = toObjectIdOrNull(session.activeCompanyId);
    await ensurePlanningIndexes(db);
    await ensurePlanningStageHistoryMigration(db);
    await ensureInvoiceIndexes(db);

    const existingPlanning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
      ...activeDocumentFilter(),
    });

    if (!existingPlanning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    if (profile && typeof profile === "object") {
      const existingProfile = (existingPlanning as any)?.data?.profile ?? {};
      const previousBuildingAddress = {
        street: safeString(existingProfile?.buildingStreet),
        houseNumber: safeString(existingProfile?.buildingStreetNo),
        zip: safeString(existingProfile?.buildingZip),
        city: safeString(existingProfile?.buildingCity),
      };
      const nextBuildingAddress = {
        street: safeString(profile?.buildingStreet),
        houseNumber: safeString(profile?.buildingStreetNo),
        zip: safeString(profile?.buildingZip),
        city: safeString(profile?.buildingCity),
      };
      const addressWasChanged = objectAddressChanged(
        previousBuildingAddress,
        nextBuildingAddress,
      );
      const parcelWasExplicitlyChanged =
        hasOwn(profile, "parcelNumber") &&
        safeString(profile?.parcelNumber) !== safeString(existingProfile?.parcelNumber);
      const manualParcel =
        profile?.parcelNumberSource === "manual" ||
        (parcelWasExplicitlyChanged && profile?.parcelNumberSource !== "auto") ||
        (existingProfile?.parcelNumberSource === "manual" &&
          profile?.parcelNumberSource !== "auto");
      const buildingNumberWasExplicitlyChanged =
        (hasOwn(profile, "buildingNumber") || hasOwn(profile, "egid")) &&
        safeString(profile?.buildingNumber ?? profile?.egid) !==
          safeString(existingProfile?.buildingNumber ?? existingProfile?.egid);
      const manualBuildingNumber =
        profile?.buildingNumberSource === "manual" ||
        (buildingNumberWasExplicitlyChanged && profile?.buildingNumberSource !== "auto") ||
        (existingProfile?.buildingNumberSource === "manual" &&
          profile?.buildingNumberSource !== "auto");

      if (
        addressWasChanged ||
        (!existingProfile?.geoAdminResolvedAt && hasResolvableObjectAddress(nextBuildingAddress))
      ) {
        const resolved = hasResolvableObjectAddress(nextBuildingAddress)
          ? await resolveGeoAdminProperty(db, nextBuildingAddress)
          : null;
        profile = {
          ...profile,
          buildingStreet: resolved?.addressStreet || nextBuildingAddress.street,
          buildingStreetNo: resolved?.addressHouseNumber || nextBuildingAddress.houseNumber,
          buildingZip: resolved?.addressZip || nextBuildingAddress.zip,
          buildingCity: resolved?.addressCity || nextBuildingAddress.city,
          egid: manualBuildingNumber
            ? safeString(profile?.buildingNumber ?? profile?.egid ?? existingProfile?.buildingNumber ?? existingProfile?.egid) || null
            : resolved?.egid ?? null,
          buildingNumber: manualBuildingNumber
            ? safeString(profile?.buildingNumber ?? profile?.egid ?? existingProfile?.buildingNumber ?? existingProfile?.egid) || null
            : resolved?.buildingNumber ?? null,
          buildingNumberSource: manualBuildingNumber ? "manual" : "auto",
          parcelNumber: manualParcel
            ? safeString(profile?.parcelNumber ?? existingProfile?.parcelNumber) || null
            : resolved?.parcelNumber ?? null,
          parcelNumberSource: manualParcel ? "manual" : "auto",
          geoAdminFeatureId: resolved?.featureId ?? null,
          geoAdminEasting: resolved?.easting ?? null,
          geoAdminNorthing: resolved?.northing ?? null,
          geoAdminResolvedAt: resolved?.lookupSucceeded ? new Date().toISOString() : null,
        };
      } else {
        profile = {
          ...profile,
          egid: manualBuildingNumber
            ? safeString(
                profile?.buildingNumber ??
                  profile?.egid ??
                  existingProfile?.buildingNumber ??
                  existingProfile?.egid,
              ) || null
            : hasOwn(profile, "egid")
              ? profile.egid
              : existingProfile.egid ?? null,
          buildingNumber: hasOwn(profile, "buildingNumber")
            ? profile.buildingNumber
            : hasOwn(profile, "egid")
              ? profile.egid
              : existingProfile.buildingNumber ?? existingProfile.egid ?? null,
          buildingNumberSource: manualBuildingNumber
            ? "manual"
            : profile?.buildingNumberSource || existingProfile?.buildingNumberSource || "auto",
          parcelNumber: hasOwn(profile, "parcelNumber")
            ? profile.parcelNumber
            : existingProfile.parcelNumber ?? null,
          parcelNumberSource: manualParcel
            ? "manual"
            : profile?.parcelNumberSource || existingProfile?.parcelNumberSource || "auto",
          geoAdminFeatureId: existingProfile.geoAdminFeatureId ?? null,
          geoAdminEasting: existingProfile.geoAdminEasting ?? null,
          geoAdminNorthing: existingProfile.geoAdminNorthing ?? null,
          geoAdminResolvedAt: existingProfile.geoAdminResolvedAt ?? null,
        };
      }
    }

    const paymentTermsLocked =
      safeString((existingPlanning as any)?.orderStatus) === "generated" ||
      !!safeString((existingPlanning as any)?.orderId);
    if (paymentTermsLocked) {
      const existingPaymentTerms = safeString(
        (existingPlanning as any)?.data?.reportOptions?.paymentTerms ??
          (existingPlanning as any)?.data?.reportOptions?.zahlungsbedingungen,
      );
      const paymentTermsChanged =
        (hasOwn(reportOptions, "paymentTerms") &&
          safeString(reportOptions?.paymentTerms) !== existingPaymentTerms) ||
        (hasOwn(reportOptions, "zahlungsbedingungen") &&
          safeString(reportOptions?.zahlungsbedingungen) !== existingPaymentTerms);
      const paymentsChanged =
        hasOwn(angebot, "payments") &&
        stableJson(angebot?.payments) !==
          stableJson((existingPlanning as any)?.data?.angebot?.payments);

      if (paymentTermsChanged || paymentsChanged || invoiceSyncRequestedFieldPresent) {
        return jsonResponse(
          origin,
          {
            ok: false,
            message:
              "Zahlungsbedingungen können nach Auftragserzeugung nicht mehr geändert werden.",
          },
          409,
        );
      }
    }

    const canAutoRename = shouldAutoRenameTitle(
      safeString((existingPlanning as any)?.title)
    );

    // -------------------- CRM-friendly metadata --------------------

    if (typeof title === "string") {
      setObj.title = safeString(title) || "Unbenanntes Projekt";
    }

    if (typeof customerId === "string") {
      setObj.customerId = safeString(customerId) || null;
    }

    if (typeof planningNumber === "string") {
      setObj.planningNumber = safeString(planningNumber);
    }

    if (commercial && typeof commercial === "object") {
      if (typeof commercial.stage === "string") {
        const nextStage = safeString(commercial.stage) || "lead";
        const company = await companies.findOne({
          ...(activeCompanyObjectId ? { _id: activeCompanyObjectId } : { _id: new ObjectId() }),
        });
        const currentStage = safeString((existingPlanning as any)?.commercial?.stage) || "lead";
        const currentStageType = getPipelineStageTypeByKey(company, currentStage);
        const nextStageType = getPipelineStageTypeByKey(company, nextStage);

        if (
          currentStageType === "won" &&
          nextStage !== currentStage
        ) {
          return jsonResponse(
            origin,
            { ok: false, message: "Statuswechsel aus «Gewonnen» ist nur via Storno möglich." },
            409,
          );
        }

        if (
          nextStageType === "won" &&
          safeString((existingPlanning as any)?.orderStatus) !== "generated"
        ) {
          return jsonResponse(
            origin,
            { ok: false, message: "Auftrag muss zuerst generiert werden." },
            409,
          );
        }

        setObj["commercial.stage"] = nextStage;
        setObj["commercial.stageHistory"] = buildStageHistoryForTransition(
          existingPlanning,
          nextStage,
          session as any,
        );
      }
      if (typeof commercial.valueChf === "number") {
        setObj["commercial.valueChf"] = commercial.valueChf;
      }
      if (typeof commercial.assignedToUserId === "string") {
        setObj["commercial.assignedToUserId"] =
          safeString(commercial.assignedToUserId) || null;
      }
      if (typeof commercial.source === "string") {
        setObj["commercial.source"] = safeString(commercial.source);
      }
      if (typeof commercial.label === "string") {
        setObj["commercial.label"] = safeString(commercial.label);
      }
    }

    if (summary && typeof summary === "object") {
      if (typeof summary.customerName === "string") {
        setObj["summary.customerName"] = safeString(summary.customerName);
      }
      if (typeof summary.moduleCount === "number") {
        setObj["summary.moduleCount"] = summary.moduleCount;
      }
      if (typeof summary.selectedPanelId === "string") {
        setObj["summary.selectedPanelId"] = safeString(summary.selectedPanelId);
      }
      if (typeof summary.dcPowerKw === "number") {
        setObj["summary.dcPowerKw"] = summary.dcPowerKw;
      }
      if (typeof summary.roofCount === "number") {
        setObj["summary.roofCount"] = summary.roofCount;
      }
      if (typeof summary.hasSnapshot === "boolean") {
        setObj["summary.hasSnapshot"] = summary.hasSnapshot;
      }
      if ("lastCalculatedAt" in summary) {
        setObj["summary.lastCalculatedAt"] = summary.lastCalculatedAt ?? null;
      }
    }

    // -------------------- Planner flow payload --------------------

    if (profile && typeof profile === "object") {
      setObj["data.profile"] = profile;
      setObj.currentStep = "ist";

      const customerName = buildCustomerNameFromProfile(profile);
      if (customerName) {
        setObj["summary.customerName"] = customerName;
      }

      const autoTitle = deriveProjectTitleFromData(profile, ist);
      if (autoTitle && canAutoRename) {
        setObj.title = autoTitle;
      }
    }

if (ist && typeof ist === "object") {
  const existingIst = (existingPlanning as any)?.data?.ist ?? {};

  const mergedIst = {
    ...existingIst,
    ...ist,
    checklist:
      ist?.checklist && typeof ist.checklist === "object"
        ? {
            ...(existingIst?.checklist ?? {}),
            ...ist.checklist,
          }
        : existingIst?.checklist,
  };

  setObj["data.ist"] = mergedIst;
  setObj.currentStep = safeString(body?.currentStep) || "building";

  const existingParts = (existingPlanning as any)?.data?.parts ?? {};
  const existingItems = Array.isArray(existingParts?.items)
    ? preserveLoosePartsItems(existingParts.items)
    : [];

  setObj["data.parts"] = {
    ...existingParts,
    items: syncDemolitionItem(existingItems, mergedIst),
  };

  const effectiveProfile =
    profile && typeof profile === "object"
      ? profile
      : (existingPlanning as any)?.data?.profile;

  const autoTitle = deriveProjectTitleFromData(effectiveProfile, mergedIst);
  if (autoTitle && canAutoRename) {
    setObj.title = autoTitle;
  }
}

    if (planner && typeof planner === "object") {
      const existingPlannerState = (existingPlanning as any)?.data?.planner ?? {};

      const mergedPlanner = {
        ...existingPlannerState,
        ...planner,
        snapshot: {
          ...(existingPlannerState?.snapshot ?? {}),
          ...(planner?.snapshot ?? {}),
        },
      };

      if (!mergedPlanner.snapshot?.url && existingPlannerState?.snapshot) {
        mergedPlanner.snapshot = {
          ...existingPlannerState.snapshot,
          ...(planner?.snapshot ?? {}),
        };
      }

      setObj["data.planner"] = mergedPlanner;

      const computedSummary = deriveSummaryFromPlanner({
        ...(existingPlanning as any),
        data: {
          ...((existingPlanning as any)?.data ?? {}),
          planner: mergedPlanner,
        },
        summary: (existingPlanning as any)?.summary ?? {},
      });

      setObj["summary.moduleCount"] = computedSummary.moduleCount;
      setObj["summary.selectedPanelId"] = computedSummary.selectedPanelId;
      setObj["summary.dcPowerKw"] = computedSummary.dcPowerKw;
      setObj["summary.roofCount"] = computedSummary.roofCount;
      setObj["summary.hasSnapshot"] = computedSummary.hasSnapshot;
      setObj["summary.lastCalculatedAt"] = computedSummary.lastCalculatedAt;

      const plannerStep = safeString(planner?.step || mergedPlanner?.step);

      if (plannerStep === "modules") {
        setObj.currentStep = "modules";
      } else if (plannerStep === "building") {
        setObj.currentStep = "building";
      } else {
        setObj.currentStep =
          safeString((existingPlanning as any)?.currentStep) || "building";
      }
    }

    if (parts && typeof parts === "object") {
      const existingParts = (existingPlanning as any)?.data?.parts ?? {};

      const normalizedItems = Array.isArray(parts?.items)
        ? preserveLoosePartsItems(parts.items)
        : preserveLoosePartsItems(existingParts.items ?? []);
      normalizedItemsForCatalog = normalizedItems;

      const normalizedFormDocuments =
        parts?.formDocuments && typeof parts.formDocuments === "object"
          ? parts.formDocuments
          : existingParts.formDocuments ?? {};

      setObj["data.parts"] = {
        ...existingParts,
        ...parts,
        items: normalizedItems,
        formDocuments: normalizedFormDocuments,
      };

      setObj.currentStep = "parts";
    }

    if (angebot && typeof angebot === "object") {
      const existingAngebot = (existingPlanning as any)?.data?.angebot ?? {};
      const nextAngebot = {
        ...existingAngebot,
        ...angebot,
      };
      delete (nextAngebot as any).invoiceSyncRequestedAt;

      const paymentValidation = validatePlanningPayments(nextAngebot?.payments);
      if (!paymentValidation.ok) {
        return jsonResponse(origin, { ok: false, message: paymentValidation.message }, 400);
      }

      setObj["data.angebot"] = nextAngebot;
    }

    // NEW: save Bericht options
    if (reportOptions && typeof reportOptions === "object") {
      const existingReportOptions =
        (existingPlanning as any)?.data?.reportOptions ?? {};

      setObj["data.reportOptions"] = {
        ...existingReportOptions,
        ...reportOptions,
      };

      // se siamo in Bericht, non sovrascrivere currentStep con qualcosa di sbagliato
      if (!setObj.currentStep) {
        setObj.currentStep = "bericht";
      }
    }

    // -------------------- customerId validation / sync --------------------

    if (typeof customerId === "string" && safeString(customerId)) {
      const customerObjectId = toObjectIdOrNull(customerId);

      if (!customerObjectId) {
        return jsonResponse(origin, { ok: false, error: "Invalid customerId" }, 400);
      }

      const customer = await customers.findOne({
        _id: customerObjectId,
        companyId: session.activeCompanyId,
      });

      if (!customer) {
        return jsonResponse(
          origin,
          { ok: false, error: "Customer not found in active company" },
          400
        );
      }

      const customerName =
        safeString((customer as any).name) ||
        safeString((customer as any).companyName) ||
        [safeString((customer as any).firstName), safeString((customer as any).lastName)]
          .filter(Boolean)
          .join(" ")
          .trim();

      if (customerName && !setObj["summary.customerName"]) {
        setObj["summary.customerName"] = customerName;
      }
    }

    const res = await plannings.updateOne(
      { _id: planningObjectId, companyId: session.activeCompanyId, ...activeDocumentFilter() },
      { $set: setObj },
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const updated = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
      ...activeDocumentFilter(),
    });

    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Planning not found after update" }, 404);
    }

    if (Array.isArray(normalizedItemsForCatalog) && normalizedItemsForCatalog.length) {
      await upsertPinnedCatalogItems(
        db,
        String(session.activeCompanyId),
        normalizedItemsForCatalog,
      );
    }

    const updatedCompany = await companies.findOne({
      ...(activeCompanyObjectId ? { _id: activeCompanyObjectId } : { _id: new ObjectId() }),
    });
    if (
      safeString((updated as any)?.commercial?.stage) ===
      getWonStageKey(updatedCompany)
    ) {
      await ensureExecutionTasksForWonPlanning(db, updated, session as any);
    }

    let syncedInvoices: any[] | null = null;
    if (invoiceSyncRequestedAt && safeString((updated as any)?.orderId)) {
      const commercial = await computePlanningCommercialSummary(db, updated);
      const resyncResult = await resyncOrderInvoices({
        db,
        companyId: String(session.activeCompanyId),
        planning: updated,
        company: updatedCompany,
        session: session as any,
        orderId: safeString((updated as any)?.orderId),
        orderGeneratedAt:
          (updated as any)?.orderGeneratedAt instanceof Date
            ? (updated as any).orderGeneratedAt
            : new Date(String((updated as any)?.orderGeneratedAt || new Date().toISOString())),
        totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
      });

      if (!resyncResult.ok) {
        return jsonResponse(
          origin,
          { ok: false, message: resyncResult.message },
          resyncResult.status,
        );
      }

      syncedInvoices = resyncResult.invoices.map((invoice) => normalizeInvoice(invoice));
    }

    const normalizedInvoices =
      syncedInvoices ??
      (safeString((updated as any)?.orderId)
        ? (
            await invoices
              .find({
                companyId: String(session.activeCompanyId),
                orderId: safeString((updated as any)?.orderId),
              })
              .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
              .toArray()
          ).map((invoice) => normalizeInvoice(invoice))
        : []);

    const {
      comments: _comments,
      signatureToken: _signatureToken,
      signatureTokenHash: _signatureTokenHash,
      signerIp: _signerIp,
      signerUserAgent: _signerUserAgent,
      offerSignatureTokenHash: _offerSignatureTokenHash,
      offerSignerIp: _offerSignerIp,
      offerSignerUserAgent: _offerSignerUserAgent,
      offerSignatureImage: _offerSignatureImage,
      offerSignatureProcessingId: _offerSignatureProcessingId,
      offerSignatureProcessingAt: _offerSignatureProcessingAt,
      offerSignatureAudit: _offerSignatureAudit,
      offerSignedPdfSha256: _offerSignedPdfSha256,
      ...updatedWithoutComments
    } = updated as any;
    const normalized = {
      ...updatedWithoutComments,
      _id: String((updated as any)._id),
      summary: deriveSummaryFromPlanner(updated),
      title: safeString((updated as any)?.title) || "Unbenanntes Projekt",
      planningNumber: safeString((updated as any)?.planningNumber) || "",
      commercial: {
        stage: safeString((updated as any)?.commercial?.stage) || "lead",
        valueChf:
          typeof (updated as any)?.commercial?.valueChf === "number"
            ? (updated as any).commercial.valueChf
            : 0,
        assignedToUserId: (updated as any)?.commercial?.assignedToUserId ?? null,
        source: safeString((updated as any)?.commercial?.source),
        label: safeString((updated as any)?.commercial?.label),
        stageHistory: normalizeStageHistory((updated as any)?.commercial?.stageHistory),
      },
      customerId: (updated as any)?.customerId ?? null,
      ...normalizeOrderFields(updated),
      invoices: normalizedInvoices,
    };

    return jsonResponse(origin, { ok: true, planning: normalized, invoices: normalizedInvoices }, 200);
  } catch (e: any) {
    console.error("UPDATE PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  }
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  if (!planningId) {
    return jsonResponse(
      origin,
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      500
    );
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }


  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const plannings = db.collection("plannings");
    const invoices = getInvoicesCollection(db);
    await ensurePlanningIndexes(db);
    await ensurePlanningStageHistoryMigration(db);
    await ensureInvoiceIndexes(db);

    const doc = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
      ...activeDocumentFilter(),
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const normalizedInvoices = safeString((doc as any)?.orderId)
      ? (
          await invoices
            .find({
              companyId: String(session.activeCompanyId),
              orderId: safeString((doc as any)?.orderId),
            })
            .sort({ position: 1, rateIndex: 1, createdAt: 1, _id: 1 })
            .toArray()
        ).map((invoice) => normalizeInvoice(invoice))
      : [];

    const {
      comments: _comments,
      signatureToken: _signatureToken,
      signatureTokenHash: _signatureTokenHash,
      signerIp: _signerIp,
      signerUserAgent: _signerUserAgent,
      offerSignatureTokenHash: _offerSignatureTokenHash,
      offerSignerIp: _offerSignerIp,
      offerSignerUserAgent: _offerSignerUserAgent,
      offerSignatureImage: _offerSignatureImage,
      offerSignatureProcessingId: _offerSignatureProcessingId,
      offerSignatureProcessingAt: _offerSignatureProcessingAt,
      offerSignatureAudit: _offerSignatureAudit,
      offerSignedPdfSha256: _offerSignedPdfSha256,
      ...docWithoutComments
    } = doc as any;
    const normalized = {
      ...docWithoutComments,
      _id: String((doc as any)._id),
      summary: deriveSummaryFromPlanner(doc),
      title: safeString((doc as any)?.title) || "Unbenanntes Projekt",
      planningNumber: safeString((doc as any)?.planningNumber) || "",
      commercial: {
        stage: safeString((doc as any)?.commercial?.stage) || "lead",
        valueChf:
          typeof (doc as any)?.commercial?.valueChf === "number"
            ? (doc as any).commercial.valueChf
            : 0,
        assignedToUserId: (doc as any)?.commercial?.assignedToUserId ?? null,
        source: safeString((doc as any)?.commercial?.source),
        label: safeString((doc as any)?.commercial?.label),
        stageHistory: normalizeStageHistory((doc as any)?.commercial?.stageHistory),
      },
      customerId: (doc as any)?.customerId ?? null,
      ...normalizeOrderFields(doc),
      invoices: normalizedInvoices,
    };

    return jsonResponse(origin, { ok: true, planning: normalized, invoices: normalizedInvoices }, 200);
  } catch (e: any) {
    console.error("GET PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }


  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const plannings = db.collection("plannings");

    const res = await plannings.updateOne(
      {
        _id: planningObjectId,
        companyId: session.activeCompanyId,
        ...activeDocumentFilter(),
      },
      {
        $set: buildSoftDeleteFields(session as any),
      }
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  }
}
