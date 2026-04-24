import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

type PipelineStage = {
  key: string;
  label: string;
  color: string;
  order: number;
  type?: "open" | "won" | "lost";
};

const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  {
    key: "lead",
    label: "Entwurf",
    color: "hsl(210 80% 58%)",
    order: 0,
    type: "open",
  },
  {
    key: "offer",
    label: "Angebot gesendet",
    color: "hsl(42 92% 55%)",
    order: 1,
    type: "open",
  },
  {
    key: "won",
    label: "Gewonnen",
    color: "hsl(160 60% 45%)",
    order: 2,
    type: "won",
  },
  {
    key: "lost",
    label: "Verloren",
    color: "hsl(0 72% 55%)",
    order: 3,
    type: "lost",
  },
];

/* ---------------- CORS OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- Session helpers ---------------- */

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

/* ---------------- Helpers ---------------- */

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function toObjectIdOrNull(v: unknown) {
  try {
    const s = safeString(v);
    if (!s) return null;
    return new ObjectId(s);
  } catch {
    return null;
  }
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

function normalizeStageKey(v: unknown) {
  return safeString(v).toLowerCase();
}

function normalizeStageType(v: unknown): "open" | "won" | "lost" {
  const s = safeString(v);
  if (s === "won") return "won";
  if (s === "lost") return "lost";
  return "open";
}

function isAllowedRole(session: any) {
  if (session?.isPlatformSuperAdmin === true) return true;

  const role = safeString(session?.role || session?.primaryRole || session?.companyRole).toLowerCase();

  const roles = Array.isArray(session?.roles)
    ? session.roles.map((r: any) => safeString(r).toLowerCase())
    : [];

  return (
    role === "inhaber" ||
    role === "owner" ||
    role === "admin" ||
    role === "company_admin" ||
    role === "manager" ||
    roles.includes("inhaber") ||
    roles.includes("owner") ||
    roles.includes("admin") ||
    roles.includes("company_admin") ||
    roles.includes("manager")
  );
}

function normalizePipelineStages(input: any[]): PipelineStage[] {
  return input
    .map((stage, index) => {
      const key = normalizeStageKey(stage?.key);
      const label = safeString(stage?.label);
      const color = safeString(stage?.color);

      return {
        key,
        label,
        color,
        order:
          typeof stage?.order === "number" && Number.isFinite(stage.order)
            ? stage.order
            : index,
        type: normalizeStageType(stage?.type),
      };
    })
    .filter((stage) => stage.key && stage.label)
    .sort((a, b) => a.order - b.order)
    .map((stage, index) => ({
      ...stage,
      order: index,
    }));
}

function validatePipelineStages(stages: PipelineStage[]) {
  if (!Array.isArray(stages) || stages.length < 1) {
    return "Mindestens eine Pipeline-Spalte ist erforderlich.";
  }

  const keys = new Set<string>();

  for (const stage of stages) {
    if (!stage.key || !/^[a-z0-9_-]+$/.test(stage.key)) {
      return `Ungültiger Stage-Key: ${stage.key}`;
    }

    if (keys.has(stage.key)) {
      return `Doppelter Stage-Key: ${stage.key}`;
    }

    keys.add(stage.key);

    if (!stage.label) {
      return `Label fehlt für Stage: ${stage.key}`;
    }

    if (!/^hsl\(\d{1,3}\s+\d{1,3}%\s+\d{1,3}%\)$/.test(stage.color)) {
      return `Ungültige Farbe für Stage "${stage.label}". Erwartet: hsl(210 80% 58%)`;
    }

    if (stage.type && !["open", "won", "lost"].includes(stage.type)) {
      return `Ungültiger Typ für Stage "${stage.label}".`;
    }
  }

  return "";
}

function getCompanyStages(company: any): PipelineStage[] {
  const stages = Array.isArray(company?.pipelineStages)
    ? normalizePipelineStages(company.pipelineStages)
    : [];

  return stages.length ? stages : DEFAULT_PIPELINE_STAGES;
}

/* ---------------- GET ---------------- */

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
console.log("PIPELINE SESSION:", session);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const companyObjectId = toObjectIdOrNull(session.activeCompanyId);

  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();

    const db = client.db();
    const companies = db.collection("companies");

    const company = await companies.findOne({
      _id: companyObjectId,
    });

    if (!company) {
      return jsonResponse(origin, { ok: false, error: "Company not found" }, 404);
    }

    const stages = getCompanyStages(company);

    return jsonResponse(origin, {
      ok: true,
      stages,
    });
  } catch (e: any) {
    console.error("GET PIPELINE STAGES ERROR:", e);

    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* ---------------- PUT ---------------- */

export async function PUT(req: Request) {
  const origin = req.headers.get("origin");

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

  if (!isAllowedRole(session)) {
    return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }

  const companyObjectId = toObjectIdOrNull(session.activeCompanyId);

  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, error: "Invalid JSON body" }, 400);
  }

  const incomingStages = normalizePipelineStages(
    Array.isArray(body?.stages) ? body.stages : []
  );

  const validationError = validatePipelineStages(incomingStages);

  if (validationError) {
    return jsonResponse(origin, { ok: false, error: validationError }, 400);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();

    const db = client.db();
    const companies = db.collection("companies");
    const plannings = db.collection("plannings");

    const company = await companies.findOne({
      _id: companyObjectId,
    });

    if (!company) {
      return jsonResponse(origin, { ok: false, error: "Company not found" }, 404);
    }

    const existingStages = getCompanyStages(company);
    const existingKeys = existingStages.map((s) => s.key);
    const incomingKeys = incomingStages.map((s) => s.key);

    const removedKeys = existingKeys.filter((key) => !incomingKeys.includes(key));

    if (removedKeys.length) {
      const blockedKeys: { key: string; count: number }[] = [];

      for (const key of removedKeys) {
        const count = await plannings.countDocuments({
          companyId: String(session.activeCompanyId),
          "commercial.stage": key,
        });

        if (count > 0) {
          blockedKeys.push({ key, count });
        }
      }

      if (blockedKeys.length) {
        return jsonResponse(
          origin,
          {
            ok: false,
            error: "stages_in_use",
            blockedKeys,
          },
          400
        );
      }
    }

    await companies.updateOne(
      { _id: companyObjectId },
      {
        $set: {
          pipelineStages: incomingStages,
          updatedAt: new Date(),
        },
      }
    );

    return jsonResponse(origin, {
      ok: true,
      stages: incomingStages,
    });
  } catch (e: any) {
    console.error("PUT PIPELINE STAGES ERROR:", e);

    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}