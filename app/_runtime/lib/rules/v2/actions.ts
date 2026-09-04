import { canonicalSha256 } from "../profiles/canonical";
import { environmentProfileEnabled } from "../profiles/environment";
import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalGeometry,
} from "../profiles/tactical-geometry";
import type { TacticalPosition } from "../tactical-projection";
import type { RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import { standardGearResolverForProfile } from "../profiles/standard-gear";
import {
  createEventTransition,
  createScopeProof,
} from "./events";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  AwaitingRandomnessRulesResult,
  AwaitingInputRulesResult,
  CanonicalFactRecord,
  CharacterRecord,
  CommittedRulesResult,
  ContestResolutionPlan,
  EventEnvelope,
  EventPayloadByType,
  FrozenCheck,
  InitializedRulesResult,
  JsonRecord,
  KnowledgeRecord,
  PublicReceipt,
  RandomnessRequest,
  RuntimeGenesis,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  fulfillRestRandomness,
  settleDueActivityBeforeInput,
  stepCampaignWorld,
} from "./campaign-actions";
import { stepCombatWorld } from "./combat-actions";
import { correctionPlan, emptyCorrectionRuntime } from "./correction";
import { emptyMultiplayerRuntime, initialMultiplayerFictionTimelines } from "./multiplayer-model";
import { stepMultiplayerWorld } from "./multiplayer-actions";
import {
  fulfillActorPlanRandomness,
  stepActorPlanMechanics,
} from "./compound-actions";
import {
  fulfillCausalActionProgramRandomness,
  fulfillCausalActionProgramRandomnessBatch,
  fulfillHiddenRealityRandomness,
  stepCausalActionProgram,
} from "./causal-actions";
import { continueCompoundRoot } from "./internal-compound";
import { stepSafetyWorld } from "./safety";
import { stepEnvironmentWorld } from "./environment";
import {
  buildNpcSpatialEntity,
  buildPlayerCombatEntity,
  compileStaticCharacterCombat,
} from "./character-abilities";
import { experienceThresholdForLevel } from "./character-progression";
import {
  deriveCharacterLoadoutFromItems,
  mergeInitialStandardLoadout,
} from "./item-transitions";
import {
  createInitialItemEntry,
  emptyItemSystemState,
  isItemDefinitionV1,
  isItemSystemStateV1,
  type InitialItemEntryInput,
  type ItemDefinitionV1,
} from "./items";
import {
  isStoredSemanticDefinition,
  type StoredSemanticDefinition,
} from "./semantic-definitions";
import { characterProficiencyFieldsMatchProfile } from "./proficiency";
import { isNpcSocialMechanics, socialUtteranceFingerprint } from "./social-model";
import {
  answerSocialResolution,
  fulfillSocialResolutionRandomness,
  supersedeSocialResolutionPending,
} from "./social-actions";
import {
  fulfillVNextWorldInteractionRandomness,
  stepVNextWorldInteraction,
} from "./world-interactions";
import {
  CANONICAL_SIGNED_INTEGER_PATTERN,
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
  hasExactKeys,
  hasOnlyKeys,
  hashWorldState,
  isCharacterLoadout,
  isAuthoritativeWorldState,
  isNonEmptyString,
  isProfileRef,
  isRecord,
  isSha256,
  unsignedGenesis,
} from "./validation";

const INITIALIZE_KEYS = [
  "activeBranchId",
  "canonicalFacts",
  "characterControls",
  "characters",
  "fictionInstantMicros",
  "initialDefinitionCatalogRef",
  "initialKnowledge",
  "kind",
  "moduleRef",
  "principals",
  "roomId",
  "runtimeEpochId",
  "scenes",
  "seats",
] as const;

const OPTIONAL_INITIALIZE_KEYS = ["advancementProfile", "vNextSeed"] as const;

function uniqueById(entries: JsonRecord[]): boolean {
  return new Set(entries.map(({ id }) => id)).size === entries.length;
}

function recordById<T extends { id: string }>(entries: T[]): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => [entry.id, entry]),
  );
}

function validateInitializationCollections(
  input: JsonRecord,
  profiles: RuntimeProfileManifest,
): boolean {
  if (
    !Array.isArray(input.scenes)
    || !Array.isArray(input.principals)
    || !Array.isArray(input.seats)
    || !Array.isArray(input.characters)
    || !Array.isArray(input.characterControls)
    || !Array.isArray(input.canonicalFacts)
    || !Array.isArray(input.initialKnowledge)
  ) {
    return false;
  }

  const scenes = input.scenes;
  const principals = input.principals;
  const seats = input.seats;
  const characters = input.characters;
  const controls = input.characterControls;
  const facts = input.canonicalFacts;
  const knowledge = input.initialKnowledge;

  return scenes.every((scene) => isRecord(scene)
      && hasOnlyKeys(scene, ["id", "name"], ["geometry"])
      && isNonEmptyString(scene.id)
      && isNonEmptyString(scene.name)
      && (scene.geometry === undefined || isCanonicalTacticalGeometry(scene.geometry)))
    && principals.every((principal) => isRecord(principal)
      && hasOnlyKeys(principal, ["id", "sessionVersion"], ["role"])
      && isNonEmptyString(principal.id)
      && Number.isSafeInteger(principal.sessionVersion)
      && Number(principal.sessionVersion) > 0
      && (principal.role === undefined || ["host", "player", "observer"].includes(String(principal.role))))
    && seats.every((seat) => isRecord(seat)
      && hasExactKeys(seat, ["id", "principalId", "status"])
      && isNonEmptyString(seat.id)
      && isNonEmptyString(seat.principalId)
      && (seat.status === "active" || seat.status === "inactive"))
    && characters.every((character) => isRecord(character)
      && hasOnlyKeys(
        character,
        ["id", "kind", "name", "sceneId", "tenureStatus"],
        [
          "abilityScores",
          "cantripIds",
          "characterBuild",
          "classId",
          "featureIds",
          "experiencePoints",
          "expertiseSkills",
          "hitPoints",
          "lastControllerSeatId",
          "lastLongRestCompletedAtMicros",
          "level",
          "loadout",
          "preparedSpellIds",
          "proficiencyBonus",
          "proficientSkills",
          "proficientSaves",
          "raceId",
          "resourceMaximums",
          "resources",
          "socialMechanics",
          "spatialVisibilityFactId",
          "spatialVisibilityPolicyId",
          "subclassId",
        ],
      )
      && isNonEmptyString(character.id)
      && (character.kind === "player" || character.kind === "npc")
      && isNonEmptyString(character.name)
      && isNonEmptyString(character.sceneId)
      && ["active", "dead", "retired", "missing", "npcTransitioned"]
        .includes(String(character.tenureStatus))
      && (character.level === undefined
        || (Number.isSafeInteger(character.level) && Number(character.level) > 0))
      && (character.experiencePoints === undefined
        || (character.kind === "player"
          && Number.isSafeInteger(character.experiencePoints)
          && Number(character.experiencePoints) >= 0))
      && (character.lastLongRestCompletedAtMicros === undefined
        || (typeof character.lastLongRestCompletedAtMicros === "string"
          && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(character.lastLongRestCompletedAtMicros)))
      && (character.hitPoints === undefined
        || (isRecord(character.hitPoints)
          && hasExactKeys(character.hitPoints, ["current", "maximum"])
          && Number.isSafeInteger(character.hitPoints.current)
          && Number.isSafeInteger(character.hitPoints.maximum)
          && Number(character.hitPoints.current) >= 0
          && Number(character.hitPoints.maximum) > 0
          && Number(character.hitPoints.current) <= Number(character.hitPoints.maximum)))
      && (character.resources === undefined
        || (isRecord(character.resources)
          && Object.entries(character.resources).every(([resourceId, amount]) =>
            isNonEmptyString(resourceId) && Number.isSafeInteger(amount) && Number(amount) >= 0)))
      && (character.resourceMaximums === undefined
        || (isRecord(character.resourceMaximums)
          && Object.entries(character.resourceMaximums).every(([resourceId, maximum]) =>
            isNonEmptyString(resourceId) && Number.isSafeInteger(maximum) && Number(maximum) >= 0)))
      && (character.abilityScores === undefined
        || (isRecord(character.abilityScores)
          && hasExactKeys(character.abilityScores, ["cha", "con", "dex", "int", "str", "wis"])
          && Object.values(character.abilityScores).every((score) =>
            Number.isSafeInteger(score) && Number(score) >= 1 && Number(score) <= 30)))
      && (character.proficiencyBonus === undefined
        || (Number.isSafeInteger(character.proficiencyBonus)
          && Number(character.proficiencyBonus) >= 0
          && Number(character.proficiencyBonus) <= 12))
      && (character.socialMechanics === undefined
        || (character.kind === "npc"
          && socialResolutionProfileEnabled(profiles.extensions)
          && isNpcSocialMechanics(character.socialMechanics)
          && isRecord(character.abilityScores)
          && canonicalSha256(character.abilityScores)
            === canonicalSha256(character.socialMechanics.abilityScores)
          && character.proficiencyBonus === character.socialMechanics.proficiencyBonus))
      && (character.proficientSkills === undefined
        || (Array.isArray(character.proficientSkills)
          && character.proficientSkills.every(isNonEmptyString)
          && character.proficientSkills.length === new Set(character.proficientSkills).size))
      && characterProficiencyFieldsMatchProfile(profiles, character)
      && [character.classId, character.raceId, character.subclassId, character.lastControllerSeatId]
        .every((entry) => entry === undefined || isNonEmptyString(entry))
      && (character.spatialVisibilityPolicyId === undefined
        || character.spatialVisibilityPolicyId === "visibility:scene-observers"
        || character.spatialVisibilityPolicyId === "visibility:hidden-until-evidence")
      && (character.spatialVisibilityFactId === undefined
        || (character.spatialVisibilityPolicyId === "visibility:hidden-until-evidence"
          && isNonEmptyString(character.spatialVisibilityFactId)))
      && [character.cantripIds, character.preparedSpellIds, character.featureIds]
        .every((entry) => entry === undefined || (Array.isArray(entry)
          && entry.every(isNonEmptyString) && entry.length === new Set(entry).size))
      && (character.characterBuild === undefined || isRecord(character.characterBuild))
      && (character.loadout === undefined || isCharacterLoadout(character.loadout)))
    && controls.every((control) => isRecord(control)
      && hasExactKeys(control, ["characterId", "seatId"])
      && isNonEmptyString(control.characterId)
      && isNonEmptyString(control.seatId))
    && facts.every((fact) => isRecord(fact)
      && hasExactKeys(fact, ["id", "kind", "source", "subjectRefs", "value", "visibilityPolicyId"])
      && isNonEmptyString(fact.id)
      && isNonEmptyString(fact.kind)
      && Array.isArray(fact.subjectRefs)
      && fact.subjectRefs.every(isNonEmptyString)
      && isNonEmptyString(fact.visibilityPolicyId)
      && [
        "moduleAnchor",
        "dynamicMaterialization",
        "observedEvent",
        "mechanicalResolution",
        "characterAction",
        "npcOrFactionAction",
        "correction",
      ].includes(String(fact.source)))
    && knowledge.every((entry) => isRecord(entry)
      && hasExactKeys(entry, [
        "characterId",
        "content",
        "kind",
        "knowledgeRef",
        "layer",
        "provenanceChain",
        "visibility",
      ])
      && isNonEmptyString(entry.characterId)
      && isNonEmptyString(entry.knowledgeRef)
      && ["sensoryEvidence", "sourceClaim", "characterInference", "canonicalFact"]
        .includes(String(entry.kind))
      && ["hint", "partial", "full"].includes(String(entry.layer))
      && ["private", "shared", "publiclyObservable"].includes(String(entry.visibility))
      && Array.isArray(entry.provenanceChain)
      && entry.provenanceChain.every(isNonEmptyString))
    && uniqueById(scenes)
    && uniqueById(principals)
    && uniqueById(seats)
    && uniqueById(characters)
    && uniqueById(facts);
}

