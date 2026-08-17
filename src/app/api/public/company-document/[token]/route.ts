import { getDb } from "@/lib/db";
import { safeString } from "@/lib/api-session";
import { createPublicCompanyDocumentDownloadResponse } from "@/lib/companyDocuments";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return Response.json({ ok: false, message: "Dokument nicht verfügbar." }, { status: 500 });
  }
  const token = safeString((await params).token);
  if (!token) {
    return Response.json({ ok: false, message: "Dokument nicht gefunden." }, { status: 404 });
  }
  try {
    const response = await createPublicCompanyDocumentDownloadResponse({
      db: await getDb(),
      token,
      secret,
    });
    if (!response) return Response.json(
        { ok: false, message: "Dokument nicht gefunden." },
        { status: 404, headers: getCorsHeaders(req.headers.get("origin")) },
      );
    for (const [key, value] of Object.entries(getCorsHeaders(req.headers.get("origin")))) {
      response.headers.set(key, value);
    }
    return response;
  } catch (error) {
    console.error("GET PUBLIC COMPANY DOCUMENT ERROR:", error);
    return Response.json({ ok: false, message: "Dokument konnte nicht geladen werden." }, { status: 500 });
  }
}
