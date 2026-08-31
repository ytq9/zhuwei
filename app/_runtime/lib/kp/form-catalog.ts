/**
 * Private KP proposal forms for new V3 rooms.
 *
 * The catalog is deliberately not exported. Callers can obtain only the IDs or
 * the descriptors selected for one proposal. This prevents an unfiltered
 * catalog from becoming part of a model, page, or public API contract.
 */

import { canonicalSha256 } from "../rules/profiles/canonical";
import {
  compoundCompositionModelSchema,
  validateCompoundCompositionDraft,
} from "./compound-composition";

export const KP_FORM_IDS = Object.freeze([
  "clarification.v1",
  "observe.v1",
  "npc-exchange.v1",
  "ordinary-check.v1",
  "high-risk-action.v1",
  "in-world-refusal.v1",
  "materialization.v1",
  "combat-action.v1",
  "environmental-stunt.v1",
  "compound.v1",
] as const);

export type KpFormId = (typeof KP_FORM_IDS)[number];

/** Stable function names for the current private-Form transport. The tool
 * name selects the Form; arguments contain that Form's draft directly. */
export const KP_FORM_TOOL_NAMES = Object.freeze({
  "clarification.v1": "submit_kp_clarification_v1",
  "observe.v1": "submit_kp_observe_v1",
  "npc-exchange.v1": "submit_kp_npc_exchange_v1",
  "ordinary-check.v1": "submit_kp_ordinary_check_v1",
  "high-risk-action.v1": "submit_kp_high_risk_action_v1",
  "in-world-refusal.v1": "submit_kp_in_world_refusal_v1",
  "materialization.v1": "submit_kp_materialization_v1",
  "combat-action.v1": "submit_kp_combat_action_v1",
  "environmental-stunt.v1": "submit_kp_environmental_stunt_v1",
  "compound.v1": "submit_kp_compound_v1",
} as const satisfies Readonly<Record<KpFormId, string>>);

const KP_FORM_ID_BY_TOOL_NAME: ReadonlyMap<string, KpFormId> = new Map<string, KpFormId>(
  KP_FORM_IDS.map((formId) => [KP_FORM_TOOL_NAMES[formId], formId] as const),
);
if (KP_FORM_ID_BY_TOOL_NAME.size !== KP_FORM_IDS.length) {
  throw new Error("KP_FORM_TOOL_NAME_COLLISION");
}

export function kpFormToolName(formId: KpFormId): string {
  const name = KP_FORM_TOOL_NAMES[formId];
  if (name === undefined) throw new Error("KP_FORM_UNKNOWN");
  return name;
}

export function kpFormIdForToolName(toolName: unknown): KpFormId | undefined {
  if (typeof toolName !== "string") return undefined;
  return KP_FORM_ID_BY_TOOL_NAME.get(toolName);
}

type FieldKind =
  | "text"
  | "text-list"
  | "stage-list"
  | "compound-composition"
  | "ability"
  | "skill"
  | "check-mode"
  | "resolution"
  | "duration-unit"
  | "boolean"
  | "positive-integer"
  | "nonnegative-integer"
  | "signed-integer"
  | "dc"
  | "save-dc"
  | "armor-class"
  | "bounded-distance"
  | "even-distance"
  | "feature-disposition"
  | "environment-effect-mode"
  | "damage-formula"
  | "damage-type"
  | "damage-type-list"
  | "failure-status"
  | "propagation"
  | "phase-name"
  | "phase-name-list"
  | "phase-ref-list"
  | "boolean-list"
  | "cover-list"
  | "phase-propagation-list"
  | "terrain-list"
  | "nonnegative-integer-list"
  | "environment-activation"
  | "attack-approach";

type CatalogForm = Readonly<{
  id: KpFormId;
  purpose: string;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  fieldKinds: Readonly<Record<string, FieldKind>>;
}>;

export type ModelFormDescriptor = CatalogForm;

