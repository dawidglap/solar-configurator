import type { ClientSession, Db, MongoClient, ObjectId } from "mongodb";
import { ReturnDocument } from "mongodb";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";
import { CHECKLIST_ITEMS } from "@/lib/checklistCatalog";
import { getSessionUserMeta } from "@/lib/tasks";

export type AuftragPipelineStep = {
  key: string;
  label: string;
  color: string;
  order: number;
  isLocked: boolean;
  isTerminal: boolean;
};

export type AuftragStepActor = {
  id: string;
  fullName: string;
};

export type AuftragStepState = {
  stepKey: string;
  completedAt: string | null;
  completedBy: AuftragStepActor | null;
  archived: boolean;
};

export type AuftragStatus = "aktiv" | "abgeschlossen" | "storniert";

export const AUFTRAG_LOCKED_FIRST_STEP = {
  key: "gewonnen",
  label: "Gewonnen",
} as const;

export const AUFTRAG_LOCKED_LAST_STEP = {
  key: "bereit_fuer_ausfuehrung",
  label: "Bereit für Ausführung",
} as const;

const LEGACY_LOCKED_FIRST_STEP_KEY = "projekt_geprueft";
const LEGACY_LOCKED_LAST_STEP_KEY = "projekt_abgeschlossen";

const DEFAULT_STEP_COLORS = [
  "hsl(210 78% 56%)",
  "hsl(220 64% 58%)",
  "hsl(228 58% 60%)",
  "hsl(238 54% 61%)",
  "hsl(248 56% 61%)",
  "hsl(264 54% 59%)",
  "hsl(282 52% 57%)",
  "hsl(302 48% 56%)",
  "hsl(334 64% 58%)",
  "hsl(8 76% 58%)",
  "hsl(22 82% 56%)",
  "hsl(36 88% 54%)",
  "hsl(46 90% 52%)",
  "hsl(154 56% 45%)",
  "hsl(164 60% 38%)",
] as const;

export function getAuftragPipelineTemplatesCollection(db: Db) {
  return db.collection("auftrag_pipeline_templates");
}

export function getAuftraegeCollection(db: Db) {
  return db.collection("auftraege");
}

export function getAuftragStepsStateCollection(db: Db) {
  return db.collection("auftrag_steps_state");
}

export function getAuftragAuditLogsCollection(db: Db) {
  return db.collection("auftrag_audit_logs");
}

export async function ensureAuftragIndexes(db: Db) {
  await Promise.all([
    getAuftragPipelineTemplatesCollection(db).createIndex({ companyId: 1 }, { unique: true }),
    getAuftraegeCollection(db).createIndex({ companyId: 1, planningId: 1 }, { unique: true }),
    getAuftraegeCollection(db).createIndex({ companyId: 1, orderId: 1 }, { unique: true, sparse: true }),
    getAuftraegeCollection(db).createIndex(
      { companyId: 1, montageId: 1 },
      { unique: true, sparse: true },
    ),
    getAuftraegeCollection(db).createIndex({ companyId: 1, status: 1, currentStepKey: 1 }),
    getAuftragStepsStateCollection(db).createIndex(
      { companyId: 1, orderId: 1, stepKey: 1 },
      { unique: true },
    ),
    getAuftragStepsStateCollection(db).createIndex({ companyId: 1, orderId: 1, position: 1 }),
    getAuftragAuditLogsCollection(db).createIndex({ companyId: 1, auftragId: 1, createdAt: -1 }),
  ]);
}

function normalizeStepKey(value: unknown) {
  const normalized = safeString(value)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
  if (normalized === LEGACY_LOCKED_FIRST_STEP_KEY) {
    return AUFTRAG_LOCKED_FIRST_STEP.key;
  }
  if (normalized === LEGACY_LOCKED_LAST_STEP_KEY) {
    return AUFTRAG_LOCKED_LAST_STEP.key;
  }
  return normalized;
}