type VNextSeed = {
  semanticDefinitions: StoredSemanticDefinition[];
  itemDefinitions: ItemDefinitionV1[];
  itemEntries: Array<{
    definitionRef: string;
    entry: InitialItemEntryInput;
  }>;
  entityDefinitionBindings: Array<{
    entityRef: string;
    definitionRef: string;
  }>;
};

function vNextSeedValue(
  input: JsonRecord,
  profiles: RuntimeProfileManifest,
): VNextSeed | undefined | null {
  if (input.vNextSeed === undefined) return undefined;
  if (!worldInteractionProfileEnabled(profiles.extensions)
    || !isRecord(input.vNextSeed)
    || !hasExactKeys(input.vNextSeed, [
      "entityDefinitionBindings", "itemDefinitions", "itemEntries", "semanticDefinitions",
    ])) return null;
  const seed = input.vNextSeed;
  if (!Array.isArray(seed.semanticDefinitions)
    || !seed.semanticDefinitions.every(isStoredSemanticDefinition)
    || !Array.isArray(seed.itemDefinitions)
    || !seed.itemDefinitions.every(isItemDefinitionV1)
    || !Array.isArray(seed.itemEntries)
    || !seed.itemEntries.every((value) => isRecord(value)
      && hasExactKeys(value, ["definitionRef", "entry"])
      && isNonEmptyString(value.definitionRef)
      && isRecord(value.entry)
      && hasOnlyKeys(value.entry, ["entryId", "ownership", "placement", "quantity"], [
        "visibilityPolicyRef",
      ]))
    || !Array.isArray(seed.entityDefinitionBindings)
    || !seed.entityDefinitionBindings.every((value) => isRecord(value)
      && hasExactKeys(value, ["definitionRef", "entityRef"])
      && isNonEmptyString(value.definitionRef)
      && isNonEmptyString(value.entityRef))) return null;
  const semanticDefinitions = seed.semanticDefinitions as StoredSemanticDefinition[];
  const itemDefinitions = seed.itemDefinitions as ItemDefinitionV1[];
  const itemEntries = seed.itemEntries as VNextSeed["itemEntries"];
  const bindings = seed.entityDefinitionBindings as VNextSeed["entityDefinitionBindings"];
  if (new Set(semanticDefinitions.map(({ definitionId }) => definitionId)).size
      !== semanticDefinitions.length
    || new Set(itemDefinitions.map(({ definitionId }) => definitionId)).size
      !== itemDefinitions.length
    || new Set(itemEntries.map(({ entry }) => entry.entryId)).size !== itemEntries.length
    || new Set(bindings.map(({ entityRef }) => entityRef)).size !== bindings.length) return null;
  return {
    semanticDefinitions: structuredClone(semanticDefinitions),
    itemDefinitions: structuredClone(itemDefinitions),
    itemEntries: structuredClone(itemEntries),
    entityDefinitionBindings: structuredClone(bindings),
  };
}

function semanticSeedCatalog(
  seed: VNextSeed | undefined,
  entities: Record<string, CharacterRecord>,
): Record<string, JsonRecord> | undefined {
  if (seed === undefined) return {};
  const catalog = Object.fromEntries(seed.semanticDefinitions
    .map((definition) => [definition.definitionId, structuredClone(definition)]));
  for (const definition of seed.semanticDefinitions) {
    const template = catalog[definition.templateRef];
    const selfTemplate = definition.templateRef === definition.definitionId
      && definition.templateHash === definition.definitionHash;
    if (!selfTemplate
      && (!isStoredSemanticDefinition(template)
        || template.definitionHash !== definition.templateHash)) return undefined;
  }
  for (const binding of seed.entityDefinitionBindings) {
    const entity = entities[binding.entityRef];
    const definition = catalog[binding.definitionRef];
    if (entity === undefined
      || !isStoredSemanticDefinition(definition)
      || definition.semanticKind !== "npc"
      || entity.kind !== "npc"
      || !isRecord(definition.content.links)
      || definition.content.links.entityRef !== entity.id) return undefined;
    entity.semanticDefinitionRef = definition.definitionId;
    entity.semanticDefinitionRevision = definition.revision;
  }
  for (const definition of seed.semanticDefinitions.filter(({ semanticKind }) => semanticKind === "npc")) {
    if (!isRecord(definition.content.links)
      || !isNonEmptyString(definition.content.links.entityRef)
      || entities[definition.content.links.entityRef]?.kind !== "npc"
      || entities[definition.content.links.entityRef]?.semanticDefinitionRef !== definition.definitionId) {
      return undefined;
    }
  }
  return catalog;
}

function stateEntityUnavailable(
  entities: Record<string, CharacterRecord>,
  entityRef: string | null,
): boolean {
  return entityRef === null || entities[entityRef] === undefined;
}

