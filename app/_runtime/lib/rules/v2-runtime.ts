import {
  createRuntimeProfileRegistry,
  PRODUCTION_RUNTIME_PROFILE_REGISTRY,
  resolveRuntimeProfileManifest,
} from "./profiles/registry";
import type {
  RuntimeInterpreterRegistration,
  RuntimeProfileRegistry,
} from "./profiles/registry";
import type { ProfileRef, RuntimeProfileManifest } from "./profiles/types";
import { causalActionInterpreterEnabled } from "./profiles/causal-action-interpreter";
import { canonicalSha256 } from "./profiles/canonical";
import { environmentProfileEnabled } from "./profiles/environment";
import { isCanonicalTacticalGeometry } from "./profiles/tactical-geometry";
import {
  eventHash,
  foldEvent,
  validateEventEnvelope,
} from "./v2/events";
import {
  initializeAuthoritativeWorld,
  stepAuthoritativeWorld,
} from "./v2/actions";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  JsonRecord,
  KpViewer,
  NpcViewer,
  PlayerViewer,
  ProjectionQuery,
  ProjectionResult,
  ReplayResult,
  ReplayedRulesResult,
  RuntimeGenesis,
  StepResult,
} from "./v2/model";
import { projectWorld } from "./v2/projector";
import { rejected } from "./v2/results";
import {
  isCurrentCausalResolutionMarker,
  isCausalProgramFactValue,
  isCausalActionResolutionPlan,
  isCausalContinuationStateBinding,
  isCausalRandomnessEventBinding,
} from "./v2/causal-model";
import {
  hashWorldState,
  isAuthoritativeWorldState,
  isGenesisIntegrityValid,
  isRecord,
  isRuntimeGenesis,
} from "./v2/validation";
import { characterProficiencyFieldsMatchProfile } from "./v2/proficiency";
import { socialResolutionProfileEnabled } from "./profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "./profiles/npc-mechanics";
import {
  isNpcSocialMechanics,
  isSocialContinuationStateBinding,
  isSocialRandomnessEventBinding,
  isSocialResolutionPlan,
} from "./v2/social-model";
import {
  isNpcMechanicalTemplateDefinition,
  NPC_MECHANICAL_TEMPLATE_KIND,
  npcCoreCombatRuntimeMatches,
  npcMechanicalDefinitionClosureValid,
  npcMechanicalEntityMatchesTemplate,
} from "./v2/npc-mechanics";
import { isItemSystemStateV1 } from "./v2/items";
import { worldInteractionProfileEnabled } from "./profiles/vnext-world-interaction";
import { isStoredSemanticDefinition } from "./v2/semantic-definitions";
import { isWorldInteractionResolutionPlan } from "./v2/world-interaction-model";
import { isWorldInteractionContinuationStateBinding } from "./v2/world-interactions";

function profilesMatch(left: ProfileRef, right: ProfileRef): boolean {
  return left.profileId === right.profileId && left.profileHash === right.profileHash;
}

function stateModuleMatchesGenesis(
  state: AuthoritativeWorldState,
  genesis: RuntimeGenesis,
): boolean {
  const ref = state.campaignRuntime.campaign?.moduleRef;
  return isRecord(ref)
    && typeof ref.profileId === "string"
    && typeof ref.profileHash === "string"
    && profilesMatch(ref as ProfileRef, genesis.moduleRef);
}

function stateProfileRejection(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): ReturnType<typeof rejected> | undefined {
  return profilesMatch(profiles.manifest, state.runtimeManifestRef)
    ? undefined
    : rejected(
      "runtimeProfileMismatch",
      "The provided runtime manifest does not match the manifest pinned by this room epoch.",
    );
}

function stateEnvironmentProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  return Object.values(state.combatRuntime.scenes).every((scene) => {
    const geometry = isRecord(scene) ? scene.geometry : undefined;
    if (geometry === undefined) return true;
    if (!isRecord(geometry) || !Array.isArray(geometry.obstacles)) return false;
    const hasEnvironmentBinding = geometry.obstacles.some((feature) =>
      isRecord(feature) && feature.environment !== undefined);
    // A scene without executable environment bindings may use the compact
    // `{ unit, obstacles }` shape; executable bindings require full geometry.
    if (!hasEnvironmentBinding) return true;
    if (!isCanonicalTacticalGeometry(geometry)) return false;
    return geometry.obstacles.every((feature) => feature.environment === undefined
      || environmentProfileEnabled(profiles.extensions, feature.environment.profile));
  });
}

function stateCharacterProficiencyProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  return Object.values(state.entities).every((entity) =>
    characterProficiencyFieldsMatchProfile(profiles, entity))
    && Object.values(state.combatRuntime.entities).every((entity) =>
      !isRecord(entity)
      || entity.kind !== "player"
      || characterProficiencyFieldsMatchProfile(profiles, entity));
}

function stateCausalActionProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  const causalContinuations = Object.entries(state.internalContinuations)
    .filter(([, continuation]) => continuation.resolutionPlan !== undefined
      && isCurrentCausalResolutionMarker(continuation.resolutionPlan));
  const causalPlans = causalContinuations
    .flatMap(([, continuation]) => continuation.resolutionPlan === undefined
      ? []
      : [continuation.resolutionPlan]);
  const causalFacts = Object.values(state.canonicalFacts)
    .filter((fact) => fact.kind === "causalActionProgram");
  if (causalPlans.length === 0 && causalFacts.length === 0) return true;
  return causalActionInterpreterEnabled(profiles.extensions)
    && causalFacts.every((fact) =>
      fact.source === "characterAction"
      && fact.subjectRefs.length === 1
      && state.entities[fact.subjectRefs[0]]?.kind === "player"
      && isCausalProgramFactValue(fact.value))
    && causalPlans.every(isCausalActionResolutionPlan)
    && causalContinuations.every(([continuationId, continuation]) =>
      isCausalContinuationStateBinding(profiles, state, continuationId, continuation));
}

function stateSocialResolutionProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  const markedContinuations = Object.entries(state.internalContinuations)
    .filter(([, continuation]) => {
      const plan = continuation.resolutionPlan as unknown;
      return isRecord(plan) && plan.schema === "zhuwei.social-resolution-plan/v1";
    });
  const socialMechanics = Object.values(state.entities)
    .filter((entity) => entity.socialMechanics !== undefined);
  const characterPremises = Object.values(state.canonicalFacts)
    .filter((fact) => fact.kind === "characterPremise");
  const dynamicKnowledgeGrants = Object.values(state.canonicalFacts)
    .filter((fact) => fact.kind === "dynamicEntityKnowledgeGrant");
  const typedAssertionFacts = Object.values(state.canonicalFacts)
    .filter((fact) => fact.kind === "typedAssertionFact");
  const socialDefinitions = Object.values(state.campaignRuntime.definitions)
    .filter((definition) => isRecord(definition.content)
      && (definition.content.schema === "zhuwei.dynamic-npc-definition/v1"
        || definition.content.sourceKind === "characterPremiseOpenBlank"));
  const hasArtifacts = state.campaignRuntime.conversationThreads !== undefined
    || markedContinuations.length > 0
    || socialMechanics.length > 0
    || characterPremises.length > 0
    || dynamicKnowledgeGrants.length > 0
    || typedAssertionFacts.length > 0
    || socialDefinitions.length > 0;
  if (!socialResolutionProfileEnabled(profiles.extensions)) return !hasArtifacts;
  return state.campaignRuntime.conversationThreads !== undefined
    && characterPremises.every((fact) =>
      fact.source === "dynamicMaterialization"
      && fact.subjectRefs.length === 1
      && state.entities[fact.subjectRefs[0]]?.kind === "player"
      && isRecord(fact.value)
      && fact.value.schema === "zhuwei.character-premise/v2"
      && typeof fact.value.policyRef === "string"
      && Array.isArray(fact.value.anchorRefs)
      && Array.isArray(fact.value.bindings))
    && dynamicKnowledgeGrants.every((fact) =>
      fact.source === "dynamicMaterialization"
      && isRecord(fact.value)
      && fact.value.schema === "zhuwei.dynamic-entity-knowledge-grant/v1"
      && typeof fact.value.recipientEntityRef === "string"
      && typeof fact.value.sourcePremiseFactRef === "string"
      && state.canonicalFacts[fact.value.sourcePremiseFactRef]?.kind === "characterPremise")
    && typedAssertionFacts.every((fact) =>
      fact.source === "dynamicMaterialization"
      && isRecord(fact.value)
      && fact.value.schema === "zhuwei.typed-assertion-fact/v1"
      && typeof fact.value.sourcePremiseFactRef === "string"
      && state.canonicalFacts[fact.value.sourcePremiseFactRef]?.kind === "characterPremise")
    && socialDefinitions.every((definition) =>
      isRecord(definition.content)
      && ((definition.content.schema === "zhuwei.dynamic-npc-definition/v1"
        && definition.definitionKind === "npc"
        && definition.content.entityId === definition.definitionId)
        || (definition.content.schema === "zhuwei.dynamic-open-definition/v1"
          && definition.content.entityRef === definition.definitionId)))
    && socialMechanics.every((entity) =>
      entity.kind === "npc" && isNpcSocialMechanics(entity.socialMechanics))
    && markedContinuations.every(([continuationId, continuation]) =>
      isSocialResolutionPlan(continuation.resolutionPlan)
      && isSocialContinuationStateBinding(
        profiles,
        state,
        continuationId,
        continuation,
      ));
}

function stateNpcMechanicsProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  const itemSystem = state.campaignRuntime.itemSystem;
  const mechanicalCatalog = {
    ...state.combatRuntime.definitions,
    ...itemSystem.definitions,
  };
  const campaignTemplates = Object.entries(state.campaignRuntime.definitions)
    .filter(([, definition]) => definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND);
  const combatTemplates = Object.entries(state.combatRuntime.definitions)
    .filter(([, definition]) => definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND);
  const mechanicalEntities = Object.values(state.combatRuntime.entities)
    .filter((entity) => isRecord(entity) && typeof entity.mechanicalDefinitionRef === "string");
  const hasArtifacts = campaignTemplates.length > 0
    || combatTemplates.length > 0
    || mechanicalEntities.length > 0;
  if (!npcMechanicsProfileEnabled(profiles.extensions)) return !hasArtifacts;
  if (campaignTemplates.length !== combatTemplates.length
    || campaignTemplates.some(([definitionId, definition]) =>
      !isNpcMechanicalTemplateDefinition(definition)
      || state.combatRuntime.definitions[definitionId] === undefined
      || canonicalSha256(state.combatRuntime.definitions[definitionId]) !== canonicalSha256(definition))
    || combatTemplates.some(([, definition]) =>
      !isNpcMechanicalTemplateDefinition(definition)
      || !npcMechanicalDefinitionClosureValid(definition, mechanicalCatalog))) {
    return false;
  }
  return mechanicalEntities.every((entity) => {
    const definitionRef = String(entity.mechanicalDefinitionRef);
    const definition = state.combatRuntime.definitions[definitionRef];
    const character = state.entities[String(entity.entityId)];
    return isNpcMechanicalTemplateDefinition(definition)
      && character !== undefined
      && npcMechanicalEntityMatchesTemplate(
        entity,
        definition,
        mechanicalCatalog,
        character,
        itemSystem,
      )
      && npcCoreCombatRuntimeMatches(character, entity);
  });
}

function stateWorldInteractionProfilesMatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
): boolean {
  const semanticDefinitions = Object.values(state.campaignRuntime.definitions)
    .filter((definition) => isRecord(definition)
      && definition.schema === "zhuwei.semantic-definition/vnext-1");
  const continuations = Object.entries(state.internalContinuations)
    .filter(([, continuation]) => isWorldInteractionResolutionPlan(continuation.resolutionPlan));
  const hasArtifacts = semanticDefinitions.length > 0 || continuations.length > 0;
  if (!worldInteractionProfileEnabled(profiles.extensions)) return !hasArtifacts;
  return semanticDefinitions.every(isStoredSemanticDefinition)
    && continuations.every(([continuationId]) =>
      isWorldInteractionContinuationStateBinding(state, continuationId));
}

function stateItemSystemMatches(
  state: AuthoritativeWorldState,
): boolean {
  const itemSystem = state.campaignRuntime.itemSystem;
  if (!isItemSystemStateV1(itemSystem)) return false;

  const loadoutLocations = new Map<string, {
    holderRef: string;
    equippedSlot: string | null;
    quantity: number | null;
  }>();
  for (const character of Object.values(state.entities)) {
    const loadout = character.loadout;
    if (loadout === undefined) continue;
    for (const [slot, entryId] of Object.entries(loadout.equipped)) {
      const entry = itemSystem.entries[entryId];
      if (loadoutLocations.has(entryId)
        || entry === undefined
        || entry.disposition !== "held"
        || entry.holderRef !== character.id
        || entry.equippedSlot !== slot
        || entry.condition !== "usable") return false;
      loadoutLocations.set(entryId, {
        holderRef: character.id,
        equippedSlot: slot,
        quantity: null,
      });
    }
    for (const backpackEntry of loadout.backpack) {
      const entry = itemSystem.entries[backpackEntry.itemId];
      if (entry === undefined
        || entry.disposition !== "held"
        || entry.holderRef !== character.id
        || entry.quantity !== backpackEntry.quantity) return false;
      const equippedLocation = loadoutLocations.get(backpackEntry.itemId);
      if (equippedLocation !== undefined) {
        if (equippedLocation.holderRef !== character.id
          || equippedLocation.equippedSlot !== "ammo"
          || entry.equippedSlot !== "ammo") return false;
        loadoutLocations.set(backpackEntry.itemId, {
          holderRef: character.id,
          equippedSlot: "ammo",
          quantity: backpackEntry.quantity,
        });
        continue;
      }
      if (entry.equippedSlot !== null) return false;
      loadoutLocations.set(backpackEntry.itemId, {
        holderRef: character.id,
        equippedSlot: null,
        quantity: backpackEntry.quantity,
      });
    }
  }

  return Object.values(itemSystem.entries).every((entry) => {
    if (entry.disposition === "scene") {
      return entry.sceneRef !== null && state.scenes[entry.sceneRef] !== undefined;
    }
    if (entry.disposition !== "held") return true;
    if (entry.holderRef === null || state.entities[entry.holderRef] === undefined) return false;
    const location = loadoutLocations.get(entry.entryId);
    return location !== undefined
      && location.holderRef === entry.holderRef
      && location.equippedSlot === entry.equippedSlot
      && (location.quantity === null || location.quantity === entry.quantity);
  });
}

function containsForbidden2024Semantics(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized.includes("dnd2024")
      || normalized.includes("d&d 2024")
      || normalized.includes("5.5e")
      || normalized === "latest"
      || /weapon[\s_-]*mastery/i.test(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbidden2024Semantics(entry, seen));
  }
  return Object.entries(value).some(
    ([key, entry]) => containsForbidden2024Semantics(key, seen)
      || containsForbidden2024Semantics(entry, seen),
  );
}

function profilesMatchEpoch(
  registry: RuntimeProfileRegistry,
  event: EventEnvelope,
  genesis: RuntimeGenesis,
): boolean {
  const resolution = resolveRuntimeProfileManifest(registry, event.profiles);
  if (!resolution.ok) {
    return false;
  }
  return profilesMatch(resolution.profiles.manifest, genesis.profiles.manifest);
}

