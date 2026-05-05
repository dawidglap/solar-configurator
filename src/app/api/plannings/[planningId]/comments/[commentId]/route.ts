import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import { canDeletePlanningComment, normalizePlanningComments } from "@/lib/plannings";
import { isAdminLikeRole } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...noStoreHeaders(origin),
    },
  });
}

function isOwnerAdminOnly(session: any) {
  if (session?.isPlatformSuperAdmin === true) return true;
  const roles = [
    session?.activeRole,
    session?.role,
    session?.activeCompanyRole,
    session?.membershipRole,
    session?.companyRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);

  return roles.some((role) => ["owner", "inhaber", "admin", "administrator"].includes(role));
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

type Params = { params: Promise<{ planningId: string; commentId: string }> };

export async function DELETE(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId, commentId } = await params;
  if (!ObjectId.isValid(planningId) || !safeString(commentId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid params" }, 400);
  }

  try {
    const db = await getDb();
    const planning = await db.collection("plannings").findOne({
      _id: new ObjectId(planningId),
      companyId: String(session.activeCompanyId),
      ...activeDocumentFilter(),
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const comments = normalizePlanningComments((planning as any)?.comments);
    const comment = comments.find((entry) => entry.id === commentId);
    if (!comment) {
      return jsonResponse(origin, { ok: false, message: "Comment not found" }, 404);
    }

    if (!isOwnerAdminOnly(session) && !canDeletePlanningComment(comment, session as any)) {
      return jsonResponse(origin, { ok: false, message: "Forbidden" }, 403);
    }

    await db.collection("plannings").updateOne(
      {
        _id: new ObjectId(planningId),
        companyId: String(session.activeCompanyId),
        ...activeDocumentFilter(),
      },
      {
        $pull: { comments: { id: commentId } },
        $set: { updatedAt: new Date() },
      } as any,
    );

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE PLANNING COMMENT ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