function buildInitialState(
  input: JsonRecord,
  profiles: RuntimeProfileManifest,
): AuthoritativeWorldState | undefined {
  if (!validateInitializationCollections(input, profiles)) {
    return undefined;
  }
  const vNextSeed = vNextSeedValue(input, profiles);
  if (vNextSeed === null) return undefined;
  const sceneInputs = input.scenes as Array<{
    id: string;
    name: string;
    geometry?: CanonicalTacticalGeometry;
  }>;
  if (!sceneInputs.every((scene) => scene.geometry === undefined
    || scene.geometry.obstacles.every((feature) => feature.environment === undefined
      || environmentProfileEnabled(
        profiles.extensions,
        feature.environment.profile,
      )))) return undefined;
  const principalInputs = input.principals as Array<{
    id: string;
    sessionVersion: number;
    role?: "host" | "player" | "observer";
  }>;
  const seatInputs = input.seats as Array<{ id: string; principalId: string; status: "active" | "inactive" }>;
  const characterInputs = input.characters as Array<{
    id: string;
    kind: "player" | "npc";
    name: string;
    sceneId: string;
    tenureStatus: CharacterRecord["tenureStatus"];
    level?: number;
    experiencePoints?: number;
    hitPoints?: { current: number; maximum: number };
    resources?: Record<string, number>;
    resourceMaximums?: Record<string, number>;
    abilityScores?: Record<string, number>;
    proficiencyBonus?: number;
    proficientSkills?: string[];
    expertiseSkills?: string[];
    proficientSaves?: string[];
    classId?: string;
    raceId?: string;
    subclassId?: string;
    cantripIds?: string[];
    preparedSpellIds?: string[];
    featureIds?: string[];
    lastControllerSeatId?: string;
    lastLongRestCompletedAtMicros?: string;
    loadout?: CharacterRecord["loadout"];
    socialMechanics?: CharacterRecord["socialMechanics"];
    characterBuild?: JsonRecord;
    spatialVisibilityPolicyId?: "visibility:scene-observers" | "visibility:hidden-until-evidence";
    spatialVisibilityFactId?: string;
  }>;
  const controlInputs = input.characterControls as Array<{ characterId: string; seatId: string }>;
  const factInputs = input.canonicalFacts as Array<{
    id: string;
    kind: string;
    subjectRefs: string[];
    value: unknown;
    visibilityPolicyId: string;
    source: CanonicalFactRecord["source"];
  }>;
  const knowledgeInputs = input.initialKnowledge as Array<{
    characterId: string;
    knowledgeRef: string;
    kind: KnowledgeRecord["objectKind"];
    layer: KnowledgeRecord["layer"];
    content: unknown;
    visibility: KnowledgeRecord["visibility"];
    provenanceChain: string[];
  }>;

  const scenes = recordById(sceneInputs.map((scene) => ({ id: scene.id, name: scene.name })));
  const principals = recordById(principalInputs.map(({ id, sessionVersion }) => ({ id, sessionVersion })));
  const principalSeeds = recordById(principalInputs.map((principal) => ({ ...principal })));
  const seats = recordById(seatInputs.map((seat) => ({ ...seat })));
  const sortedCharacters = [...characterInputs].sort((left, right) => left.id.localeCompare(right.id));
  const characterBuilds = Object.fromEntries(sortedCharacters.map((character) => [
    character.id,
    character.characterBuild === undefined ? undefined : structuredClone(character.characterBuild),
  ]));
  const spatialVisibilityByCharacter = Object.fromEntries(sortedCharacters.map((character) => [
    character.id,
    character.spatialVisibilityPolicyId === undefined
      ? undefined
      : {
          policyId: character.spatialVisibilityPolicyId,
          ...(character.spatialVisibilityFactId === undefined
            ? {}
            : { factId: character.spatialVisibilityFactId }),
        },
  ]));
  const advancementProfile = input.advancementProfile === "srdXp2014"
    ? "srdXp2014"
    : "milestone";
  const entities = recordById(sortedCharacters.map((character, index) => {
    const {
      characterBuild: _characterBuild,
      spatialVisibilityFactId: _spatialVisibilityFactId,
      spatialVisibilityPolicyId: _spatialVisibilityPolicyId,
      ...core
    } = character;
    const minimumExperience = core.kind === "player" && advancementProfile === "srdXp2014"
      ? experienceThresholdForLevel(core.level ?? 1)
      : undefined;
    if (minimumExperience !== undefined
      && core.experiencePoints !== undefined
      && core.experiencePoints < minimumExperience) {
      throw new TypeError("character experience is below the selected SRD level threshold");
    }
    return ({
    ...structuredClone(core),
    ...(minimumExperience === undefined
      ? {}
      : { experiencePoints: core.experiencePoints ?? minimumExperience }),
    ...(core.proficientSkills === undefined
      ? {}
      : { proficientSkills: [...core.proficientSkills].sort() }),
    ...(core.expertiseSkills === undefined
      ? {}
      : { expertiseSkills: [...core.expertiseSkills].sort() }),
    ...(core.proficientSaves === undefined
      ? {}
      : { proficientSaves: [...core.proficientSaves].sort() }),
    ...(core.cantripIds === undefined ? {} : { cantripIds: [...core.cantripIds].sort() }),
    ...(core.preparedSpellIds === undefined
      ? {}
      : { preparedSpellIds: [...core.preparedSpellIds].sort() }),
    ...(core.featureIds === undefined ? {} : { featureIds: [...core.featureIds].sort() }),
    entityOrdinal: String(index + 1),
  });
  }));

  const semanticDefinitions = semanticSeedCatalog(vNextSeed, entities);
  if (semanticDefinitions === undefined) return undefined;

  if (
    seatInputs.some((seat) => !(seat.principalId in principals))
    || characterInputs.some((character) => !(character.sceneId in scenes))
    || controlInputs.some(({ characterId, seatId }) =>
      entities[characterId]?.kind !== "player" || !(seatId in seats))
  ) {
    return undefined;
  }
  if (
    new Set(controlInputs.map(({ characterId }) => characterId)).size !== controlInputs.length
    || new Set(knowledgeInputs.map(({ characterId, knowledgeRef }) => `${characterId}\u0000${knowledgeRef}`)).size
      !== knowledgeInputs.length
  ) {
    return undefined;
  }

  let itemSystem = emptyItemSystemState();
  {
    const standardGearResolver = profiles.extensions
      .map((profile) => standardGearResolverForProfile(profile))
      .find((resolver) => resolver !== undefined);
    if (standardGearResolver === undefined) return undefined;

    for (const character of Object.values(entities)) {
      const loadout = character.loadout;
      if (loadout === undefined) continue;
      const initialItemIds = [
        ...Object.values(loadout.equipped),
        ...loadout.backpack.map((entry) => entry.itemId),
      ];
      if (initialItemIds.some((itemId) => standardGearResolver(itemId) === undefined)) {
        return undefined;
      }
      const merged = mergeInitialStandardLoadout(itemSystem, character.id, loadout);
      if ("error" in merged) return undefined;
      itemSystem = merged.itemSystem;
    }

    if (vNextSeed !== undefined) {
      const factIds = new Set(factInputs.map(({ id }) => id));
      for (const definition of vNextSeed.itemDefinitions) {
        const rulesBasis = definition.rulesBasis;
        if (itemSystem.definitions[definition.definitionId] !== undefined
          || definition.causalBasisRefs.some((ref) => !factIds.has(ref))
          || (typeof rulesBasis !== "string"
            && !profiles.extensions.some((extension) =>
              extension.profileId === rulesBasis.profileRef.profileId
              && extension.profileHash === rulesBasis.profileRef.profileHash))) return undefined;
        itemSystem.definitions[definition.definitionId] = structuredClone(definition);
      }
      for (const seeded of vNextSeed.itemEntries) {
        const definition = itemSystem.definitions[seeded.definitionRef];
        if (definition === undefined) return undefined;
        let entry;
        try {
          entry = createInitialItemEntry(definition, seeded.entry);
        } catch {
          return undefined;
        }
        if (itemSystem.entries[entry.entryId] !== undefined
          || (entry.disposition === "held" && stateEntityUnavailable(entities, entry.holderRef))
          || (entry.disposition === "scene" && !sceneInputs.some(({ id }) => id === entry.sceneRef))) {
          return undefined;
        }
        itemSystem.entries[entry.entryId] = entry;
      }
      if (!isItemSystemStateV1(itemSystem)) return undefined;
    }

    for (const character of Object.values(entities)) {
      const initialLoadout = character.loadout;
      const hasHeldItems = Object.values(itemSystem.entries).some((entry) =>
        entry.disposition === "held" && entry.holderRef === character.id);
      if (initialLoadout === undefined && !hasHeldItems) continue;
      const derived = deriveCharacterLoadoutFromItems(itemSystem, {
        holderRef: character.id,
        ...(character.classId === undefined ? {} : { classId: character.classId }),
        scores: {
          dex: character.abilityScores?.dex ?? 10,
          con: character.abilityScores?.con ?? 10,
        },
        speedFeet: initialLoadout?.speedFeet ?? 30,
      });
      if ("error" in derived) return undefined;
      character.loadout = derived.loadout;
    }
  }

  const characterControls = Object.fromEntries(
    [...controlInputs]
      .sort((left, right) => left.characterId.localeCompare(right.characterId))
      .map((control) => [control.characterId, {
        characterId: control.characterId,
        seatId: control.seatId,
      }]),
  );
  const activeBranchId = input.activeBranchId as string;
  const canonicalFacts = recordById(factInputs.map((fact) => ({
    ...structuredClone(fact),
    subjectRefs: [...new Set(fact.subjectRefs)].sort(),
    branchId: activeBranchId,
    validFromEventSeq: "0",
    causalParentIds: [],
  })));
  const knowledge: AuthoritativeWorldState["knowledge"] = Object.fromEntries(
    Object.keys(entities).sort().map((characterId) => [characterId, {}]),
  );
  for (const entry of [...knowledgeInputs].sort((left, right) =>
    `${left.characterId}\u0000${left.knowledgeRef}`.localeCompare(`${right.characterId}\u0000${right.knowledgeRef}`))) {
    if (!(entry.characterId in entities)) {
      return undefined;
    }
    knowledge[entry.characterId][entry.knowledgeRef] = {
      characterId: entry.characterId,
      knowledgeRef: entry.knowledgeRef,
      objectKind: entry.kind,
      layer: entry.layer,
      content: structuredClone(entry.content),
      visibility: entry.visibility,
      acquiredByEventId: entry.provenanceChain[0] ?? "genesis:initial-knowledge",
      acquiredAtFictionMicros: input.fictionInstantMicros as string,
      sourceCharacterId: null,
      provenanceChain: [...entry.provenanceChain],
    };
  }

  const placeholderHash = `sha256:${"0".repeat(64)}` as Sha256Ref;
  const combatScenes: AuthoritativeWorldState["combatRuntime"]["scenes"] = Object.fromEntries(
    Object.values(scenes).map((scene) => [scene.id, {
      sceneId: scene.id,
      geometry: structuredClone(
        sceneInputs.find((entry) => entry.id === scene.id)?.geometry
          ?? { unit: "inch", obstacles: [] },
      ),
    }]),
  );
  const combatDefinitions: AuthoritativeWorldState["combatRuntime"]["definitions"] = {};
  const combatEntities: AuthoritativeWorldState["combatRuntime"]["entities"] = {};
  const nextSpawnIndexByScene = new Map<string, number>();
  const tacticalPositionByCharacter = new Map<string, TacticalPosition>();
  for (const character of Object.values(entities)) {
    const tacticalGeometry = sceneInputs.find((entry) => entry.id === character.sceneId)?.geometry;
    if (tacticalGeometry === undefined) continue;
    const spawnIndex = nextSpawnIndexByScene.get(character.sceneId) ?? 0;
    const tacticalPosition = tacticalGeometry.spawnPoints[spawnIndex];
    if (tacticalPosition === undefined) return undefined;
    nextSpawnIndexByScene.set(character.sceneId, spawnIndex + 1);
    tacticalPositionByCharacter.set(character.id, structuredClone(tacticalPosition));
  }
  for (const character of Object.values(entities).filter((entry) => entry.kind === "player")) {
    const compiled = compileStaticCharacterCombat(
      character,
      characterBuilds[character.id],
      itemSystem,
      combatDefinitions,
    );
    for (const [definitionId, definition] of Object.entries(compiled.definitions)) {
      const existing = combatDefinitions[definitionId];
      if (existing !== undefined && canonicalSha256(existing) !== canonicalSha256(definition)) {
        return undefined;
      }
      combatDefinitions[definitionId] = structuredClone(definition);
    }
    const control = characterControls[character.id];
    const seat = control === undefined ? undefined : seats[control.seatId];
    const tacticalPosition = tacticalPositionByCharacter.get(character.id);
    combatEntities[character.id] = buildPlayerCombatEntity(
      profiles,
      character,
      compiled,
      seat?.principalId,
      tacticalPosition,
      itemSystem,
    );
  }
  for (const character of Object.values(entities).filter((entry) => entry.kind === "npc")) {
    const tacticalPosition = tacticalPositionByCharacter.get(character.id);
    if (tacticalPosition === undefined) continue;
    const visibility = spatialVisibilityByCharacter[character.id];
    combatEntities[character.id] = buildNpcSpatialEntity(
      character,
      tacticalPosition,
      visibility?.policyId ?? "visibility:scene-observers",
      visibility?.factId,
    );
  }
  return {
    schema: "zhuwei.authoritative-world-state/v2",
    version: "0",
    roomId: input.roomId as string,
    runtimeEpochId: input.runtimeEpochId as string,
    runtimeManifestRef: structuredClone(profiles.manifest),
    activeBranchId,
    fictionTimelines: initialMultiplayerFictionTimelines(
      activeBranchId,
      entities,
      input.fictionInstantMicros as string,
    ),
    scenes,
    principals,
    seats,
    entities,
    characterControls,
    canonicalFacts,
    knowledge,
    receipts: {},
    pendingInputs: {},
    internalContinuations: {},
    campaignRuntime: {
      campaign: {
        campaignId: `campaign:${input.roomId as string}`,
        moduleRef: structuredClone(input.moduleRef),
        currentChapterId: "chapter:opening",
        advancementProfile,
        status: "active",
      },
      chapters: {
        "chapter:opening": {
          chapterId: "chapter:opening",
          ordinal: "1",
          status: "active",
          moduleRef: structuredClone(input.moduleRef),
          storyAnchorRefs: [],
          sceneQuestion: "这一章将如何改变角色与世界？",
        },
      },
      relationships: {},
      promises: {},
      debts: {},
      factions: {},
      activities: {},
      unresolvedThreats: [],
      definitions: semanticDefinitions,
      sourceClaims: {},
      npcPlans: {},
      factionPlans: {},
      meaningfulFailures: {},
      adjudicationPrecedents: {},
      retryChanges: {},
      sceneQuestions: {},
      endingCandidates: {},
      stories: {},
      epilogues: {},
      inheritanceSources: {},
      ...(socialResolutionProfileEnabled(profiles.extensions)
        ? { conversationThreads: {} }
        : {}),
      itemSystem,
    },
    combatRuntime: {
      story: { chapterId: "chapter:opening", status: "active", endingCandidates: [] },
      scenes: combatScenes,
      entities: combatEntities,
      definitions: combatDefinitions,
      encounters: {},
      effects: {},
      pendingInputs: {},
      randomnessResolutions: {},
    },
    correctionRuntime: emptyCorrectionRuntime(input.roomId as string, input.runtimeEpochId as string),
    multiplayerRuntime: emptyMultiplayerRuntime(
      input.roomId as string,
      input.runtimeEpochId as string,
      principalSeeds,
      seats,
      entities,
      characterControls,
      activeBranchId,
      scenes,
      input.fictionInstantMicros as string,
    ),
    eventHeadHash: placeholderHash,
    lastEventId: null,
  };
}