function isContinuousEvent(
  registry: RuntimeProfileRegistry,
  event: EventEnvelope,
  state: AuthoritativeWorldState,
  genesis: RuntimeGenesis,
): boolean {
  const expectedEventSeq = (BigInt(state.version) + 1n).toString();
  const expectedCausalParents = state.lastEventId === null ? [] : [state.lastEventId];
  const timeline = state.fictionTimelines[event.fictionTimelineId];
  return event.roomId === genesis.roomId
    && event.runtimeEpochId === genesis.runtimeEpochId
    && event.eventSeq === expectedEventSeq
    && event.eventId === `event:${genesis.runtimeEpochId}:${expectedEventSeq}`
    && event.branchId === state.activeBranchId
    && timeline !== undefined
    && timeline.branchId === event.branchId
    && event.fictionInstantMicros === timeline.nowMicros
    && event.parentEventId === state.lastEventId
    && event.causalParentEventIds.length === expectedCausalParents.length
    && event.causalParentEventIds.every((entry, index) => entry === expectedCausalParents[index])
    && event.previousEventHash === state.eventHeadHash
    && event.stateBeforeHash === hashWorldState(state)
    && profilesMatchEpoch(registry, event, genesis);
}

/**
 * Reconstructs a room from genesis plus its closed, typed event log. Replay is
 * pure: it folds committed payloads and never recompiles definitions, rerolls,
 * reads a wall clock, or delegates historical events to the current adapter.
 */