const FORM_CATALOG: Readonly<Record<KpFormId, CatalogForm>> = Object.freeze({
  "clarification.v1": form(
    "clarification.v1",
    "Ask for one missing fictional or player decision before adjudication.",
    ["goal", "question", "choices"],
    ["reason", "basisRefs"],
  ),
  "observe.v1": form(
    "observe.v1",
    "Resolve an attempt to perceive, inspect, recall, or investigate.",
    ["goal", "method", "focus", "desiredInformation", "resolution", "durationUnit", "durationValue"],
    ["basisRefs", "risk", "ability", "skill", "dc", "mode", "successConsequence", "failureConsequence"],
    mechanicalFieldKinds(),
  ),
  "npc-exchange.v1": form(
    "npc-exchange.v1",
    "Resolve an in-world exchange with a projected NPC.",
    ["goal", "method", "utterance", "desiredResponse", "npcResponse", "resolution", "durationUnit", "durationValue"],
    ["basisRefs", "risk", "ability", "skill", "dc", "mode", "successConsequence", "failureConsequence"],
    mechanicalFieldKinds(),
  ),
  "ordinary-check.v1": form(
    "ordinary-check.v1",
    "Resolve a bounded ordinary action whose consequences fit one check.",
    [
      "goal", "method", "intendedOutcome", "risk", "resolution", "ability", "skill", "dc", "mode",
      "durationUnit", "durationValue", "successConsequence", "failureConsequence",
    ],
    ["basisRefs", "alternatives", "resourceRef", "resourceAmount", "itemRef", "itemCount"],
    mechanicalFieldKinds(),
  ),
  "high-risk-action.v1": form(
    "high-risk-action.v1",
    "Resolve a dangerous action with meaningful success and failure stakes.",
    [
      "goal", "method", "intendedOutcome", "risk", "stakes", "resolution", "ability", "skill", "dc", "mode",
      "durationUnit", "durationValue", "successConsequence", "failureConsequence",
    ],
    ["basisRefs", "alternatives", "resourceRef", "resourceAmount", "itemRef", "itemCount"],
    mechanicalFieldKinds(),
  ),
  "in-world-refusal.v1": form(
    "in-world-refusal.v1",
    "Resolve an impossible or premise-breaking attempt inside the fiction.",
    ["goal", "method", "reason", "alternatives", "durationUnit", "durationValue"],
    ["basisRefs"],
    mechanicalFieldKinds(),
  ),
  "materialization.v1": form(
    "materialization.v1",
    "Propose one bounded open-world fact before any random result is known.",
    ["goal", "method", "proposedFact", "basisRefs", "resolution", "durationUnit", "durationValue"],
    [
      "risk", "alternatives", "ability", "skill", "dc", "mode", "successConsequence",
      "failureConsequence",
    ],
    mechanicalFieldKinds(),
  ),
  "combat-action.v1": form(
    "combat-action.v1",
    "Resolve one combat intent without selecting authoritative entities.",
    ["goal", "method", "intendedOutcome", "combatApproach", "abilityRef"],
    ["basisRefs", "risk", "contingencies"],
  ),
  "environmental-stunt.v1": form(
    "environmental-stunt.v1",
    "Resolve an improvised interaction with a possible environment feature.",
    ["goal", "method", "featureDescription", "intendedOutcome", "featureDisposition"],
    [
      "activation", "attackApproach", "abilityRef", "checkAbility", "checkSkill", "checkDc", "checkMode",
      "checkSuccessConsequence", "checkFailureConsequence",
      "effectMode",
      "material", "centerXInches", "centerYInches", "elevationInches",
      "widthInches", "depthInches", "heightInches", "objectAc", "objectHitPoints",
      "damageThreshold", "immuneDamageTypes", "initialPhase", "phaseNames", "phaseOpaque",
      "phaseImpassable", "phaseCover", "phaseEffectPropagation", "phaseTerrain",
      "damageFromPhases", "damageRemainingAtOrBelow", "damageToPhases",
      "stuntFromPhases", "stuntToPhases",
      "hazardFromPhases", "hazardToPhases", "hazardTriggerPhase", "hazardResolvedPhase",
      "trigger", "areaOriginElevationInches", "areaRadiusInches", "propagation",
      "spreadBudgetInches", "saveAbility", "saveDc", "halfOnSuccess", "damage",
      "damageType", "condition", "debrisOutcome", "basisRefs", "risk", "contingencies",
      "resourceRef", "resourceAmount",
    ],
    {
      featureDisposition: "feature-disposition",
      effectMode: "environment-effect-mode",
      activation: "environment-activation",
      attackApproach: "attack-approach",
      checkAbility: "ability",
      checkSkill: "skill",
      checkDc: "dc",
      checkMode: "check-mode",
      centerXInches: "signed-integer",
      centerYInches: "signed-integer",
      elevationInches: "signed-integer",
      widthInches: "even-distance",
      depthInches: "even-distance",
      heightInches: "bounded-distance",
      objectAc: "armor-class",
      objectHitPoints: "positive-integer",
      damageThreshold: "nonnegative-integer",
      immuneDamageTypes: "damage-type-list",
      initialPhase: "phase-name",
      phaseNames: "phase-name-list",
      phaseOpaque: "boolean-list",
      phaseImpassable: "boolean-list",
      phaseCover: "cover-list",
      phaseEffectPropagation: "phase-propagation-list",
      phaseTerrain: "terrain-list",
      damageFromPhases: "phase-ref-list",
      damageRemainingAtOrBelow: "nonnegative-integer-list",
      damageToPhases: "phase-ref-list",
      stuntFromPhases: "phase-ref-list",
      stuntToPhases: "phase-ref-list",
      hazardFromPhases: "phase-ref-list",
      hazardToPhases: "phase-ref-list",
      hazardTriggerPhase: "phase-name",
      hazardResolvedPhase: "phase-name",
      areaOriginElevationInches: "signed-integer",
      areaRadiusInches: "bounded-distance",
      propagation: "propagation",
      spreadBudgetInches: "bounded-distance",
      saveAbility: "ability",
      saveDc: "save-dc",
      halfOnSuccess: "boolean",
      damage: "damage-formula",
      damageType: "damage-type",
      condition: "failure-status",
      resourceAmount: "positive-integer",
    },
  ),
  "compound.v1": form(
    "compound.v1",
    "Describe a bounded causal sequence for an unforeseen or multi-stage action.",
    [
      "goal", "method", "stages", "intendedOutcome", "resolution", "durationUnit",
      "durationValue", "composition",
    ],
    [
      "basisRefs", "risk", "alternatives", "ability", "skill", "dc", "mode",
      "successConsequence", "failureConsequence", "resourceRef", "resourceAmount",
      "itemRef", "itemCount",
    ],
    {
      ...mechanicalFieldKinds(),
      composition: "compound-composition",
    },
  ),
});

function form(
  id: KpFormId,
  purpose: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  fieldKindOverrides: Readonly<Record<string, FieldKind>> = {},
): CatalogForm {
  const fieldKinds: Record<string, FieldKind> = {};
  for (const field of [...requiredFields, ...optionalFields]) {
    fieldKinds[field] = fieldKindOverrides[field] ?? fieldKind(field);
  }
  return Object.freeze({
    id,
    purpose,
    requiredFields: Object.freeze([...requiredFields]),
    optionalFields: Object.freeze([...optionalFields]),
    fieldKinds: Object.freeze(fieldKinds),
  });
}

function mechanicalFieldKinds(): Readonly<Record<string, FieldKind>> {
  return Object.freeze({
    resolution: "resolution",
    ability: "ability",
    skill: "skill",
    mode: "check-mode",
    dc: "dc",
    durationUnit: "duration-unit",
    durationValue: "positive-integer",
    resourceAmount: "positive-integer",
    itemCount: "positive-integer",
  });
}

function fieldKind(field: string): FieldKind {
  if (field === "stages") return "stage-list";
  if (field === "composition") return "compound-composition";
  if (["choices", "basisRefs", "alternatives", "contingencies"].includes(field)) return "text-list";
  return "text";
}

export type FormSelectionSignals = Readonly<{
  interaction?: "free" | "observe" | "npc-exchange" | "combat" | "structured";
  risk?: "low" | "ordinary" | "high";
  mayNeedClarification?: boolean;
  mayNeedRefusal?: boolean;
  mayMaterialize?: boolean;
  mayUseEnvironment?: boolean;
  mayUseNpcExchange?: boolean;
  preferredCount?: 3 | 4 | 5 | 6;
  serverSelectedForm?: KpFormId;
  preferObservationForFree?: boolean;
  preferMaterializationForFree?: boolean;
}>;

