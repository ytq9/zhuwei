import { canonicalJson, collectStrings, validateProposal } from "../kp/authoritative-helpers";
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
import {
  authoritativeModuleMigration,
  verifyAuthoritativeModuleMigration,
} from "../module/authoritative";
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
      "actionLanguageHash,actionPlanVersion,actorCharacterId,causalActionProgram,kind,rootActionId",
      "actionLanguageHash,actionPlanVersion,actorCharacterId,causalActionProgram,kind,rootActionId,trustedUtterance",
    ].includes(Object.keys(value).sort().join(","))
    || value.kind !== "resolveCompoundActionPlan"
    || value.actionPlanVersion !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    || value.actionLanguageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash
    || !isNonEmptyString(value.actorCharacterId)
    || !isNonEmptyString(value.rootActionId)
    || !isRecord(value.causalActionProgram)
    || (value.trustedUtterance !== undefined && !isNonEmptyString(value.trustedUtterance))) return false;
  const validation = validateCausalActionProgram(value.causalActionProgram);
  return validation.ok
    && value.causalActionProgram.languageRef === value.actionPlanVersion
    && value.causalActionProgram.languageHash === value.actionLanguageHash;
}

function isProfileRef(value: unknown): value is { profileId: string; profileHash: string } {
  return isRecord(value)
    && Object.keys(value).sort().join(",") === "profileHash,profileId"
    && isNonEmptyString(value.profileId)
    && typeof value.profileHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.profileHash);
}

function sameProfileRef(
  left: { profileId: string; profileHash: string },
  right: { profileId: string; profileHash: string },
): boolean {
  return left.profileId === right.profileId && left.profileHash === right.profileHash;
}

export type RoomModuleMigrationBinding =
  | { kind: "bound"; proposal: JsonObject }
  | { kind: "rejected" };

function normalizePrivateFormKpProposal(value: Record<string, unknown>): JsonObject | undefined {
  const allowedKeys = new Set([
    "kind", "formId", "draft", "causalActionProgram", "loweredCausalProgram",
    "semanticFreezeHash", "repairUsed", "proposalAttemptId", "modelInvocationReceipt",
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
      actionPlanVersion: program.languageRef,
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
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: program.languageRef,
    actionLanguageHash: program.languageHash,
    causalActionProgram: structuredClone(program) as unknown as JsonObject,
  };
}

/**
 * Replaces the three caller-visible migration refs with the exact Registry
 * record. A caller-provided hash is only a lookup claim: it never becomes the
 * Rules authority unless this adapter independently resolves and verifies the
 * pinned mapping against the Room's current Campaign binding.
 */
export async function bindRoomModuleMigration(
  proposal: JsonObject,
  currentModuleRefValue: unknown,
  moduleId: string,
): Promise<RoomModuleMigrationBinding> {
  const mechanical = isRecord(proposal.mechanicalProposal)
    ? proposal.mechanicalProposal
    : undefined;
  if (mechanical === undefined || mechanical.moduleMigration === undefined) {
    return { kind: "bound", proposal };
  }
  const request = mechanical.moduleMigration;
  if (
    mechanical.operation !== "advanceCampaignLifecycle"
    || mechanical.lifecycleAction !== "transitionChapter"
    || !isRecord(request)
    || Object.keys(request).sort().join(",") !== "fromModuleRef,migrationRef,toModuleRef"
    || !isProfileRef(request.fromModuleRef)
    || !isProfileRef(request.toModuleRef)
    || !isProfileRef(request.migrationRef)
    || !isProfileRef(currentModuleRefValue)
    || !sameProfileRef(request.fromModuleRef, currentModuleRefValue)
  ) return { kind: "rejected" };

  const prefix = `module:${moduleId}:`;
  if (
    !request.fromModuleRef.profileId.startsWith(prefix)
    || !request.toModuleRef.profileId.startsWith(prefix)
  ) return { kind: "rejected" };
  const fromVersion = request.fromModuleRef.profileId.slice(prefix.length);
  const toVersion = request.toModuleRef.profileId.slice(prefix.length);
  if (fromVersion.length === 0 || toVersion.length === 0 || fromVersion === toVersion) {
    return { kind: "rejected" };
  }

  try {
    const registered = await authoritativeModuleMigration(moduleId, fromVersion, toVersion);
    if (
      !await verifyAuthoritativeModuleMigration(registered)
      || !sameProfileRef(request.fromModuleRef, registered.fromModuleRef)
      || !sameProfileRef(request.toModuleRef, registered.toModuleRef)
      || !sameProfileRef(request.migrationRef, registered.migrationRef)
    ) return { kind: "rejected" };
    const { moduleMigration: _untrustedMigration, ...mechanicalWithoutRequest } = mechanical;
    return {
      kind: "bound",
      proposal: {
        ...structuredClone(proposal),
        mechanicalProposal: {
          ...structuredClone(mechanicalWithoutRequest),
          verifiedModuleMigration: structuredClone(registered),
        },
      },
    };
  } catch {
    return { kind: "rejected" };
  }
}

/**
 * Accepts one complete production KP draft envelope, or the exact
 * Room-generated capability for an authenticated pending answer.  Model
 * receipts and caller-supplied authority fields never cross this seam; the
 * Room adds the trusted actor/root immediately before Rules `step`.
 */
export function normalizeRoomKpProposal(value: unknown): JsonObject | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return undefined;
  if (value.kind === "privateFormProposal") return normalizePrivateFormKpProposal(value);
  if (value.kind === "authenticatedPendingAnswer") {
    const keys = Object.keys(value).sort();
    return keys.length === 2
      && keys[0] === "kind"
      && keys[1] === "rootActionId"
      && isNonEmptyString(value.rootActionId)
      ? structuredClone(value) as JsonObject
      : undefined;
  }

  const {
    rootActionId: _rootActionId,
    proposalAttemptId: _proposalAttemptId,
    modelInvocationReceipt: _modelInvocationReceipt,
    ...draftValue
  } = value;
  let draft;
  try {
    draft = validateProposal(draftValue);
  } catch {
    return undefined;
  }

  const pending = draft.pendingInput;
  if (pending !== null) {
    return {
      kind: pending.kind,
      prompt: pending.prompt,
      choices: pending.choices.map((choice) => ({
        choiceId: choice.id,
        label: choice.label,
        ...(pending.kind === "playerChoice" ? { consequence: choice.consequence } : {}),
      })),
      ...(isNonEmptyString(value.proposalAttemptId)
        ? { proposalAttemptId: value.proposalAttemptId }
        : {}),
    };
  }

  const mechanical = draft.mechanicalProposal;
  if (mechanical === null) return undefined;
  return {
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    feasibilityKind: draft.kind,
    goal: draft.goal,
    method: draft.method,
    publicBasisRefs: structuredClone(draft.publicBasisRefs),
    privateBasisRefs: structuredClone(draft.privateBasisRefs),
    adjudicationPrecedent: structuredClone(draft.adjudicationPrecedent),
    risk: structuredClone(draft.risk),
    dynamicMaterializations: structuredClone(draft.dynamicMaterializations),
    ...(draft.hiddenRealityCandidateSet == null
      ? {}
      : { hiddenRealityCandidateSet: structuredClone(draft.hiddenRealityCandidateSet) }),
    npcActions: structuredClone(draft.npcActions),
    scene: structuredClone(draft.scene),
    mechanicalProposal: structuredClone(mechanical),
  };
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