function replayWithRegistry(
  registry: RuntimeProfileRegistry,
  genesisValue: unknown,
  eventsValue: unknown,
): ReplayResult {
  if (!isRecord(genesisValue) || !("profiles" in genesisValue)) {
    return rejected("invalidGenesis", "Replay requires a complete roomGenesis record.");
  }
  const genesisProfileResolution = resolveRuntimeProfileManifest(registry, genesisValue.profiles);
  if (!genesisProfileResolution.ok) {
    return rejected(
      genesisProfileResolution.rejection.code,
      genesisProfileResolution.rejection.message,
    );
  }
  if (!isRuntimeGenesis(genesisValue)) {
    return rejected("invalidGenesis", "roomGenesis is missing a required canonical field.");
  }
  if (!isGenesisIntegrityValid(genesisValue)) {
    return rejected(
      "archiveIntegrityMismatch",
      "roomGenesis state or hash commitment does not match canonical bytes.",
    );
  }
  if (!Array.isArray(eventsValue)) {
    return rejected("invalidReplayInput", "Replay events must be an ordered array.");
  }

  let state: JsonRecord;
  try {
    state = structuredClone(genesisValue.initialState);
  } catch {
    return rejected("invalidGenesis", "roomGenesis initial state is not cloneable canonical data.");
  }

  if (!isAuthoritativeWorldState(state)) {
    return rejected(
      "invalidWorldState",
      "The V5 genesis state is malformed or lacks its runtime manifest pin.",
    );
  }
  if (!stateModuleMatchesGenesis(state, genesisValue)) {
    return rejected(
      "profileIntegrityMismatch",
      "Genesis Campaign Module binding does not match roomGenesis.",
    );
  }
  if (isAuthoritativeWorldState(state)) {
    const mismatch = stateProfileRejection(genesisProfileResolution.profiles, state);
    if (mismatch !== undefined) {
      return mismatch;
    }
    if (!stateEnvironmentProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis environment bindings do not match the room manifest extensions.",
      );
    }
    if (!stateCharacterProficiencyProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis character proficiency fields do not match the room manifest extensions.",
      );
    }
    if (!stateCausalActionProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis V3 causal artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateSocialResolutionProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis social artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateItemSystemMatches(state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis item state does not match the room manifest extensions.",
      );
    }
    if (!stateNpcMechanicsProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis NPC mechanical artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateWorldInteractionProfilesMatch(genesisProfileResolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "Genesis semantic definitions or world interactions do not match the room manifest extensions.",
      );
    }
  }

  for (const eventValue of eventsValue) {
    if (!isAuthoritativeWorldState(state)) {
      return rejected("invalidWorldState", "Replay state left the authoritative-v2 schema.");
    }
    const validation = validateEventEnvelope(eventValue);
    if (!validation.ok) {
      return rejected("invalidEventEnvelope", validation.message);
    }
    const event = validation.event;
    const eventPayload = event.payload as unknown;
    const eventProfileResolution = resolveRuntimeProfileManifest(registry, event.profiles);
    if (!eventProfileResolution.ok) {
      return rejected(
        eventProfileResolution.rejection.code,
        eventProfileResolution.rejection.message,
      );
    }
    if (
      event.eventType === "RandomnessRequested"
      && isRecord(event.payload)
      && "resolutionPlan" in event.payload
      && isCurrentCausalResolutionMarker(event.payload.resolutionPlan)
      && !isCausalRandomnessEventBinding(
        eventProfileResolution.profiles,
        state,
        event.rootActionId,
        event.payload,
      )
    ) {
      return rejected(
        "invalidEventEnvelope",
        "Causal randomness request does not match its frozen program, actor, or capability.",
      );
    }
    if (
      event.eventType === "RandomnessRequested"
      && isRecord(eventPayload)
      && isRecord(eventPayload.resolutionPlan)
      && eventPayload.resolutionPlan.schema === "zhuwei.social-resolution-plan/v1"
      && !isSocialRandomnessEventBinding(
        eventProfileResolution.profiles,
        state,
        event.rootActionId,
        eventPayload,
      )
    ) {
      return rejected(
        "invalidEventEnvelope",
        "Social randomness request does not match its frozen offer, participants, or capability.",
      );
    }
    if (!isContinuousEvent(registry, event, state, genesisValue)) {
      return rejected(
        "archiveIntegrityMismatch",
        "Event sequence, branch, profile, causal, fiction-time, or previous hash commitment diverged.",
      );
    }
    try {
      const next = foldEvent(state, event);
      if (!isAuthoritativeWorldState(next)) {
        return rejected(
          "invalidWorldState",
          "Replayed state left the current 0.4 authoritative schema.",
        );
      }
      if (!stateModuleMatchesGenesis(next, genesisValue)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed Campaign Module binding diverged from roomGenesis.",
        );
      }
      if (!stateEnvironmentProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed environment bindings do not match the event manifest extensions.",
        );
      }
      if (!stateCharacterProficiencyProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed character proficiency fields do not match the event manifest extensions.",
        );
      }
      if (!stateCausalActionProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed V3 causal artifacts do not match the event manifest extensions.",
        );
      }
      if (!stateSocialResolutionProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed social artifacts do not match the event manifest extensions.",
        );
      }
      if (!stateItemSystemMatches(next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed item state does not match the event manifest extensions.",
        );
      }
      if (!stateNpcMechanicsProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed NPC mechanical artifacts do not match the event manifest extensions.",
        );
      }
      if (!stateWorldInteractionProfilesMatch(eventProfileResolution.profiles, next)) {
        return rejected(
          "profileIntegrityMismatch",
          "Replayed semantic definitions or world interactions do not match the event manifest extensions.",
        );
      }
      if (hashWorldState(next) !== event.stateHashAfter || eventHash(event) !== event.eventHash) {
        return rejected(
          "archiveIntegrityMismatch",
          "Folded state or event hash does not match its canonical commitment.",
        );
      }
      state = next;
    } catch {
      return rejected(
        "invalidEventEnvelope",
        "Typed event payload cannot be legally folded from the committed prior state.",
      );
    }
  }

  const eventSeq = isAuthoritativeWorldState(state) ? state.version : "0";
  const stateHash = hashWorldState(state);
  const eventHeadHash = isAuthoritativeWorldState(state)
    ? state.eventHeadHash
    : genesisValue.initialStateHash;
  return {
    kind: "replayed",
    interpreterKind: "authoritative",
    profiles: structuredClone(genesisProfileResolution.profiles),
    state,
    cache: structuredClone(state),
    head: {
      runtimeEpochId: genesisValue.runtimeEpochId,
      eventSeq,
      stateHash,
      genesisHash: genesisValue.genesisHash,
      eventHash: eventHeadHash,
    },
  } satisfies ReplayedRulesResult;
}