function normalizeOrder(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeStepActor(input: any): AuftragStepActor | null {
  const id = safeString(input?.id);
  const fullName = safeString(input?.fullName);
  if (!id && !fullName) return null;

  return {
    id,
    fullName: fullName || "Unbekannt",
  };
}

export function getSessionActor(session: SessionPayload | null | undefined): AuftragStepActor {
  const meta = getSessionUserMeta(session);
  return {
    id: meta.id || "",
    fullName: meta.name || "Unbekannt",
  };
}

export function canManageAuftragPipelineTemplate(session: SessionPayload | null | undefined) {
  if ((session as any)?.isPlatformSuperAdmin === true) return true;
  if (!session) return false;

  const directRoles = [
    (session as any)?.activeRole,
    (session as any)?.role,
    (session as any)?.activeCompanyRole,
    (session as any)?.membershipRole,
    (session as any)?.companyRole,
    (session as any)?.primaryRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);

  const listRoles = Array.isArray((session as any)?.roles)
    ? (session as any).roles
        .map((value: unknown) => safeString(value).toLowerCase())
        .filter(Boolean)
    : [];

  const roles = new Set([...directRoles, ...listRoles]);
  return ["owner", "admin", "inhaber", "administrator", "company_admin"].some((role) =>
    roles.has(role),
  );
}

export function normalizeAuftragPipelineSteps(input: unknown): AuftragPipelineStep[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw, index) => {
      const key = normalizeStepKey((raw as any)?.key);
      const label = safeString((raw as any)?.label);
      const color = safeString((raw as any)?.color);
      if (!key || !label || !color) return null;

      return {
        key,
        label,
        color,
        order: normalizeOrder((raw as any)?.order, index),
        isLocked: !!(raw as any)?.isLocked,
        isTerminal: !!(raw as any)?.isTerminal,
      } satisfies AuftragPipelineStep;
    })
    .filter((step): step is AuftragPipelineStep => !!step)
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({
      ...step,
      order: index,
    }));
}

export function validateAuftragPipelineSteps(steps: AuftragPipelineStep[]) {
  if (!Array.isArray(steps) || steps.length < 2) {
    return "Mindestens zwei Schritte sind erforderlich.";
  }

  if (steps.length > 20) {
    return "Maximal 20 Schritte sind erlaubt.";
  }

  const keys = new Set<string>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step.key || !/^[a-z0-9_-]+$/.test(step.key)) {
      return `Ungültiger Step-Key: ${step.key || "(leer)"}`;
    }
    if (keys.has(step.key)) {
      return `Doppelter Step-Key: ${step.key}`;
    }
    keys.add(step.key);

    if (!step.label) {
      return `Label fehlt für Step ${step.key}.`;
    }
    if (!/^hsl\(\d{1,3}\s+\d{1,3}%\s+\d{1,3}%\)$/.test(step.color)) {
      return `Ungültige Farbe für Step ${step.label}.`;
    }
    if (step.order !== index) {
      return "Step-Reihenfolge muss bei 0 beginnen und lückenlos sein.";
    }
  }

  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  const firstMatches =
    firstStep?.key === AUFTRAG_LOCKED_FIRST_STEP.key &&
    firstStep.order === 0 &&
    firstStep.isLocked === true &&
    firstStep.isTerminal === false;
  if (!firstMatches) {
    return `Der erste Step muss "${AUFTRAG_LOCKED_FIRST_STEP.key}" sein und gesperrt bleiben.`;
  }

  const terminalMatches =
    lastStep?.key === AUFTRAG_LOCKED_LAST_STEP.key &&
    lastStep.isLocked === true &&
    lastStep.isTerminal === true;
  if (!terminalMatches) {
    return `Der letzte Step muss "${AUFTRAG_LOCKED_LAST_STEP.key}" sein und terminal bleiben.`;
  }

  const lockedCount = steps.filter((step) => step.isLocked).length;
  const terminalCount = steps.filter((step) => step.isTerminal).length;
  if (lockedCount !== 2) {
    return "Nur der erste und letzte Step dürfen gesperrt sein.";
  }
  if (terminalCount !== 1) {
    return "Genau ein terminaler Step ist erforderlich.";
  }

  return "";
}

