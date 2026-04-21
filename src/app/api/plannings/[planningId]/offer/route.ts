import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { getCorsHeaders } from "@/lib/cors";
import { addCoverPage } from "./pdf/cover-page";

export const runtime = "nodejs";

/* ---------------- CORS OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- Session ---------------- */

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

/* ---------------- Route ---------------- */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");

  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return new Response(JSON.stringify({ ok: false, error: "Missing MONGODB_URI" }), {
      status: 500,
      headers: getCorsHeaders(origin),
    });
  }

  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "Missing SESSION_SECRET" }), {
      status: 500,
      headers: getCorsHeaders(origin),
    });
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return new Response(JSON.stringify({ ok: false, error: "Not logged in" }), {
      status: 401,
      headers: getCorsHeaders(origin),
    });
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const planning = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return new Response(JSON.stringify({ ok: false, error: "Planning not found" }), {
        status: 404,
        headers: getCorsHeaders(origin),
      });
    }

    /* ---------------- MOCK DATA PER TEST COVER ---------------- */

    const offer = {
      title: "PVA Musterstrasse 12 - Zürich",
      planningNumber: "ANG-TEST-001",
      pv: {
        dcPowerKw: 12.5,
      },
      customer: {
        name: "Max Muster",
      },
    };

    /* ---------------- PDF ---------------- */

    const pdf = await PDFDocument.create();

    await addCoverPage(pdf, {
      title: offer.title,
      planningNumber: offer.planningNumber,
      kWp: offer.pv.dcPowerKw,
      customerName: offer.customer.name,
    });

    const pdfBytes = await pdf.save();

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Angebot_${planningId}.pdf"`,
        "Cache-Control": "no-store",
        ...getCorsHeaders(origin),
      },
    });
  } catch (e: any) {
    console.error("OFFER ERROR:", e);

    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
      {
        status: 500,
        headers: getCorsHeaders(origin),
      }
    );
  } finally {
    await client.close().catch(() => {});
  }
}