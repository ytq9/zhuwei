import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../../app/_runtime/lib/kp/causal-action-program";
import type { KpFormId } from "../../app/_runtime/lib/kp/form-catalog";

type JsonRecord = Record<string, unknown>;

export type ProductionProposalOptions = {
  kind?: string;
  goal?: string;
  method?: string;
  risk?: JsonRecord | null;
  publicBasisRefs?: string[];
  privateBasisRefs?: string[];
  adjudicationPrecedent?: JsonRecord | null;
  dynamicMaterializations?: JsonRecord[];
  hiddenRealityCandidateSet?: JsonRecord | null;
  npcActions?: JsonRecord[];
  scene?: JsonRecord;
  proposalAttemptId?: string;
};

function durationFields(value: unknown): {
  durationUnit: "round" | "second" | "minute" | "hour" | "day";
  durationValue: number;
} {
  const duration = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
  const durationUnit = ["round", "second", "minute", "hour", "day"]
    .includes(String(duration.unit))
    ? duration.unit as "round" | "second" | "minute" | "hour" | "day"
    : "second";
  return {
    durationUnit,
    durationValue: Number.isSafeInteger(duration.value) && Number(duration.value) > 0
      ? Number(duration.value)
      : 1,
  };
}

function basisRefs(options: ProductionProposalOptions): string[] {
  return [...new Set([
    ...(options.publicBasisRefs ?? []),
    ...(options.privateBasisRefs ?? []),
  ])];
}

export function privateFormProposal(
  rootActionId: string,
  formId: KpFormId,
  draft: JsonRecord,
  proposalAttemptId = `proposal:${rootActionId}:1`,
) {
  const program = compileKpFormDraft(formId, draft);
  return {
    kind: "privateFormProposal",
    rootActionId,
    formId,
    draft,
    causalActionProgram: program,
    loweredCausalProgram: lowerCausalActionProgram(program),
    semanticFreezeHash: program.semanticHash,
    repairUsed: false,
    proposalAttemptId,
    modelInvocationReceipt: { task: "proposal", result: "success" },
  };
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Builds the current materialization.v1 NPC mechanical encounter draft.
 * The supplied combatant seeds are fixture data; Rules still compiles,
 * validates, rolls initiative, and owns every resulting event. */
export function npcMechanicalEncounterProposal(
  rootActionId: string,
  input: {
    encounterRef: string;
    sceneRef: string;
    causalBasisRefs: string[];
    alliedEntityRefs?: string[];
    hostileEntityRefs: string[];
    establishedEntryRefs?: string[];
    entries: Array<{ entityId: string; name: string; definition: JsonRecord }>;
    durationUnit?: "round" | "second" | "minute" | "hour" | "day";
    durationValue?: number;
  },
) {
  const entryIds = new Set(input.entries.map(({ entityId }) => entityId));
  const establishedEntryRefs = new Set(input.establishedEntryRefs ?? []);
  if ([...establishedEntryRefs].some((entityRef) => !entryIds.has(entityRef))) {
    throw new TypeError("Every established encounter entry must identify one submitted entry.");
  }
  const existingParticipantRefs = [
    ...(input.alliedEntityRefs ?? []),
    ...input.hostileEntityRefs,
  ].filter((entityRef) => !entryIds.has(entityRef) || establishedEntryRefs.has(entityRef));
  const entries = input.entries.map(({ entityId, name, definition }, index) => {
    const position = record(definition.position, `NPC position ${index}`);
    const hitPoints = record(definition.hitPoints, `NPC hit points ${index}`);
    const resources = definition.resources === undefined
      ? {}
      : record(definition.resources, `NPC resources ${index}`);
    const resourceMaximums = Object.fromEntries(Object.entries(resources).map(([resourceRef, value]) => {
      const resource = record(value, `NPC resource ${resourceRef}`);
      return [resourceRef, String(resource.maximum ?? resource.current ?? "0")];
    }));
    const resourcesCurrent = Object.fromEntries(Object.entries(resources).map(([resourceRef, value]) => {
      const resource = record(value, `NPC resource ${resourceRef}`);
      return [resourceRef, String(resource.current ?? resource.maximum ?? "0")];
    }));
    const initialState = {
      hitPointsCurrent: String(hitPoints.current),
      temporaryHitPoints: String(hitPoints.temporary ?? "0"),
      resourcesCurrent,
    };
    return {
      entityId,
      name,
      placement: { position: structuredClone(position) },
      mechanics: {
        kind: "bespokeDefinition",
        definition: {
          definitionId: `npc-mechanical:${rootActionId}:${String(index + 1).padStart(2, "0")}`,
          revision: "1",
          definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014",
          causalBasisRefs: [...input.causalBasisRefs],
          visibilityPolicyRef: "visibility:room-authority-only",
          content: {
            schema: "zhuwei.npc-mechanical-template/v1",
            label: name,
            stats: stringRecord(definition.stats),
            proficiencyBonus: String(definition.proficiencyBonus),
            armorClass: String(definition.armorClass),
            armorClassModel: {
              kind: "higherOfBaseAndEquipment",
              baseArmorClass: String(definition.armorClass),
              shieldBonus: "0",
            },
            hitPointsMaximum: String(hitPoints.maximum),
            footprint: structuredClone(record(definition.footprint, `NPC footprint ${index}`)),
            speedInches: stringRecord(definition.speedInches),
            resourceMaximums,
            deathPolicy: definition.deathPolicy,
            intrinsicAbilities: structuredClone(Array.isArray(definition.abilities)
              ? definition.abilities
              : []),
            itemDefinitions: [],
            itemDefinitionRefs: [],
            initialLoadout: { entries: [] },
            ...(definition.attacksPerAttackAction === undefined
              ? {}
              : { attacksPerAttackAction: definition.attacksPerAttackAction }),
            ...(definition.damageDefenses === undefined
              ? {}
              : { damageDefenses: structuredClone(definition.damageDefenses) }),
            ...(definition.sizeCategory === undefined
              ? {}
              : { sizeCategory: definition.sizeCategory }),
            ...(definition.spellcasting === undefined
              ? {}
              : { spellcasting: structuredClone(definition.spellcasting) }),
          },
        },
      },
      initialState,
    };
  });
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: "让已经出现的敌对 NPC 进入权威遭遇",
    method: "materializeNpcMechanicalEncounter",
    proposedFact: JSON.stringify({
      schema: "zhuwei.npc-mechanical-encounter-draft/v1",
      encounterRef: input.encounterRef,
      alliedEntityRefs: input.alliedEntityRefs ?? [],
      hostileEntityRefs: input.hostileEntityRefs,
      entries,
    }),
    basisRefs: [
      input.sceneRef,
      ...input.causalBasisRefs,
      ...existingParticipantRefs,
    ],
    resolution: "direct",
    durationUnit: input.durationUnit ?? "second",
    durationValue: input.durationValue ?? 1,
  });
}

