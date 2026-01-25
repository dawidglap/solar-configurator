// src/app/api/plannings/[planningId]/offer/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PANEL_CATALOG } from "@/constants/panels";

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

type StoredLineItem = {
  id?: string;
  kategorie?: string;
  marke?: string;
  beschreibung?: string;
  einzelpreis?: number;
  stk?: number;
  einheit?: string;
};

export async function POST(req: Request, ctx: { params: { planningId: string } }) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const planningId = ctx?.params?.planningId;
  if (!planningId) {
    return Response.json(
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const sections = body?.sections ?? {};

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    // ✅ stessa guardia che usi già: planning + company
    const planning = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });
    }

    // -------------------------
    // ✅ DATI REALI (senza inventare)
    // -------------------------
    // panels nel DB: da quello che salvi tu è in planning.data.planner
    const planner = (planning as any).data?.planner ?? {};

    // prova a prendere i pannelli da dove li salvi veramente:
    const placedPanels: { panelId?: string }[] =
      (Array.isArray(planner.panels) && planner.panels) ||
      (Array.isArray(planner.placedPanels) && planner.placedPanels) ||
      (Array.isArray((planning as any).panels) && (planning as any).panels) ||
      [];

    const qty = placedPanels.length;
    const panelIdFromPlaced = placedPanels[0]?.panelId;

    const spec = panelIdFromPlaced
      ? PANEL_CATALOG.find((p) => p.id === panelIdFromPlaced)
      : undefined;

    const wp = spec?.wp ?? 0;
    const priceChf = (spec as any)?.priceChf ?? 0; // se PanelSpec ha priceChf togli any
    const kWp = (qty * wp) / 1000;
    const modulesTotal = qty * priceChf;

    // extra items: se li hai salvati nello stesso planner
    const extraItems: StoredLineItem[] =
      (Array.isArray(planner.items) && planner.items) ||
      (Array.isArray(planner.partsItems) && planner.partsItems) ||
      (Array.isArray((planning as any).items) && (planning as any).items) ||
      [];

    const extrasTotal = extraItems.reduce((acc, r) => {
      const ep = Number(r.einzelpreis ?? 0);
      const s = Number(r.stk ?? 0);
      return acc + ep * s;
    }, 0);

    const grandTotal = modulesTotal + extrasTotal;

    // -------------------------
    // ✅ PDF MINIMALE (MVP)
    // -------------------------
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const margin = 48;
    let y = 800;

    const drawText = (t: string, size = 12, bold = false) => {
      page.drawText(t, {
        x: margin,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= size + 6;
    };

    drawText("Angebot (MVP)", 18, true);
    drawText(`Planning-ID: ${planningId}`, 10, false);
    y -= 8;

    drawText("PV-Module (geplant)", 13, true);
    drawText(`Anzahl: ${qty} | Leistung: ${kWp.toFixed(2)} kWp`, 11, false);
    drawText(
      `Modell: ${spec ? `${spec.brand} ${spec.model} (${wp} Wp)` : "—"}`,
      11,
      false
    );
    drawText(
      `Einzelpreis: ${priceChf.toFixed(2)} CHF | Total: ${modulesTotal.toFixed(2)} CHF`,
      11,
      false
    );

    y -= 12;

    drawText("Stückliste (Zusatzposten)", 13, true);

    if (extraItems.length === 0) {
      drawText("— Keine Zusatzposten vorhanden —", 10, false);
    } else {
      // mini tabella (max righe)
      const headers = ["Kategorie", "Marke", "Beschreibung", "EP", "Stk", "Total"];
      const colX = [margin, 150, 245, 430, 490, 530];

      headers.forEach((h, i) => {
        page.drawText(h, {
          x: colX[i],
          y,
          size: 9,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        });
      });
      y -= 14;

      const rows = extraItems.slice(0, 18);
      for (const r of rows) {
        const kategorie = String(r.kategorie ?? "—");
        const marke = String(r.marke ?? "—");
        const beschreibung = String(r.beschreibung ?? "—");
        const ep = Number(r.einzelpreis ?? 0);
        const stk = Number(r.stk ?? 0);
        const total = ep * stk;

        page.drawText(kategorie.slice(0, 18), { x: colX[0], y, size: 9, font });
        page.drawText(marke.slice(0, 12), { x: colX[1], y, size: 9, font });
        page.drawText(beschreibung.slice(0, 28), { x: colX[2], y, size: 9, font });
        page.drawText(ep.toFixed(2), { x: colX[3], y, size: 9, font });
        page.drawText(String(stk), { x: colX[4], y, size: 9, font });
        page.drawText(total.toFixed(2), { x: colX[5], y, size: 9, font });

        y -= 12;
        if (y < 120) break;
      }
    }

    y -= 14;
    drawText("Total", 13, true);
    drawText(`Module: ${modulesTotal.toFixed(2)} CHF`, 11, false);
    drawText(`Zusatzposten: ${extrasTotal.toFixed(2)} CHF`, 11, false);
    drawText(`Gesamttotal: ${grandTotal.toFixed(2)} CHF`, 12, true);

    // toggle info (solo debug)
    y -= 10;
    page.drawText(
      `Sections: Energiefluss=${!!sections.energiefluss}, Wirtschaftlichkeit=${!!sections.wirtschaftlichkeit}, Produktion=${!!sections.produktion}, Ersparnis=${!!sections.ersparnis}`,
      { x: margin, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) }
    );

    const bytes = await pdf.save();

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Angebot_${planningId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("OFFER PDF ERROR:", e);
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
