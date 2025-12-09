// src/components_v2/profile/ProfileStep.tsx
"use client";

import type React from "react";
import { Pencil, Save } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function ProfileStep() {
  const profile = usePlannerV2Store((s) => s.profile);
  const setProfile = usePlannerV2Store((s) => s.setProfile);

  const update =
    (field: keyof typeof profile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfile({ [field]: e.target.value } as any);
    };

  const handleSave = () => {
    console.log("PROFILE DATA (ready for API):", profile);
  };

  return (
    <div className="w-full rounded-2xl bg-neutral-900/60 text-neutral-50 shadow-xl border border-white/10 backdrop-blur-sm px-6 py-4 space-y-6">
      {/* ───────────────── TOP ROW: KUNDE / KUNDENTYP / RECHTSFORM / ICONS ───────────────── */}
      <div className="grid grid-cols-1 mt-4 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_64px] gap-4 items-start">
        {/* Kunde */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
            Kunde
          </h3>

          <div className="flex flex-wrap gap-3 text-[11px]">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500 h-3 w-3"
                checked={profile.customerStatus === "new"}
                onChange={() => setProfile({ customerStatus: "new" })}
              />
              <span>Neuer Kunde</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500 h-3 w-3"
                checked={profile.customerStatus === "existing"}
                onChange={() => setProfile({ customerStatus: "existing" })}
              />
              <span>Bestandes Kunde</span>
            </label>
          </div>
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
                checked={profile.customerType === "private"}
                onChange={() => setProfile({ customerType: "private" })}
              />
              <span>Privat</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500 h-3 w-3"
                checked={profile.customerType === "company"}
                onChange={() => setProfile({ customerType: "company" })}
              />
              <span>Firma</span>
            </label>
          </div>

          {/* Quelle (Lead-Quelle) */}
          <select
            className="mt-1.5 w-full rounded-full bg-white/5 border border-white/20 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
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
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
            Rechtsform
          </h3>
          <select
            className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
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

        {/* Colonna piccola a destra: Edit / Save */}
        <div className="hidden xl:flex flex-col items-center gap-2 pt-5">
          <button
            type="button"
            className="h-8 w-8 rounded-full border border-white/20 bg-white/5 backdrop-blur hover:bg-white/10 flex items-center justify-center transition"
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

      {/* ───────────────── SECOND ROW: 3 MAIN COLUMNS + SPACER ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_64px] gap-6">
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
                onChange={() => setProfile({ contactSalutation: "herr" })}
              />
              <span>Herr</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500 h-3 w-3"
                checked={profile.contactSalutation === "frau"}
                onChange={() => setProfile({ contactSalutation: "frau" })}
              />
              <span>Frau</span>
            </label>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <InputField
              label="Vorname"
              value={profile.contactFirstName}
              onChange={update("contactFirstName")}
            />
            <InputField
              label="Nachname"
              value={profile.contactLastName}
              onChange={update("contactLastName")}
            />
            <InputField
              label="Tel. Mobile"
              value={profile.contactMobile}
              onChange={update("contactMobile")}
            />
            <InputField
              label="E-Mail"
              value={profile.contactEmail}
              onChange={update("contactEmail")}
            />
          </div>

          {/* Gebäudeadresse sotto alla Kontaktperson */}
          <h4 className="mt-4 text-[11px] font-semibold text-neutral-200">
            Gebäudeadresse
          </h4>
          <div className="space-y-1.5 text-[11px]">
            {/* Adresse + Nr. sulla stessa riga */}
            <div className="flex gap-2">
              <InputField
                label="Adresse"
                value={profile.buildingStreet}
                onChange={update("buildingStreet")}
                className="flex-1"
              />
              <InputField
                label="Nr."
                value={profile.buildingStreetNo}
                onChange={update("buildingStreetNo")}
                small
                className="w-20"
              />
            </div>
            <InputField
              label="Ort / PLZ"
              value={profile.buildingCity}
              onChange={update("buildingCity")}
            />
            <InputField
              label="PLZ"
              value={profile.buildingZip}
              onChange={update("buildingZip")}
              small
              className="w-28"
            />
          </div>
        </div>

        {/* Rechnungsadresse */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
            Rechnungsadresse
          </h3>

          <div className="space-y-1.5 text-[11px]">
            {/* Adresse + Nr. stessa riga */}
            <div className="flex gap-2">
              <InputField
                label="Adresse"
                value={profile.billingStreet}
                onChange={update("billingStreet")}
                className="flex-1"
              />
              <InputField
                label="Nr."
                value={profile.billingStreetNo}
                onChange={update("billingStreetNo")}
                small
                className="w-20"
              />
            </div>

            <InputField
              label="Ort / PLZ"
              value={profile.billingCity}
              onChange={update("billingCity")}
            />
            <InputField
              label="PLZ"
              value={profile.billingZip}
              onChange={update("billingZip")}
              small
              className="w-28"
            />
          </div>

          {/* Lead sotto la Rechnungsadresse */}
          <div className="mt-4 space-y-1 text-[11px]">
            <span className="block text-[10px] font-semibold text-neutral-200">
              Lead
            </span>
            <input
              type="text"
              className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              value={profile.leadLabel}
              onChange={update("leadLabel")}
              placeholder="#117"
            />
          </div>
        </div>

        {/* Geschäft */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
            Geschäft
          </h3>

          <div className="space-y-1.5 text-[11px]">
            <InputField
              label="Name"
              value={profile.businessName}
              onChange={update("businessName")}
            />

            {/* Adresse + Nr. stessa riga */}
            <div className="flex gap-2">
              <InputField
                label="Adresse"
                value={profile.businessStreet}
                onChange={update("businessStreet")}
                className="flex-1"
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
            />
            <InputField
              label="PLZ"
              value={profile.businessZip}
              onChange={update("businessZip")}
              small
              className="w-28"
            />
            <InputField
              label="Tel. Geschäft"
              value={profile.businessPhone}
              onChange={update("businessPhone")}
            />
            <InputField
              label="E-Mail Geschäft"
              value={profile.businessEmail}
              onChange={update("businessEmail")}
            />
            <InputField
              label="Webseite"
              value={profile.businessWebsite}
              onChange={update("businessWebsite")}
            />
          </div>

          {/* fallback Save button visibile su schermi piccoli */}
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

        {/* SPACER COLUMN per allineare con la colonna icone sopra */}
        <div className="hidden xl:block" />
      </div>
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
        className={`w-full rounded-full bg-white/5 border border-white/20 px-3 py-[5px] text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/70 ${
          small ? "max-w-full" : ""
        }`}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