/** The sole observer projection seam; query channels are audit metadata only. */
function projectWithRegistry(
  registry: RuntimeProfileRegistry,
  profiles: unknown,
  state: unknown,
  viewer: PlayerViewer | NpcViewer | KpViewer | unknown,
  query?: ProjectionQuery,
): ProjectionResult {
  const resolution = resolveRuntimeProfileManifest(registry, profiles);
  if (!resolution.ok) {
    return rejected(resolution.rejection.code, resolution.rejection.message);
  }
  if (
    isRecord(state)
    && state.schema === "zhuwei.authoritative-world-state/v2"
    && !isAuthoritativeWorldState(state)
  ) {
    return rejected(
      "invalidWorldState",
      "Authoritative-v2 state is malformed or lacks its runtime manifest pin.",
    );
  }
  if (isAuthoritativeWorldState(state)) {
    const mismatch = stateProfileRejection(resolution.profiles, state);
    if (mismatch !== undefined) {
      return mismatch;
    }
    if (!stateEnvironmentProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State environment bindings do not match the room manifest extensions.",
      );
    }
    if (!stateCharacterProficiencyProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State character proficiency fields do not match the room manifest extensions.",
      );
    }
    if (!stateCausalActionProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State V3 causal artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateSocialResolutionProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State social artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateItemSystemMatches(state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State item records do not match the room manifest extensions.",
      );
    }
    if (!stateNpcMechanicsProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State NPC mechanical artifacts do not match the room manifest extensions.",
      );
    }
    if (!stateWorldInteractionProfilesMatch(resolution.profiles, state)) {
      return rejected(
        "profileIntegrityMismatch",
        "State semantic definitions or world interactions do not match the room manifest extensions.",
      );
    }
  }
  return projectWorld(resolution.profiles, state, viewer, query);
}

/**
 * The sole public mechanical transition seam. Initialization is the one case
 * where callers provide neither a profile nor mutable state; Rules pins both.
 */
