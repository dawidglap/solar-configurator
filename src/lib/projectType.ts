export const PROJECT_TYPES = ["photovoltaic", "heating"] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const DEFAULT_PROJECT_TYPE: ProjectType = "photovoltaic";

export function isProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" &&
    (PROJECT_TYPES as readonly string[]).includes(value);
}

/** Legacy documents may omit the field; arbitrary stored values are not accepted. */
export function resolveProjectType(value: unknown): ProjectType {
  if (value === undefined) return DEFAULT_PROJECT_TYPE;
  if (isProjectType(value)) return value;
  throw new TypeError("Invalid projectType");
}

export type ProjectTypeUpdateResult =
  | Readonly<{ ok: true; projectType: ProjectType; provided: boolean }>
  | Readonly<{ ok: false; reason: "invalid" | "immutable" }>;

/** Validates create/update input and keeps an existing project's type immutable. */
export function resolveProjectTypeUpdate(
  existingValue: unknown,
  requestedValue: unknown,
  provided: boolean,
): ProjectTypeUpdateResult {
  let existingProjectType: ProjectType;
  try {
    existingProjectType = resolveProjectType(existingValue);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!provided) {
    return { ok: true, projectType: existingProjectType, provided: false };
  }
  if (!isProjectType(requestedValue)) {
    return { ok: false, reason: "invalid" };
  }
  if (requestedValue !== existingProjectType) {
    return { ok: false, reason: "immutable" };
  }
  return { ok: true, projectType: existingProjectType, provided: true };
}
