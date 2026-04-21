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

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

/* ---------------------------------- POST ---------------------------------- */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
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

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();

    const plannings = db.collection("plannings");
    const catalogItems = db.collection("catalogItems");

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const data = (planning as any)?.data ?? {};
    const planner = data?.planner ?? {};
    const reportOptions = data?.reportOptions ?? {};

    /* -------------------- LOAD CATALOG -------------------- */

    const catalog = await catalogItems
      .find({
        companyId: session.activeCompanyId,
        isActive: true,
      })
      .toArray();

    /* -------------------- IMPORT DEFAULTS -------------------- */
    // IMPORTANTE: assicurati che questo path sia corretto nel tuo progetto
    const { buildDefaultPartsItems } = await import(
      "@/app/api/plannings/[planningId]/parts-defaults/route"
    );

 const defaultItems = buildDefaultPartsItems(planning, catalog);

    /* -------------------- ADD BATTERY -------------------- */

    const selectedBatteryId = safeString(
      reportOptions?.selectedBatteryItemId
    );

    if (selectedBatteryId) {
      const battery = catalog.find(
        (c: any) => String(c._id) === selectedBatteryId
      );

      if (battery) {
        defaultItems.push({
          id: selectedBatteryId,
          category: battery.category || "battery",
          brand: battery.brand || "",
          name: battery.name || battery.model || "Batterie",
          unit: battery.unit || "piece",
          unitLabel: battery.unitLabel || "Stk.",
          quantity: 1,
          unitPriceNet: Number(battery.priceNet || 0),
          lineTotalNet: Number(battery.priceNet || 0),
        });
      }
    }

    /* -------------------- ADD WALLBOX -------------------- */

    const selectedWallboxId = safeString(
      reportOptions?.selectedWallboxItemId
    );

    if (selectedWallboxId) {
      const wallbox = catalog.find(
        (c: any) => String(c._id) === selectedWallboxId
      );

      if (wallbox) {
        defaultItems.push({
          id: selectedWallboxId,
          category: wallbox.category || "wallbox",
          brand: wallbox.brand || "",
          name: wallbox.name || wallbox.model || "Wallbox",
          unit: wallbox.unit || "piece",
          unitLabel: wallbox.unitLabel || "Stk.",
          quantity: 1,
          unitPriceNet: Number(wallbox.priceNet || 0),
          lineTotalNet: Number(wallbox.priceNet || 0),
        });
      }
    }

    /* -------------------- SAVE -------------------- */

    await plannings.updateOne(
      {
        _id: planningObjectId,
        companyId: session.activeCompanyId,
      },
      {
        $set: {
          "data.parts.items": defaultItems,
          updatedAt: new Date(),
        },
      }
    );

    return jsonResponse(origin, {
      ok: true,
      itemsCount: defaultItems.length,
    });
  } catch (e: any) {
    console.error("SYNC PARTS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}