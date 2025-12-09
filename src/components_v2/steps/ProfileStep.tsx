// src/components_v2/profile/ProfileStep.tsx
"use client";

import { usePlannerV2Store } from "../state/plannerV2Store";

export default function ProfileStep() {
  const profile = usePlannerV2Store((s) => s.profile);
  const setProfile = usePlannerV2Store((s) => s.setProfile);

  const update =
    (field: keyof typeof profile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfile({ [field]: e.target.value } as any);
    };

  return (
    <div className="w-full rounded-2xl bg-neutral-900/60 text-neutral-50 shadow-xl border border-white/10 backdrop-blur-md p-6 md:p-8 space-y-8">
      {/* Prima riga: Kunde / Kundentyp / Rechtsform */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Kunde */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Kunde
          </h3>

          <div className="flex gap-4 text-xs">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.customerStatus === "new"}
                onChange={() => setProfile({ customerStatus: "new" })}
              />
              <span>Neuer Kunde</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.customerStatus === "existing"}
                onChange={() => setProfile({ customerStatus: "existing" })}
              />
              <span>Bestandes Kunde</span>
            </label>
          </div>
        </div>

        {/* Kundentyp */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Kundentyp
          </h3>
          <div className="flex gap-4 text-xs">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.customerType === "private"}
                onChange={() => setProfile({ customerType: "private" })}
              />
              <span>Privat</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.customerType === "company"}
                onChange={() => setProfile({ customerType: "company" })}
              />
              <span>Firma</span>
            </label>
          </div>

          {/* Quelle (Lead-Quelle) */}
          <select
            className="mt-2 w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
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
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Rechtsform
          </h3>
          <select
            className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
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
      </div>

      {/* Seconda riga: Kontaktperson / Rechnungsadresse / Geschäft */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Kontaktperson */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Kontaktperson
          </h3>

          <div className="flex gap-4 text-xs">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.contactSalutation === "herr"}
                onChange={() => setProfile({ contactSalutation: "herr" })}
              />
              <span>Herr</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                className="accent-emerald-500"
                checked={profile.contactSalutation === "frau"}
                onChange={() => setProfile({ contactSalutation: "frau" })}
              />
              <span>Frau</span>
            </label>
          </div>

          <div className="space-y-2 text-xs">
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
        </div>

        {/* Rechnungsadresse */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Rechnungsadresse
          </h3>

          <div className="space-y-2 text-xs">
            <InputField
              label="Adresse"
              value={profile.billingStreet}
              onChange={update("billingStreet")}
            />
            <InputField
              label="Nr."
              value={profile.billingStreetNo}
              onChange={update("billingStreetNo")}
              small
            />
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
            />
          </div>

          <h4 className="mt-4 text-xs font-semibold text-neutral-300">
            Gebäudeadresse
          </h4>
          <div className="space-y-2 text-xs">
            <InputField
              label="Adresse"
              value={profile.buildingStreet}
              onChange={update("buildingStreet")}
            />
            <InputField
              label="Nr."
              value={profile.buildingStreetNo}
              onChange={update("buildingStreetNo")}
              small
            />
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
            />
          </div>
        </div>

        {/* Geschäft */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Geschäft
          </h3>

          <div className="space-y-2 text-xs">
            <InputField
              label="Name"
              value={profile.businessName}
              onChange={update("businessName")}
            />
            <InputField
              label="Adresse"
              value={profile.businessStreet}
              onChange={update("businessStreet")}
            />
            <InputField
              label="Nr."
              value={profile.businessStreetNo}
              onChange={update("businessStreetNo")}
              small
            />
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

          <div className="mt-4 space-y-1 text-xs">
            <span className="block text-[11px] font-semibold text-neutral-300">
              Lead
            </span>
            <input
              type="text"
              className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              value={profile.leadLabel}
              onChange={update("leadLabel")}
              placeholder="#117"
            />
          </div>
        </div>
      </div>

      {/* Barra inferiore con “Salva” – per ora solo frontend */}
      <div className="flex justify-end pt-2 border-t border-white/10 mt-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-xs font-semibold px-4 py-2 shadow-lg shadow-emerald-500/30 transition"
          onClick={() => {
            // per ora solo console.log – in futuro POST al backend
            console.log("PROFILE DATA (ready for API):", profile);
          }}
        >
          Speichern
        </button>
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
};

function InputField({ label, value, onChange, small }: InputFieldProps) {
  return (
    <label className="block">
      <span className="block text-[11px] text-neutral-300 mb-0.5">{label}</span>
      <input
        type="text"
        className={`w-full ${
          small ? "max-w-[120px]" : ""
        } rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/70`}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
