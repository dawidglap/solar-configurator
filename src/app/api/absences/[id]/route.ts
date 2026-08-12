import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildIdVariants, jsonResponse, noStoreHeaders } from "@/lib/tasks";
import { ensureAbsenceIndexes, getAbsencesCollection } from "@/lib/absences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return jsonResponse(origin, { ok: false, error: "Absence not found" }, 404);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAbsenceIndexes(db);
    const result = await getAbsencesCollection(db).deleteOne({
      _id: new ObjectId(id),
      companyId: { $in: buildIdVariants(String(session.activeCompanyId)) },
    });
    if (!result.deletedCount) {
      return jsonResponse(origin, { ok: false, error: "Absence not found" }, 404);
    }
    return jsonResponse(origin, { ok: true }, 200);
  } catch (error: any) {
    console.error("DELETE ABSENCE ERROR:", error);
    return jsonResponse(origin, { ok: false, error: error?.message || "Unknown error" }, 500);
  }
}