export function initializeAuthoritativeWorld(
  selectedProfiles: RuntimeProfileManifest,
  profilesValue: unknown,
  stateValue: unknown,
  input: unknown,
): StepResult {
  if (profilesValue !== undefined || stateValue !== undefined) {
    return rejected(
      "invalidInitialization",
      "World initialization requires undefined profiles and state; Rules selects the manifest.",
    );
  }
  if (
    !isRecord(input)
    || !hasOnlyKeys(input, INITIALIZE_KEYS, OPTIONAL_INITIALIZE_KEYS)
    || input.kind !== "initializeAuthoritativeWorld"
    || !isNonEmptyString(input.roomId)
    || !isNonEmptyString(input.runtimeEpochId)
    || !isProfileRef(input.moduleRef)
    || !isProfileRef(input.initialDefinitionCatalogRef)
    || !isNonEmptyString(input.activeBranchId)
    || typeof input.fictionInstantMicros !== "string"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(input.fictionInstantMicros)
    || (input.advancementProfile !== undefined
      && input.advancementProfile !== "milestone"
      && input.advancementProfile !== "srdXp2014")
  ) {
    return rejected(
      "invalidInitialization",
      "initializeAuthoritativeWorld input is incomplete or contains non-canonical fields.",
    );
  }

  try {
    const initialState = buildInitialState(input, selectedProfiles);
    if (initialState === undefined) {
      return rejected(
        "invalidInitialization",
        "Initialization references an unknown scene, principal, seat, character, or duplicate identity.",
      );
    }
    const initialStateHash = hashWorldState(initialState);
    initialState.eventHeadHash = initialStateHash;
    const genesisWithoutHash = {
      kind: "roomGenesis" as const,
      roomId: input.roomId,
      runtimeEpochId: input.runtimeEpochId,
      profiles: structuredClone(selectedProfiles),
      moduleRef: structuredClone(input.moduleRef),
      initialDefinitionCatalogRef: structuredClone(input.initialDefinitionCatalogRef),
      initialState,
      initialStateHash,
    };
    const genesis: RuntimeGenesis = {
      ...genesisWithoutHash,
      genesisHash: canonicalSha256(genesisWithoutHash),
    };
    return {
      kind: "initialized",
      profiles: structuredClone(selectedProfiles),
      genesis,
    } satisfies InitializedRulesResult;
  } catch {
    return rejected(
      "invalidInitialization",
      "Initialization contains a value that cannot enter canonical authoritative state.",
    );
  }
}

function baseTransitionResult(
  transition: ReturnType<typeof createEventTransition>,
  scopeProof: ReturnType<typeof createScopeProof>,
) {
  return {
    events: [transition.event],
    state: transition.state,
    cache: transition.state,
    stateHash: transition.event.stateHashAfter,
    scopeProof,
    receipt: transition.receipt,
  };
}

function ensureFreshRootAction(state: AuthoritativeWorldState, rootActionId: unknown): string | undefined {
  if (!isNonEmptyString(rootActionId) || rootActionId in state.receipts) {
    return undefined;
  }
  return rootActionId;
}

function actionCharacter(state: AuthoritativeWorldState, characterId: unknown): CharacterRecord | undefined {
  if (!isNonEmptyString(characterId)) {
    return undefined;
  }
  const character = state.entities[characterId];
  return character?.tenureStatus === "active" ? character : undefined;
}

function transitionResult<T extends "committed" | "awaitingInput" | "awaitingRandomness">(
  kind: T,
  transition: ReturnType<typeof createEventTransition>,
  scopeProof: ReturnType<typeof createScopeProof>,
): (T extends "committed" ? CommittedRulesResult
  : T extends "awaitingInput" ? AwaitingInputRulesResult
    : AwaitingRandomnessRulesResult) {
  return { kind, ...baseTransitionResult(transition, scopeProof) } as never;
}

function normalizeFrozenCheck(value: unknown): FrozenCheck | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "ability",
      "costs",
      "dc",
      "failureOutcome",
      "goal",
      "kind",
      "method",
      "mode",
      "modifier",
      "risk",
      "skill",
      "successOutcome",
    ])
    || !["ability", "skill", "tool", "savingThrow"].includes(String(value.kind))
    || !["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
      .includes(String(value.ability))
    || !(value.skill === null || isNonEmptyString(value.skill))
    || typeof value.dc !== "string"
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value.dc)
    || typeof value.modifier !== "string"
    || !CANONICAL_SIGNED_INTEGER_PATTERN.test(value.modifier)
    || !["normal", "advantage", "disadvantage"].includes(String(value.mode))
    || !isNonEmptyString(value.goal)
    || !isNonEmptyString(value.method)
    || !isNonEmptyString(value.risk)
    || !isNonEmptyString(value.successOutcome)
    || !isNonEmptyString(value.failureOutcome)
    || !Array.isArray(value.costs)
    || !value.costs.every(isNonEmptyString)
  ) {
    return undefined;
  }
  return {
    kind: value.kind as FrozenCheck["kind"],
    ability: value.ability as FrozenCheck["ability"],
    skill: value.skill,
    dc: value.dc,
    modifier: value.modifier,
    mode: value.mode as FrozenCheck["mode"],
    goal: value.goal,
    method: value.method,
    risk: value.risk,
    successOutcome: value.successOutcome,
    failureOutcome: value.failureOutcome,
    costs: [...new Set(value.costs)].sort(),
  };
}