/** Forms one current finite-knowledge NPC ActorPlan. The selected trigger is
 * already held by that NPC, so Rules (not the test) decides that the plan is
 * due before the next affected player intent. */
export function npcActorPlanFormationProposal(
  rootActionId: string,
  input: {
    sceneRef: string;
    npcRef: string;
    premiseKnowledgeRef: string;
    planRef: string;
    activityRef: string;
    traceFactRef: string;
    nextStep: string;
    alternateTargetRef?: string;
  },
) {
  const alternateTargetRef = input.alternateTargetRef ?? input.sceneRef;
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: `让 ${input.npcRef} 依据自己的有限知识形成下一步计划`,
    method: "formActorPlan",
    proposedFact: JSON.stringify({
      schema: "zhuwei.actor-plan-draft/v1",
      npcRef: input.npcRef,
      factionRef: null,
      planId: input.planRef,
      goal: input.nextStep,
      premiseRefs: [input.premiseKnowledgeRef],
      nextStep: input.nextStep,
      resourceRefs: [],
      activity: {
        activityId: input.activityRef,
        activityKind: "combatTactic",
        intendedDurationMicros: "1",
      },
      due: null,
      trigger: {
        kind: "knowledgeAcquired",
        knowledgeRef: input.premiseKnowledgeRef,
      },
      trace: {
        factRef: input.traceFactRef,
        description: `${input.npcRef} 执行了已经形成的战术计划。`,
        visibilityPolicyRef: "visibility:scene-observers",
      },
      alternateTarget: {
        targetRef: alternateTargetRef,
        reason: "原计划需要在当前可见战场中选择已冻结的替代目标。",
      },
    }),
    basisRefs: [...new Set([
      input.sceneRef,
      input.npcRef,
      input.premiseKnowledgeRef,
      alternateTargetRef,
    ])],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  }, `proposal:${rootActionId}:form-npc-actor-plan`);
}

export function executeNpcActorPlanDecision(
  rootActionId: string,
  input: {
    planRef: string;
    mechanicalProposal: JsonRecord;
    targetRef?: string;
  },
) {
  return {
    kind: "actorPlanDecision",
    decision: "execute",
    planId: input.planRef,
    mechanicalProposal: structuredClone(input.mechanicalProposal),
    ...(input.targetRef === undefined ? {} : { targetRef: input.targetRef }),
    proposalAttemptId: `proposal:${rootActionId}:execute-npc-actor-plan`,
  };
}

