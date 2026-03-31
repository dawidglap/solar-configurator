// src/app/api/plannings/[planningId]/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

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

  // es. "9445 Rebstein"
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

  const panels =
    Array.isArray(data?.panels) ? data.panels :
    Array.isArray(data?.planner?.panels) ? data.planner.panels :
    [];

  const layers =
    Array.isArray(data?.layers) ? data.layers :
    Array.isArray(data?.planner?.layers) ? data.planner.layers :
    [];

  return {
    customerName:
      safeString(existingSummary.customerName) ||
      buildCustomerNameFromProfile(data?.profile),

    moduleCount:
      typeof existingSummary.moduleCount === "number"
        ? existingSummary.moduleCount
        : panels.length,

    selectedPanelId:
      safeString(existingSummary.selectedPanelId) ||
      safeString(data?.selectedPanelId) ||
      safeString(data?.planner?.selectedPanelId),

    dcPowerKw:
      typeof existingSummary.dcPowerKw === "number"
        ? existingSummary.dcPowerKw
        : 0,

    roofCount:
      typeof existingSummary.roofCount === "number"
        ? existingSummary.roofCount
        : layers.length,

    hasSnapshot:
      typeof existingSummary.hasSnapshot === "boolean"
        ? existingSummary.hasSnapshot
        : !!data?.snapshotScale,

    lastCalculatedAt: existingSummary.lastCalculatedAt ?? null,
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

  const profile = body?.profile;
  const ist = body?.ist;
  const planner = body?.planner;

  const title = body?.title;
  const customerId = body?.customerId;
  const planningNumber = body?.planningNumber;
  const commercial = body?.commercial;
  const summary = body?.summary;

  const hasPlannerPayload =
    (profile && typeof profile === "object") ||
    (ist && typeof ist === "object") ||
    (planner && typeof planner === "object");

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
          "Send planner data ({ profile }, { ist }, { planner }) or CRM fields ({ title, customerId, planningNumber, commercial, summary })",
      },
      400
    );
  }

  const setObj: Record<string, any> = { updatedAt: new Date() };

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");
    const customers = db.collection("customers");

    const existingPlanning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!existingPlanning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
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
        setObj["commercial.stage"] = safeString(commercial.stage) || "lead";
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
      setObj["data.ist"] = ist;
      setObj.currentStep = "building";

      const effectiveProfile =
        profile && typeof profile === "object"
          ? profile
          : (existingPlanning as any)?.data?.profile;

      const autoTitle = deriveProjectTitleFromData(effectiveProfile, ist);
      if (autoTitle && canAutoRename) {
        setObj.title = autoTitle;
      }
    }

    if (planner && typeof planner === "object") {
      setObj["data.planner"] = planner;
      setObj.currentStep = "offer";
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
      { _id: planningObjectId, companyId: session.activeCompanyId },
      { $set: setObj },
    );

    if (res.matchedCount === 0) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const updated = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Planning not found after update" }, 404);
    }

    const normalized = {
      ...updated,
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
      },
      customerId: (updated as any)?.customerId ?? null,
    };

    return jsonResponse(origin, { ok: true, planning: normalized }, 200);
  } catch (e: any) {
    console.error("UPDATE PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
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

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const doc = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const normalized = {
      ...doc,
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
      },
      customerId: (doc as any)?.customerId ?? null,
    };

    return jsonResponse(origin, { ok: true, planning: normalized }, 200);
  } catch (e: any) {
    console.error("GET PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}