function resolveImprovisedRuling(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  actor: CharacterRecord,
  ruling: JsonRecord,
): StepResult {
  if (ruling.kind === "directSuccess") {
    if (!hasOnlyKeys(ruling, ["kind", "outcomeCode"], ["fact"])
      || !isNonEmptyString(ruling.outcomeCode)) {
      return rejected("invalidRulesInput", "directSuccess ruling is not canonical.");
    }
    let fact: EventPayloadByType["ImprovisedActionResolved"]["fact"] = null;
    if (ruling.fact !== undefined) {
      const candidate = ruling.fact;
      if (
        !isRecord(candidate)
        || !hasExactKeys(candidate, ["id", "kind", "source", "subjectRefs", "value", "visibilityPolicyId"])
        || !isNonEmptyString(candidate.id)
        || !isNonEmptyString(candidate.kind)
        || !Array.isArray(candidate.subjectRefs)
        || !candidate.subjectRefs.every(isNonEmptyString)
        || !isNonEmptyString(candidate.visibilityPolicyId)
        || ![
          "dynamicMaterialization",
          "observedEvent",
          "mechanicalResolution",
          "characterAction",
          "npcOrFactionAction",
        ].includes(String(candidate.source))
        || candidate.id in state.canonicalFacts
      ) {
        return rejected("invalidRulesInput", "directSuccess fact is not a legal typed fact draft.");
      }
      fact = {
        id: candidate.id,
        kind: candidate.kind,
        subjectRefs: [...new Set(candidate.subjectRefs)].sort(),
        value: structuredClone(candidate.value),
        visibilityPolicyId: candidate.visibilityPolicyId,
        source: candidate.source as CanonicalFactRecord["source"],
      };
    }
    const payload: EventPayloadByType["ImprovisedActionResolved"] = {
      actorCharacterId: actor.id,
      outcomeCode: ruling.outcomeCode,
      fact,
    };
    const scopeProof = createScopeProof(
      state,
      [`entity:${actor.id}`],
      [`receipt:${rootActionId}`, ...(fact === null ? [] : [`fact:${fact.id}`])],
      fact === null ? [] : [`fact:${fact.id}`],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      eventType: "ImprovisedActionResolved",
      payload,
      scopeProof,
      visibilityPolicyId: fact?.visibilityPolicyId ?? "visibility:scene-observers",
      secrecy: fact?.visibilityPolicyId === "visibility:kp-internal" ? "internal" : "public",
    });
    return transitionResult("committed", transition, scopeProof);
  }

  if (ruling.kind === "clarification") {
    if (
      !hasExactKeys(ruling, ["kind", "pendingInputId", "question"])
      || !isNonEmptyString(ruling.pendingInputId)
      || !isNonEmptyString(ruling.question)
      || ruling.pendingInputId in state.pendingInputs
    ) {
      return rejected("invalidRulesInput", "clarification ruling is not canonical.");
    }
    const payload: EventPayloadByType["ClarificationRequested"] = {
      actorCharacterId: actor.id,
      pendingInputId: ruling.pendingInputId,
      question: ruling.question,
    };
    const scopeProof = createScopeProof(
      state,
      [`entity:${actor.id}`],
      [`pending:${ruling.pendingInputId}`, `receipt:${rootActionId}`],
      [`pending:${ruling.pendingInputId}`],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      eventType: "ClarificationRequested",
      payload,
      scopeProof,
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
    });
    return {
      ...transitionResult("awaitingInput", transition, scopeProof),
      pending: {
        pendingInputId: payload.pendingInputId,
        kind: "clarification",
        question: payload.question,
      },
    };
  }

  if (ruling.kind === "playerChoice") {
    const choices = Array.isArray(ruling.choices)
      ? ruling.choices.filter(isRecord)
      : [];
    if (
      !hasExactKeys(ruling, ["choices", "kind", "pendingInputId", "question"])
      || !isNonEmptyString(ruling.pendingInputId)
      || !isNonEmptyString(ruling.question)
      || ruling.pendingInputId in state.pendingInputs
      || !Array.isArray(ruling.choices)
      || choices.length < 2
      || choices.length > 12
      || choices.length !== ruling.choices.length
      || choices.some((choice) => !hasExactKeys(choice, ["choiceId", "consequence", "label"])
        || !isNonEmptyString(choice.choiceId)
        || !isNonEmptyString(choice.label)
        || !isNonEmptyString(choice.consequence))
      || new Set(choices.map(({ choiceId }) => choiceId)).size !== choices.length
    ) {
      return rejected("invalidRulesInput", "playerChoice ruling is not canonical.");
    }
    const payload: EventPayloadByType["PlayerChoiceRequested"] = {
      actorCharacterId: actor.id,
      pendingInputId: ruling.pendingInputId,
      question: ruling.question,
      choices: choices.map((choice) => ({
        choiceId: choice.choiceId as string,
        label: choice.label as string,
        consequence: choice.consequence as string,
      })),
    };
    const scopeProof = createScopeProof(
      state,
      [`entity:${actor.id}`],
      [`pending:${ruling.pendingInputId}`, `receipt:${rootActionId}`],
      [`pending:${ruling.pendingInputId}`],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      eventType: "PlayerChoiceRequested",
      payload,
      scopeProof,
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
    });
    return {
      ...transitionResult("awaitingInput", transition, scopeProof),
      pending: {
        pendingInputId: payload.pendingInputId,
        kind: "playerChoice",
        question: payload.question,
        choices: structuredClone(payload.choices),
      },
    };
  }

  if (ruling.kind === "checkRequired") {
    if (
      !hasExactKeys(ruling, ["check", "kind", "randomnessId", "resolutionId"])
      || !isNonEmptyString(ruling.resolutionId)
      || !isNonEmptyString(ruling.randomnessId)
    ) {
      return rejected("invalidRulesInput", "checkRequired ruling is not canonical.");
    }
    const frozenCheck = normalizeFrozenCheck(ruling.check);
    if (frozenCheck === undefined) {
      return rejected("invalidRulesInput", "checkRequired must freeze a complete 2014 check before dice.");
    }
    const request: RandomnessRequest = {
      randomnessId: ruling.randomnessId,
      resolutionId: ruling.resolutionId,
      actorCharacterId: actor.id,
      purpose: "improvisedCheck",
      diceExpression: frozenCheck.mode === "normal"
        ? "1d20"
        : frozenCheck.mode === "advantage"
          ? "2d20kh1"
          : "2d20kl1",
      frozenCheck,
    };
    const continuation: AuthorityContinuation = {
      kind: "roomAuthorityRandomness",
      continuationId: `continuation:${request.resolutionId}`,
      capability: canonicalSha256({
        kind: "roomAuthorityRandomness",
        roomId: state.roomId,
        runtimeEpochId: state.runtimeEpochId,
        stateHash: hashWorldState(state),
        rootActionId,
        request,
      }),
    };
    if (continuation.continuationId in state.internalContinuations) {
      return rejected("invalidRulesInput", "The resolution already has an active continuation.");
    }
    const payload: EventPayloadByType["RandomnessRequested"] = {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
    };
    const scopeProof = createScopeProof(
      state,
      [`entity:${actor.id}`],
      [`continuation:${continuation.continuationId}`, `receipt:${rootActionId}`],
      [`continuation:${continuation.continuationId}`],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      resolutionId: request.resolutionId,
      eventType: "RandomnessRequested",
      payload,
      scopeProof,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    });
    return {
      ...transitionResult("awaitingRandomness", transition, scopeProof),
      randomnessRequest: request,
      continuation,
    };
  }

  return rejected("invalidRulesInput", "Unknown improvised feasibility ruling.");
}

function resolveImprovisedAction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "rootActionId", "ruling"])) {
    return rejected("invalidRulesInput", "Improvised action input has additional or missing fields.");
  }
  const rootActionId = ensureFreshRootAction(state, input.rootActionId);
  const actor = actionCharacter(state, input.actorCharacterId);
  if (rootActionId === undefined || actor === undefined || !isRecord(input.ruling)) {
    return rejected("privateOrUnknownReference", "The action reference is unavailable.");
  }
  return resolveImprovisedRuling(profiles, state, rootActionId, actor, input.ruling);
}

function answerPendingInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(input, [
      "answer",
      "controllerCharacterId",
      "kind",
      "pendingInputId",
      "proposal",
      "rootActionId",
    ])
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.controllerCharacterId)
    || !isRecord(input.answer)
    || !isRecord(input.proposal)
    || !(
      (hasExactKeys(input.proposal, ["kind", "ruling"])
        && input.proposal.kind === "resolveImprovisedAction"
        && isRecord(input.proposal.ruling))
      || input.proposal.kind === "executeCausalActionProgram"
      || (input.proposal.kind === "recordAdvancementChoice"
        && hasExactKeys(input.proposal, [
          "characterId",
          "choice",
          "kind",
          "pendingInputId",
          "proposalId",
        ])
        && isRecord(input.proposal.choice))
    )
  ) {
    return rejected("invalidRulesInput", "Pending answer must contain one canonical same-root proposal.");
  }
  const pending = state.pendingInputs[input.pendingInputId];
  const receipt = state.receipts[input.rootActionId];
  const actor = actionCharacter(state, input.controllerCharacterId);
  if (input.proposal.kind === "recordAdvancementChoice") {
    if (
      pending?.kind !== "advancementChoice"
      || pending.rootActionId !== input.rootActionId
      || pending.controllerCharacterId !== input.controllerCharacterId
      || receipt?.status !== "awaitingInput"
      || actor === undefined
      || input.proposal.characterId !== actor.id
      || input.proposal.pendingInputId !== pending.pendingInputId
      || input.proposal.proposalId !== pending.rootActionId
      || canonicalSha256(input.proposal.choice) !== canonicalSha256(input.answer)
    ) {
      return rejected("privateOrUnknownReference", "The advancement choice is unavailable.");
    }
    return stepCampaignWorld(
      profiles,
      state,
      continueCompoundRoot(structuredClone(input.proposal), pending.rootActionId),
    ) ?? rejected("unsupportedOperation", "The advancement choice has no Rules implementation.");
  }
  if (
    pending === undefined
    || !["clarification", "playerChoice", "socialResolution"].includes(pending.kind)
    || pending.rootActionId !== input.rootActionId
    || pending.controllerCharacterId !== input.controllerCharacterId
    || receipt?.status !== "awaitingInput"
    || actor === undefined
  ) {
    return rejected("privateOrUnknownReference", "The pending input reference is unavailable.");
  }
  if (pending.kind === "playerChoice") {
    const answer = input.answer as JsonRecord;
    const choices = Array.isArray(pending.options?.choices)
      ? pending.options.choices.filter(isRecord)
      : [];
    if (
      !hasExactKeys(answer, ["choiceId"])
      || !isNonEmptyString(answer.choiceId)
      || !choices.some((choice) => choice.choiceId === answer.choiceId)
    ) {
      return rejected("invalidRulesInput", "The player choice answer is not one of the frozen candidates.");
    }
  }
  if (pending.kind === "socialResolution"
    && input.proposal.kind === "executeCausalActionProgram"
    && isRecord(input.proposal.causalActionProgram)
    && isRecord(pending.options)) {
    const nodes = Array.isArray(input.proposal.causalActionProgram.nodes)
      ? input.proposal.causalActionProgram.nodes.filter(isRecord)
      : [];
    const exchange = nodes.find((node) => node.primitive === "exchangeWithNpc");
    const argumentsValue = isRecord(exchange?.arguments) ? exchange.arguments : undefined;
    const utterance = isNonEmptyString(argumentsValue?.utterance)
      ? argumentsValue.utterance
      : undefined;
    const replacementFingerprint = utterance === undefined
      ? undefined
      : socialUtteranceFingerprint(utterance);
    if (!isNonEmptyString(pending.options.utteranceFingerprint)
      || replacementFingerprint === undefined) {
      return rejected(
        "invalidRulesInput",
        "The replacement social utterance is not bound to the frozen offer.",
      );
    }
    if (replacementFingerprint === pending.options.utteranceFingerprint) {
      return rejected(
        "unchangedRetry",
        "The replacement social utterance is identical to the still-frozen offer.",
      );
    }
  }
  if (
    input.proposal.kind === "resolveImprovisedAction"
    && isRecord(input.proposal.ruling)
    && input.proposal.ruling.kind === "clarification"
    && input.proposal.ruling.pendingInputId === pending.pendingInputId
  ) {
    return rejected("invalidRulesInput", "A revised clarification requires a new pending input id.");
  }

  const closePayload: EventPayloadByType["PendingInputAnswered"] = {
    actorCharacterId: actor.id,
    pendingInputId: pending.pendingInputId,
    openedByEventId: pending.openedByEventId,
    answer: structuredClone(input.answer),
  };
  const closeScopeProof = createScopeProof(
    state,
    [
      `entity:${actor.id}`,
      `pending:${pending.pendingInputId}`,
      `receipt:${pending.rootActionId}`,
    ],
    [`pending:${pending.pendingInputId}`, `receipt:${pending.rootActionId}`],
    [],
  );
  const close = createEventTransition(state, profiles, {
    rootActionId: pending.rootActionId,
    eventType: "PendingInputAnswered",
    payload: closePayload,
    scopeProof: closeScopeProof,
    visibilityPolicyId: `visibility:character-controller:${actor.id}`,
    secrecy: "private",
  });
  const socialSupersession = pending.kind === "socialResolution"
    ? supersedeSocialResolutionPending(profiles, close.state, pending)
    : undefined;
  if (pending.kind === "socialResolution" && socialSupersession === undefined) {
    return rejected("invalidWorldState", "The frozen social offer cannot be superseded.");
  }
  const continuedState = socialSupersession?.state ?? close.state;
  const continuedProposal = input.proposal.kind === "executeCausalActionProgram"
    ? continueCompoundRoot(structuredClone(input.proposal), pending.rootActionId)
    : undefined;
  const outcome = continuedProposal !== undefined
    ? stepCausalActionProgram(profiles, continuedState, continuedProposal)
    : resolveImprovisedRuling(
        profiles,
        continuedState,
        pending.rootActionId,
        actor,
        input.proposal.ruling as JsonRecord,
      );
  if (outcome === undefined) {
    return rejected("unsupportedOperation", "The pending answer proposal has no Rules implementation.");
  }
  if (outcome.kind === "rejected" || outcome.kind === "initialized") {
    return outcome;
  }
  return {
    ...outcome,
    events: [
      close.event,
      ...(socialSupersession === undefined ? [] : [socialSupersession.event]),
      ...outcome.events,
    ],
  };
}

function applyServiceCorrection(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(input, [
      "actorCharacterId",
      "basis",
      "correctionAuthority",
      "correctionId",
      "errorKind",
      "kind",
      "publicExplanation",
      "targetReceiptId",
    ])
    || !isRecord(input.correctionAuthority)
    || !hasExactKeys(input.correctionAuthority, ["capability", "kind"])
    || input.correctionAuthority.kind !== "roomCorrectionAuthority"
    || !isSha256(input.correctionAuthority.capability)
    || !isRecord(input.basis)
    || !hasExactKeys(input.basis, ["eventHash", "stateHash"])
    || !isSha256(input.basis.eventHash)
    || !isSha256(input.basis.stateHash)
    || !isNonEmptyString(input.actorCharacterId)
    || !isNonEmptyString(input.correctionId)
    || !isNonEmptyString(input.targetReceiptId)
    || !isNonEmptyString(input.errorKind)
    || !isNonEmptyString(input.publicExplanation)
  ) {
    return rejected("invalidRulesInput", "Correction input must be one closed hash-bound service request.");
  }
  if (input.correctionAuthority.capability !== state.correctionRuntime.authorityCapability) {
    return rejected("correctionUnauthorized", "Only the Room correction authority may execute a correction.");
  }
  if (
    input.basis.eventHash !== state.eventHeadHash
    || input.basis.stateHash !== hashWorldState(state)
  ) {
    return rejected("correctionConflict", "Correction context no longer matches the authoritative head.");
  }
  if (input.correctionId in state.correctionRuntime.corrections) {
    return rejected("duplicateRootAction", "The correction id has already been committed.");
  }
  const plan = correctionPlan(state, input.correctionId, input.targetReceiptId);
  if (plan === undefined) {
    return rejected("privateOrUnknownReference", "The correction target is unavailable.");
  }
  const targetReceipt = Object.values(state.receipts)
    .find((receipt) => receipt.receiptId === input.targetReceiptId);
  if (targetReceipt === undefined
    || !(input.actorCharacterId in state.entities)
    || (targetReceipt.subjectCharacterIds.length > 0
      && !targetReceipt.subjectCharacterIds.includes(input.actorCharacterId))) {
    return rejected(
      "privateOrUnknownReference",
      "The correction actor is not a subject of the target Receipt.",
    );
  }
  const rootActionId = `correction:${input.correctionId}`;
  if (rootActionId in state.receipts) {
    return rejected("duplicateRootAction", "The correction id has already been used.");
  }
  const correctionReads = [
    `event-head:${state.eventHeadHash}`,
    `receipt:${plan.targetRootActionId}`,
    ...plan.affectedEventIds.map((eventId) => `event:${eventId}`),
  ];

  if (plan.strategy === "forwardCompensation") {
    const payload: EventPayloadByType["CorrectionApplied"] = {
      actorCharacterId: input.actorCharacterId,
      correctionId: input.correctionId,
      targetReceiptId: plan.targetReceiptId,
      targetRootActionId: plan.targetRootActionId,
      errorKind: input.errorKind,
      publicExplanation: input.publicExplanation,
      compensatedEventIds: [...plan.affectedEventIds].sort(),
      effects: structuredClone(plan.effects),
    };
    const scopeProof = createScopeProof(
      state,
      correctionReads,
      [`correction:${input.correctionId}`, `receipt:${rootActionId}`],
      [`correction:${input.correctionId}`],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      eventType: "CorrectionApplied",
      payload,
      scopeProof,
      visibilityPolicyId: "visibility:room-correction-authority",
      secrecy: "internal",
    });
    return {
      ...transitionResult("committed", transition, scopeProof),
      correctionId: input.correctionId,
      strategy: "forwardCompensation",
      activeBranchId: transition.state.activeBranchId,
      supersededRootActionIds: [],
    };
  }

  if (plan.branchId === undefined) {
    return rejected("invalidRulesInput", "Causal correction did not derive a branch id.");
  }
  const openScopeProof = createScopeProof(
    state,
    correctionReads,
    [`branch:${plan.branchId}`, `receipt:${rootActionId}`],
    [`branch:${plan.branchId}`],
  );
  const opened = createEventTransition(state, profiles, {
    rootActionId,
    eventType: "CorrectionBranchOpened",
    payload: {
      actorCharacterId: input.actorCharacterId,
      correctionId: input.correctionId,
      targetReceiptId: plan.targetReceiptId,
      targetRootActionId: plan.targetRootActionId,
      parentBranchId: state.activeBranchId,
      branchId: plan.branchId,
      cutoffEventSeq: plan.cutoffEventSeq,
      errorKind: input.errorKind,
      publicExplanation: input.publicExplanation,
      supersededRootActionIds: [...plan.supersededRootActionIds].sort(),
    },
    scopeProof: openScopeProof,
    visibilityPolicyId: "visibility:room-correction-authority",
    secrecy: "internal",
  });
  const activateScopeProof = createScopeProof(
    opened.state,
    [`branch:${plan.branchId}`, ...correctionReads],
    [
      `active-branch:${plan.branchId}`,
      ...plan.supersededRootActionIds.map((root) => `receipt:${root}`),
      `receipt:${rootActionId}`,
    ],
    [],
  );
  const activated = createEventTransition(opened.state, profiles, {
    rootActionId,
    eventType: "BranchActivated",
    payload: {
      correctionId: input.correctionId,
      parentBranchId: state.activeBranchId,
      branchId: plan.branchId,
      effects: structuredClone(plan.effects),
      supersededRootActionIds: [...plan.supersededRootActionIds].sort(),
    },
    scopeProof: activateScopeProof,
    visibilityPolicyId: "visibility:room-correction-authority",
    secrecy: "internal",
  });
  return {
    kind: "committed",
    events: [opened.event, activated.event],
    state: activated.state,
    cache: activated.state,
    stateHash: activated.event.stateHashAfter,
    scopeProof: activateScopeProof,
    receipt: activated.receipt,
    correctionId: input.correctionId,
    strategy: "causalBranch",
    activeBranchId: plan.branchId,
    supersededRootActionIds: [...plan.supersededRootActionIds],
  };
}

function fulfillAuthoritativeRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(input, ["continuation", "kind", "rolls"])
    || !isRecord(input.continuation)
    || !hasExactKeys(input.continuation, ["capability", "continuationId", "kind"])
    || input.continuation.kind !== "roomAuthorityRandomness"
    || !isNonEmptyString(input.continuation.continuationId)
    || !isSha256(input.continuation.capability)
    || !Array.isArray(input.rolls)
    || !input.rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 1_000_000)
  ) {
    return rejected("invalidRulesInput", "Only a canonical Room Authority continuation can fulfill dice.");
  }
  const stored = state.internalContinuations[input.continuation.continuationId];
  if (
    stored === undefined
    || stored.continuation.capability !== input.continuation.capability
    || stored.continuation.kind !== input.continuation.kind
  ) {
    return rejected("privateOrUnknownReference", "The continuation reference is unavailable.");
  }
  if (stored.request.purpose === "hiddenRealitySelection") {
    return fulfillHiddenRealityRandomness(
      profiles,
      state,
      input.continuation.continuationId,
      input.rolls as number[],
    ) ?? rejected("invalidWorldState", "The frozen hidden-reality continuation is unavailable.");
  }
  const maximumFace = stored.request.purpose === "restHitDice"
    ? Number(stored.request.dice[0]?.sides)
    : 20;
  if (!(input.rolls as number[]).every((roll) => roll <= maximumFace)) {
    return rejected("invalidRulesInput", "The authoritative face exceeds the frozen die.");
  }
  const worldInteraction = fulfillVNextWorldInteractionRandomness(
    profiles,
    state,
    input.continuation.continuationId,
    input.rolls as number[],
  );
  if (worldInteraction !== undefined) return worldInteraction;
  const rest = fulfillRestRandomness(
    profiles,
    state,
    input.continuation.continuationId,
    input.rolls as number[],
  );
  if (stored.request.purpose === "restHitDice") {
    return rest ?? rejected("invalidWorldState", "The frozen rest continuation could not be resumed.");
  }
  const causal = fulfillCausalActionProgramRandomness(
    profiles,
    state,
    input.continuation.continuationId,
    input.rolls as number[],
  );
  const social = fulfillSocialResolutionRandomness(
    profiles,
    state,
    input.continuation.continuationId,
    input.rolls as number[],
  );
  if (social !== undefined) return social;
  if (causal !== undefined) return causal;
  const actorPlan = fulfillActorPlanRandomness(
    profiles,
    state,
    input.continuation.continuationId,
    input.rolls as number[],
  );
  if (actorPlan !== undefined) return actorPlan;
  const expectedRollCount = stored.request.frozenCheck.mode === "normal" ? 1 : 2;
  if (input.rolls.length !== expectedRollCount) {
    return rejected("invalidRulesInput", "The authoritative roll count does not match the frozen request.");
  }
  const selectedRoll = stored.request.frozenCheck.mode === "advantage"
    ? Math.max(...input.rolls)
    : stored.request.frozenCheck.mode === "disadvantage"
      ? Math.min(...input.rolls)
      : input.rolls[0];
  const total = selectedRoll + Number(stored.request.frozenCheck.modifier);
  const succeeded = total >= Number(stored.request.frozenCheck.dc);
  const diceScopeProof = createScopeProof(
    state,
    [`continuation:${input.continuation.continuationId}`],
    [`receipt:${stored.rootActionId}`],
    [],
  );
  const dice = createEventTransition(state, profiles, {
    rootActionId: stored.rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "DiceRolled",
    payload: {
      randomnessId: stored.request.randomnessId,
      resolutionId: stored.request.resolutionId,
      formula: stored.request.diceExpression,
      faces: [...input.rolls] as number[],
      selectedFace: selectedRoll,
      requestHash: canonicalSha256(stored.request),
      frozenParametersHash: canonicalSha256(stored.request.frozenCheck),
    },
    scopeProof: diceScopeProof,
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  const payload: EventPayloadByType["ImprovisedCheckResolved"] = {
    request: structuredClone(stored.request),
    rolls: [...input.rolls],
    selectedRoll,
    total,
    succeeded,
    outcome: succeeded
      ? stored.request.frozenCheck.successOutcome
      : stored.request.frozenCheck.failureOutcome,
  };
  const scopeProof = createScopeProof(
    dice.state,
    [`continuation:${input.continuation.continuationId}`, `entity:${stored.request.actorCharacterId}`],
    [`continuation:${input.continuation.continuationId}`, `receipt:${stored.rootActionId}`],
    [],
  );
  const transition = createEventTransition(dice.state, profiles, {
    rootActionId: stored.rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "ImprovisedCheckResolved",
    payload,
    scopeProof,
    visibilityPolicyId: `visibility:character-controller:${stored.request.actorCharacterId}`,
    secrecy: "private",
  });
  return {
    ...transitionResult("committed", transition, scopeProof),
    events: [dice.event, transition.event],
  };
}

function fulfillAuthoritativeRandomnessBatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasExactKeys(input, ["kind", "results"])
    || input.kind !== "fulfillAuthoritativeRandomnessBatch"
    || !Array.isArray(input.results)
    || input.results.length < 1
    || input.results.length > 64
  ) return rejected("invalidRulesInput", "An authoritative continuation batch must be bounded and non-empty.");

  const canonicalResults = input.results.flatMap((value) => {
    if (
      !isRecord(value)
      || !hasExactKeys(value, ["continuation", "rolls"])
      || !isRecord(value.continuation)
      || !hasExactKeys(value.continuation, ["capability", "continuationId", "kind"])
      || value.continuation.kind !== "roomAuthorityRandomness"
      || !isNonEmptyString(value.continuation.continuationId)
      || !isSha256(value.continuation.capability)
      || !Array.isArray(value.rolls)
      || !value.rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 1_000_000)
    ) return [];
    const stored = state.internalContinuations[value.continuation.continuationId];
    if (stored === undefined
      || stored.continuation.capability !== value.continuation.capability
      || stored.request.purpose === "hiddenRealitySelection") return [];
    const checkFaces = stored.request.purpose === "restHitDice"
      ? Number(stored.request.dice[0]?.count)
      : stored.request.frozenCheck.mode === "normal" ? 1 : 2;
    // A world interaction froze one extra d20 per saving throw its branches
    // will need, so the batch has to expect those faces as well.
    const expected = stored.request.purpose === "worldInteractionCheck"
      ? checkFaces + stored.request.hazardSaves.length
      : checkFaces;
    const maximumFace = stored.request.purpose === "restHitDice"
      ? Number(stored.request.dice[0]?.sides)
      : 20;
    if (value.rolls.length !== expected || !value.rolls.every((roll) => Number(roll) <= maximumFace)) return [];
    return [{
      continuation: structuredClone(value.continuation) as AuthorityContinuation,
      rolls: [...value.rolls] as number[],
      stored,
    }];
  });
  if (
    canonicalResults.length !== input.results.length
    || new Set(canonicalResults.map(({ continuation }) => continuation.continuationId)).size
      !== canonicalResults.length
    || new Set(canonicalResults.map(({ stored }) => stored.rootActionId)).size !== 1
  ) return rejected("invalidRulesInput", "Continuation batch entries are unavailable, duplicated, or cross-root.");

  const causal = fulfillCausalActionProgramRandomnessBatch(
    profiles,
    state,
    canonicalResults.map(({ continuation, rolls }) => ({ continuation, rolls })),
  );
  if (causal !== undefined) return causal;

  const isCanonicalContest = canonicalResults.length === 2
    && canonicalResults.every(({ stored }) =>
      stored.request.purpose === "contestCheck"
      && isRecord(stored.resolutionPlan)
      && "schema" in stored.resolutionPlan
      && stored.resolutionPlan.schema === "zhuwei.contest-resolution-plan/v1");
  if (!isCanonicalContest) {
    let next = state;
    const events: EventEnvelope[] = [];
    let final: Exclude<StepResult, InitializedRulesResult | ReturnType<typeof rejected>> | undefined;
    const resolutions: JsonRecord[] = [];
    for (const entry of canonicalResults) {
      const outcome = fulfillAuthoritativeRandomness(profiles, next, {
        kind: "fulfillAuthoritativeRandomness",
        continuation: entry.continuation,
        rolls: entry.rolls,
      });
      if (outcome.kind === "rejected") return outcome;
      if (outcome.kind === "initialized" || outcome.kind === "awaitingRandomness") {
        return rejected("invalidWorldState", "A fulfilled continuation did not close its frozen randomness.");
      }
      events.push(...outcome.events);
      next = outcome.state;
      final = outcome;
      resolutions.push(outcome.mechanicalResult ?? {
        continuationId: entry.continuation.continuationId,
        resultKind: outcome.kind,
      });
    }
    if (final === undefined) return rejected("invalidRulesInput", "Continuation batch is empty.");
    return {
      ...final,
      events,
      state: next,
      cache: next,
      mechanicalResult: { kind: "continuationBatch", resolutions },
    };
  }

  const resolved = input.results.map((value) => {
    if (
      !isRecord(value)
      || !hasExactKeys(value, ["continuation", "rolls"])
      || !isRecord(value.continuation)
      || !hasExactKeys(value.continuation, ["capability", "continuationId", "kind"])
      || value.continuation.kind !== "roomAuthorityRandomness"
      || !isNonEmptyString(value.continuation.continuationId)
      || !isSha256(value.continuation.capability)
      || !Array.isArray(value.rolls)
      || !value.rolls.every((roll) => Number.isInteger(roll) && roll >= 1 && roll <= 20)
    ) throw new TypeError("contest randomness result is not canonical");
    const stored = state.internalContinuations[value.continuation.continuationId];
    if (
      stored === undefined
      || stored.continuation.capability !== value.continuation.capability
      || stored.request.purpose !== "contestCheck"
      || !isRecord(stored.resolutionPlan)
      || !("schema" in stored.resolutionPlan)
      || stored.resolutionPlan.schema !== "zhuwei.contest-resolution-plan/v1"
    ) throw new TypeError("contest continuation is unavailable");
    const request = stored.request;
    const expected = request.frozenCheck.mode === "normal" ? 1 : 2;
    if (value.rolls.length !== expected) throw new TypeError("contest roll count does not match");
    const selected = request.frozenCheck.mode === "advantage"
      ? Math.max(...value.rolls)
      : request.frozenCheck.mode === "disadvantage"
        ? Math.min(...value.rolls)
        : value.rolls[0];
    return {
      continuationId: value.continuation.continuationId,
      stored,
      rolls: [...value.rolls] as number[],
      selected,
      total: selected + Number(request.frozenCheck.modifier),
    };
  });
  const continuationIds = resolved.map(({ continuationId }) => continuationId);
  if (new Set(continuationIds).size !== resolved.length) {
    return rejected("invalidRulesInput", "Contest continuations must be unique.");
  }
  const plan = resolved[0].stored.resolutionPlan as ContestResolutionPlan;
  if (
    !isRecord(plan)
    || !isNonEmptyString(plan.initiatorId)
    || !isNonEmptyString(plan.defenderId)
    || !isNonEmptyString(plan.tieResult)
    || resolved.some(({ stored }) => canonicalSha256(stored.resolutionPlan) !== canonicalSha256(plan))
  ) return rejected("invalidRulesInput", "Contest resolution plans do not match.");
  const initiator = resolved.find(({ stored }) => stored.request.actorCharacterId === plan.initiatorId);
  const defender = resolved.find(({ stored }) => stored.request.actorCharacterId === plan.defenderId);
  if (initiator === undefined || defender === undefined) {
    return rejected("privateOrUnknownReference", "Contest participants do not match their frozen requests.");
  }

  let next = state;
  const events: EventEnvelope[] = [];
  let scopeProof: ScopeProof | undefined;
  let receipt: PublicReceipt | undefined;
  for (const entry of resolved) {
    if (entry.stored.request.purpose === "restHitDice") {
      return rejected("invalidWorldState", "Contest continuation changed randomness kind.");
    }
    scopeProof = createScopeProof(
      next,
      [`continuation:${entry.continuationId}`],
      [`receipt:${entry.stored.rootActionId}`],
      [],
    );
    const transition = createEventTransition(next, profiles, {
      rootActionId: entry.stored.rootActionId,
      resolutionId: entry.stored.request.resolutionId,
      eventType: "DiceRolled",
      payload: {
        randomnessId: entry.stored.request.randomnessId,
        resolutionId: entry.stored.request.resolutionId,
        formula: entry.stored.request.diceExpression,
        faces: entry.rolls,
        selectedFace: entry.selected,
        requestHash: canonicalSha256(entry.stored.request),
        frozenParametersHash: canonicalSha256("frozenCheck" in entry.stored.request
          ? entry.stored.request.frozenCheck
          : entry.stored.request.frozenParameters),
      },
      scopeProof,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    });
    events.push(transition.event);
    next = transition.state;
    receipt = transition.receipt;
  }
  const winnerId = initiator.total === defender.total
    ? null
    : initiator.total > defender.total ? plan.initiatorId : plan.defenderId;
  const outcome = winnerId === null
    ? plan.tieResult
    : winnerId === plan.initiatorId ? "initiatorWon" : "defenderWon";
  scopeProof = createScopeProof(
    next,
    continuationIds.map((id) => `continuation:${id}`),
    [`receipt:${resolved[0].stored.rootActionId}`],
    [],
  );
  const transition = createEventTransition(next, profiles, {
    rootActionId: resolved[0].stored.rootActionId,
    eventType: "ContestResolved",
    payload: {
      initiatorId: plan.initiatorId,
      defenderId: plan.defenderId,
      initiatorRolls: initiator.rolls,
      defenderRolls: defender.rolls,
      initiatorTotal: initiator.total,
      defenderTotal: defender.total,
      winnerId,
      outcome,
      continuationIds: [...continuationIds].sort(),
    },
    scopeProof,
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
  });
  events.push(transition.event);
  next = transition.state;
  receipt = transition.receipt;
  return {
    kind: "committed",
    events,
    state: next,
    cache: next,
    stateHash: transition.event.stateHashAfter,
    scopeProof,
    receipt,
    mechanicalResult: {
      kind: "contest",
      initiatorId: plan.initiatorId,
      defenderId: plan.defenderId,
      initiatorTotal: initiator.total,
      defenderTotal: defender.total,
      winnerId,
      outcome,
    },
  } as StepResult;
}

