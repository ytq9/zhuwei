import { canonicalJson, collectStrings } from "../kp/authoritative-helpers";
import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  compileKpFormDraft,
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
} from "../kp/causal-action-program";
import {
  KP_FORM_IDS,
  validateKpFormDraft,
  type KpFormId,
} from "../kp/form-catalog";
import { compileAbilityDefinition } from "../rules/profiles/ability-compiler";
import { ENVIRONMENT_PROFILE } from "../rules/profiles/environment";
import type { AuthoritativeWorldState } from "../rules";
import type { AuthoritativeCharacterSeed, JsonObject } from "./authority-types";

type CanonicalFixtureFact = {
  id: string;
  kind: string;
  subjectRefs: string[];
  value: unknown;
  visibilityPolicyId: string;
  source: "moduleAnchor";
};

type InitialFixtureKnowledge = {
  characterId: string;
  knowledgeRef: string;
  kind: "canonicalFact";
  layer: "full";
  content: unknown;
  visibility: "private";
  provenanceChain: string[];
};

export type InferredNpcFixture = {
  id: string;
  kind: "npc";
  name: string;
  sceneId: string;
  tenureStatus: "active";
  spatialVisibilityPolicyId: "visibility:hidden-until-evidence";
  spatialVisibilityFactId: string;
};