const DEFAULT_FORM_ORDER: readonly KpFormId[] = Object.freeze([
  "ordinary-check.v1",
  "high-risk-action.v1",
  "observe.v1",
  "npc-exchange.v1",
  "materialization.v1",
  "environmental-stunt.v1",
  "combat-action.v1",
  "clarification.v1",
  "in-world-refusal.v1",
]);

/** Selects the complete model-visible form allowlist for one RootAction. */
export function selectAllowedKpForms(signals: FormSelectionSignals): readonly KpFormId[] {
  const desiredCount = signals.preferredCount ?? 5;
  if (!Number.isInteger(desiredCount) || desiredCount < 3 || desiredCount > 6) {
    throw new Error("KP_FORM_ALLOWLIST_SIZE_INVALID");
  }

  const ranked: KpFormId[] = [];
  const add = (id: KpFormId | undefined): void => {
    if (id !== undefined && id !== "compound.v1" && !ranked.includes(id)) ranked.push(id);
  };

  // Unclassified prose is intentionally left to KP semantic selection. Keep
  // observation first instead of pretending the server recognized an
  // ordinary check from arbitrary wording.
  if (signals.interaction === "free" && signals.preferObservationForFree === true) {
    add("observe.v1");
  }
  add(signals.serverSelectedForm);
  if (signals.interaction === "free" && signals.preferMaterializationForFree === true) {
    add("materialization.v1");
  }
  if (signals.mayUseNpcExchange === true) add("npc-exchange.v1");
  // V3 arbitrary prose must always retain the environmental form even when a
  // deterministic router can identify one likely non-environmental form.
  if (signals.mayUseEnvironment === true) add("environmental-stunt.v1");
  if (signals.interaction === "observe") add("observe.v1");
  if (signals.interaction === "npc-exchange") add("npc-exchange.v1");
  if (signals.interaction === "combat") add("combat-action.v1");
  if (signals.risk === "high") add("high-risk-action.v1");
  if (signals.risk === "ordinary" || signals.risk === "low") add("ordinary-check.v1");
  if (signals.mayMaterialize === true) add("materialization.v1");
  if (signals.mayNeedClarification === true) add("clarification.v1");
  if (signals.mayNeedRefusal === true) add("in-world-refusal.v1");
  for (const id of DEFAULT_FORM_ORDER) add(id);

  const selectedCount = Math.min(
    5,
    desiredCount - 1 + (signals.mayNeedClarification === true ? 1 : 0),
  );
  const selected = ranked.slice(0, selectedCount);
  if (signals.mayNeedClarification === true && !selected.includes("clarification.v1")) {
    // Ambiguous free prose must retain an actual clarification capability;
    // ranking hints cannot consume every slot and force KP to guess intent.
    selected[Math.max(0, selected.length - 1)] = "clarification.v1";
  }
  selected.push("compound.v1");
  return Object.freeze(selected);
}

/**
 * Returns only explicitly allowed descriptors. The private catalog and its
 * registration metadata never enter the model payload.
 */
export function modelFormDescriptors(
  allowedForms: readonly KpFormId[],
): readonly ModelFormDescriptor[] {
  assertAllowedFormSet(allowedForms);
  return Object.freeze(allowedForms.map((id) => {
    if (id === "npc-exchange.v1") {
      return Object.freeze({
        ...FORM_CATALOG[id],
        purpose: "Resolve an exchange with one projected NPC. desiredResponse is a typed social-intent JSON string with explicit evidenceRefs; npcResponse is typed and source-checked against finite NPC knowledge; utterance is overwritten with authenticated player text.",
      });
    }
    if (id === "materialization.v1") {
      const purpose = [
        FORM_CATALOG[id].purpose,
        "Character-premise answers use the establishCharacterPremise method and a typed, source-cited premise JSON string.",
        "NPC encounters, built-in healing-potion materialization, item transfers, NPC gear changes, and established item-state changes use exact typed JSON drafts; Rules derives trusted actors, item identities, definitions, abilities, targets, and all authoritative effects.",
      ].join(" ");
      return Object.freeze({
        ...FORM_CATALOG[id],
        purpose,
      });
    }
    if (id !== "observe.v1") return FORM_CATALOG[id];
    return Object.freeze({
      ...FORM_CATALOG[id],
      purpose: "Resolve perception, inspection, recall, or investigation. For direct resolution, desiredInformation is the concrete answer committed to the character; for a check, it names the question answered by the frozen success/failure consequences.",
    });
  }));
}

/** Builds the direct draft schema for exactly one Form. No formId/draft
 * envelope or cross-Form oneOf is exposed to the model. */
export function buildKpFormToolParameters(
  formId: KpFormId,
): Readonly<Record<string, unknown>> {
  if (!Object.hasOwn(FORM_CATALOG, formId)) throw new Error("KP_FORM_UNKNOWN");
  const branch = modelBranchSchema(FORM_CATALOG[formId]);
  const properties = branch.properties;
  if (!isPlainRecord(properties) || !isPlainRecord(properties.draft)) {
    throw new Error("KP_FORM_SCHEMA_INVALID");
  }
  return properties.draft;
}

