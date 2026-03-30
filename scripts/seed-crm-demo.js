import mongoose from "mongoose";

const MONGODB_URI =
  "mongodb+srv://mopen_db_user:AQDOG38xenuOpJuU@cluster0.0indfuy.mongodb.net/sola?retryWrites=true&w=majority";

const COMPANY_ID = "69612fbe9966bc81ea62d5d3";
const CREATED_BY_USER_ID = "69c97b10b737afcaa32adf02";

function defaultStoreData() {
  return {
    step: "profile",
    view: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      fitScale: 1,
    },
    tool: "select",
    snapshotScale: 2,
    layers: [],
    zones: [],
    panels: [],
    detectedRoofs: [],
    modules: {
      orientation: "portrait",
      spacingM: 0.02,
      marginM: 0,
      showGrid: true,
      placingSingle: false,
      gridAngleDeg: 0,
      gridPhaseX: 0,
      gridPhaseY: 0,
      gridAnchorX: "start",
      gridAnchorY: "start",
      coverageRatio: 1,
      perRoofAngles: {},
    },
    roofAlign: {
      rotDeg: 0,
      pivotPx: null,
    },
    snowGuards: [],
    selectedSnowGuardId: null,
    catalogPanels: [
      {
        id: "GEN54-410",
        brand: "Generic",
        model: "M10 54c",
        wp: 410,
        widthM: 1.134,
        heightM: 1.722,
        priceChf: 120,
      },
      {
        id: "GEN54-425",
        brand: "Generic",
        model: "M10 54c",
        wp: 425,
        widthM: 1.134,
        heightM: 1.762,
        priceChf: 130,
      },
      {
        id: "GEN72-550",
        brand: "Generic",
        model: "M10 72c",
        wp: 550,
        widthM: 1.134,
        heightM: 2.279,
        priceChf: 170,
      },
    ],
    selectedPanelId: "GEN54-410",
    profile: {
      customerStatus: "new",
      customerType: "private",
      legalForm: "",
      source: "",
      contactSalutation: null,
      contactFirstName: "",
      contactLastName: "",
      contactMobile: "",
      contactEmail: "",
      billingStreet: "",
      billingStreetNo: "",
      billingCity: "",
      billingZip: "",
      buildingStreet: "",
      buildingStreetNo: "",
      buildingCity: "",
      buildingZip: "",
      businessName: "",
      businessStreet: "",
      businessStreetNo: "",
      businessCity: "",
      businessZip: "",
      businessPhone: "",
      businessEmail: "",
      businessWebsite: "",
      leadLabel: "",
    },
    ist: {
      checklist: {
        inverterPhoto: false,
        meterPhoto: false,
        cabinetPhoto: false,
        lightning: false,
        internet: false,
        naProtection: false,
        evg: false,
        zev: false,
      },
      unitsCount: "",
      buildingType: "",
      roofShape: "",
      roofCover: "",
      consumption: "",
      heating: "",
      heatingCombo: false,
      hakSize: "",
      evTopic: "",
      evCar: "",
      montageTime: "",
      dismantling: "",
      dismantlingNote: "",
      completed: false,
    },
  };
}

