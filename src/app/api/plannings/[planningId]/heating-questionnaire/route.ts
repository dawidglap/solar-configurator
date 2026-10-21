import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { enforceActiveSubscription } from "@/lib/subscription";
import { resolveProjectType } from "@/lib/projectType";
import {
  buildHeatingQuestionnaireSet,
  HeatingQuestionnaireValidationError,
  normalizeHeatingQuestionnaire,
  parseHeatingQuestionnairePatch,
} from "@/lib/heatingQuestionnaire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string }> };

function noStoreHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...noStoreHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

function questionnaireResponse(planningId: string, stored: unknown) {
  return {
    ok: true,
    planningId,
    questionnaire: normalizeHeatingQuestionnaire(stored),
  };
}

function ensureHeatingProject(origin: string | null, planning: Record<string, unknown>) {
  try {
    if (resolveProjectType(planning.projectType) === "heating") return null;
  } catch {
    // An invalid stored project type must never be treated as a heating project.
  }
  return jsonResponse(
    origin,
    { ok: false, message: "Heating questionnaire is only available for heating projects" },
    409,
  );
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const planning = await db.collection("plannings").findOne({
      _id: new ObjectId(planningId),
      companyId: String(session.activeCompanyId),
      ...activeDocumentFilter(),
    });
    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const projectTypeError = ensureHeatingProject(origin, planning);
    if (projectTypeError) return projectTypeError;

    return jsonResponse(
      origin,
      questionnaireResponse(planningId, (planning as any)?.heating?.questionnaire),
    );
  } catch (error: any) {
    console.error("GET HEATING QUESTIONNAIRE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  let patch: Record<string, unknown>;
  try {
    const body = await req.json();
    patch = parseHeatingQuestionnairePatch(body);
  } catch (error) {
    const message = error instanceof HeatingQuestionnaireValidationError
      ? error.message
      : "Invalid JSON body";
    return jsonResponse(origin, { ok: false, message }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    const plannings = db.collection("plannings");
    const id = new ObjectId(planningId);
    const companyId = String(session.activeCompanyId);
    const planning = await plannings.findOne({
      _id: id,
      companyId,
      ...activeDocumentFilter(),
    });
    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const projectTypeError = ensureHeatingProject(origin, planning);
    if (projectTypeError) return projectTypeError;

    const questionnaireSet = buildHeatingQuestionnaireSet(patch);
    if (Object.keys(questionnaireSet).length > 0) {
      const result = await plannings.updateOne(
        {
          _id: id,
          companyId,
          projectType: "heating",
          ...activeDocumentFilter(),
        },
        { $set: { ...questionnaireSet, updatedAt: new Date() } },
      );
      if (!result.matchedCount) {
        return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
      }
    }

    const updated = await plannings.findOne({
      _id: id,
      companyId,
      ...activeDocumentFilter(),
    });
    if (!updated) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    return jsonResponse(
      origin,
      questionnaireResponse(planningId, (updated as any)?.heating?.questionnaire),
    );
  } catch (error: any) {
    console.error("PATCH HEATING QUESTIONNAIRE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