function modelBranchSchema(
  definition: CatalogForm,
): Readonly<Record<string, unknown>> {
  const draftProperties: Record<string, unknown> = {};
  for (const field of [...definition.requiredFields, ...definition.optionalFields]) {
    const schema = modelFieldSchema(definition.fieldKinds[field]!);
    draftProperties[field] = definition.id === "materialization.v1"
      && field === "proposedFact"
      ? Object.freeze({ ...schema, maxLength: 8_000 })
      : schema;
  }
  return deepFreezeSchema({
    type: "object",
    additionalProperties: false,
    description: definition.purpose,
    properties: {
      formId: { type: "string", const: definition.id },
      draft: {
        type: "object",
        additionalProperties: false,
        properties: draftProperties,
        required: definition.requiredFields,
        ...(
          definition.fieldKinds.resolution === "resolution"
          || definition.fieldKinds.featureDisposition === "feature-disposition"
            ? {
                allOf: [
                  ...(definition.fieldKinds.resolution === "resolution"
                    ? [{
                        if: { properties: { resolution: { const: "check" } } },
                        then: {
                          required: [
                            "ability", "skill", "dc", "mode", "successConsequence",
                            "failureConsequence",
                          ],
                        },
                      }]
                    : []),
                  ...(definition.fieldKinds.featureDisposition === "feature-disposition"
                    ? [
                      {
                        if: {
                          properties: {
                            featureDisposition: { const: "reasonable-open-blank" },
                          },
                        },
                        then: {
                          required: [
                            "material", "centerXInches", "centerYInches",
                            "elevationInches", "widthInches", "depthInches", "heightInches",
                            "objectAc", "objectHitPoints", "damageThreshold", "effectMode",
                            "initialPhase", "phaseNames", "phaseOpaque", "phaseImpassable",
                            "phaseCover", "phaseEffectPropagation", "phaseTerrain",
                            "damageFromPhases", "damageRemainingAtOrBelow", "damageToPhases",
                            "trigger", "basisRefs",
                          ],
                        },
                      },
                      {
                        if: {
                          properties: {
                            featureDisposition: { const: "reasonable-open-blank" },
                            effectMode: { const: "area-hazard" },
                          },
                          required: ["featureDisposition", "effectMode"],
                        },
                        then: {
                          required: [
                            "hazardFromPhases", "hazardToPhases", "hazardTriggerPhase",
                            "hazardResolvedPhase", "areaOriginElevationInches",
                            "areaRadiusInches", "propagation", "saveAbility", "saveDc",
                            "halfOnSuccess", "damage", "damageType", "condition", "debrisOutcome",
                          ],
                        },
                      },
                      {
                        if: {
                          properties: {
                            featureDisposition: { const: "reasonable-open-blank" },
                            effectMode: { const: "state-only" },
                          },
                          required: ["featureDisposition", "effectMode"],
                        },
                        then: {
                          allOf: [
                            "hazardFromPhases", "hazardToPhases", "hazardTriggerPhase",
                            "hazardResolvedPhase", "areaOriginElevationInches",
                            "areaRadiusInches", "propagation", "spreadBudgetInches",
                            "saveAbility", "saveDc", "halfOnSuccess", "damage",
                            "damageType", "condition", "debrisOutcome",
                          ].map((field) => ({ not: { required: [field] } })),
                        },
                      },
                      {
                        if: {
                          properties: { propagation: { const: "aroundCorners" } },
                          required: ["propagation"],
                        },
                        then: { required: ["spreadBudgetInches"] },
                      },
                      {
                        if: {
                          properties: {
                            featureDisposition: {
                              enum: ["reuse-existing", "reasonable-open-blank"],
                            },
                          },
                          required: ["featureDisposition"],
                        },
                        then: { required: ["activation"] },
                      },
                      {
                        if: {
                          properties: { activation: { const: "attack" } },
                          required: ["activation"],
                        },
                        then: {
                          required: [
                            "attackApproach", "abilityRef",
                          ],
                        },
                      },
                      {
                        if: {
                          properties: {
                            featureDisposition: { const: "reasonable-open-blank" },
                            activation: { enum: ["check", "direct"] },
                          },
                          required: ["activation", "featureDisposition"],
                        },
                        then: { required: ["stuntFromPhases", "stuntToPhases"] },
                      },
                      {
                        if: {
                          properties: { activation: { const: "check" } },
                          required: ["activation"],
                        },
                        then: {
                          required: [
                            "checkAbility", "checkSkill", "checkDc", "checkMode",
                            "checkSuccessConsequence", "checkFailureConsequence",
                          ],
                        },
                      },
                    ]
                    : []),
                ],
              }
            : {}),
      },
    },
    required: ["formId", "draft"],
  }) as Readonly<Record<string, unknown>>;
}

