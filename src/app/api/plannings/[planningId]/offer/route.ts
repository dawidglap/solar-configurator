// src/app/api/plannings/[planningId]/offer/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PANEL_CATALOG } from "@/constants/panels";

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

/* ---------------------------- Safe data extractors ---------------------------- */

function getByPath(obj: any, path: string) {
  try {
    return path.split(".").reduce((acc, k) => acc?.[k], obj);
  } catch {
    return undefined;
  }
}

function looksLikePanelInstance(o: any) {
  if (!o || typeof o !== "object") return false;

  // pannello piazzato spesso ha coordinate o roofId
  const hasRoof = typeof o.roofId === "string" && o.roofId.length > 0;

  // id modello può essere in vari campi:
  const panelId =
    o.panelId || o.panelSpecId || o.specId || o.catalogId || o.modelId;

  const hasPanelId = typeof panelId === "string" && panelId.length > 0;

  // coordinate tipiche
  const hasCoords =
    typeof o.x === "number" ||
    typeof o.y === "number" ||
    typeof o.cx === "number" ||
    typeof o.cy === "number";

  // basta una combinazione “sensata”
  return (hasPanelId && (hasRoof || hasCoords)) || (hasRoof && hasCoords);
}

function extractPlacedPanelsFromKnownPaths(planning: any) {
  const candidates = [
    // probabili
    "data.planner.panels",
    "data.planner.placedPanels",
    "data.planner.modules.panels",
    "data.planner.modules.placedPanels",
    "data.planner.pv.panels",
    "data.planner.pv.placedPanels",
    "data.planner.state.panels",
    "data.planner.state.placedPanels",
    // fallback
    "data.panels",
    "panels",
  ];

  for (const p of candidates) {
    const v = getByPath(planning, p);
    if (Array.isArray(v) && v.length > 0) {
      // se sono proprio pannelli
      if (looksLikePanelInstance(v[0])) return v;

      // a volte è un array dentro un wrapper
      const first = v[0];
      if (first && typeof first === "object") {
        // es: { items:[...] }
        for (const k of ["items", "data", "list", "panels"]) {
          const inner = (first as any)[k];
          if (
            Array.isArray(inner) &&
            inner.length > 0 &&
            looksLikePanelInstance(inner[0])
          ) {
            return inner;
          }
        }
      }
    }
  }
  return [];
}

// fallback “deep scan”: cerca ovunque nel planning una lista che sembri pannelli
function deepFindPanels(obj: any, maxNodes = 20000) {
  const q: any[] = [obj];
  let nodes = 0;

  while (q.length) {
    const cur = q.shift();
    nodes++;
    if (nodes > maxNodes) break;

    if (Array.isArray(cur) && cur.length > 0) {
      if (looksLikePanelInstance(cur[0])) return cur;
      // continua a scendere
      for (const it of cur) q.push(it);
      continue;
    }

    if (cur && typeof cur === "object") {
      for (const v of Object.values(cur)) q.push(v);
    }
  }

  return [];
}

function extractPanelIdFromPanelInstance(p: any): string | undefined {
  const v =
    p?.panelId || p?.panelSpecId || p?.specId || p?.catalogId || p?.modelId;
  return typeof v === "string" && v ? v : undefined;
}

/* ------------------------- NEW: extract from YOUR DB ------------------------- */

// Nel tuo DB: planning.data.profile
function extractProfile(planning: any) {
  return planning?.data?.profile ?? null;
}

// Nel tuo DB: planning.data.ist
function extractIst(planning: any) {
  return planning?.data?.ist ?? null;
}

// Nel tuo DB: planning.data.selectedPanelId
function extractSelectedPanelId(planning: any): string | undefined {
  const v = planning?.data?.selectedPanelId;
  return typeof v === "string" && v ? v : undefined;
}

// Nel tuo DB: planning.data.catalogPanels (contiene anche priceChf!)
function extractCatalogPanels(planning: any): any[] {
  const v = planning?.data?.catalogPanels;
  return Array.isArray(v) ? v : [];
}

/* --------------------------------- Formatters -------------------------------- */