function stepWithRegistry(
  registry: RuntimeProfileRegistry,
  profiles: unknown,
  state: unknown,
  input: unknown,
): StepResult {
  if (isRecord(input) && input.kind === "initializeAuthoritativeWorld") {
    const initializationProfiles = profiles === undefined || profiles === null
      ? { ok: true as const, profiles: registry.defaultManifest }
      : resolveRuntimeProfileManifest(registry, profiles);
    if (!initializationProfiles.ok) {
      return rejected(
        initializationProfiles.rejection.code,
        initializationProfiles.rejection.message,
      );
    }
    const initialized = initializeAuthoritativeWorld(
      initializationProfiles.profiles,
      undefined,
      state,
      input,
    );
    if (initialized.kind !== "initialized") return initialized;
    if (!isAuthoritativeWorldState(initialized.genesis.initialState)
      || !stateItemSystemMatches(initialized.genesis.initialState)) {
      return rejected(
        "profileIntegrityMismatch",
        "Initialized item state does not match the selected room manifest extensions.",
      );
    }
    return initialized;
  }
  const resolution = resolveRuntimeProfileManifest(registry, profiles);
  if (!resolution.ok) {
    return rejected(resolution.rejection.code, resolution.rejection.message);
  }
  if (!isRecord(input)) {
    return rejected("invalidRulesInput", "Rules step input must be a structured proposal.");
  }
  if (containsForbidden2024Semantics(input)) {
    return rejected(
      "unsupportedRulesBasis",
      "Only SRD 5.1 / D&D 5e 2014 mechanics are accepted by this runtime.",
      [{
        code: "unsupportedRulesBasis",
        message: "dnd2024, 5.5e, latest, and Weapon Mastery semantics are outside this ruleset.",
        path: "input",
        source: "SPEC 0013",
        visibility: "public",
      }],
    );
  }
  if (!isAuthoritativeWorldState(state)) {
    if (input.kind === "registerAbilityDefinition" && isRecord(state)) {
      return rejected(
        "unsupportedOperation",
        "The authoritative Ability compiler adapter is not enabled in this runtime slice.",
      );
    }
    return rejected("invalidWorldState", "Rules step requires a canonical authoritative-v2 state.");
  }
  const mismatch = stateProfileRejection(resolution.profiles, state);
  if (mismatch !== undefined) {
    return mismatch;
  }
  if (!stateEnvironmentProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State environment bindings do not match the room manifest extensions.",
    );
  }
  if (!stateCharacterProficiencyProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State character proficiency fields do not match the room manifest extensions.",
    );
  }
  if (!stateCausalActionProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State V3 causal artifacts do not match the room manifest extensions.",
    );
  }
  if (!stateSocialResolutionProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State social artifacts do not match the room manifest extensions.",
    );
  }
  if (!stateItemSystemMatches(state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State item records do not match the room manifest extensions.",
    );
  }
  if (!stateNpcMechanicsProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State NPC mechanical artifacts do not match the room manifest extensions.",
    );
  }
  if (!stateWorldInteractionProfilesMatch(resolution.profiles, state)) {
    return rejected(
      "profileIntegrityMismatch",
      "State semantic definitions or world interactions do not match the room manifest extensions.",
    );
  }
  return stepAuthoritativeWorld(resolution.profiles, state, input);
}

export type VersionedRulesRuntime = {
  replay: (genesisValue: unknown, eventsValue: unknown) => ReplayResult;
  project: (
    profiles: unknown,
    state: unknown,
    viewer: PlayerViewer | NpcViewer | KpViewer | unknown,
    query?: ProjectionQuery,
  ) => ProjectionResult;
  step: (profiles: unknown, state: unknown, input: unknown) => StepResult;
};

function runtimeForRegistry(registry: RuntimeProfileRegistry): VersionedRulesRuntime {
  return {
    replay: (genesisValue, eventsValue) => replayWithRegistry(registry, genesisValue, eventsValue),
    project: (profiles, state, viewer, query) =>
      projectWithRegistry(registry, profiles, state, viewer, query),
    step: (profiles, state, input) => stepWithRegistry(registry, profiles, state, input),
  };
}

/** Internal construction seam used by conformance tests and future shipped adapters. */
export function createVersionedRulesRuntime(config: {
  registrations: readonly RuntimeInterpreterRegistration[];
  defaultManifest: ProfileRef;
}): VersionedRulesRuntime {
  return runtimeForRegistry(createRuntimeProfileRegistry(config));
}

const productionRuntime = runtimeForRegistry(PRODUCTION_RUNTIME_PROFILE_REGISTRY);

export const replay = productionRuntime.replay;
export const project = productionRuntime.project;
export const step = productionRuntime.step;

export type {
  AuthoritativeWorldState,
  AwaitingInputRulesResult,
  AwaitingRandomnessRulesResult,
  CommittedRulesResult,
  ConcludedRulesResult,
  EventEnvelope,
  EventPayloadByType,
  InitializedRulesResult,
  KpSpatialReadModel,
  KpViewer,
  NeedsKpRulesResult,
  NpcViewer,
  PlayerViewer,
  ProjectionQuery,
  ProjectionResult,
  RejectedRulesResult,
  ReplayHead,
  ReplayResult,
  ReplayedRulesResult,
  RuleDiagnostic,
  RulesRejection,
  RulesRejectionCode,
  RuntimeGenesis,
  SafeReadModel,
  ScopeProof,
  StepResult,
} from "./v2/model";