function modelFieldSchema(kind: FieldKind): Readonly<Record<string, unknown>> {
  if (kind === "compound-composition") return compoundCompositionModelSchema();
  if (kind === "text") return Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 });
  if (kind === "ability") return Object.freeze({ enum: ["str", "dex", "con", "int", "wis", "cha"] });
  if (kind === "skill") {
    return Object.freeze({
      enum: [
        "none", "acrobatics", "animal", "arcana", "athletics", "deception", "history",
        "insight", "intimidation", "investigation", "medicine", "nature", "perception",
        "performance", "persuasion", "religion", "sleight", "stealth", "survival",
      ],
    });
  }
  if (kind === "check-mode") return Object.freeze({ enum: ["normal", "advantage", "disadvantage"] });
  if (kind === "resolution") return Object.freeze({ enum: ["direct", "check"] });
  if (kind === "duration-unit") return Object.freeze({ enum: ["round", "second", "minute", "hour", "day"] });
  if (kind === "boolean") return Object.freeze({ type: "boolean" });
  if (kind === "positive-integer") {
    return Object.freeze({ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
  }
  if (kind === "nonnegative-integer") {
    return Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  }
  if (kind === "signed-integer") {
    return Object.freeze({ type: "integer", minimum: -1_000_000, maximum: 1_000_000 });
  }
  if (kind === "dc") return Object.freeze({ type: "integer", minimum: 0, maximum: 30 });
  if (kind === "save-dc" || kind === "armor-class") {
    return Object.freeze({ type: "integer", minimum: 1, maximum: 30 });
  }
  if (kind === "bounded-distance") {
    return Object.freeze({ type: "integer", minimum: 1, maximum: 12_000 });
  }
  if (kind === "even-distance") {
    return Object.freeze({ type: "integer", minimum: 2, maximum: 12_000, multipleOf: 2 });
  }
  if (kind === "feature-disposition") {
    return Object.freeze({ enum: ["reuse-existing", "reasonable-open-blank", "explicitly-absent"] });
  }
  if (kind === "environment-effect-mode") {
    return Object.freeze({ enum: ["state-only", "area-hazard"] });
  }
  if (kind === "damage-formula") {
    return Object.freeze({ type: "string", pattern: "^([1-9]|1[0-9]|20)d(4|6|8|10|12)(?:\\+(0|[1-9][0-9]*))?$" });
  }
  if (kind === "damage-type") {
    return Object.freeze({
      enum: [
        "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
        "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
      ],
    });
  }
  if (kind === "damage-type-list") {
    return Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: modelFieldSchema("damage-type"),
    });
  }
  if (kind === "failure-status") return Object.freeze({ enum: ["none", "prone"] });
  if (kind === "propagation") return Object.freeze({ enum: ["straight", "aroundCorners"] });
  if (kind === "phase-name") {
    return Object.freeze({ type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$" });
  }
  if (kind === "phase-name-list") {
    return Object.freeze({
      type: "array", minItems: 2, maxItems: 16, uniqueItems: true,
      items: modelFieldSchema("phase-name"),
    });
  }
  if (kind === "phase-ref-list") {
    return Object.freeze({
      type: "array", minItems: 1, maxItems: 16,
      items: modelFieldSchema("phase-name"),
    });
  }
  if (kind === "boolean-list") {
    return Object.freeze({ type: "array", minItems: 1, maxItems: 16, items: { type: "boolean" } });
  }
  if (kind === "cover-list") {
    return Object.freeze({
      type: "array", minItems: 1, maxItems: 16,
      items: { enum: ["none", "half", "threeQuarters", "full"] },
    });
  }
  if (kind === "phase-propagation-list") {
    return Object.freeze({
      type: "array", minItems: 1, maxItems: 16,
      items: { enum: ["passes", "blocks"] },
    });
  }
  if (kind === "terrain-list") {
    return Object.freeze({
      type: "array", minItems: 1, maxItems: 16,
      items: { enum: ["normal", "rubble"] },
    });
  }
  if (kind === "nonnegative-integer-list") {
    return Object.freeze({
      type: "array", minItems: 1, maxItems: 16,
      items: { type: "integer", minimum: 0, maximum: 1_000_000 },
    });
  }
  if (kind === "environment-activation") return Object.freeze({ enum: ["attack", "check", "direct"] });
  if (kind === "attack-approach") return Object.freeze({ enum: ["any", "melee", "ranged", "spell"] });
  if (kind === "text-list") {
    return deepFreezeSchema({
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
    }) as Readonly<Record<string, unknown>>;
  }
  if (kind !== "stage-list") throw new Error("KP_FORM_FIELD_KIND_UNKNOWN");
  return deepFreezeSchema({
    type: "array",
    minItems: 1,
    maxItems: 7,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 1_000 },
        method: { type: "string", minLength: 1, maxLength: 1_000 },
        intendedOutcome: { type: "string", minLength: 1, maxLength: 1_000 },
        risk: { type: "string", minLength: 1, maxLength: 1_000 },
        resolution: { enum: ["direct", "check"] },
        ability: { enum: ["str", "dex", "con", "int", "wis", "cha"] },
        skill: { type: "string", minLength: 1, maxLength: 120 },
        dc: { type: "integer", minimum: 0, maximum: 30 },
        mode: { enum: ["normal", "advantage", "disadvantage"] },
        successConsequence: { type: "string", minLength: 1, maxLength: 1_000 },
        failureConsequence: { type: "string", minLength: 1, maxLength: 1_000 },
        basisRefs: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
      required: ["goal", "method", "intendedOutcome", "resolution"],
      allOf: [{
        if: { properties: { resolution: { const: "check" } } },
        then: {
          required: ["ability", "skill", "dc", "mode", "successConsequence", "failureConsequence"],
        },
      }],
    },
  }) as Readonly<Record<string, unknown>>;
}

function deepFreezeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeSchema));
  if (!isPlainRecord(value)) return value;
  const frozen: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) frozen[key] = deepFreezeSchema(child);
  return Object.freeze(frozen);
}

const KP_FORM_CATALOG_REF = "kp-private-form-catalog-v5" as const;
const KP_FORM_CATALOG_VERSION = "kp-private-form-catalog-v5.0" as const;

/**
 * Complete private catalog preimage. The document stays module-private so a
 * caller still cannot request the unfiltered catalog, while the registered
 * hash remains independently checkable against every descriptor and tool
 * parameter schema that the current catalog can expose.
 */
const KP_FORM_CATALOG_PROFILE_DOCUMENT = Object.freeze({
  schema: "zhuwei.kp-form-catalog-profile/v1",
  catalogRef: KP_FORM_CATALOG_REF,
  catalogVersion: KP_FORM_CATALOG_VERSION,
  selectionContract: "server-allowlist-of-three-to-six-forms-including-compound",
  validationContract: "closed-draft-schema-plus-resolution-cost-pair-environment-cross-field-and-bounded-compound-composition-validation",
  itemCostContract: "one-exact-item-entry-ref-paired-with-one-positive-count",
  forms: Object.freeze(KP_FORM_IDS.map((formId) => Object.freeze({
    formId,
    toolName: KP_FORM_TOOL_NAMES[formId],
    descriptor: FORM_CATALOG[formId],
    parameters: buildKpFormToolParameters(formId),
  }))),
});

export const KP_FORM_CATALOG_REGISTRATION = Object.freeze({
  catalogRef: KP_FORM_CATALOG_REF,
  catalogVersion: KP_FORM_CATALOG_VERSION,
  catalogHash: "sha256:996c8b5221f8acb10e66c3cd4d3766d0a2a04d3910609aeee84f418d1c35212b",
  formCount: KP_FORM_IDS.length,
});

export function canonicalKpFormCatalogHash(): `sha256:${string}` {
  return canonicalSha256(KP_FORM_CATALOG_PROFILE_DOCUMENT);
}

export function formCatalogRegistrationMatchesCanonicalDocument(): boolean {
  return KP_FORM_CATALOG_REGISTRATION.catalogHash
    === canonicalKpFormCatalogHash();
}

export function assertAllowedFormSet(allowedForms: readonly KpFormId[]): void {
  if (allowedForms.length < 3 || allowedForms.length > 6) {
    throw new Error("KP_FORM_ALLOWLIST_SIZE_INVALID");
  }
  if (!allowedForms.includes("compound.v1")) throw new Error("KP_FORM_COMPOUND_REQUIRED");
  if (new Set(allowedForms).size !== allowedForms.length) throw new Error("KP_FORM_ALLOWLIST_DUPLICATE");
  for (const id of allowedForms) {
    if (!Object.hasOwn(FORM_CATALOG, id)) throw new Error("KP_FORM_UNKNOWN");
  }
}

const FORBIDDEN_MODEL_KEY_PARTS = Object.freeze([
  "actor",
  "principal",
  "controller",
  "audience",
  "visibility",
  "dice",
  "d20",
  "roll",
  "target",
  "state",
  "event",
  "patch",
  "profile",
  "scope",
  "root",
]);

