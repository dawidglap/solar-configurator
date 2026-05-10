import { ObjectId } from "mongodb";
import {
  assertCompanyScopedPlanning,
  buildPlanningFileDownloadUrl,
  createPlanningFileJsonResponse,
  createPlanningFileNoStoreHeaders,
  inferPlanningFileCloudinaryDeliveryType,
  getPlanningFileDbAndSession,
  getPlanningFilesCollection,
  getOriginalFileExtension,
  splitPlanningFilePublicIdAndFormat,
} from "@/lib/planningFiles";
import { safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string; fileId: string }> };

function buildContentDisposition(
  disposition: "inline" | "attachment",
  originalFileName: string,
) {
  const encodedSource = originalFileName.replace(/["\r\n]/g, "").trim() || "download";
  const asciiFallback =
    encodedSource
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "download";
  const encoded = encodeURIComponent(encodedSource);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function bytesToHexPrefix(buffer: Uint8Array, count = 8) {
  return Array.from(buffer.slice(0, count))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function bytesToTextSnippet(buffer: Uint8Array, count = 200) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, count));
  } catch {
    return "";
  }
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: createPlanningFileNoStoreHeaders(origin),
  });
}

export async function GET(req: Request, { params }: Params) {
  const context = await getPlanningFileDbAndSession(req);
  if (!context.ok) return context.response;

  const { origin, db, companyId, session } = context;
  const subscriptionError = await enforceActiveSubscription(db, origin, session);
  if (subscriptionError) return subscriptionError;
  const { planningId, fileId } = await params;

  if (!ObjectId.isValid(planningId) || !ObjectId.isValid(fileId)) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid id" }, 400);
  }

  try {
    const planning = await assertCompanyScopedPlanning(db, planningId, companyId);
    if (!planning) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const fileDoc = await getPlanningFilesCollection(db).findOne({
      _id: new ObjectId(fileId),
      companyId,
      planningId,
      isDeleted: { $ne: true },
    });

    if (!fileDoc) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "File not found" }, 404);
    }

    const disposition =
      safeString(new URL(req.url).searchParams.get("disposition")).toLowerCase() === "inline"
        ? "inline"
        : "attachment";

    const downloadUrl = buildPlanningFileDownloadUrl(fileDoc, disposition);
    const resourceType =
      (safeString(fileDoc?.cloudinaryResourceType) || "raw") as "image" | "raw" | "video";
    const deliveryType = inferPlanningFileCloudinaryDeliveryType(fileDoc);
    const originalFileName = safeString(fileDoc?.originalFileName) || "download";
    const { publicId, format, publicIdWithExtension } = splitPlanningFilePublicIdAndFormat(fileDoc);
    const mimeType = safeString(fileDoc?.mimeType) || "application/octet-stream";

    const upstream = await fetch(downloadUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
    });
    const upstreamContentType = safeString(upstream.headers.get("content-type")).toLowerCase();
    const upstreamContentLength = safeString(upstream.headers.get("content-length"));
    const bodyBuffer = new Uint8Array(await upstream.arrayBuffer());
    const pdfSignature = bodyBuffer.slice(0, 5);
    const isPdfPayload =
      pdfSignature.length === 5 &&
      String.fromCharCode(...pdfSignature) === "%PDF-";
    const shouldValidatePdf = mimeType === "application/pdf";
    const nonPdfSnippet = !isPdfPayload ? bytesToTextSnippet(bodyBuffer) : "";

    console.info("PLANNING FILE DOWNLOAD URL", {
      planningId,
      fileId,
      cloudinaryPublicId: safeString(fileDoc?.cloudinaryPublicId),
      normalizedPublicId: publicId,
      publicIdWithExtension,
      format,
      resourceType,
      deliveryType,
      originalFileName,
      mimeType,
      generatedUrl: downloadUrl,
      disposition,
      inferredExtension: getOriginalFileExtension(originalFileName, mimeType),
      upstreamStatus: upstream.status,
      upstreamContentType,
      upstreamContentLength,
      pdfSignatureHex: bytesToHexPrefix(bodyBuffer),
      ...(shouldValidatePdf && !isPdfPayload
        ? { upstreamSnippet: nonPdfSnippet }
        : {}),
    });

    if (!upstream.ok) {
      return createPlanningFileJsonResponse(
        origin,
        {
          ok: false,
          error: `Cloudinary download failed with status ${upstream.status}`,
        },
        upstream.status === 401 || upstream.status === 403 || upstream.status === 404
          ? upstream.status
          : 502,
      );
    }

    if (
      upstreamContentType.includes("text/html") ||
      upstreamContentType.includes("application/json") ||
      upstreamContentType.includes("application/xml") ||
      upstreamContentType.includes("text/xml")
    ) {
      return createPlanningFileJsonResponse(
        origin,
        {
          ok: false,
          error: "Cloudinary returned a non-file response",
        },
        502,
      );
    }

    if (shouldValidatePdf && !isPdfPayload) {
      return createPlanningFileJsonResponse(
        origin,
        {
          ok: false,
          error: "Downloaded asset is not a valid PDF",
        },
        502,
      );
    }

    return new Response(bodyBuffer, {
      status: 200,
      headers: {
        ...createPlanningFileNoStoreHeaders(origin),
        "Content-Type": mimeType,
        "Content-Disposition": buildContentDisposition(disposition, originalFileName),
        ...(upstreamContentLength ? { "Content-Length": upstreamContentLength } : {}),
      },
    });
  } catch (e: any) {
    console.error("DOWNLOAD PLANNING FILE ERROR:", e);
    return createPlanningFileJsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}