function planningNumber(n) {
  return `ANG-2026-${String(n).padStart(4, "0")}`;
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to Mongo");

  const db = mongoose.connection.db;
  const customers = db.collection("customers");
  const plannings = db.collection("plannings");

  const companyId = COMPANY_ID;
  const createdByUserId = CREATED_BY_USER_ID;
  const now = new Date();

  // pulizia demo precedente
  await customers.deleteMany({ companyId });
  await plannings.deleteMany({ companyId });

  console.log("Old demo customers/plannings removed");

  // --------------------
  // CUSTOMERS
  // --------------------
  const customerDocs = [
    {
      companyId,
      type: "private",
      name: "Martin Müller",
      firstName: "Martin",
      lastName: "Müller",
      email: "martin.mueller@example.ch",
      phone: "+41 79 123 45 67",
      address: "Rigistraße 2, 9445 Rebstein",
      notes: "Interessiert an PV + Wallbox.",
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      type: "private",
      name: "Anna Keller",
      firstName: "Anna",
      lastName: "Keller",
      email: "anna.keller@example.ch",
      phone: "+41 78 555 11 22",
      address: "Sonnenweg 10, 9000 St. Gallen",
      notes: "Möchte Vergleich zwischen 2 Varianten.",
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      type: "company",
      name: "SolarTech Immobilien AG",
      companyName: "SolarTech Immobilien AG",
      email: "info@solartech-immobilien.ch",
      phone: "+41 71 400 10 10",
      address: "Industriestrasse 22, 9435 Heerbrugg",
      notes: "Mehrfamilienhaus, hoher Verbrauch.",
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      type: "company",
      name: "Huber Bau GmbH",
      companyName: "Huber Bau GmbH",
      email: "office@huberbau.ch",
      phone: "+41 71 222 33 44",
      address: "Werkstrasse 5, 9450 Altstätten",
      notes: "Will schnelle Grobofferte.",
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      type: "private",
      name: "Luca Bernasconi",
      firstName: "Luca",
      lastName: "Bernasconi",
      email: "luca.bernasconi@example.ch",
      phone: "+41 76 999 88 77",
      address: "Via Centrale 8, 6900 Lugano",
      notes: "Interesse an Batterie später.",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const customerInsert = await customers.insertMany(customerDocs);
  const customerIds = Object.values(customerInsert.insertedIds);

  console.log("Customers created:", customerIds.length);

  const [martinId, annaId, solartechId, huberId, lucaId] = customerIds.map(
    (id) => id.toString(),
  );

  // --------------------
  // PLANNINGS (= Projekte im CRM)
  // --------------------
  const planningDocs = [
    {
      companyId,
      customerId: martinId,
      createdByUserId,
      status: "draft",
      currentStep: "profile",
      title: "PV Martin Müller – Rebstein",
      planningNumber: planningNumber(1),
      commercial: {
        stage: "lead",
        valueChf: 25250,
        assignedToUserId: createdByUserId,
        source: "website",
        label: "warm",
      },
      summary: {
        customerName: "Martin Müller",
        moduleCount: 24,
        selectedPanelId: "GEN54-410",
        dcPowerKw: 9.84,
        roofCount: 1,
        hasSnapshot: true,
        lastCalculatedAt: now,
      },
      data: {
        ...defaultStoreData(),
        selectedPanelId: "GEN54-410",
        profile: {
          ...defaultStoreData().profile,
          contactFirstName: "Martin",
          contactLastName: "Müller",
          contactEmail: "martin.mueller@example.ch",
          contactMobile: "+41 79 123 45 67",
          buildingStreet: "Rigistraße",
          buildingStreetNo: "2",
          buildingZip: "9445",
          buildingCity: "Rebstein",
          billingStreet: "Rigistraße",
          billingStreetNo: "2",
          billingZip: "9445",
          billingCity: "Rebstein",
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      customerId: annaId,
      createdByUserId,
      status: "draft",
      currentStep: "offer",
      title: "PV Anna Keller – St. Gallen",
      planningNumber: planningNumber(2),
      commercial: {
        stage: "offer",
        valueChf: 18900,
        assignedToUserId: createdByUserId,
        source: "referral",
        label: "angebot gesendet",
      },
      summary: {
        customerName: "Anna Keller",
        moduleCount: 18,
        selectedPanelId: "GEN54-425",
        dcPowerKw: 7.65,
        roofCount: 1,
        hasSnapshot: true,
        lastCalculatedAt: now,
      },
      data: {
        ...defaultStoreData(),
        selectedPanelId: "GEN54-425",
        profile: {
          ...defaultStoreData().profile,
          contactFirstName: "Anna",
          contactLastName: "Keller",
          contactEmail: "anna.keller@example.ch",
          contactMobile: "+41 78 555 11 22",
          buildingStreet: "Sonnenweg",
          buildingStreetNo: "10",
          buildingZip: "9000",
          buildingCity: "St. Gallen",
          billingStreet: "Sonnenweg",
          billingStreetNo: "10",
          billingZip: "9000",
          billingCity: "St. Gallen",
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      customerId: solartechId,
      createdByUserId,
      status: "draft",
      currentStep: "offer",
      title: "MFH SolarTech Immobilien AG",
      planningNumber: planningNumber(3),
      commercial: {
        stage: "won",
        valueChf: 78200,
        assignedToUserId: createdByUserId,
        source: "outbound",
        label: "gewonnen",
      },
      summary: {
        customerName: "SolarTech Immobilien AG",
        moduleCount: 72,
        selectedPanelId: "GEN72-550",
        dcPowerKw: 39.6,
        roofCount: 2,
        hasSnapshot: true,
        lastCalculatedAt: now,
      },
      data: {
        ...defaultStoreData(),
        selectedPanelId: "GEN72-550",
        profile: {
          ...defaultStoreData().profile,
          customerType: "company",
          businessName: "SolarTech Immobilien AG",
          businessEmail: "info@solartech-immobilien.ch",
          businessPhone: "+41 71 400 10 10",
          buildingStreet: "Industriestrasse",
          buildingStreetNo: "22",
          buildingZip: "9435",
          buildingCity: "Heerbrugg",
          billingStreet: "Industriestrasse",
          billingStreetNo: "22",
          billingZip: "9435",
          billingCity: "Heerbrugg",
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      customerId: huberId,
      createdByUserId,
      status: "draft",
      currentStep: "profile",
      title: "Huber Bau GmbH – Grobofferte",
      planningNumber: planningNumber(4),
      commercial: {
        stage: "lost",
        valueChf: 14500,
        assignedToUserId: createdByUserId,
        source: "phone",
        label: "preis verloren",
      },
      summary: {
        customerName: "Huber Bau GmbH",
        moduleCount: 14,
        selectedPanelId: "GEN54-410",
        dcPowerKw: 5.74,
        roofCount: 1,
        hasSnapshot: false,
        lastCalculatedAt: now,
      },
      data: {
        ...defaultStoreData(),
        selectedPanelId: "GEN54-410",
        profile: {
          ...defaultStoreData().profile,
          customerType: "company",
          businessName: "Huber Bau GmbH",
          businessEmail: "office@huberbau.ch",
          businessPhone: "+41 71 222 33 44",
          buildingStreet: "Werkstrasse",
          buildingStreetNo: "5",
          buildingZip: "9450",
          buildingCity: "Altstätten",
          billingStreet: "Werkstrasse",
          billingStreetNo: "5",
          billingZip: "9450",
          billingCity: "Altstätten",
        },
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      companyId,
      customerId: lucaId,
      createdByUserId,
      status: "draft",
      currentStep: "building",
      title: "PV Luca Bernasconi – Lugano",
      planningNumber: planningNumber(5),
      commercial: {
        stage: "lead",
        valueChf: 21900,
        assignedToUserId: createdByUserId,
        source: "instagram",
        label: "neu",
      },
      summary: {
        customerName: "Luca Bernasconi",
        moduleCount: 20,
        selectedPanelId: "GEN54-425",
        dcPowerKw: 8.5,
        roofCount: 1,
        hasSnapshot: true,
        lastCalculatedAt: now,
      },
      data: {
        ...defaultStoreData(),
        selectedPanelId: "GEN54-425",
        profile: {
          ...defaultStoreData().profile,
          contactFirstName: "Luca",
          contactLastName: "Bernasconi",
          contactEmail: "luca.bernasconi@example.ch",
          contactMobile: "+41 76 999 88 77",
          buildingStreet: "Via Centrale",
          buildingStreetNo: "8",
          buildingZip: "6900",
          buildingCity: "Lugano",
          billingStreet: "Via Centrale",
          billingStreetNo: "8",
          billingZip: "6900",
          billingCity: "Lugano",
        },
      },
      createdAt: now,
      updatedAt: now,
    },
  ];

  const planningInsert = await plannings.insertMany(planningDocs);

  console.log(
    "Plannings created:",
    Object.keys(planningInsert.insertedIds).length,
  );
  console.log("✅ CRM demo seed completed");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
