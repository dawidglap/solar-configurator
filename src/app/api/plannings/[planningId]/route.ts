// src/app/api/plannings/[planningId]/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";

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

function buildCustomerNameFromProfile(profile: any) {
  const businessName = safeString(profile?.businessName);
  if (businessName) return businessName;

  const firstName = safeString(profile?.contactFirstName);
  const lastName = safeString(profile?.contactLastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName || "";
}

function deriveSummaryFromPlanner(docLike: any) {
  const data = docLike?.data ?? {};
  const existingSummary = docLike?.summary ?? {};

  const panels = Array.isArray(data?.panels) ? data.panels : [];
  const layers = Array.isArray(data?.layers) ? data.layers : [];

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
      safeString(data?.selectedPanelId),

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

    lastCalculatedAt:
      existingSummary.lastCalculatedAt ?? null,
  };
}

/* --------------------------------- PATCH --------------------------------- */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  }

  if (!secret) {
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });
  }

  const session = readSession(req, secret);
  if (!session) {
    return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  if (!planningId) {
    return Response.json(
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      { status: 500 },
    );
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
    return Response.json(
      {
        ok: false,
        error:
          "Send planner data ({ profile }, { ist }, { planner }) or CRM fields ({ title, customerId, planningNumber, commercial, summary })",
      },
      { status: 400 },
    );
  }

  const setObj: any = { updatedAt: new Date() };

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

  // dopo Profil si passa a IST
  if (profile && typeof profile === "object") {
    setObj["data.profile"] = profile;
    setObj.currentStep = "ist";

    const customerName = buildCustomerNameFromProfile(profile);
    if (customerName) {
      setObj["summary.customerName"] = customerName;
    }
  }

  // dopo IST si passa a Building (mappa)
  if (ist && typeof ist === "object") {
    setObj["data.ist"] = ist;
    setObj.currentStep = "building";
  }

  // dopo planner (roof + moduli) si passa a offer/review
  if (planner && typeof planner === "object") {
    setObj["data.planner"] = planner;
    setObj.currentStep = "offer";
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");
    const customers = db.collection("customers");

    // se arriva customerId, verifichiamo che appartenga alla stessa company
    if (typeof customerId === "string" && safeString(customerId)) {
      const customer = await customers.findOne({
        _id: toObjectIdOrNull(customerId),
        companyId: session.activeCompanyId,
      });

      if (!customer) {
        return Response.json(
          { ok: false, error: "Customer not found in active company" },
          { status: 400 },
        );
      }

      const customerName =
        safeString(customer.name) ||
        safeString(customer.companyName) ||
        [safeString(customer.firstName), safeString(customer.lastName)]
          .filter(Boolean)
          .join(" ")
          .trim();

      if (customerName && !setObj["summary.customerName"]) {
        setObj["summary.customerName"] = customerName;
      }
    }

    const res = await plannings.updateOne(
      { _id: new ObjectId(planningId), companyId: session.activeCompanyId },
      { $set: setObj },
    );

    if (res.matchedCount === 0) {
      return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });
    }

    // ritorna il doc aggiornato in forma utile per il CRM
    const updated = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    return Response.json({
      ok: true,
      planning: updated,
    });
  } catch (e: any) {
    console.error("UPDATE PLANNING ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
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
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  }

  if (!secret) {
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });
  }

  const session = readSession(req, secret);
  if (!session) {
    return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  if (!planningId) {
    return Response.json(
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      { status: 500 },
    );
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const doc = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    if (!doc) {
      return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });
    }

    const normalized = {
      ...doc,
      summary: deriveSummaryFromPlanner(doc),
      title: safeString(doc?.title) || "Unbenanntes Projekt",
      planningNumber: safeString(doc?.planningNumber) || "",
      commercial: {
        stage: safeString(doc?.commercial?.stage) || "lead",
        valueChf:
          typeof doc?.commercial?.valueChf === "number"
            ? doc.commercial.valueChf
            : 0,
        assignedToUserId: doc?.commercial?.assignedToUserId ?? null,
        source: safeString(doc?.commercial?.source),
        label: safeString(doc?.commercial?.label),
      },
      customerId: doc?.customerId ?? null,
    };

    return Response.json({ ok: true, planning: normalized });
  } catch (e: any) {
    console.error("GET PLANNING ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  } finally {
    await client.close().catch(() => {});
  }
}