export function getDefaultAuftragPipelineSteps() {
  return CHECKLIST_ITEMS.map((item, index, all) => ({
    key:
      index === 0
        ? AUFTRAG_LOCKED_FIRST_STEP.key
        : index === all.length - 1
          ? AUFTRAG_LOCKED_LAST_STEP.key
          : item.key,
    label:
      index === 0
        ? AUFTRAG_LOCKED_FIRST_STEP.label
        : index === all.length - 1
          ? AUFTRAG_LOCKED_LAST_STEP.label
          : item.label,
    color: DEFAULT_STEP_COLORS[index] || DEFAULT_STEP_COLORS[DEFAULT_STEP_COLORS.length - 1],
    order: index,
    isLocked: index === 0 || index === all.length - 1,
    isTerminal: index === all.length - 1,
  })) satisfies AuftragPipelineStep[];
}

function canonicalizeAuftragPipelineSteps(steps: AuftragPipelineStep[]) {
  if (steps.length < 2) return steps;

  return steps.map((step, index, all) => {
    if (index === 0) {
      return {
        ...step,
        key: AUFTRAG_LOCKED_FIRST_STEP.key,
        label: AUFTRAG_LOCKED_FIRST_STEP.label,
        order: 0,
        isLocked: true,
        isTerminal: false,
      } satisfies AuftragPipelineStep;
    }

    if (index === all.length - 1) {
      return {
        ...step,
        key: AUFTRAG_LOCKED_LAST_STEP.key,
        label: AUFTRAG_LOCKED_LAST_STEP.label,
        order: all.length - 1,
        isLocked: true,
        isTerminal: true,
      } satisfies AuftragPipelineStep;
    }

    return {
      ...step,
      order: index,
      isLocked: false,
      isTerminal: false,
    } satisfies AuftragPipelineStep;
  });
}

