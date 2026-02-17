// src/components_v2/profile/ProfileStep.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Pencil, Save } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function ProfileStep() {
  const sp = useSearchParams();
  const router = useRouter();
  const planningId = sp.get("planningId");

  const profile = usePlannerV2Store((s) => s.profile);
  const setProfile = usePlannerV2Store((s) => s.setProfile);
  const setStep = usePlannerV2Store((s) => s.setStep);

  // ✅ placeholder clienti (per ora non hai clienti reali)
  const existingCustomers = useMemo(
    () => [
      {
        id: "demo-1",
        label: "Max Muster (Demo)",
        contactSalutation: "herr",
        contactFirstName: "Max",
        contactLastName: "Muster",
        contactMobile: "+41 79 123 45 67",
        contactEmail: "max.muster@example.com",
        buildingStreet: "Bahnhofstrasse",
        buildingStreetNo: "12",
        buildingCity: "Zürich",
        buildingZip: "8001",
        leadLabel: "#117",
        source: "website",
        legalForm: "gmbh",
        businessName: "Muster GmbH",
        businessStreet: "Bahnhofstrasse",
        businessStreetNo: "12",
        businessCity: "Zürich",
        businessZip: "8001",
        businessPhone: "+41 44 123 45 67",
        businessEmail: "office@muster.ch",
        businessWebsite: "https://muster.ch",
      },
      {
        id: "demo-2",
        label: "Anna Beispiel (Demo)",
        contactSalutation: "frau",
        contactFirstName: "Anna",
        contactLastName: "Beispiel",
        contactMobile: "+41 78 555 66 77",
        contactEmail: "anna.beispiel@example.com",
        buildingStreet: "Hauptstrasse",
        buildingStreetNo: "5",
        buildingCity: "Bern",
        buildingZip: "3011",
        leadLabel: "#204",
        source: "empfehlung",
        legalForm: "",
        businessName: "",
        businessStreet: "",
        businessStreetNo: "",
        businessCity: "",
        businessZip: "",
        businessPhone: "",
        businessEmail: "",
        businessWebsite: "",
      },
    ],
    [],
  );

  // ✅ selezione cliente esistente SOLO locale (così non serve ProfileData.existingCustomerId)
  const [selectedExistingId, setSelectedExistingId] = useState<string>("");

  // ✅ default PRIVAT se non valorizzato
  useEffect(() => {
    if (!profile.customerType) setProfile({ customerType: "private" } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPrivate = (profile.customerType || "private") === "private";
  const showCompanyFields = !isPrivate;

  // update “generico”
  const update =
    (field: keyof typeof profile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfile({ [field]: e.target.value } as any);
    };

  // ✅ sync: Gebäudeadresse -> Rechnungsadresse (sempre uguali)
  const setBuildingAndSyncBilling = (patch: Partial<typeof profile>) => {
    const mapped: Partial<typeof profile> = {};

    if (patch.buildingStreet !== undefined)
      mapped.billingStreet = patch.buildingStreet;
    if (patch.buildingStreetNo !== undefined)
      mapped.billingStreetNo = patch.buildingStreetNo;
    if (patch.buildingCity !== undefined)
      mapped.billingCity = patch.buildingCity;
    if (patch.buildingZip !== undefined) mapped.billingZip = patch.buildingZip;

    setProfile({ ...(patch as any), ...(mapped as any) } as any);
  };

  const updateBuilding =
    (field: keyof typeof profile) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setBuildingAndSyncBilling({ [field]: e.target.value } as any);
    };

  const setCustomerType = (t: "private" | "company") => {
    if (t === "private") {
      setProfile({
        customerType: "private",
        legalForm: "",
        businessName: "",
        businessStreet: "",
        businessStreetNo: "",
        businessCity: "",
        businessZip: "",
        businessPhone: "",
        businessEmail: "",
        businessWebsite: "",
      } as any);
      return;
    }
    setProfile({ customerType: "company" } as any);
  };

  const applyExistingCustomerToProfile = (c: any) => {
    if (!c) return;

    setProfile({
      contactSalutation: c.contactSalutation ?? "",
      contactFirstName: c.contactFirstName ?? "",
      contactLastName: c.contactLastName ?? "",
      contactMobile: c.contactMobile ?? "",
      contactEmail: c.contactEmail ?? "",

      buildingStreet: c.buildingStreet ?? "",
      buildingStreetNo: c.buildingStreetNo ?? "",
      buildingCity: c.buildingCity ?? "",
      buildingZip: c.buildingZip ?? "",

      billingStreet: c.billingStreet ?? c.buildingStreet ?? "",
      billingStreetNo: c.billingStreetNo ?? c.buildingStreetNo ?? "",
      billingCity: c.billingCity ?? c.buildingCity ?? "",
      billingZip: c.billingZip ?? c.buildingZip ?? "",

      leadLabel: c.leadLabel ?? "",
      source: c.source ?? "",

      legalForm: c.legalForm ?? "",
      businessName: c.businessName ?? "",
      businessStreet: c.businessStreet ?? "",
      businessStreetNo: c.businessStreetNo ?? "",
      businessCity: c.businessCity ?? "",
      businessZip: c.businessZip ?? "",
      businessPhone: c.businessPhone ?? "",
      businessEmail: c.businessEmail ?? "",
      businessWebsite: c.businessWebsite ?? "",
    } as any);
  };

  const handleExistingCustomerSelect = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const id = e.target.value;
    setSelectedExistingId(id);

    const found = existingCustomers.find((x) => x.id === id) ?? null;
    applyExistingCustomerToProfile(found);
  };

  const handleSave = async () => {
    if (!planningId) {
      console.warn(
        "Missing planningId in URL. Example: /planner-v2?planningId=XXXX",
      );
      setStep("ist");
      return;
    }

    try {
      const res = await fetch(`/api/plannings/${planningId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profile }),
      });

      if (res.status === 401) {
        router.push(
          `/login?next=${encodeURIComponent(`/planner-v2?planningId=${planningId}`)}`,
        );
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        console.error("SAVE PROFILE FAILED:", json);
        return;
      }

      setStep("ist");
    } catch (err) {
      console.error("SAVE PROFILE ERROR:", err);
    }
  };

  const topGridCols = useMemo(() => {
    return showCompanyFields
      ? "grid-cols-1 mt-4 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_64px]"
      : "grid-cols-1 mt-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px]";
  }, [showCompanyFields]);

  const secondGridCols = useMemo(() => {
    return showCompanyFields
      ? "grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_64px]"
      : "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px]";
  }, [showCompanyFields]);

  // ✅ input uguali e non full-screen (come screenshot)
  const fieldWidth = "w-[260px] max-w-full";
  const isExisting = profile.customerStatus === "existing";

  return (
    <div className="w-full h-full rounded-b-2xl text-neutral-50 shadow-xl border-b border-l border-[#7E8B97] bg-transparent backdrop-blur-md px-6 py-4 flex flex-col">
      <div className="flex-1 space-y-6">
        {/* ───────────────── TOP ROW ───────────────── */}
        <div className={`grid gap-4 items-start ${topGridCols}`}>
          {/* Kunde */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
              Kunde
            </h3>

            <div className="flex flex-col gap-2 text-[11px]">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={(profile.customerStatus || "new") === "new"}
                  onChange={() => {
                    setProfile({ customerStatus: "new" } as any);
                    setSelectedExistingId(""); // ✅ reset UI select
                  }}
                />
                <span>Neuer Kunde</span>
              </label>

              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={profile.customerStatus === "existing"}
                  onChange={() =>
                    setProfile({ customerStatus: "existing" } as any)
                  }
                />
                <span>Bestandes Kunde</span>
              </label>
            </div>

            {isExisting && (
              <select
                className={`${fieldWidth} mt-2 rounded-full bg-white/5 border-1 border-white/80 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70`}
                value={selectedExistingId}
                onChange={handleExistingCustomerSelect}
              >
                <option value="">Kunde auswählen (Demo)</option>
                {existingCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Kundentyp */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
              Kundentyp
            </h3>

            <div className="flex flex-wrap gap-3 text-[11px]">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={(profile.customerType || "private") === "private"}
                  onChange={() => setCustomerType("private")}
                />
                <span>Privat</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={profile.customerType === "company"}
                  onChange={() => setCustomerType("company")}
                />
                <span>Firma</span>
              </label>
            </div>

            <select
              className={`${fieldWidth} mt-1.5 rounded-full bg-white/5 border-1 border-white/80 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70`}
              value={profile.source}
              onChange={update("source")}
            >
              <option value="">Quelle</option>
              <option value="empfehlung">Empfehlung</option>
              <option value="website">Website</option>
              <option value="telefon">Telefon</option>
              <option value="messe">Messe / Event</option>
            </select>
          </div>

          {/* Rechtsform */}
          {showCompanyFields && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
                Rechtsform
              </h3>
              <select
                className={`${fieldWidth} rounded-full bg-white/5 border-1 border-white/80 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70`}
                value={profile.legalForm}
                onChange={update("legalForm")}
              >
                <option value="">Auswählen</option>
                <option value="einzelunternehmen">Einzelunternehmen</option>
                <option value="gmbh">GmbH</option>
                <option value="ag">AG</option>
                <option value="verein">Verein</option>
              </select>
            </div>
          )}

          {/* Icone */}
          <div className="hidden xl:flex flex-col items-center gap-2 pt-5">
            <button
              type="button"
              className="h-8 w-8 rounded-full border-1 border-white/80 bg-white/5 backdrop-blur hover:bg-white/10 flex items-center justify-center transition"
              title="Bearbeiten"
            >
              <Pencil className="w-3.5 h-3.5 text-neutral-100" />
            </button>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center shadow-lg shadow-emerald-500/40 transition"
              title="Speichern"
              onClick={handleSave}
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ───────────────── SECOND ROW ───────────────── */}
        <div className={`${secondGridCols} gap-6`}>
          {/* Kontaktperson */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
              Kontaktperson
            </h3>

            <div className="flex flex-wrap gap-3 text-[11px]">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={profile.contactSalutation === "herr"}
                  onChange={() =>
                    setProfile({ contactSalutation: "herr" } as any)
                  }
                />
                <span>Herr</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="accent-emerald-500 h-3 w-3"
                  checked={profile.contactSalutation === "frau"}
                  onChange={() =>
                    setProfile({ contactSalutation: "frau" } as any)
                  }
                />
                <span>Frau</span>
              </label>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <InputField
                label="Vorname"
                value={profile.contactFirstName}
                onChange={update("contactFirstName")}
                className={fieldWidth}
              />
              <InputField
                label="Nachname"
                value={profile.contactLastName}
                onChange={update("contactLastName")}
                className={fieldWidth}
              />
              <InputField
                label="Tel. Mobile"
                value={profile.contactMobile}
                onChange={update("contactMobile")}
                className={fieldWidth}
              />
              <InputField
                label="E-Mail"
                value={profile.contactEmail}
                onChange={update("contactEmail")}
                className={fieldWidth}
              />
            </div>

            <h4 className="mt-4 text-[11px] font-semibold text-neutral-200">
              Gebäudeadresse
            </h4>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex gap-2">
                <InputField
                  label="Adresse"
                  value={profile.buildingStreet}
                  onChange={updateBuilding("buildingStreet")}
                  className={`${fieldWidth}`}
                />
                <InputField
                  label="Nr."
                  value={profile.buildingStreetNo}
                  onChange={updateBuilding("buildingStreetNo")}
                  small
                  className="w-20"
                />
              </div>
              <InputField
                label="Ort / PLZ"
                value={profile.buildingCity}
                onChange={updateBuilding("buildingCity")}
                className={fieldWidth}
              />
            </div>
          </div>

          {/* Rechnungsadresse */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
              Rechnungsadresse
            </h3>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex gap-2">
                <InputField
                  label="Adresse"
                  value={profile.billingStreet}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProfile({ billingStreet: v, buildingStreet: v } as any);
                  }}
                  className={`${fieldWidth}`}
                />
                <InputField
                  label="Nr."
                  value={profile.billingStreetNo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProfile({
                      billingStreetNo: v,
                      buildingStreetNo: v,
                    } as any);
                  }}
                  small
                  className="w-20"
                />
              </div>

              <InputField
                label="Ort / PLZ"
                value={profile.billingCity}
                onChange={(e) => {
                  const v = e.target.value;
                  setProfile({ billingCity: v, buildingCity: v } as any);
                }}
                className={fieldWidth}
              />
            </div>

            <div className="mt-4 space-y-1 text-[11px]">
              <span className="block text-[10px] font-semibold text-neutral-200">
                Lead
              </span>
              <input
                type="text"
                className={`${fieldWidth} rounded-full bg-white/5 border-1 border-white/80 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70`}
                value={profile.leadLabel}
                onChange={update("leadLabel")}
                placeholder="#117"
              />
            </div>
          </div>

          {/* Geschäft */}
          {showCompanyFields && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
                Geschäft
              </h3>

              <div className="space-y-1.5 text-[11px]">
                <InputField
                  label="Name"
                  value={profile.businessName}
                  onChange={update("businessName")}
                  className={fieldWidth}
                />

                <div className="flex gap-2">
                  <InputField
                    label="Adresse"
                    value={profile.businessStreet}
                    onChange={update("businessStreet")}
                    className={`${fieldWidth}`}
                  />
                  <InputField
                    label="Nr."
                    value={profile.businessStreetNo}
                    onChange={update("businessStreetNo")}
                    small
                    className="w-20"
                  />
                </div>

                <InputField
                  label="Ort / PLZ"
                  value={profile.businessCity}
                  onChange={update("businessCity")}
                  className={fieldWidth}
                />

                <InputField
                  label="Tel. Geschäft"
                  value={profile.businessPhone}
                  onChange={update("businessPhone")}
                  className={fieldWidth}
                />
                <InputField
                  label="E-Mail Geschäft"
                  value={profile.businessEmail}
                  onChange={update("businessEmail")}
                  className={fieldWidth}
                />
                <InputField
                  label="Webseite"
                  value={profile.businessWebsite}
                  onChange={update("businessWebsite")}
                  className={fieldWidth}
                />
              </div>

              <div className="mt-4 flex justify-end xl:hidden">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-[11px] font-semibold px-3.5 py-1.5 shadow-lg shadow-emerald-500/30 transition"
                  onClick={handleSave}
                >
                  <Save className="w-3 h-3" />
                  <span>Speichern</span>
                </button>
              </div>
            </div>
          )}

          <div className="hidden xl:block" />
        </div>
      </div>

      {!showCompanyFields && (
        <div className="mt-4 flex justify-end xl:hidden">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-[11px] font-semibold px-3.5 py-1.5 shadow-lg shadow-emerald-500/30 transition"
            onClick={handleSave}
          >
            <Save className="w-3 h-3" />
            <span>Speichern</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* --- piccolo componente riutilizzabile per gli input --- */
type InputFieldProps = {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  small?: boolean;
  className?: string;
};

function InputField({
  label,
  value,
  onChange,
  small,
  className,
}: InputFieldProps) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-[10px] text-neutral-200 mb-0.5">{label}</span>
      <input
        type="text"
        className={`w-full rounded-full bg-white/5 border-1 border-white/80 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70 ${
          small ? "max-w-full" : ""
        }`}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