export type InitializationFixtureProjection = {
  canonicalFacts: CanonicalFixtureFact[];
  initialKnowledge: InitialFixtureKnowledge[];
  npcCharacters: InferredNpcFixture[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Resolves only a KP-submitted finite reference. Narrative text and labels
 * are intentionally absent from this authority seam. */
export function ownedEnvironmentAttackAbilityRef(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  draft: Readonly<Record<string, unknown>>,
): string | undefined {
  const source = state.combatRuntime.entities[actorCharacterId];
  const requestedAbilityRef = draft.abilityRef;
  if (!isRecord(source)
    || !Array.isArray(source.abilityRefs)
    || !isNonEmptyString(requestedAbilityRef)
    || !source.abilityRefs.includes(requestedAbilityRef)) return undefined;
  const definition = state.combatRuntime.definitions[requestedAbilityRef];
  if (!isRecord(definition) || !compileAbilityDefinition(definition).ok) return undefined;
  const target = isRecord(definition.target) ? definition.target : undefined;
  const damage = Array.isArray(definition.damage) ? definition.damage.filter(isRecord) : [];
  if (target?.kind !== "creatureOrEnvironmentFeature" || damage.length !== 1) return undefined;
  const approach = String(draft.attackApproach);
  const definitionKind = String(definition.definitionKind ?? "").toLowerCase();
  const ranged = isNonEmptyString(target.rangeInches) || isNonEmptyString(target.rangeNormalInches);
  const melee = isNonEmptyString(target.reachInches);
  if ((approach === "spell" && definitionKind !== "spell")
    || (approach === "ranged" && !ranged)
    || (approach === "melee" && !melee)
    || !["any", "spell", "ranged", "melee"].includes(approach)) return undefined;
  return requestedAbilityRef;
}

/** Canonical serialized V3 Rules input used by the DO recovery journal. The
 * Rules interpreter revalidates executable semantics at execution time; this
 * seam prevents a forged version/profile/key surface from entering recovery. */
export function isCanonicalV3CausalRulesInput(value: unknown): value is JsonObject {
  if (!isRecord(value)
    || ![
      "actionLanguageHash,actionLanguageRef,actorCharacterId,causalActionProgram,kind,rootActionId",
      "actionLanguageHash,actionLanguageRef,actorCharacterId,causalActionProgram,kind,rootActionId,trustedUtterance",
    ].includes(Object.keys(value).sort().join(","))
    || value.kind !== "executeCausalActionProgram"
    || value.actionLanguageRef !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    || value.actionLanguageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash
    || !isNonEmptyString(value.actorCharacterId)
    || !isNonEmptyString(value.rootActionId)
    || !isRecord(value.causalActionProgram)
    || (value.trustedUtterance !== undefined && !isNonEmptyString(value.trustedUtterance))) return false;
  const validation = validateCausalActionProgram(value.causalActionProgram);
  return validation.ok
    && value.causalActionProgram.languageRef === value.actionLanguageRef
    && value.causalActionProgram.languageHash === value.actionLanguageHash;
}

function normalizePrivateFormKpProposal(value: Record<string, unknown>): JsonObject | undefined {
  const allowedKeys = new Set([
    "kind", "formId", "draft", "causalActionProgram", "loweredCausalProgram",
    "finalSemanticHash", "semanticFreezeHash", "repairUsed", "proposalAttemptId", "modelInvocationReceipt",
    "rootActionId",
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key))
    ||
    value.kind !== "privateFormProposal"
    || typeof value.formId !== "string"
    || !(KP_FORM_IDS as readonly string[]).includes(value.formId)
    || !isRecord(value.draft)
    || !isRecord(value.causalActionProgram)
    || !isRecord(value.loweredCausalProgram)
    || typeof value.semanticFreezeHash !== "string"
    || !/^fnv1a64:[0-9a-f]{16}$/u.test(value.semanticFreezeHash)
    || (value.finalSemanticHash !== undefined
      && (typeof value.finalSemanticHash !== "string"
        || !/^fnv1a64:[0-9a-f]{16}$/u.test(value.finalSemanticHash)))
    || typeof value.repairUsed !== "boolean"
    || !isNonEmptyString(value.proposalAttemptId)
    || !isRecord(value.modelInvocationReceipt)
  ) return undefined;
  const formId = value.formId as KpFormId;
  if (!validateKpFormDraft(formId, value.draft).ok) return undefined;
  let program: CausalActionProgram;
  try {
    program = compileKpFormDraft(formId, value.draft);
  } catch {
    return undefined;
  }
  if (
    canonicalJson(program) !== canonicalJson(value.causalActionProgram)
    || canonicalJson(lowerCausalActionProgram(program)) !== canonicalJson(value.loweredCausalProgram)
  ) return undefined;

  if (
    formId === "environmental-stunt.v1"
    && value.draft.featureDisposition !== "explicitly-absent"
  ) {
    // The environment Rules profile owns this specialized lowering. It is
    // connected only when the matching manifest is installed.
    return {
      kind: "resolveDynamicEnvironmentStunt",
      environmentProgramVersion: ENVIRONMENT_PROFILE.profileId,
      actionLanguageRef: program.languageRef,
      actionLanguageHash: program.languageHash,
      formProgramHash: program.semanticHash,
      causalActionProgram: structuredClone(program) as unknown as JsonObject,
      draft: structuredClone(value.draft) as JsonObject,
    };
  }

  // Room supplies only the authenticated actor/root. Rules owns every
  // semantic validation and transition derived from the complete frozen
  // causal program; V3 is never relabelled as the historical ActionPlan v1.
  return {
    kind: "executeCausalActionProgram",
    actionLanguageRef: program.languageRef,
    actionLanguageHash: program.languageHash,
    causalActionProgram: structuredClone(program) as unknown as JsonObject,
  };
}

/**
 * Accepts one current private-Form envelope or an exact Room-generated
 * authenticated capability. Model receipts and caller-supplied authority
 * fields never cross this seam; Room adds the trusted actor/root immediately
 * before Rules `step`.
 */
export function normalizeRoomKpProposal(value: unknown): JsonObject | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return undefined;
  if (value.kind === "privateFormProposal") return normalizePrivateFormKpProposal(value);
  if (value.kind === "authenticatedPartyAction") {
    const exact = (...keys: string[]) =>
      Object.keys(value).sort().join(",") === [...keys, "action", "kind", "rootActionId"].sort().join(",");
    if (!isNonEmptyString(value.rootActionId)) return undefined;
    if (value.action === "inviteMember" || value.action === "transferLeadership") {
      return exact("targetCharacterId") && isNonEmptyString(value.targetCharacterId)
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    if (value.action === "cancelInvitation") {
      return exact("pendingInputId") && isNonEmptyString(value.pendingInputId)
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    if (value.action === "leave") {
      return exact() ? structuredClone(value) as JsonObject : undefined;
    }
    if (value.action === "proposeMove" || value.action === "moveIndividually") {
      return exact("destinationSceneId", "fictionTimeCostMicros")
          && isNonEmptyString(value.destinationSceneId)
          && typeof value.fictionTimeCostMicros === "string"
          && /^[1-9][0-9]*$/u.test(value.fictionTimeCostMicros)
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    return undefined;
  }
  if (value.kind === "authenticatedCampaignAction") {
    const exact = (...keys: string[]) =>
      Object.keys(value).sort().join(",") === [...keys, "action", "kind", "rootActionId"].sort().join(",");
    if (!isNonEmptyString(value.rootActionId)) return undefined;
    if (value.action === "retireCharacter") {
      return exact("continueAsNpc", "reason")
          && typeof value.continueAsNpc === "boolean"
          && isNonEmptyString(value.reason)
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    if (value.action === "startActivity") {
      return exact("activityId", "activityKind", "completion", "intendedDurationMicros")
          && isNonEmptyString(value.activityId)
          && isNonEmptyString(value.activityKind)
          && isRecord(value.completion)
          && typeof value.intendedDurationMicros === "string"
          && /^[1-9][0-9]*$/u.test(value.intendedDurationMicros)
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    if (value.action === "formNpcPlan") {
      return exact(
        "activity",
        "alternateTarget",
        "due",
        "goal",
        "nextAction",
        "npcId",
        "planId",
        "premiseRefs",
        "resourceRefs",
        "trace",
        "trigger",
      )
          && [value.goal, value.nextAction, value.npcId, value.planId].every(isNonEmptyString)
          && [value.premiseRefs, value.resourceRefs].every(Array.isArray)
          && isRecord(value.activity)
          && isRecord(value.alternateTarget)
          && isRecord(value.trace)
          && (value.due === null || isRecord(value.due))
          && (value.trigger === null || isRecord(value.trigger))
        ? structuredClone(value) as JsonObject
        : undefined;
    }
    return undefined;
  }
  if (value.kind === "authenticatedPendingAnswer") {
    const keys = Object.keys(value).sort();
    return keys.length === 2
      && keys[0] === "kind"
      && keys[1] === "rootActionId"
      && isNonEmptyString(value.rootActionId)
      ? structuredClone(value) as JsonObject
      : undefined;
  }

  return undefined;
}

function fixtureNpcName(npcId: string): string {
  const suffix = npcId.startsWith("npc:") ? npcId.slice(4) : npcId;
  return suffix.length > 0 ? suffix : npcId;
}

/**
 * Turns trusted initialization fixtures into canonical Rules genesis inputs.
 * The fixtures are intentionally narrow: a communication channel becomes a
 * world fact, while a holder-scoped knowledge seed also infers the finite NPC
 * whose private projection owns it. Unknown fixture shapes fail closed.
 */
export function projectInitializationFixtures(
  fixtureFacts: unknown,
  playerCharacters: AuthoritativeCharacterSeed[],
): InitializationFixtureProjection | undefined {
  if (fixtureFacts === undefined) {
    return { canonicalFacts: [], initialKnowledge: [], npcCharacters: [] };
  }
  if (!Array.isArray(fixtureFacts)) return undefined;

  const playerIds = new Set(playerCharacters.map((entry) => entry.characterId));
  const fallbackSceneId = playerCharacters.find((entry) => entry.staticCard.sceneId === "yard")
    ?.staticCard.sceneId ?? playerCharacters[0]?.staticCard.sceneId;
  if (fallbackSceneId === undefined) return undefined;

  const npcIds = new Set<string>();
  const npcMetadata = new Map<string, { name: string; sceneId: string }>();
  for (const fixture of fixtureFacts) {
    if (!isRecord(fixture)) return undefined;
    if (isNonEmptyString(fixture.knowledgeRef) && isNonEmptyString(fixture.holderEntityId)) {
      if (!playerIds.has(fixture.holderEntityId)) {
        npcIds.add(fixture.holderEntityId);
        npcMetadata.set(fixture.holderEntityId, {
          name: isNonEmptyString(fixture.holderName)
            ? fixture.holderName
            : fixtureNpcName(fixture.holderEntityId),
          sceneId: isNonEmptyString(fixture.sceneId) ? fixture.sceneId : fallbackSceneId,
        });
      }
      continue;
    }
    if (
      isNonEmptyString(fixture.factRef)
      && fixture.kind === "establishedCommunicationChannel"
      && Array.isArray(fixture.participants)
      && fixture.participants.length >= 2
      && fixture.participants.every(isNonEmptyString)
    ) {
      continue;
    }
    return undefined;
  }

  const allEntityIds = new Set([...playerIds, ...npcIds]);
  const canonicalFacts: CanonicalFixtureFact[] = [];
  const initialKnowledge: InitialFixtureKnowledge[] = [];
  const seenFactIds = new Set<string>();
  const seenKnowledge = new Set<string>();

  for (const fixture of fixtureFacts) {
    if (!isRecord(fixture)) return undefined;
    if (isNonEmptyString(fixture.factRef)) {
      const participants = Array.isArray(fixture.participants)
        ? fixture.participants.filter(isNonEmptyString)
        : [];
      if (
        seenFactIds.has(fixture.factRef)
        || participants.length < 2
        || participants.some((entry) => !allEntityIds.has(entry))
      ) return undefined;
      seenFactIds.add(fixture.factRef);
      canonicalFacts.push({
        id: fixture.factRef,
        kind: "establishedCommunicationChannel",
        subjectRefs: [...participants].sort(),
        value: { participants: [...participants].sort(), established: true },
        visibilityPolicyId: "visibility:channel-participants",
        source: "moduleAnchor",
      });
      continue;
    }

    const knowledgeRef = fixture.knowledgeRef;
    const holderEntityId = fixture.holderEntityId;
    if (!isNonEmptyString(knowledgeRef) || !isNonEmptyString(holderEntityId)) return undefined;
    const key = `${holderEntityId}\u0000${knowledgeRef}`;
    if (seenKnowledge.has(key) || !allEntityIds.has(holderEntityId)) return undefined;
    seenKnowledge.add(key);
    initialKnowledge.push({
      characterId: holderEntityId,
      knowledgeRef,
      kind: "canonicalFact",
      layer: "full",
      content: fixture.content === undefined
        ? { knowledgeRef, holderEntityId }
        : structuredClone(fixture.content),
      visibility: "private",
      provenanceChain: [`fixture:${knowledgeRef}`],
    });
  }

  const npcCharacters = [...npcIds].sort().map((id) => {
    const visibilityFactId = initialKnowledge.find((entry) => entry.characterId === id)?.knowledgeRef;
    if (visibilityFactId === undefined) throw new TypeError("fixture NPC lacks finite knowledge");
    return {
      id,
      kind: "npc" as const,
      name: npcMetadata.get(id)?.name ?? fixtureNpcName(id),
      sceneId: npcMetadata.get(id)?.sceneId ?? fallbackSceneId,
      tenureStatus: "active" as const,
      spatialVisibilityPolicyId: "visibility:hidden-until-evidence" as const,
      spatialVisibilityFactId: visibilityFactId,
    };
  });
  canonicalFacts.sort((left, right) => left.id.localeCompare(right.id));
  initialKnowledge.sort((left, right) =>
    left.characterId.localeCompare(right.characterId)
      || left.knowledgeRef.localeCompare(right.knowledgeRef));
  return { canonicalFacts, initialKnowledge, npcCharacters };
}

/** Preserve the Rules projector as the sole knowledge boundary while adapting
 * its generic subject id into the Room/KP viewer contract. */
export function roomPlayerProjection(projection: JsonObject, characterId: string): JsonObject {
  return {
    ...projection,
    viewer: { kind: "player", characterId },
  };
}

/**
 * Narration gets only observer-safe material derived from that observer's
 * Rules projection. The per-character text prevents one viewer's current
 * Delivery body from becoming a cross-viewer correlation oracle.
 */
export function narrationProjection(
  projection: JsonObject,
  characterId: string,
  _receiptId: string,
  entityCatalog: Readonly<Record<string, unknown>> = {},
): JsonObject {
  const playerProjection = roomPlayerProjection(projection, characterId);
  // Room membership, Party coordination, and the global Spotlight ledger are
  // useful UI coordination metadata, but they are not fictional observations.
  // Keeping them in a narration prompt would let an otherwise observer-safe
  // current response name characters who are not present in this scene.  The
  // Rules projector remains the sole source projection; this adapter only
  // narrows that projection for the one-shot narration purpose.
  const {
    roomMembers: _roomMembers,
    partyGroups: _partyGroups,
    spotlightLedger: _spotlightLedger,
    ...observerNarrationProjection
  } = playerProjection;
  const committedDelta = isRecord(observerNarrationProjection.committedDelta)
    ? structuredClone(observerNarrationProjection.committedDelta)
    : undefined;
  const committedChanges = committedDelta !== undefined && Array.isArray(committedDelta.changes)
    ? committedDelta.changes.filter(isRecord)
    : [];
  const pressure = committedChanges.find((change) => isNonEmptyString(change.pressure))?.pressure;
  const opportunities = committedChanges.flatMap((change) =>
    Array.isArray(change.opportunities)
      ? change.opportunities.filter(isNonEmptyString)
      : []);
  const observableStrings = collectStrings(observerNarrationProjection);
  const agencySubjects: Array<{
    subjectKind: "playerCharacter" | "npc";
    subjectRef: string;
  }> = [];
  for (const [subjectRef, entity] of Object.entries(entityCatalog)) {
    if (!observableStrings.has(subjectRef) || !isRecord(entity)) continue;
    if (entity.kind === "player") {
      agencySubjects.push({ subjectKind: "playerCharacter", subjectRef });
    } else if (entity.kind === "npc") {
      agencySubjects.push({ subjectKind: "npc", subjectRef });
    }
  }
  agencySubjects.sort((left, right) => left.subjectRef.localeCompare(right.subjectRef));
  return {
    ...observerNarrationProjection,
    agencySubjects,
    narration: {
      ...(committedDelta === undefined ? {} : { committedDelta }),
      pressure: isNonEmptyString(pressure) ? pressure : "",
      opportunities: [...new Set(opportunities)].slice(0, 8),
      decisionPrompt: `决定权交还 ${characterId}：你接下来怎么做？`,
    },
  };
}

/** Builds the singular outer Room story summary only from facts already made
 * visible by Rules project(viewer); hidden story facts never enter this seam. */
export function projectedStorySummary(projection: JsonObject): JsonObject | undefined {
  const stories = Array.isArray(projection.stories)
    ? projection.stories.filter(isRecord)
    : [];
  const canonicalConclusion = [...stories].reverse().find((entry) =>
    entry.status === "concluded"
    && isNonEmptyString(entry.storyId)
    && isNonEmptyString(entry.endingCandidateId));
  if (canonicalConclusion !== undefined) {
    const epilogues = Array.isArray(projection.epilogues)
      ? projection.epilogues.filter(isRecord)
      : [];
    const epilogue = [...epilogues].reverse().find((entry) =>
      entry.storyId === canonicalConclusion.storyId
      && isNonEmptyString(entry.characterId)
      && isNonEmptyString(entry.choice));
    const sequel = [...stories].reverse().find((entry) =>
      entry.status === "active"
      && entry.priorStoryId === canonicalConclusion.storyId
      && isNonEmptyString(entry.sequelStoryId));
    return {
      status: "concluded",
      storyRef: canonicalConclusion.storyId,
      endingCandidateRef: canonicalConclusion.endingCandidateId,
      epilogue: epilogue === undefined
        ? null
        : { characterId: epilogue.characterId, choice: epilogue.choice },
      sequel: sequel === undefined
        ? null
        : {
            storyRef: sequel.sequelStoryId,
            chapterRef: sequel.chapterId,
          },
    };
  }
  const visibleFacts = Array.isArray(projection.visibleFacts)
    ? projection.visibleFacts.filter(isRecord)
    : [];
  const conclusion = [...visibleFacts].reverse().find((entry) => entry.kind === "storyConclusion");
  const conclusionValue = conclusion !== undefined && isRecord(conclusion.value)
    ? conclusion.value
    : undefined;
  if (
    conclusionValue === undefined
    || conclusionValue.status !== "concluded"
    || !isNonEmptyString(conclusionValue.endingCandidateRef)
  ) return undefined;
  const epilogueFact = [...visibleFacts].reverse().find((entry) => {
    if (entry.kind !== "epilogueChoice" || !isRecord(entry.value)) return false;
    return entry.value.endingCandidateRef === conclusionValue.endingCandidateRef;
  });
  const epilogueValue = epilogueFact !== undefined && isRecord(epilogueFact.value)
    ? epilogueFact.value
    : undefined;
  return {
    status: "concluded",
    endingCandidateRef: conclusionValue.endingCandidateRef,
    epilogue: epilogueValue === undefined
      ? null
      : {
          characterId: epilogueValue.characterId,
          choice: epilogueValue.choice,
        },
    sequel: null,
  };
}