export function isForbiddenModelField(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return (FORBIDDEN_MODEL_KEY_PARTS as readonly string[]).includes(token)
      || (FORBIDDEN_MODEL_KEY_PARTS as readonly string[]).includes(singular);
  })) return true;
  const compact = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (FORBIDDEN_MODEL_KEY_PARTS as readonly string[])
    .filter((part) => part !== "script")
    .some((part) => compact.includes(part));
}

function keyTokens(key: string): string[] {
  return key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
}

export type FormDraftValidation = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

/** Validates the model-owned part only; authority fields are never accepted. */
export function validateKpFormDraft(formId: KpFormId, draft: unknown): FormDraftValidation {
  const definition = FORM_CATALOG[formId];
  const errors: string[] = [];
  if (!isPlainRecord(draft)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["draft:object-required"]) });
  }

  const allowedFields = new Set([...definition.requiredFields, ...definition.optionalFields]);
  for (const key of Object.keys(draft).sort()) {
    if (isForbiddenModelField(key)) errors.push(`${key}:authority-field-forbidden`);
    else if (!allowedFields.has(key)) errors.push(`${key}:unknown-field`);
  }
  for (const field of definition.requiredFields) {
    if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) errors.push(`${field}:required`);
  }
  for (const field of [...definition.requiredFields, ...definition.optionalFields]) {
    if (Object.hasOwn(draft, field) && !matchesFieldKind(definition.fieldKinds[field]!, draft[field])) {
      errors.push(`${field}:type-invalid`);
    }
  }
  if (definition.fieldKinds.resolution === "resolution") {
    const checkFields = ["ability", "skill", "dc", "mode", "successConsequence", "failureConsequence"];
    if (draft.resolution === "check") {
      for (const field of checkFields) {
        if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) errors.push(`${field}:check-required`);
      }
    } else if (draft.resolution === "direct") {
      for (const field of checkFields) {
        if (Object.hasOwn(draft, field)) errors.push(`${field}:direct-forbidden`);
      }
    }
  }
  for (const [refField, amountField] of [
    ["resourceRef", "resourceAmount"],
    ["itemRef", "itemCount"],
  ] as const) {
    if (Object.hasOwn(draft, refField) !== Object.hasOwn(draft, amountField)) {
      errors.push(`${refField}:${amountField}:pair-required`);
    }
  }
  if (formId === "environmental-stunt.v1" && draft.featureDisposition === "reasonable-open-blank") {
    for (const field of [
      "material", "centerXInches", "centerYInches", "elevationInches",
      "widthInches", "depthInches", "heightInches", "objectAc", "objectHitPoints",
      "damageThreshold", "effectMode", "initialPhase", "phaseNames", "phaseOpaque",
      "phaseImpassable", "phaseCover", "phaseEffectPropagation", "phaseTerrain",
      "damageFromPhases", "damageRemainingAtOrBelow", "damageToPhases", "trigger", "basisRefs",
    ]) {
      if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) {
        errors.push(`${field}:environment-required`);
      }
    }
  }
  if (formId === "environmental-stunt.v1") {
    const definitionFields = [
      "effectMode", "material", "centerXInches", "centerYInches", "elevationInches", "widthInches",
      "depthInches", "heightInches", "objectAc", "objectHitPoints", "damageThreshold",
      "immuneDamageTypes", "initialPhase", "phaseNames", "phaseOpaque", "phaseImpassable",
      "phaseCover", "phaseEffectPropagation", "phaseTerrain", "damageFromPhases",
      "damageRemainingAtOrBelow", "damageToPhases", "stuntFromPhases", "stuntToPhases",
      "hazardFromPhases", "hazardToPhases",
      "hazardTriggerPhase", "hazardResolvedPhase", "trigger", "areaOriginElevationInches",
      "areaRadiusInches", "propagation", "spreadBudgetInches", "saveAbility", "saveDc",
      "halfOnSuccess", "damage", "damageType", "condition", "debrisOutcome",
    ];
    if (draft.featureDisposition !== "reasonable-open-blank") {
      for (const field of definitionFields) {
        if (Object.hasOwn(draft, field)) errors.push(`${field}:established-definition-forbidden`);
      }
    }
    if (draft.featureDisposition === "explicitly-absent") {
      for (const field of [
        "activation", "attackApproach", "abilityRef", "checkAbility", "checkSkill", "checkDc", "checkMode",
        "checkSuccessConsequence", "checkFailureConsequence",
      ]) {
        if (Object.hasOwn(draft, field)) errors.push(`${field}:absent-feature-forbidden`);
      }
    } else {
      if (!Object.hasOwn(draft, "activation")) errors.push("activation:environment-required");
      if (draft.activation === "attack") {
        for (const field of ["attackApproach", "abilityRef"]) {
          if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) {
            errors.push(`${field}:attack-required`);
          }
        }
      }
      if (draft.activation === "check") {
        for (const field of [
          "checkAbility", "checkSkill", "checkDc", "checkMode", "checkSuccessConsequence",
          "checkFailureConsequence",
        ]) {
          if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) {
            errors.push(`${field}:environment-check-required`);
          }
        }
      }
    }
    validateEnvironmentalDraft(draft, errors);
  }
  findNestedForbiddenFields(draft, "$", errors);

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)].sort()) });
}

