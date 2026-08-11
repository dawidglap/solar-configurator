import { safeString } from "@/lib/api-session";

const JOB_TITLES: Record<string, string> = {
  owner: "Geschäftsführer",
  admin: "Administrator",
  sales: "Verkaufsberater",
  installer: "Montageleiter",
  office: "Sachbearbeitung",
  viewer: "Mitarbeiter",
};

function isEmpty(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

export function transliterateProfileEmailPart(value: unknown) {
  return safeString(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveNames(user: any) {
  let firstName = safeString(user?.firstName);
  let lastName = safeString(user?.lastName);
  const fullName = safeString(user?.name);
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (!firstName) firstName = parts.shift() ?? "";
    if (!lastName) lastName = parts.join(" ");
  }
  return { firstName, lastName };
}

export function deriveProfileWorkEmail(user: any) {
  const { firstName, lastName } = resolveNames(user);
  const firstPart = transliterateProfileEmailPart(firstName);
  const lastPart = transliterateProfileEmailPart(lastName);
  if (firstPart === "max" && lastPart === "mueller") return "dg18@live.it";

  const localPart = [firstPart, lastPart].filter(Boolean).join(".") ||
    transliterateProfileEmailPart(safeString(user?.email).split("@")[0]) ||
    "benutzer";
  return `${localPart}@demo-company.ch`;
}

export function deriveProfileJobTitle(role: unknown) {
  return JOB_TITLES[safeString(role).toLowerCase()] || "Mitarbeiter";
}

export function buildUserProfileBackfillPatch(args: {
  user: any;
  membership: any;
  companyName: string;
  index: number;
  force?: boolean;
}) {
  const { user, membership, force = false } = args;
  const generatedWorkEmail = deriveProfileWorkEmail(user);
  const generatedPhone = `+41 44 000 00 ${String(args.index).padStart(2, "0")}`;
  const generatedJobTitle = deriveProfileJobTitle(membership?.role);

  const workEmail = force || isEmpty(user?.workEmail) ? generatedWorkEmail : safeString(user.workEmail);
  const phone = force || isEmpty(user?.phone) ? generatedPhone : safeString(user.phone);
  const jobTitle = force || isEmpty(user?.jobTitle) ? generatedJobTitle : safeString(user.jobTitle);
  const { firstName, lastName } = resolveNames(user);
  const displayName = [firstName, lastName].filter(Boolean).join(" ") ||
    safeString(user?.name) || safeString(user?.email);
  const generatedSignature = [
    "Freundliche Grüsse",
    displayName,
    jobTitle,
    "",
    args.companyName,
    `Tel. ${phone}`,
    workEmail,
  ].join("\n");

  const patch: Record<string, string> = {};
  if (force || isEmpty(user?.workEmail)) patch.workEmail = generatedWorkEmail;
  if (force || isEmpty(user?.phone)) patch.phone = generatedPhone;
  if (force || isEmpty(user?.jobTitle)) patch.jobTitle = generatedJobTitle;
  if (force || isEmpty(user?.emailSignature)) patch.emailSignature = generatedSignature;
  return patch;
}