function arePipelineStepsEqual(left: AuftragPipelineStep[], right: AuftragPipelineStep[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function ensureCompanyAuftragPipelineTemplate(
  db: Db,
  companyId: ObjectId,
  actor?: AuftragStepActor | null,
) {
  await ensureAuftragIndexes(db);
  const now = new Date();
  const result = await getAuftragPipelineTemplatesCollection(db).findOneAndUpdate(
    { companyId },
    {
      $setOnInsert: {
        companyId,
        steps: getDefaultAuftragPipelineSteps(),
        updatedAt: now,
        updatedBy: actor ?? null,
      },
    },
    {
      upsert: true,
      includeResultMetadata: false,
      returnDocument: ReturnDocument.AFTER,
    },
  );

  const doc = result as any;
  const existingSteps = normalizeAuftragPipelineSteps(doc?.steps);
  const canonicalSteps =
    existingSteps.length > 0
      ? canonicalizeAuftragPipelineSteps(existingSteps)
      : getDefaultAuftragPipelineSteps();

  if (!arePipelineStepsEqual(existingSteps, canonicalSteps)) {
    await getAuftragPipelineTemplatesCollection(db).updateOne(
      { companyId },
      {
        $set: {
          steps: canonicalSteps,
          updatedAt: now,
          updatedBy: actor ?? doc?.updatedBy ?? null,
        },
      },
    );
    await migrateLegacyAuftraegeLockedSteps(db, companyId, canonicalSteps);
    return {
      ...doc,
      steps: canonicalSteps,
      updatedAt: now,
      updatedBy: actor ?? doc?.updatedBy ?? null,
    };
  }

  await migrateLegacyAuftraegeLockedSteps(db, companyId, canonicalSteps);
  return {
    ...doc,
    steps: canonicalSteps,
  };
}

export function normalizeAuftragPipelineTemplate(doc: any) {
  return {
    companyId: mongoIdToString(doc?.companyId),
    steps: normalizeAuftragPipelineSteps(doc?.steps),
    updatedAt:
      doc?.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : safeString(doc?.updatedAt) || null,
    updatedBy: normalizeStepActor(doc?.updatedBy),
  };
}

export function normalizeAuftragStepState(input: any): AuftragStepState | null {
  const stepKey = normalizeStepKey(input?.stepKey);
  if (!stepKey) return null;

  const completedAtValue = input?.completedAt;
  const completedAt =
    completedAtValue instanceof Date
      ? completedAtValue.toISOString()
      : safeString(completedAtValue) || null;

  return {
    stepKey,
    completedAt,
    completedBy: completedAt ? normalizeStepActor(input?.completedBy) : null,
    archived: !!input?.archived,
  };
}

export function normalizeAuftragStepStates(input: unknown) {
  if (!Array.isArray(input)) return [] as AuftragStepState[];

  return input
    .map((entry) => normalizeAuftragStepState(entry))
    .filter((entry): entry is AuftragStepState => !!entry);
}

function normalizeAuftragStepStatePosition(input: any, fallback: number) {
  return typeof input?.position === "number" && Number.isFinite(input.position)
    ? Math.trunc(input.position)
    : fallback;
}

function buildEmptyStepState(stepKey: string): AuftragStepState {
  return {
    stepKey,
    completedAt: null,
    completedBy: null,
    archived: false,
  };
}

function buildChecklistItemLabel(stepKey: string) {
  return stepKey
    .split("_")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function mapStatesByKey(states: AuftragStepState[]) {
  const map = new Map<string, AuftragStepState>();
  for (const state of states) {
    if (!map.has(state.stepKey)) {
      map.set(state.stepKey, state);
    }
  }
  return map;
}

export function deriveCurrentAuftragStepKey(
  templateSteps: AuftragPipelineStep[],
  stepsState: AuftragStepState[],
  requestedStepKey?: string | null,
  status?: AuftragStatus | null,
) {
  const templateKeys = new Set(templateSteps.map((step) => step.key));
  const requested = normalizeStepKey(requestedStepKey);
  if (requested && templateKeys.has(requested)) {
    return requested;
  }

  const terminalStep = templateSteps.find((step) => step.isTerminal) ?? templateSteps[templateSteps.length - 1];
  if ((status ?? "aktiv") === "abgeschlossen") {
    return terminalStep?.key || templateSteps[0]?.key || "";
  }

  const statesByKey = mapStatesByKey(stepsState);
  const firstIncomplete = templateSteps.find((step) => !statesByKey.get(step.key)?.completedAt);
  if (firstIncomplete) return firstIncomplete.key;

  return terminalStep?.key || templateSteps[templateSteps.length - 1]?.key || "";
}

export function migrateAuftragStateToTemplate(args: {
  templateSteps: AuftragPipelineStep[];
  existingStepsState: unknown;
  currentStepKey?: string | null;
  status?: AuftragStatus | null;
}) {
  const templateKeys = new Set(args.templateSteps.map((step) => step.key));
  const existing = normalizeAuftragStepStates(args.existingStepsState);
  const existingByKey = mapStatesByKey(existing);

  const activeStates = args.templateSteps.map((step) => {
    const prior = existingByKey.get(step.key);
    return prior
      ? {
          ...prior,
          stepKey: step.key,
          archived: false,
        }
      : buildEmptyStepState(step.key);
  });

  const archivedStates = existing
    .filter((state) => !templateKeys.has(state.stepKey) && !!state.completedAt)
    .map((state) => ({
      ...state,
      archived: true,
    }));

  const currentStepKey = deriveCurrentAuftragStepKey(
    args.templateSteps,
    activeStates,
    args.currentStepKey ?? null,
    args.status ?? null,
  );
  const terminalKey =
    args.templateSteps.find((step) => step.isTerminal)?.key ||
    args.templateSteps[args.templateSteps.length - 1]?.key ||
    "";
  const status =
    (args.status ?? "aktiv") === "storniert"
      ? "storniert"
      : currentStepKey === terminalKey
        ? "abgeschlossen"
        : "aktiv";

  return {
    currentStepKey,
    status: status as AuftragStatus,
    stepsState: [...activeStates, ...archivedStates],
  };
}

export function buildInitialAuftragStepStates(
  templateSteps: AuftragPipelineStep[],
  actor: AuftragStepActor,
  now = new Date(),
) {
  const completedAt = now.toISOString();
  return templateSteps.map((step, index) =>
    index === 0
      ? {
          stepKey: step.key,
          completedAt,
          completedBy: actor,
          archived: false,
        }
      : buildEmptyStepState(step.key),
  );
}

export function buildCompletedAuftragStepStates(
  templateSteps: AuftragPipelineStep[],
  actor: AuftragStepActor,
  now = new Date(),
) {
  const completedAt = now.toISOString();
  return templateSteps.map((step) => ({
    stepKey: step.key,
    completedAt,
    completedBy: actor,
    archived: false,
  }));
}

function buildActorFromAuftrag(doc: any): AuftragStepActor {
  const embedded = normalizeStepActor(doc?.createdBy);
  if (embedded) return embedded;

  return {
    id: safeString(doc?.createdByUserId) || "",
    fullName: safeString(doc?.createdByName) || "Unbekannt",
  };
}

function buildStepStateDocs(args: {
  companyId: ObjectId;
  orderId: string;
  templateSteps: AuftragPipelineStep[];
  stepsState: AuftragStepState[];
}) {
  const templateStepMap = new Map(args.templateSteps.map((step) => [step.key, step]));
  let archivedPosition = args.templateSteps.length;

  return args.stepsState.map((state) => {
    const templateStep = templateStepMap.get(state.stepKey);
    const completedAt = state.completedAt ? new Date(state.completedAt) : null;

    return {
      companyId: args.companyId,
      orderId: args.orderId,
      stepKey: state.stepKey,
      stepLabel: templateStep?.label || buildChecklistItemLabel(state.stepKey),
      completedAt,
      completedBy: state.completedBy ?? null,
      archived: !!state.archived,
      position: templateStep ? templateStep.order : archivedPosition++,
      updatedAt: new Date(),
      ...(templateStep ? { createdAt: new Date() } : {}),
    };
  });
}

export async function persistAuftragStepsState(args: {
  db: Db;
  companyId: ObjectId;
  orderId: string;
  templateSteps: AuftragPipelineStep[];
  stepsState: AuftragStepState[];
  session?: ClientSession;
}) {
  const docs = buildStepStateDocs(args);
  const collection = getAuftragStepsStateCollection(args.db);
  const operations = docs.map((doc) => ({
    updateOne: {
      filter: {
        companyId: args.companyId,
        orderId: args.orderId,
        stepKey: doc.stepKey,
      },
      update: {
        $set: {
          stepLabel: doc.stepLabel,
          completedAt: doc.completedAt,
          completedBy: doc.completedBy,
          archived: doc.archived,
          position: doc.position,
          updatedAt: doc.updatedAt,
        },
        $setOnInsert: {
          companyId: doc.companyId,
          orderId: doc.orderId,
          createdAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await collection.bulkWrite(operations, {
      ordered: false,
      ...(args.session ? { session: args.session } : {}),
    });
  }

  const stepKeys = docs.map((doc) => doc.stepKey);
  await collection.deleteMany(
    {
      companyId: args.companyId,
      orderId: args.orderId,
      ...(stepKeys.length > 0 ? { stepKey: { $nin: stepKeys } } : {}),
    },
    args.session ? { session: args.session } : undefined,
  );
}

function mergeAuftragStepsWithTemplate(args: {
  templateSteps: AuftragPipelineStep[];
  stepDocs: any[];
}) {
  const normalizedDocs = args.stepDocs
    .map((doc, index) => {
      const normalized = normalizeAuftragStepState(doc);
      if (!normalized) return null;
      return {
        ...normalized,
        stepLabel: safeString(doc?.stepLabel) || buildChecklistItemLabel(normalized.stepKey),
        position: normalizeAuftragStepStatePosition(doc, index),
      };
    })
    .filter(
      (
        item,
      ): item is AuftragStepState & {
        stepLabel: string;
        position: number;
      } => !!item,
    );

  const byKey = new Map(normalizedDocs.map((doc) => [doc.stepKey, doc]));
  const activeStates = args.templateSteps.map((step) => {
    const existing = byKey.get(step.key);
    return existing
      ? {
          stepKey: step.key,
          completedAt: existing.completedAt,
          completedBy: existing.completedBy,
          archived: false,
        }
      : buildEmptyStepState(step.key);
  });

  const templateKeys = new Set(args.templateSteps.map((step) => step.key));
  const archivedStates = normalizedDocs
    .filter((doc) => !templateKeys.has(doc.stepKey) && !!doc.completedAt)
    .sort((left, right) => left.position - right.position)
    .map((doc) => ({
      stepKey: doc.stepKey,
      completedAt: doc.completedAt,
      completedBy: doc.completedBy,
      archived: true,
    }));

  return [...activeStates, ...archivedStates];
}

function deriveAuftragStatesFromLegacyDoc(args: {
  templateSteps: AuftragPipelineStep[];
  auftrag: any;
}) {
  const actor = buildActorFromAuftrag(args.auftrag);
  const createdAt =
    args.auftrag?.createdAt instanceof Date ? args.auftrag.createdAt : new Date();
  const embeddedSteps = normalizeAuftragStepStates((args.auftrag as any)?.stepsState);
  if (embeddedSteps.length > 0) {
    return migrateAuftragStateToTemplate({
      templateSteps: args.templateSteps,
      existingStepsState: embeddedSteps,
      currentStepKey: safeString((args.auftrag as any)?.currentStepKey),
      status: safeString((args.auftrag as any)?.status) as AuftragStatus,
    });
  }

  if (safeString((args.auftrag as any)?.status) === "abgeschlossen" || (args.auftrag as any)?.completedAt) {
    const stepsState = buildCompletedAuftragStepStates(args.templateSteps, actor, createdAt);
    return {
      currentStepKey:
        args.templateSteps[args.templateSteps.length - 1]?.key || AUFTRAG_LOCKED_LAST_STEP.key,
      status: "abgeschlossen" as AuftragStatus,
      stepsState,
    };
  }

  const targetStepKey =
    safeString((args.auftrag as any)?.currentStepKey) || args.templateSteps[0]?.key || AUFTRAG_LOCKED_FIRST_STEP.key;
  return advanceAuftragSteps({
    templateSteps: args.templateSteps,
    existingStepsState: [],
    toStepKey: targetStepKey,
    actor,
    now: createdAt,
  });
}

export async function ensureAuftragStepStateForOrder(args: {
  db: Db;
  companyId: ObjectId;
  orderId: string;
  templateSteps: AuftragPipelineStep[];
  auftrag: any;
  session?: ClientSession;
}) {
  const collection = getAuftragStepsStateCollection(args.db);
  const existing = await collection
    .find(
      {
        companyId: args.companyId,
        orderId: args.orderId,
      },
      args.session ? { session: args.session } : undefined,
    )
    .sort({ position: 1, _id: 1 })
    .toArray();

  if (existing.length > 0) {
    return mergeAuftragStepsWithTemplate({
      templateSteps: args.templateSteps,
      stepDocs: existing,
    });
  }

  const reconstructed = deriveAuftragStatesFromLegacyDoc({
    templateSteps: args.templateSteps,
    auftrag: args.auftrag,
  });
  await persistAuftragStepsState({
    db: args.db,
    companyId: args.companyId,
    orderId: args.orderId,
    templateSteps: args.templateSteps,
    stepsState: reconstructed.stepsState,
    session: args.session,
  });
  return reconstructed.stepsState;
}

export function buildChecklistFromAuftragState(args: {
  templateSteps: AuftragPipelineStep[];
  stepsState: AuftragStepState[];
}) {
  const statesByKey = mapStatesByKey(args.stepsState.filter((state) => !state.archived));
  const items = args.templateSteps.map((step) => {
    const state = statesByKey.get(step.key) ?? buildEmptyStepState(step.key);
    return {
      key: step.key,
      label: step.label,
      done: !!state.completedAt,
      doneAt: state.completedAt,
      doneBy: state.completedBy?.id || null,
      doneByName: state.completedBy?.fullName || null,
    };
  });

  return {
    items,
    updatedAt: new Date().toISOString(),
  };
}

export function getNextTemplateStepKey(templateSteps: AuftragPipelineStep[], stepKey: string) {
  const normalizedKey = normalizeStepKey(stepKey);
  const currentIndex = templateSteps.findIndex((step) => step.key === normalizedKey);
  if (currentIndex < 0) return null;
  return templateSteps[currentIndex + 1]?.key || templateSteps[currentIndex]?.key || null;
}

export function isLockedTemplateStep(templateSteps: AuftragPipelineStep[], stepKey: string) {
  const normalizedKey = normalizeStepKey(stepKey);
  return !!templateSteps.find((step) => step.key === normalizedKey && step.isLocked);
}

export function advanceAuftragSteps(args: {
  templateSteps: AuftragPipelineStep[];
  existingStepsState: unknown;
  toStepKey: string;
  actor: AuftragStepActor;
  now?: Date;
}) {
  const targetKey = normalizeStepKey(args.toStepKey);
  const targetStep = args.templateSteps.find((step) => step.key === targetKey);
  if (!targetStep) {
    throw new Error("Ungültiger Zielschritt.");
  }

  const nowIso = (args.now ?? new Date()).toISOString();
  const existing = normalizeAuftragStepStates(args.existingStepsState);
  const existingByKey = mapStatesByKey(existing);
  const templateKeys = new Set(args.templateSteps.map((step) => step.key));

  const stepsState = args.templateSteps.map((step) => {
    const prior = existingByKey.get(step.key) ?? buildEmptyStepState(step.key);

    if (step.order < targetStep.order) {
      return prior.completedAt
        ? { ...prior, archived: false }
        : {
            stepKey: step.key,
            completedAt: nowIso,
            completedBy: args.actor,
            archived: false,
          };
    }

    if (step.order > targetStep.order) {
      return buildEmptyStepState(step.key);
    }

    if (step.isTerminal) {
      return prior.completedAt
        ? { ...prior, archived: false }
        : {
            stepKey: step.key,
            completedAt: nowIso,
            completedBy: args.actor,
            archived: false,
          };
    }

    return buildEmptyStepState(step.key);
  });

  const archivedStates = existing
    .filter((state) => !templateKeys.has(state.stepKey) && (!!state.completedAt || state.archived))
    .map((state) => ({
      ...state,
      archived: true,
    }));

  return {
    currentStepKey: targetStep.key,
    status: (targetStep.isTerminal ? "abgeschlossen" : "aktiv") as AuftragStatus,
    stepsState: [...stepsState, ...archivedStates],
  };
}

export async function migrateOpenAuftraegeForTemplate(
  db: Db,
  companyId: ObjectId,
  templateSteps: AuftragPipelineStep[],
) {
  const offeneAuftraege = await getAuftraegeCollection(db)
    .find({
      companyId,
      status: "aktiv",
    })
    .toArray();

  if (offeneAuftraege.length === 0) {
    return { matched: 0, modified: 0 };
  }

  const operations = offeneAuftraege.map((auftrag) => {
    const migrated = deriveAuftragStatesFromLegacyDoc({
      templateSteps,
      auftrag,
    });

    return {
      updateOne: {
        filter: { _id: (auftrag as any)._id, companyId },
        update: {
          $set: {
            currentStepKey: migrated.currentStepKey,
            status: migrated.status,
            completedAt:
              migrated.status === "abgeschlossen"
                ? (auftrag as any)?.completedAt ?? new Date()
                : null,
            updatedAt: new Date(),
          },
          $unset: {
            stepsState: "",
          },
        },
      },
    };
  });

  const result = await getAuftraegeCollection(db).bulkWrite(operations, { ordered: false });
  for (const auftrag of offeneAuftraege) {
    const migrated = deriveAuftragStatesFromLegacyDoc({
      templateSteps,
      auftrag,
    });
    const orderId = safeString((auftrag as any)?.orderId);
    if (!orderId) continue;
    await persistAuftragStepsState({
      db,
      companyId,
      orderId,
      templateSteps,
      stepsState: migrated.stepsState,
    });
  }
  return {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  };
}

export async function migrateLegacyAuftraegeLockedSteps(
  db: Db,
  companyId: ObjectId,
  templateSteps: AuftragPipelineStep[],
) {
  const legacyAuftraege = await getAuftraegeCollection(db)
    .find({
      companyId,
      $or: [
        { currentStepKey: { $in: [LEGACY_LOCKED_FIRST_STEP_KEY, LEGACY_LOCKED_LAST_STEP_KEY] } },
        { "stepsState.stepKey": { $in: [LEGACY_LOCKED_FIRST_STEP_KEY, LEGACY_LOCKED_LAST_STEP_KEY] } },
      ],
    })
    .toArray();

  if (legacyAuftraege.length === 0) {
    return { matched: 0, modified: 0 };
  }

  const operations = legacyAuftraege.map((auftrag) => {
    const migrated = deriveAuftragStatesFromLegacyDoc({ templateSteps, auftrag });

    return {
      updateOne: {
        filter: { _id: (auftrag as any)._id, companyId },
        update: {
          $set: {
            currentStepKey: migrated.currentStepKey,
            status: migrated.status,
            completedAt:
              migrated.status === "abgeschlossen"
                ? (auftrag as any)?.completedAt ?? new Date()
                : null,
            updatedAt: new Date(),
          },
          $unset: {
            stepsState: "",
          },
        },
      },
    };
  });

  const result = await getAuftraegeCollection(db).bulkWrite(operations, { ordered: false });
  for (const auftrag of legacyAuftraege) {
    const migrated = deriveAuftragStatesFromLegacyDoc({ templateSteps, auftrag });
    const orderId = safeString((auftrag as any)?.orderId);
    if (!orderId) continue;
    await persistAuftragStepsState({
      db,
      companyId,
      orderId,
      templateSteps,
      stepsState: migrated.stepsState,
    });
  }
  return {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  };
}

export function normalizeAuftrag(doc: any) {
  return {
    id: mongoIdToString(doc?._id),
    companyId: mongoIdToString(doc?.companyId),
    orderId: safeString(doc?.orderId) || null,
    planningId: mongoIdToString(doc?.planningId),
    montageId: mongoIdToString(doc?.montageId) || null,
    status: (safeString(doc?.status) || "aktiv") as AuftragStatus,
    currentStepKey: safeString(doc?.currentStepKey) || null,
    completedAt:
      doc?.completedAt instanceof Date
        ? doc.completedAt.toISOString()
        : safeString(doc?.completedAt) || null,
    stepsState: normalizeAuftragStepStates(doc?.stepsState),
    createdAt:
      doc?.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : safeString(doc?.createdAt) || null,
    updatedAt:
      doc?.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : safeString(doc?.updatedAt) || null,
    createdBy: normalizeStepActor(doc?.createdBy),
  };
}

export async function getAuftragByOrderId(
  db: Db,
  companyId: ObjectId,
  orderId: string,
  session?: ClientSession,
) {
  return getAuftraegeCollection(db).findOne(
    {
      companyId,
      orderId: safeString(orderId),
    },
    session ? { session } : undefined,
  );
}

export async function getHydratedAuftragState(args: {
  db: Db;
  companyId: ObjectId;
  orderId: string;
  actor?: AuftragStepActor | null;
  session?: ClientSession;
}) {
  const normalizedOrderId = safeString(args.orderId);
  if (!normalizedOrderId) return null;

  const template = await ensureCompanyAuftragPipelineTemplate(
    args.db,
    args.companyId,
    args.actor ?? null,
  );
  const templateSteps = normalizeAuftragPipelineSteps((template as any)?.steps);
  const auftrag = await getAuftragByOrderId(
    args.db,
    args.companyId,
    normalizedOrderId,
    args.session,
  );
  if (!auftrag) return null;

  const stepsState = await ensureAuftragStepStateForOrder({
    db: args.db,
    companyId: args.companyId,
    orderId: normalizedOrderId,
    templateSteps,
    auftrag,
    session: args.session,
  });
  const checklist = buildChecklistFromAuftragState({
    templateSteps,
    stepsState,
  });

  return {
    auftrag,
    normalizedAuftrag: {
      ...normalizeAuftrag(auftrag),
      stepsState,
    },
    templateSteps,
    stepsState,
    checklist,
  };
}

export async function logAuftragAdvance(args: {
  db: Db;
  companyId: ObjectId;
  auftragId: ObjectId;
  actor: AuftragStepActor;
  fromStepKey: string;
  toStepKey: string;
  session?: ClientSession;
}) {
  await getAuftragAuditLogsCollection(args.db).insertOne(
    {
      companyId: args.companyId,
      auftragId: args.auftragId,
      action: "advance",
      fromStepKey: safeString(args.fromStepKey) || null,
      toStepKey: safeString(args.toStepKey),
      actor: args.actor,
      createdAt: new Date(),
    },
    args.session ? { session: args.session } : undefined,
  );
}

export async function runWithOptionalTransaction<T>(
  client: MongoClient,
  work: (session?: ClientSession) => Promise<T>,
) {
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error: any) {
    const message = String(error?.message || "");
    if (
      message.includes("Transaction numbers are only allowed") ||
      message.includes("Transaction is not supported")
    ) {
      return work();
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