function validateEnvironmentalDraft(
  draft: Record<string, unknown>,
  errors: string[],
): void {
  if (draft.featureDisposition !== "reasonable-open-blank") return;
  const areaHazard = draft.effectMode === "area-hazard";
  const stateOnly = draft.effectMode === "state-only";
  const hazardFields = [
    "hazardFromPhases", "hazardToPhases", "hazardTriggerPhase", "hazardResolvedPhase",
    "areaOriginElevationInches", "areaRadiusInches", "propagation", "spreadBudgetInches",
    "saveAbility", "saveDc", "halfOnSuccess", "damage", "damageType", "condition",
    "debrisOutcome",
  ];
  if (stateOnly) {
    for (const field of hazardFields) {
      if (Object.hasOwn(draft, field)) errors.push(`${field}:state-only-forbidden`);
    }
  }
  if (areaHazard) {
    for (const field of hazardFields.filter((field) => field !== "spreadBudgetInches")) {
      if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) {
        errors.push(`${field}:area-hazard-required`);
      }
    }
  }
  if (areaHazard && draft.propagation === "aroundCorners" && !Object.hasOwn(draft, "spreadBudgetInches")) {
    errors.push("spreadBudgetInches:around-corners-required");
  }
  if (areaHazard && draft.propagation === "straight" && Object.hasOwn(draft, "spreadBudgetInches")) {
    errors.push("spreadBudgetInches:straight-forbidden");
  }
  if (Number.isSafeInteger(draft.damageThreshold)
    && Number.isSafeInteger(draft.objectHitPoints)
    && Number(draft.damageThreshold) > Number(draft.objectHitPoints)) {
    errors.push("damageThreshold:exceeds-object-hit-points");
  }

  const phaseNames = Array.isArray(draft.phaseNames)
    ? draft.phaseNames.filter((value): value is string => typeof value === "string")
    : [];
  const phaseSet = new Set(phaseNames);
  if (phaseNames.length < 2) errors.push("phaseNames:minimum-two");
  for (const field of [
    "phaseOpaque", "phaseImpassable", "phaseCover", "phaseEffectPropagation", "phaseTerrain",
  ]) {
    if (Array.isArray(draft[field]) && draft[field].length !== phaseNames.length) {
      errors.push(`${field}:phase-cardinality-mismatch`);
    }
  }
  for (const field of ["initialPhase", ...(areaHazard
    ? ["hazardTriggerPhase", "hazardResolvedPhase"] as const
    : [])] as const) {
    if (typeof draft[field] === "string" && !phaseSet.has(draft[field])) {
      errors.push(`${field}:unknown-phase`);
    }
  }

  const transitionGroups = [
    ["damageFromPhases", "damageToPhases", "damageRemainingAtOrBelow"],
    ["stuntFromPhases", "stuntToPhases"],
    ["hazardFromPhases", "hazardToPhases"],
  ] as const;
  for (const group of transitionGroups) {
    const arrays = group.map((field) => Array.isArray(draft[field]) ? draft[field] as unknown[] : []);
    const populated = arrays.filter((values) => values.length > 0);
    if (populated.length > 0 && arrays.some((values) => values.length !== populated[0]!.length)) {
      errors.push(`${group.join(":")}:cardinality-mismatch`);
    }
    for (const field of group.filter((field) => field !== "damageRemainingAtOrBelow")) {
      for (const phase of Array.isArray(draft[field]) ? draft[field] : []) {
        if (typeof phase === "string" && !phaseSet.has(phase)) {
          errors.push(`${field}:unknown-phase:${phase}`);
        }
      }
    }
  }

  const damageFrom = Array.isArray(draft.damageFromPhases) ? draft.damageFromPhases : [];
  const damageTo = Array.isArray(draft.damageToPhases) ? draft.damageToPhases : [];
  const thresholds = Array.isArray(draft.damageRemainingAtOrBelow)
    ? draft.damageRemainingAtOrBelow
    : [];
  const stuntFrom = Array.isArray(draft.stuntFromPhases) ? draft.stuntFromPhases : [];
  const stuntTo = Array.isArray(draft.stuntToPhases) ? draft.stuntToPhases : [];
  const hazardFrom = Array.isArray(draft.hazardFromPhases) ? draft.hazardFromPhases : [];
  const hazardTo = Array.isArray(draft.hazardToPhases) ? draft.hazardToPhases : [];
  const transitionCount = Math.max(damageFrom.length, damageTo.length, thresholds.length)
    + Math.max(stuntFrom.length, stuntTo.length)
    + Math.max(hazardFrom.length, hazardTo.length);
  if (transitionCount > 32) errors.push("environmentTransitions:limit-exceeded");
  if (Number.isSafeInteger(draft.objectHitPoints)) {
    thresholds.forEach((threshold, index) => {
      if (Number.isSafeInteger(threshold) && Number(threshold) > Number(draft.objectHitPoints)) {
        errors.push(`damageRemainingAtOrBelow[${index}]:exceeds-object-hit-points`);
      }
    });
  }
  const assertTransitionPairs = (from: unknown[], to: unknown[], label: string): void => {
    const keys = new Set<string>();
    for (let index = 0; index < Math.min(from.length, to.length); index += 1) {
      if (from[index] === to[index]) errors.push(`${label}[${index}]:self-transition`);
      const key = `${String(from[index])}\u0000${String(to[index])}`;
      if (keys.has(key)) errors.push(`${label}[${index}]:duplicate`);
      keys.add(key);
    }
  };
  assertTransitionPairs(damageFrom, damageTo, "damageTransition");
  assertTransitionPairs(stuntFrom, stuntTo, "stuntTransition");
  assertTransitionPairs(hazardFrom, hazardTo, "hazardTransition");

  for (const field of ["damageFromPhases", "damageRemainingAtOrBelow", "damageToPhases"]) {
    if (!Array.isArray(draft[field]) || draft[field].length === 0) {
      errors.push(`${field}:environment-required`);
    }
  }
  if (draft.activation === "attack" && areaHazard) {
    if (!damageFrom.some((from, index) => from === draft.initialPhase
      && damageTo[index] === draft.hazardTriggerPhase)) {
      errors.push("damageTransition:initial-to-trigger-required");
    }
  }
  if (draft.activation === "check" || draft.activation === "direct") {
    for (const field of ["stuntFromPhases", "stuntToPhases"]) {
      if (!Array.isArray(draft[field]) || draft[field].length === 0) {
        errors.push(`${field}:stunt-required`);
      }
    }
    if (!stuntFrom.some((from) => from === draft.initialPhase)) {
      errors.push("stuntTransition:initial-transition-required");
    }
    if (stateOnly && stuntFrom.filter((from) => from === draft.initialPhase).length !== 1) {
      errors.push("stuntTransition:state-only-initial-must-be-unique");
    }
    if (areaHazard && !stuntFrom.some((from, index) => from === draft.initialPhase
      && stuntTo[index] === draft.hazardTriggerPhase)) {
      errors.push("stuntTransition:initial-to-trigger-required");
    }
  }
  if (areaHazard && !hazardFrom.some((from, index) => from === draft.hazardTriggerPhase
    && hazardTo[index] === draft.hazardResolvedPhase)) {
    errors.push("hazardTransition:trigger-to-resolved-required");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function matchesFieldKind(kind: FieldKind, value: unknown): boolean {
  if (kind === "compound-composition") return validateCompoundCompositionDraft(value).ok;
  if (kind === "text") return typeof value === "string" && value.trim().length > 0;
  if (kind === "ability") return ["str", "dex", "con", "int", "wis", "cha"].includes(String(value));
  if (kind === "skill") {
    return [
      "none", "acrobatics", "animal", "arcana", "athletics", "deception", "history",
      "insight", "intimidation", "investigation", "medicine", "nature", "perception",
      "performance", "persuasion", "religion", "sleight", "stealth", "survival",
    ].includes(String(value));
  }
  if (kind === "check-mode") return ["normal", "advantage", "disadvantage"].includes(String(value));
  if (kind === "resolution") return value === "direct" || value === "check";
  if (kind === "duration-unit") return ["round", "second", "minute", "hour", "day"].includes(String(value));
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "positive-integer") return Number.isSafeInteger(value) && Number(value) > 0;
  if (kind === "nonnegative-integer") return Number.isSafeInteger(value) && Number(value) >= 0;
  if (kind === "signed-integer") {
    return Number.isSafeInteger(value) && Number(value) >= -1_000_000 && Number(value) <= 1_000_000;
  }
  if (kind === "dc") return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 30;
  if (kind === "save-dc" || kind === "armor-class") {
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 30;
  }
  if (kind === "bounded-distance") {
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 12_000;
  }
  if (kind === "even-distance") {
    return Number.isSafeInteger(value) && Number(value) >= 2 && Number(value) <= 12_000
      && Number(value) % 2 === 0;
  }
  if (kind === "feature-disposition") {
    return ["reuse-existing", "reasonable-open-blank", "explicitly-absent"].includes(String(value));
  }
  if (kind === "environment-effect-mode") {
    return value === "state-only" || value === "area-hazard";
  }
  if (kind === "damage-formula") {
    return typeof value === "string"
      && /^([1-9]|1[0-9]|20)d(4|6|8|10|12)(?:\+(0|[1-9][0-9]*))?$/u.test(value);
  }
  if (kind === "damage-type") {
    return [
      "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
      "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
    ].includes(String(value));
  }
  if (kind === "damage-type-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && new Set(value).size === value.length
      && value.every((entry) => matchesFieldKind("damage-type", entry));
  }
  if (kind === "failure-status") return value === "none" || value === "prone";
  if (kind === "propagation") return value === "straight" || value === "aroundCorners";
  if (kind === "phase-name") {
    return typeof value === "string" && value.length <= 80
      && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
  }
  if (kind === "phase-name-list") {
    return Array.isArray(value) && value.length >= 2 && value.length <= 16
      && new Set(value).size === value.length
      && value.every((entry) => matchesFieldKind("phase-name", entry));
  }
  if (kind === "phase-ref-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => matchesFieldKind("phase-name", entry));
  }
  if (kind === "boolean-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => typeof entry === "boolean");
  }
  if (kind === "cover-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => ["none", "half", "threeQuarters", "full"].includes(String(entry)));
  }
  if (kind === "phase-propagation-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => entry === "passes" || entry === "blocks");
  }
  if (kind === "terrain-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => entry === "normal" || entry === "rubble");
  }
  if (kind === "nonnegative-integer-list") {
    return Array.isArray(value) && value.length > 0 && value.length <= 16
      && value.every((entry) => Number.isSafeInteger(entry)
        && Number(entry) >= 0 && Number(entry) <= 1_000_000);
  }
  if (kind === "environment-activation") return ["attack", "check", "direct"].includes(String(value));
  if (kind === "attack-approach") return ["any", "melee", "ranged", "spell"].includes(String(value));
  if (kind === "text-list") {
    return Array.isArray(value) && value.length > 0
      && value.every((item) => typeof item === "string" && item.trim().length > 0);
  }
  if (kind !== "stage-list") return false;
  return Array.isArray(value) && value.length > 0 && value.every((stage) => {
    if (!isPlainRecord(stage)) return false;
    const allowed = new Set([
      "goal", "method", "intendedOutcome", "risk", "basisRefs", "resolution", "ability",
      "skill", "dc", "mode", "successConsequence", "failureConsequence",
    ]);
    if (Object.keys(stage).some((key) => !allowed.has(key))) return false;
    if (["goal", "method", "intendedOutcome"].some((key) => typeof stage[key] !== "string"
      || (stage[key] as string).trim().length === 0)) return false;
    if (stage.resolution !== "direct" && stage.resolution !== "check") return false;
    if (stage.resolution === "check") {
      if (!["str", "dex", "con", "int", "wis", "cha"].includes(String(stage.ability))) return false;
      if (![
        "none", "acrobatics", "animal", "arcana", "athletics", "deception", "history",
        "insight", "intimidation", "investigation", "medicine", "nature", "perception",
        "performance", "persuasion", "religion", "sleight", "stealth", "survival",
      ].includes(String(stage.skill))) return false;
      if (!Number.isSafeInteger(stage.dc) || Number(stage.dc) < 0 || Number(stage.dc) > 30) return false;
      if (!["normal", "advantage", "disadvantage"].includes(String(stage.mode))) return false;
      if (typeof stage.successConsequence !== "string" || !stage.successConsequence.trim()) return false;
      if (typeof stage.failureConsequence !== "string" || !stage.failureConsequence.trim()) return false;
    } else if (["ability", "skill", "dc", "mode", "successConsequence", "failureConsequence"]
      .some((key) => Object.hasOwn(stage, key))) return false;
    if (stage.risk !== undefined && (typeof stage.risk !== "string" || stage.risk.trim().length === 0)) return false;
    return stage.basisRefs === undefined || (Array.isArray(stage.basisRefs)
      && stage.basisRefs.length > 0
      && stage.basisRefs.every((ref) => typeof ref === "string" && ref.trim().length > 0));
  });
}

function findNestedForbiddenFields(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findNestedForbiddenFields(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenModelField(key)) errors.push(`${path}.${key}:authority-field-forbidden`);
    findNestedForbiddenFields(child, `${path}.${key}`, errors);
  }
}