export function observationProposal(
  rootActionId: string,
  options: ProductionProposalOptions & {
    duration?: { unit: "round" | "second" | "minute" | "hour" | "day"; value: number };
  } = {},
) {
  const goal = options.goal ?? "确认当前可感知的现场状况";
  const method = options.method ?? "在当前位置谨慎观察";
  const refs = basisRefs(options);
  return privateFormProposal(rootActionId, "observe.v1", {
    goal,
    method,
    focus: goal,
    desiredInformation: "确认这次观察能够直接取得的信息",
    resolution: "direct",
    ...durationFields(options.duration),
    ...(refs.length === 0 ? {} : { basisRefs: refs }),
  }, options.proposalAttemptId);
}

/** Registers one genuinely new Scene and Passage, then asks Rules to move the
 * authenticated Form actor through it on the existing individual timeline. */
export function dynamicPassageMoveProposal(
  rootActionId: string,
  input: {
    sourceSceneRef: string;
    locationRef: string;
    destinationSceneRef: string;
    destinationName: string;
    passageRef: string;
    traversal: string;
    geometry: JsonRecord;
    causalBasisRefs?: string[];
    durationUnit?: "round" | "second" | "minute" | "hour" | "day";
    durationValue?: number;
  },
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: `沿${input.traversal}进入${input.destinationName}`,
    method: "materializePassageAndMove",
    proposedFact: JSON.stringify({
      schema: "zhuwei.dynamic-passage-move-draft/v1",
      locationRef: input.locationRef,
      destinationSceneRef: input.destinationSceneRef,
      destinationName: input.destinationName,
      passageRef: input.passageRef,
      traversal: input.traversal,
      geometry: structuredClone(input.geometry),
    }),
    basisRefs: [...new Set([
      input.sourceSceneRef,
      ...(input.causalBasisRefs ?? []),
    ])],
    resolution: "direct",
    durationUnit: input.durationUnit ?? "minute",
    durationValue: input.durationValue ?? 1,
  });
}

export function directConsequencesProposal(
  rootActionId: string,
  options: ProductionProposalOptions & {
    duration?: { unit: "round" | "second" | "minute" | "hour" | "day"; value: number };
    success?: JsonRecord[];
  } = {},
) {
  if (
    (options.dynamicMaterializations?.length ?? 0) > 0
    || (options.npcActions?.length ?? 0) > 0
    || (options.success?.length ?? 0) > 0
    || options.hiddenRealityCandidateSet !== undefined
      && options.hiddenRealityCandidateSet !== null
    || options.adjudicationPrecedent !== undefined
      && options.adjudicationPrecedent !== null
  ) {
    throw new Error("CURRENT_TEST_FORM_REQUIRES_EXACT_TYPED_MIGRATION");
  }
  return observationProposal(rootActionId, options);
}

export function noncombatCheckProposal(
  rootActionId: string,
  options: ProductionProposalOptions & {
    ability?: "str" | "dex" | "con" | "int" | "wis" | "cha";
    skill?: string | null;
    dc?: number;
    mode?: "normal" | "advantage" | "disadvantage";
    duration?: { unit: "round" | "second" | "minute" | "hour" | "day"; value: number };
    frozenCosts?: JsonRecord[];
    success?: JsonRecord[];
    failure?: JsonRecord[];
  } = {},
) {
  if (
    (options.success?.length ?? 0) > 0
    || (options.failure?.length ?? 0) > 0
    || (options.frozenCosts?.length ?? 0) > 0
    || options.adjudicationPrecedent !== undefined
      && options.adjudicationPrecedent !== null
  ) {
    throw new Error("CURRENT_TEST_CHECK_REQUIRES_EXACT_TYPED_MIGRATION");
  }
  const goal = options.goal ?? "完成玩家已经声明的检定";
  const method = options.method ?? "按玩家已经声明的做法行动";
  const risk = options.risk;
  const refs = basisRefs(options);
  const successConsequence = Array.isArray(risk?.successConsequences)
    && typeof risk.successConsequences[0] === "string"
    ? risk.successConsequences[0]
    : "行动成功并产生已冻结后果。";
  const failureConsequence = Array.isArray(risk?.failureConsequences)
    && typeof risk.failureConsequences[0] === "string"
    ? risk.failureConsequences[0]
    : "行动失败并产生已冻结后果。";
  return privateFormProposal(rootActionId, "observe.v1", {
    goal,
    method,
    focus: goal,
    desiredInformation: "确认检定所针对的现场事实",
    resolution: "check",
    ability: options.ability ?? "str",
    skill: options.skill ?? "athletics",
    dc: options.dc ?? 10,
    mode: options.mode ?? "normal",
    successConsequence,
    failureConsequence,
    ...durationFields(options.duration),
    ...(refs.length === 0 ? {} : { basisRefs: refs }),
  }, options.proposalAttemptId);
}