const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

function safeText(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : "—";
}

function joinAddress(street?: string, no?: string, zip?: string, city?: string) {
  const a = [street?.trim(), no?.trim()].filter(Boolean).join(" ");
  const b = [zip?.trim(), city?.trim()].filter(Boolean).join(" ");
  const out = [a, b].filter(Boolean).join(", ");
  return out || "—";
}

/* --------------------------------- PDF builder -------------------------------- */

function drawLabelValue(
  page: any,
  x: number,
  y: number,
  label: string,
  value: string,
  font: any,
  bold: any,
) {
  page.drawText(label, {
    x,
    y,
    size: 10.5,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  page.drawText(value, {
    x: x + 210,
    y,
    size: 10.5,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });
}

/* --------------------------------- Route -------------------------------- */

export const runtime = "nodejs";

export async function POST(
   req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session)
    return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  if (!planningId)
    return Response.json({ ok: false, error: "Missing planningId param" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const summary = body?.summary as
    | {
        qty?: number;
        kWp?: number;
        panelId?: string | null;
        model?: string | null;
        priceChf?: number;
        totalChf?: number;
      }
    | undefined;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const planning = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });
    }

    /* -------------------- Extract: profile/ist (DB) -------------------- */

    const profile = extractProfile(planning);
    const ist = extractIst(planning);

    /* -------------------- Extract: panels/spec (DB) + fallback summary -------------------- */

    // 1) pannelli piazzati (se presenti)
    let placedPanels: any[] = extractPlacedPanelsFromKnownPaths(planning);
    if (!placedPanels.length) placedPanels = deepFindPanels(planning);

    const qtyDb = placedPanels.length;
    const panelIdDb = placedPanels[0]
      ? extractPanelIdFromPanelInstance(placedPanels[0])
      : undefined;

    // 2) se non ci sono pannelli piazzati, nel tuo DB esiste selectedPanelId
    const selectedPanelIdDb = extractSelectedPanelId(planning);

    // 3) panelId finale: preferisci panelId dai pannelli, poi selectedPanelId, poi summary
    const panelId =
      panelIdDb ||
      selectedPanelIdDb ||
      (typeof summary?.panelId === "string" ? summary.panelId : undefined);

    // 4) spec: prima prova da catalogPanels in DB (contiene priceChf), poi PANEL_CATALOG
    const catalogPanelsDb = extractCatalogPanels(planning);
    const specFromDb = panelId
      ? catalogPanelsDb.find((p: any) => p?.id === panelId)
      : undefined;

    const specFromConst = panelId
      ? PANEL_CATALOG.find((p) => p.id === panelId)
      : undefined;

    const spec = specFromDb || specFromConst;

    const wp = spec?.wp ?? 0;
    const priceChfCatalog = (spec as any)?.priceChf ?? 0;

    // quantità: se DB non ce l’ha, usa UI summary
    const qty =
      Number.isFinite(qtyDb) && qtyDb > 0
        ? qtyDb
        : typeof summary?.qty === "number" && summary.qty > 0
          ? summary.qty
          : 0;

    // kWp: preferisci calcolo; se non puoi, usa summary
    const kWpCalculated = qty && wp ? (qty * wp) / 1000 : 0;
    const kWp =
      kWpCalculated > 0
        ? kWpCalculated
        : typeof summary?.kWp === "number" && summary.kWp > 0
          ? summary.kWp
          : 0;

    const priceChf =
      priceChfCatalog > 0
        ? priceChfCatalog
        : typeof summary?.priceChf === "number"
          ? summary.priceChf
          : 0;

    const totalChf =
      qty && priceChf
        ? qty * priceChf
        : typeof summary?.totalChf === "number"
          ? summary.totalChf
          : 0;

    const modelText =
      spec ? `${spec.brand} ${spec.model}` : (summary?.model ?? null);

    /* ------------------------------- Build PDF ------------------------------ */

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const x = 48;
    let y = 800;

    page.drawText("Angebot", {
      x,
      y,
      size: 20,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 18;

    page.drawText("Projekt (MVP) – nur verfügbare Daten", {
      x,
      y,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });

    y -= 26;

    /* ------------------- Kundendaten (Profile) ------------------- */

    page.drawText("Kundendaten", {
      x,
      y,
      size: 13,
      font: bold,
      color: rgb(0.15, 0.15, 0.15),
    });
    y -= 16;

    const contactName =
      [
        safeText(profile?.contactFirstName) !== "—" ? profile?.contactFirstName : "",
        safeText(profile?.contactLastName) !== "—" ? profile?.contactLastName : "",
      ]
        .filter(Boolean)
        .join(" ") || "—";

    const contactEmail = safeText(profile?.contactEmail);
    const contactMobile = safeText(profile?.contactMobile);

    const buildingAddr = joinAddress(
      profile?.buildingStreet,
      profile?.buildingStreetNo,
      profile?.buildingZip,
      profile?.buildingCity,
    );

    const billingAddr = joinAddress(
      profile?.billingStreet,
      profile?.billingStreetNo,
      profile?.billingZip,
      profile?.billingCity,
    );

    drawLabelValue(page, x, y, "Kontaktperson", contactName, font, bold); y -= 14;
    drawLabelValue(page, x, y, "E-Mail", contactEmail, font, bold); y -= 14;
    drawLabelValue(page, x, y, "Tel. Mobile", contactMobile, font, bold); y -= 14;
    drawLabelValue(page, x, y, "Gebäudeadresse", buildingAddr, font, bold); y -= 14;
    drawLabelValue(page, x, y, "Rechnungsadresse", billingAddr, font, bold); y -= 22;

    // Divider
    page.drawLine({
      start: { x, y },
      end: { x: 595.28 - x, y },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= 20;

    /* ------------------- IST Situation (DB) ------------------- */

    page.drawText("IST-Situation", {
      x,
      y,
      size: 13,
      font: bold,
      color: rgb(0.15, 0.15, 0.15),
    });
    y -= 16;

    const istRows: Array<[string, string]> = [
      ["Gebäudetyp", safeText(ist?.buildingType)],
      ["Wohneinheiten", safeText(ist?.unitsCount)],
      ["Dachform", safeText(ist?.roofShape)],
      ["Dacheindeckung", safeText(ist?.roofCover)],
      ["Heizung", safeText(ist?.heating)],
      ["E-Mobilität", safeText(ist?.evTopic)],
      ["Montagezeit (Tage)", safeText(ist?.montageTime)],
    ];

    for (const [label, value] of istRows) {
      drawLabelValue(page, x, y, label, value, font, bold);
      y -= 14;
    }

    y -= 10;

    // Divider
    page.drawLine({
      start: { x, y },
      end: { x: 595.28 - x, y },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= 20;

    /* ------------------- PV-Anlage (geplant) ------------------- */

    page.drawText("PV-Anlage (geplant)", {
      x,
      y,
      size: 13,
      font: bold,
      color: rgb(0.15, 0.15, 0.15),
    });
    y -= 16;

    const pvRows: Array<[string, string]> = [
      ["Module", qty > 0 ? fmt0.format(qty) : "—"],
      ["Leistung", kWp > 0 ? `${fmt2.format(kWp)} kWp` : "—"],
      ["Modell", safeText(modelText)],
      ["Einzelpreis", priceChf > 0 ? `${fmt2.format(priceChf)} CHF` : "—"],
      ["Total Module", totalChf > 0 ? `${fmt2.format(totalChf)} CHF` : "—"],
    ];

    for (const [label, value] of pvRows) {
      drawLabelValue(page, x, y, label, value, font, bold);
      y -= 14;
    }

    y -= 18;

    page.drawText(
      "Bericht (Grafiken): Platzhalter – werden nach Kundeninput ergänzt.",
      {
        x,
        y,
        size: 10,
        font,
        color: rgb(0.4, 0.4, 0.4),
      },
    );

    const pdfBytes = await pdf.save();

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Angebot_${planningId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("OFFER PDF ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  } finally {
    await client.close().catch(() => {});
  }
}
