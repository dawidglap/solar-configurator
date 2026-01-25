// src/types/planner.ts

// ───────────────────────────────────────────
// STEP DEL PLANNER
// ───────────────────────────────────────────
export type PlannerStep =
  | 'profile'     // Step 1 – Profil
  | 'ist'         // Step 2 – IST-Situation
  | 'building'    // Step 3 – Gebäudeplanung
  | 'modules'     // Step 4 – Modulplanung
  | 'strings'
  | 'parts'
  | 'report'
  | 'offer';

export type UIState = {
    stepperOpen: boolean;
    rightPanelOpen: boolean;
    leftPanelOpen: boolean;
    searchOpen: boolean;
};

export type Tool =
    | 'select'
    | 'draw-roof'
    | 'draw-reserved'
    | 'draw-rect'
    | 'fill-area' // ⬅️ NEW
    | 'draw-snow-guard';

export type Pt = { x: number; y: number };

export type DetectedRoof = {
    id: string;
    points: Pt[];                 // in px immagine
    tiltDeg?: number;
    azimuthDeg?: number;
    source: 'sonnendach';
};

export type RoofArea = {
    id: string;
    name: string;
    points: Pt[];
    slopeX?: number;
    slopeY?: number;

    // orientamento/inclinazione “fisici”
    tiltDeg?: number;        // Neigung (°)
    azimuthDeg?: number;     // Ausrichtung (°, 0=N, 90=E, 180=S, 270=W)
    source?: 'manual' | 'sonnendach';

    // pronto per “zone vietate” (buchi) — opzionale
    exclusions?: Pt[][];
};

export type Snapshot = {
    url?: string;
    width?: number;
    height?: number;
    mppImage?: number;

    // info per georeferenziare lo snapshot
    center?: { lat: number; lon: number };   // WGS84
    zoom?: number;                           // WMTS/3857 zoom
    bbox3857?: { minX: number; minY: number; maxX: number; maxY: number }; // in metri
};

export type View = {
    scale: number;
    offsetX: number;
    offsetY: number;
    fitScale: number; // min zoom (cover)
};

/** Catalogo pannelli (hard-coded ora, estendibile / brand-specific in futuro) */
export type PanelSpec = {
    id: string;
    brand: string;
    model: string;
    wp: number;      // potenza (W)
    widthM: number;  // lato corto in metri
    heightM: number; // lato lungo in metri
     priceChf: number;
};

// ── Configurazione moduli per lo step “modules”
export type ModulesConfig = {
    gridAngleDeg: number;
    orientation: 'portrait' | 'landscape';
    spacingM: number;      // distanza fra moduli (m)
    marginM: number;       // bordo falda (m)
    showGrid: boolean;
    placingSingle: boolean;

    gridPhaseX?: number;
    gridPhaseY?: number;
    gridAnchorX?: 'start' | 'center' | 'end';
    gridAnchorY?: 'start' | 'center' | 'end';

    /** 0.5 = metà tetto, 0.75 = 3/4, 1 = tutto */
    coverageRatio?: number;
    perRoofAngles?: Record<string, number>;
};

// ── Istanze di pannello materializzate
export type PanelInstance = {
    id: string;
    roofId: string;
    cx: number;          // centro in px immagine
    cy: number;          // centro in px immagine
    wPx: number;         // larghezza in px immagine
    hPx: number;         // altezza in px immagine
    angleDeg: number;    // rotazione assoluta (°)
    orientation: 'portrait' | 'landscape';
    panelId: string;     // riferimento al catalogo
    locked?: boolean;
};

// src/types/planner.ts

// ...

export type ProfileData = {
  // Cliente
  customerStatus: 'new' | 'existing';      // Neuer / Bestandes Kunde
  customerType: 'private' | 'company';     // Privat / Firma
  legalForm: string;                       // Rechtsform (libero per ora)
  source: string;                          // Quelle (canale lead)

  // Persona di contatto
  contactSalutation?: 'herr' | 'frau' | 'divers' | null;
  contactFirstName: string;
  contactLastName: string;
  contactMobile: string;
  contactEmail: string;

  // Indirizzo fatturazione
  billingStreet: string;
  billingStreetNo: string;
  billingCity: string;
  billingZip: string;

  // Indirizzo edificio
  buildingStreet: string;
  buildingStreetNo: string;
  buildingCity: string;
  buildingZip: string;

  // Dati attività (Geschäft)
  businessName: string;
  businessStreet: string;
  businessStreetNo: string;
  businessCity: string;
  businessZip: string;
  businessPhone: string;
  businessEmail: string;
  businessWebsite: string;

  // Lead
  leadLabel: string; // es. "#117" o free text
};