export function stepAuthoritativeWorld(
  profiles: RuntimeProfileManifest,
  stateValue: unknown,
  input: unknown,
): StepResult {
  if (!isAuthoritativeWorldState(stateValue)) {
    return rejected("invalidWorldState", "Rules step requires a canonical authoritative-v2 state.");
  }
  if (!isRecord(input) || !isNonEmptyString(input.kind)) {
    return rejected("invalidRulesInput", "Rules step input must be a structured proposal.");
  }
  try {
    const safetyResult = stepSafetyWorld(profiles, stateValue, input);
    if (safetyResult !== undefined) {
      return safetyResult;
    }
    const environmentResult = stepEnvironmentWorld(profiles, stateValue, input);
    if (environmentResult !== undefined) {
      return environmentResult;
    }
    const vNextWorldInteractionResult = stepVNextWorldInteraction(profiles, stateValue, input);
    if (vNextWorldInteractionResult !== undefined) {
      return vNextWorldInteractionResult;
    }
    const dueActivityResult = settleDueActivityBeforeInput(profiles, stateValue, input);
    if (dueActivityResult !== undefined) {
      return dueActivityResult;
    }
    const multiplayerResult = stepMultiplayerWorld(profiles, stateValue, input);
    if (multiplayerResult !== undefined) {
      return multiplayerResult;
    }
    const socialAnswer = answerSocialResolution(profiles, stateValue, input);
    if (socialAnswer !== undefined) {
      return socialAnswer;
    }
    const causalResult = stepCausalActionProgram(profiles, stateValue, input);
    if (causalResult !== undefined) {
      return causalResult;
    }
    const actorPlanResult = stepActorPlanMechanics(profiles, stateValue, input);
    if (actorPlanResult !== undefined) {
      return actorPlanResult;
    }
    const combatResult = stepCombatWorld(profiles, stateValue, input);
    if (combatResult !== undefined) {
      return combatResult;
    }
    const campaignResult = stepCampaignWorld(profiles, stateValue, input);
    if (campaignResult !== undefined) {
      return campaignResult;
    }
    switch (input.kind) {
      case "resolveImprovisedAction":
        return resolveImprovisedAction(profiles, stateValue, input);
      case "answerPendingInput":
        return answerPendingInput(profiles, stateValue, input);
      case "applyServiceCorrection":
        return applyServiceCorrection(profiles, stateValue, input);
      case "fulfillAuthoritativeRandomness":
        return fulfillAuthoritativeRandomness(profiles, stateValue, input);
      case "fulfillAuthoritativeRandomnessBatch":
        return fulfillAuthoritativeRandomnessBatch(profiles, stateValue, input);
      default:
        return rejected("unsupportedOperation", "No authoritative-v2 adapter is registered for this input kind.");
    }
  } catch {
    return rejected("invalidRulesInput", "The proposal cannot produce a canonical typed event.");
  }
}
