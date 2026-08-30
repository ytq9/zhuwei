import {
  buildContextPack,
  createRequiredContext,
  type ContextPack,
  type ContextRecord,
  type ContextValue,
  type ExperiencedDialogue,
  type OptionalContextItem,
  type RetrievedContextChunk,
} from "./context-pack";
import type { FormSelectionSignals } from "./form-catalog";
import type { KpProposalRequest } from "./authoritative-types";
import { NPC_MECHANICS_PROFILE } from "../rules/profiles/npc-mechanics";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function contextValue(value: unknown, depth = 0): ContextValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (depth >= 12) return "[bounded]";
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => contextValue(entry, depth + 1));
  }
  if (!isRecord(value)) return null;
  const result: Record<string, ContextValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = contextValue(value[key], depth + 1);
  }
  return result;
}

function contextRecord(value: unknown): ContextRecord {
  const converted = contextValue(isRecord(value) ? value : {});
  return isRecord(converted) ? converted as ContextRecord : {};
}

function records(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? Object.values(value).filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(nonEmptyString))].sort()
    : [];
}

function firstString(value: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) if (nonEmptyString(value[key])) return value[key];
  return undefined;
}

function refList(value: unknown, keys: readonly string[]): string[] {
  return records(value)
    .flatMap((entry) => {
      const ref = firstString(entry, keys);
      return ref === undefined ? [] : [ref];
    })
    .filter((ref, index, all) => all.indexOf(ref) === index)
    .sort();
}

function runtimeHasNpcMechanics(runtimeProfiles: UnknownRecord): boolean {
  return records(runtimeProfiles.extensions).some((extension) =>
    extension.profileId === NPC_MECHANICS_PROFILE.profileId
    && extension.profileHash === NPC_MECHANICS_PROFILE.profileHash);
}

function projectedLoadout(value: unknown): ContextRecord | undefined {
  if (!isRecord(value)) return undefined;
  const equipped = isRecord(value.equipped) ? contextRecord(value.equipped) : {};
  const backpack = records(value.backpack).flatMap((entry) => {
    const itemRef = firstString(entry, ["itemRef", "itemId"]);
    if (itemRef === undefined || !Number.isSafeInteger(entry.quantity)) return [];
    return [contextRecord({ itemRef, quantity: entry.quantity })];
  });
  const mechanicalItems = isRecord(value.mechanicalItems)
    ? contextRecord(Object.fromEntries(Object.entries(value.mechanicalItems)
        .filter((entry): entry is [string, UnknownRecord] => isRecord(entry[1]))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemRef, item]) => [itemRef, contextRecord({
          definitionRef: item.definitionRef ?? null,
          sourceKind: item.sourceKind ?? null,
          status: item.status ?? null,
        })])))
    : undefined;
  return contextRecord({
    armorClass: value.armorClass ?? null,
    speedFeet: value.speedFeet ?? null,
    equipped,
    backpack,
    ...(mechanicalItems === undefined ? {} : { mechanicalItems }),
  });
}

function dialogueFromProjection(value: unknown): ExperiencedDialogue[] {
  const transcript = isRecord(value) ? value : {};
  return records(transcript.messages).flatMap((message, index) => {
    if (!nonEmptyString(message.body)) return [];
    const messageRef = firstString(message, ["messageId", "id"])
      ?? `experienced-message:${index + 1}`;
    const speakerRef = firstString(message, ["speakerCharacterId", "characterId", "speakerName"])
      ?? (message.kind === "kp" ? "speaker:kp" : "speaker:unknown");
    const fictionalTimeRef = firstString(message, ["fictionalTimeRef", "sourceEventSeq", "receiptId"])
      ?? `experienced-order:${index + 1}`;
    return [{
      messageRef,
      speakerRef,
      body: message.body.slice(0, 1_200),
      fictionalTimeRef,
    }];
  });
}

function inputText(input: unknown): string {
  if (!isRecord(input)) return "未提供可解释的玩家输入";
  for (const key of ["text", "displayText", "answer"] as const) {
    if (nonEmptyString(input[key])) return input[key].slice(0, 4_000);
  }
  if (isRecord(input.answer) && nonEmptyString(input.answer.text)) {
    return input.answer.text.slice(0, 4_000);
  }
  return JSON.stringify(contextValue(input)).slice(0, 4_000);
}

function relevantSpatialEvidence(projection: UnknownRecord, sceneRef: string): ContextRecord {
  const spatial = isRecord(projection.spatialEvidence) ? projection.spatialEvidence : {};
  const scenes = records(spatial.scenes);
  const entities = records(spatial.entities);
  const scene = scenes.find((entry) => firstString(entry, ["sceneId", "id"]) === sceneRef);
  const sceneEntities = entities.filter((entry) => {
    const entityScene = firstString(entry, ["sceneId", "sceneRef"]);
    return entityScene === undefined || entityScene === sceneRef;
  });
  return contextRecord({
    sceneRef,
    ...(scene === undefined ? {} : { scene }),
    entities: sceneEntities,
  });
}

function relevantNpcMechanicalContext(
  projection: UnknownRecord,
  sceneRef: string,
): ContextRecord | undefined {
  if (!isRecord(projection.npcMechanicalDefinitions)) return undefined;
  const spatial = isRecord(projection.spatialEvidence) ? projection.spatialEvidence : {};
  const entities = records(spatial.entities)
    .filter((entry) => firstString(entry, ["sceneId", "sceneRef"]) === sceneRef)
    .flatMap((entry) => {
      const entityRef = firstString(entry, ["id", "entityId"]);
      const definitionRef = firstString(entry, ["mechanicalDefinitionRef", "definitionRef"]);
      if (entityRef === undefined || definitionRef === undefined) return [];
      return [{
        entityRef,
        name: nonEmptyString(entry.name) ? entry.name : entityRef,
        mechanicalDefinitionRef: definitionRef,
      }];
    })
    .sort((left, right) => left.entityRef.localeCompare(right.entityRef));
  const definitions = records(projection.npcMechanicalDefinitions)
    .filter((entry) => firstString(entry, ["definitionRef", "definitionId", "id"]) !== undefined)
    .sort((left, right) => String(left.definitionRef ?? left.definitionId ?? left.id)
      .localeCompare(String(right.definitionRef ?? right.definitionId ?? right.id)));
  const itemDefinitions = records(projection.npcMechanicalItemDefinitions)
    .filter((entry) => firstString(entry, ["definitionRef", "definitionId", "id"]) !== undefined)
    .sort((left, right) => String(left.definitionRef ?? left.definitionId ?? left.id)
      .localeCompare(String(right.definitionRef ?? right.definitionId ?? right.id)));
  if (entities.length > 24 || definitions.length > 24 || itemDefinitions.length > 48) {
    throw new Error("CONTEXT_INSUFFICIENT");
  }
  return contextRecord({ entities, definitions, itemDefinitions });
}

function relevantEncounter(actorProjection: UnknownRecord, sceneRef: string): UnknownRecord | null {
  const encounters = records(actorProjection.encounters);
  return encounters.find((entry) => {
    const encounterScene = firstString(entry, ["sceneId", "sceneRef"]);
    return encounterScene === undefined || encounterScene === sceneRef;
  }) ?? null;
}

function runtimeBindingRef(value: unknown): string | undefined {
  if (!isRecord(value)
    || !nonEmptyString(value.profileId)
    || !nonEmptyString(value.profileHash)) return undefined;
  return value.profileId;
}

function coreTruthConstraints(projection: UnknownRecord, sceneRef: string): ContextValue {
  const storyBible = isRecord(projection.storyBible) ? projection.storyBible : {};
  const anchors = isRecord(storyBible.storyAnchors) ? storyBible.storyAnchors : {};
  const location = records(anchors.locations).find((entry) =>
    firstString(entry, ["sceneId", "sceneRef", "id"]) === sceneRef);
  const chapterId = location === undefined
    ? undefined
    : firstString(location, ["chapterId", "chapterRef"]);
  const chapter = chapterId === undefined
    ? undefined
    : records(anchors.chapters).find((entry) =>
        firstString(entry, ["chapterId", "chapterRef", "id"]) === chapterId);
  return contextValue({
    currentChapter: chapter ?? null,
    currentLocation: location === undefined
      ? null
      : {
          sceneId: firstString(location, ["sceneId", "sceneRef", "id"]) ?? sceneRef,
          chapterId: chapterId ?? null,
          name: location.name ?? null,
          location: location.location ?? null,
          publicOpening: location.publicOpening ?? null,
          conflictAnchor: location.conflictAnchor ?? null,
        },
  });
}

function premiseCatalog(projection: UnknownRecord): ContextValue {
  const storyBible = isRecord(projection.storyBible) ? projection.storyBible : {};
  const catalog = isRecord(storyBible.premiseCatalog) ? storyBible.premiseCatalog : null;
  return contextValue(catalog);
}

function premiseCatalogRefs(projection: UnknownRecord): string[] {
  const storyBible = isRecord(projection.storyBible) ? projection.storyBible : {};
  const catalog = isRecord(storyBible.premiseCatalog) ? storyBible.premiseCatalog : {};
  return [
    ...records(catalog.policies).flatMap((policy) =>
      nonEmptyString(policy.policyRef) ? [policy.policyRef] : []),
    ...records(catalog.archetypes).flatMap((archetype) =>
      nonEmptyString(archetype.archetypeRef) ? [archetype.archetypeRef] : []),
  ].filter((reference, index, all) => all.indexOf(reference) === index).sort();
}

function boundedNpcKnowledge(value: unknown): ContextRecord[] {
  const entries = records(value).sort((left, right) => {
    const leftMicros = nonEmptyString(left.acquiredAtFictionMicros)
      && /^(?:0|[1-9][0-9]*)$/u.test(left.acquiredAtFictionMicros)
      ? BigInt(left.acquiredAtFictionMicros)
      : -1n;
    const rightMicros = nonEmptyString(right.acquiredAtFictionMicros)
      && /^(?:0|[1-9][0-9]*)$/u.test(right.acquiredAtFictionMicros)
      ? BigInt(right.acquiredAtFictionMicros)
      : -1n;
    if (leftMicros !== rightMicros) return leftMicros < rightMicros ? 1 : -1;
    return String(right.knowledgeRef ?? "").localeCompare(String(left.knowledgeRef ?? ""));
  });
  return entries.slice(0, 12).map((entry) => contextRecord({
    knowledgeRef: firstString(entry, ["knowledgeRef", "claimId", "id"]) ?? null,
    kind: entry.objectKind ?? entry.kind ?? null,
    layer: entry.layer ?? null,
    content: entry.content ?? entry.body ?? null,
    provenanceChain: strings(entry.provenanceChain).slice(0, 12),
  }));
}

function boundedNpcPlans(value: unknown): ContextRecord[] {
  return records(value)
    .sort((left, right) => {
      const priority = (entry: UnknownRecord) => entry.status === "scheduled" ? 0
        : entry.status === "active" ? 1 : 2;
      const byStatus = priority(left) - priority(right);
      return byStatus !== 0
        ? byStatus
        : String(right.dueAtMicros ?? "").localeCompare(String(left.dueAtMicros ?? ""));
    })
    .slice(0, 8).map((entry) => contextRecord({
    planId: firstString(entry, ["planId", "goalId", "id"]) ?? null,
    goal: entry.goal ?? null,
    nextStep: entry.nextStep ?? null,
    trigger: entry.trigger ?? null,
    status: entry.status ?? null,
    dueAtMicros: entry.dueAtMicros ?? null,
    resourceRefs: strings(entry.resourceRefs).slice(0, 12),
    knowledgeRefs: strings(entry.knowledgeRefs).slice(0, 12),
  }));
}

function relevantSocialThreads(
  actorProjection: UnknownRecord,
  characterRef: string,
  sameSceneNpcRefs: ReadonlySet<string>,
): ContextRecord[] {
  const threads = records(actorProjection.conversationThreads)
    .filter((thread) => thread.actorCharacterId === characterRef
      && nonEmptyString(thread.threadRef)
      && nonEmptyString(thread.npcCharacterId)
      && sameSceneNpcRefs.has(thread.npcCharacterId)
      && thread.status === "active");
  if (threads.length > 12) throw new Error("CONTEXT_INSUFFICIENT");
  const eventOrdinal = (value: unknown): bigint => {
    if (!nonEmptyString(value)) return -1n;
    const match = /:([0-9]+)$/u.exec(value);
    return match === null ? -1n : BigInt(match[1]);
  };
  return threads
    .sort((left, right) => {
      const leftOrdinal = eventOrdinal(left.updatedByEventId);
      const rightOrdinal = eventOrdinal(right.updatedByEventId);
      return leftOrdinal === rightOrdinal
        ? String(left.threadRef).localeCompare(String(right.threadRef))
        : leftOrdinal < rightOrdinal ? -1 : 1;
    })
    .map((thread) => {
      const semantics = isRecord(thread.claimSemantics) ? thread.claimSemantics : {};
      return contextRecord({
        threadRef: thread.threadRef,
        npcRef: thread.npcCharacterId,
        claimRef: thread.claimRef ?? null,
        claimTruthStatus: thread.claimTruthStatus ?? "unresolved",
        topicFingerprint: thread.topicFingerprint ?? null,
        assertion: isRecord(semantics.assertion) ? semantics.assertion : null,
        status: thread.status,
        resolution: thread.resolution ?? null,
        degree: thread.degree ?? null,
        immediateBehavior: thread.immediateBehavior ?? null,
        outcome: thread.outcome ?? null,
      });
    });
}

function relevantNpcViews(
  projection: UnknownRecord,
  sceneRef: string,
  includeNpcMechanics: boolean,
) {
  const sameScene = Object.entries(isRecord(projection.npcViewers) ? projection.npcViewers : {})
    .filter((entry): entry is [string, UnknownRecord] => isRecord(entry[1]))
    .flatMap(([npcRef, npcView]) => {
      const controlled = isRecord(npcView.controlledCharacter)
        ? npcView.controlledCharacter
        : {};
      const npcSceneRef = firstString(controlled, ["sceneId", "sceneRef"]);
      // Free-form player prose is not an authenticated communication channel.
      // Only NPCs projected into the actor's current scene may contribute
      // private knowledge or plans to the primary KP context.
      if (npcSceneRef !== sceneRef) return [];
      const knowledge = boundedNpcKnowledge(npcView.knowledge);
      const plans = boundedNpcPlans(npcView.npcPlans);
      const socialCapabilities = isRecord(controlled.socialCapabilities)
        ? contextRecord({
            maximumInfluenceDegree: controlled.socialCapabilities.maximumInfluenceDegree ?? null,
          })
        : undefined;
      const loadout = includeNpcMechanics ? projectedLoadout(controlled.loadout) : undefined;
      return [{
        npcRef,
        ...(socialCapabilities === undefined ? {} : { socialCapabilities }),
        ...(loadout === undefined ? {} : { loadout }),
        knowledgeRefs: [
          ...strings(npcView.knowledgeRefs),
          ...knowledge.flatMap((entry) => nonEmptyString(entry.knowledgeRef)
            ? [entry.knowledgeRef]
            : []),
        ].filter((ref, index, all) => all.indexOf(ref) === index).sort(),
        planRefs: [
          ...strings(npcView.goalRefs),
          ...plans.flatMap((entry) => nonEmptyString(entry.planId) ? [entry.planId] : []),
        ].filter((ref, index, all) => all.indexOf(ref) === index).sort(),
        knowledge,
        plans,
      }];
    })
    .sort((left, right) => left.npcRef.localeCompare(right.npcRef));
  if (sameScene.length > 12) throw new Error("CONTEXT_INSUFFICIENT");
  return sameScene;
}

function contentBoundaries(projection: UnknownRecord): string[] {
  const storyBible = isRecord(projection.storyBible) ? projection.storyBible : {};
  const boundary = isRecord(storyBible.contentBoundary) ? storyBible.contentBoundary : {};
  return [
    ...(nonEmptyString(boundary.tone) ? [`tone:${boundary.tone}`] : []),
    ...(nonEmptyString(boundary.failureMeans) ? [`failure:${boundary.failureMeans}`] : []),
    ...strings(boundary.bannedPatterns).map((entry) => `banned:${entry}`),
  ].slice(0, 40);
}

/** Builds the non-retrievable authority layer. It intentionally excludes the
 * full Story Bible while retaining its shortest anchor/truth constraints. */
export function requiredContextFromKpRequest(request: KpProposalRequest) {
  if (!isRecord(request.projection)) throw new Error("CONTEXT_INSUFFICIENT");
  const projection = request.projection;
  const actorProjection = isRecord(projection.actorProjection)
    ? projection.actorProjection
    : projection;
  const controlled = isRecord(actorProjection.controlledCharacter)
    ? actorProjection.controlledCharacter
    : {};
  const viewer = isRecord(actorProjection.viewer) ? actorProjection.viewer : {};
  const characterRef = firstString(controlled, ["characterId", "id"])
    ?? firstString(viewer, ["characterId", "subjectId"]);
  const viewerCharacterRef = firstString(viewer, ["characterId", "subjectId"]);
  const sceneRef = firstString(controlled, ["sceneId", "sceneRef"]);
  if (viewer.kind !== "player"
    || characterRef === undefined
    || viewerCharacterRef !== characterRef
    || sceneRef === undefined) {
    throw new Error("CONTEXT_INSUFFICIENT");
  }

  const encounter = relevantEncounter(actorProjection, sceneRef);
  const controlledCombat = isRecord(controlled.combat) ? controlled.combat : {};
  const tactical = isRecord(actorProjection.tacticalProjection)
    ? actorProjection.tacticalProjection
    : {};
  const tacticalSelf = isRecord(tactical.self) ? tactical.self : undefined;
  const tacticalScene = isRecord(tactical.scene) ? tactical.scene : undefined;
  const tacticalPosition = isRecord(tacticalSelf?.position)
    ? tacticalSelf.position
    : undefined;
  const publicStates = tacticalSelf?.publicStates;
  const visibleFacts = records(actorProjection.visibleFacts);
  const knowledge = records(actorProjection.knowledge);
  const precedents = records(projection.adjudicationPrecedents ?? actorProjection.adjudicationPrecedents);
  const dynamicDefinitions = records(actorProjection.abilityDefinitions);
  const npcMechanicalDefinitions = records(projection.npcMechanicalDefinitions);
  const npcMechanicalItemDefinitions = records(projection.npcMechanicalItemDefinitions);
  const runtimeProfiles = isRecord(actorProjection.runtimeProfiles)
    ? actorProjection.runtimeProfiles
    : {};
  const includeNpcMechanics = runtimeHasNpcMechanics(runtimeProfiles);
  const controlledLoadout = includeNpcMechanics
    ? projectedLoadout(controlled.loadout)
    : undefined;
  const rulesRef = runtimeBindingRef(runtimeProfiles.ruleset);
  const geometryRef = runtimeBindingRef(runtimeProfiles.geometry);
  const moduleRef = runtimeBindingRef(projection.moduleRef);
  const eventRef = runtimeBindingRef(runtimeProfiles.eventSchema);
  if (firstString(tacticalSelf ?? {}, ["id"]) !== characterRef
    || firstString(tacticalScene ?? {}, ["id"]) !== sceneRef
    || tacticalPosition === undefined
    || !Array.isArray(publicStates)
    || !publicStates.every(nonEmptyString)
    || rulesRef === undefined
    || geometryRef === undefined
    || moduleRef === undefined
    || eventRef === undefined) {
    throw new Error("CONTEXT_INSUFFICIENT");
  }

  const intent = inputText(request.input);
  const npcViews = relevantNpcViews(projection, sceneRef, includeNpcMechanics);
  const socialThreads = relevantSocialThreads(
    actorProjection,
    characterRef,
    new Set(npcViews.map(({ npcRef }) => npcRef)),
  );
  const npcMechanicalContext = relevantNpcMechanicalContext(projection, sceneRef);

  return createRequiredContext({
    intent: {
      submissionRef: isRecord(request.input) && nonEmptyString(request.input.submissionId)
        ? request.input.submissionId
        : request.rootActionId,
      text: intent,
    },
    trustedControl: {
      characterRef,
      // The Room projection proves control by closing the trusted viewer onto
      // the controlled character. A principal identifier is neither required
      // nor exposed to the model-facing Context Pack.
      controllerRef: viewerCharacterRef,
      controlProofRef: request.preparedActionId,
    },
    sceneDynamics: contextRecord({
      ...relevantSpatialEvidence(projection, sceneRef),
      visibleFacts,
      personalKnowledge: knowledge,
      // Only participant-safe topic state enters KP context. Private strategy
      // fields such as desiredBehavior and evidence selection stay out, while
      // stable threadRef/npcRef let a free-text reframe address the exact old
      // topic instead of inventing a replacement identity.
      socialThreads,
      // The complete core truth remains a relevance-gated KP-only static
      // chunk. Required carries only the shortest current anchor constraints.
      currentTruthConstraints: coreTruthConstraints(projection, sceneRef),
      // Module-pinned policy/slot/archetype refs are required mechanical
      // grammar, not optional prose retrieval. Rules consumes the same signed
      // genesis catalog and never parses display names or professions.
      premiseCatalog: premiseCatalog(projection),
      ...(npcMechanicalContext === undefined ? {} : { npcMechanics: npcMechanicalContext }),
    }),
    mechanics: {
      encounter: contextValue(encounter),
      turn: contextValue(encounter === null ? null : {
        encounterId: firstString(encounter, ["encounterId", "id"]),
        phase: encounter.phase ?? null,
        round: encounter.round ?? encounter.roundNumber ?? null,
        activeEntityId: encounter.activeEntityId ?? null,
      }),
      actionEconomy: contextValue({
        encounter: encounter === null ? null : encounter,
        controlledCombat,
      }),
      position: contextValue(tacticalPosition),
      hp: contextValue(controlled.hitPoints ?? null),
      resources: contextValue(controlled.resources ?? controlledCombat.resources ?? {}),
      conditions: contextValue(publicStates),
      ...(controlledLoadout === undefined ? {} : { loadout: controlledLoadout }),
    },
    npcViews,
    temporal: {
      pendingRefs: refList(actorProjection.pendingInputs, ["pendingInputId", "id"]),
      activityRefs: refList(actorProjection.activities, ["activityId", "id"]),
      fictionalTime: contextValue(actorProjection.fictionTime ?? null),
    },
    established: {
      factRefs: visibleFacts.flatMap((entry) => {
        const ref = firstString(entry, ["id", "factRef"]);
        return ref === undefined ? [] : [ref];
      }),
      precedentRefs: precedents.flatMap((entry) => {
        const ref = firstString(entry, ["precedentId", "id"]);
        return ref === undefined ? [] : [ref];
      }),
      dynamicDefinitionRefs: dynamicDefinitions.flatMap((entry) => {
        const ref = firstString(entry, ["definitionId", "abilityRef", "id"]);
        return ref === undefined ? [] : [ref];
      }).concat(npcMechanicalDefinitions.flatMap((entry) => {
        const ref = firstString(entry, ["definitionRef", "definitionId", "id"]);
        return ref === undefined ? [] : [ref];
      })).concat(npcMechanicalItemDefinitions.flatMap((entry) => {
        const ref = firstString(entry, ["definitionRef", "definitionId", "id"]);
        return ref === undefined ? [] : [ref];
      })),
    },
    bindings: {
      rulesRef,
      geometryRef,
      moduleRef,
      eventRef,
    },
    truthConstraintRefs: [
      `${moduleRef}:core-truth`,
      `${moduleRef}:story-anchors`,
      ...premiseCatalogRefs(projection),
    ],
    contentBoundaries: contentBoundaries(projection),
    recentDialogue: dialogueFromProjection(projection.experiencedTranscript),
    recentDialogueLimit: 10,
  });
}

export function v3FormSelectionSignals(
  request: KpProposalRequest,
  options: Readonly<{ socialResolution?: boolean }> = {},
): FormSelectionSignals {
  const text = inputText(request.input);
  const projection = isRecord(request.projection) ? request.projection : {};
  const actorProjection = isRecord(projection.actorProjection) ? projection.actorProjection : projection;
  const input = isRecord(request.input) ? request.input : {};
  const pendingInputId = nonEmptyString(input.pendingInputId) ? input.pendingInputId : undefined;
  const pending = pendingInputId === undefined
    ? undefined
    : records(actorProjection.pendingInputs).find((entry) =>
      firstString(entry, ["pendingInputId", "id"]) === pendingInputId);
  const socialReframe = options.socialResolution === true
    && pending?.kind === "socialResolution";
  const hasSameSceneNpc = options.socialResolution === true
    && Object.keys(isRecord(projection.npcViewers) ? projection.npcViewers : {}).length > 0;
  const inCombat = records(actorProjection.encounters).length > 0;
  const clarification = /(那个人|重要的东西|必要的部分|最合适的|所有麻烦|之前说的|关键步骤|可信的人|同时确保.*不会|不能.*但也|但也不能)/u.test(text);
  const refusal = /(没有.+(?:情况|前提|工具|钥匙)|完全没有|隔着.+(?:堵|层).+(?:听清|看清)|已经.*(?:碎成灰|耗尽).*(?:恢复|再次)|徒手.+整座|从未.+立刻|一步.+地图另一端)/u.test(text);
  const highRisk = /(致命|冒险|高风险|爆炸|坠落|断裂|峡谷|坍塌|箭雨|未经辨认|毒素|燃烧|独自引开|失控|悬崖|自己所在|失败|破裂|暴露|锁死|提前转移|潮水上涨|潜入|偷取|谈判破裂|接受.*可能)/u.test(text);
  const characterPremise = options.socialResolution === true
    && /(?:我|这个角色).{0,8}(?:为什么|为何).{0,10}(?:在这里|来到|到这)|(?:我|这个角色).{0,8}(?:是来|来这|来到这里).{0,10}(?:做什么|干什么|办什么)|(?:我|这个角色).{0,10}(?:本来|原本|此前|先前).{0,10}(?:知道|认识|受邀|答应|欠|隶属)|(?:我的)?(?:来意|来由|背景|所属|使命)(?:是|是什么)/u.test(text);
  const exchange = /(我问|询问|交谈|交涉|说服|威胁|欺骗|闲聊|套问|转告|对.*说|回答|质问|(?:向|问|请|让|要求)[^，。；]{0,30}(?:解释|告诉|回忆|认得|保证|说明|描述|画出|列出|转告|回应))/u.test(text);
  const combat = inCombat || /(攻击|施法|射击|挥砍|战斗|格挡|突袭|冲锋|敌人|逼退|压制|占据高处|迫使.*守卫)/u.test(text);
  const materialize = /(是否留有|备用|惯常配备|供\S{0,8}使用的)/u.test(text);
  const observe = /(观察|查看|环顾|检查|搜寻|寻找|调查|聆听|侧耳|闻一闻|翻看|回想|回忆|判断|辨认|确认|比较|核对|分辨|追踪)/u.test(text);
  const serverSelectedForm = socialReframe ? "npc-exchange.v1"
    : characterPremise ? "materialization.v1"
      : clarification ? "clarification.v1"
    : refusal ? "in-world-refusal.v1"
      : highRisk ? "high-risk-action.v1"
        : combat ? "combat-action.v1"
          : exchange ? "npc-exchange.v1"
            : materialize ? "materialization.v1"
              : observe ? "observe.v1"
                : options.socialResolution === true ? undefined : "ordinary-check.v1";
  const interaction = characterPremise ? "structured"
    : combat ? "combat"
    : socialReframe || exchange ? "npc-exchange"
      : observe ? "observe" : "free";
  return {
    interaction,
    risk: highRisk ? "high" : "ordinary",
    mayNeedClarification: true,
    mayNeedRefusal: true,
    mayMaterialize: true,
    // Arbitrary player prose cannot be exhaustively classified by object
    // names. Keep the open environmental form available and let KP decide
    // whether the concrete method needs a custom scene definition.
    mayUseEnvironment: true,
    mayUseNpcExchange: hasSameSceneNpc,
    // The candidate is only a schema-routing hint. Environmental and compound
    // remain available, so it cannot decide feasibility or constrain custom
    // content on the KP's behalf.
    serverSelectedForm,
    preferObservationForFree: options.socialResolution === true,
    // Arbitrary language and phrasing must retain the generic dynamic-world
    // path; keyword routing is only a ranking hint, never the capability gate.
    preferMaterializationForFree: options.socialResolution === true,
    preferredCount: options.socialResolution === true && interaction === "free" && hasSameSceneNpc
      ? 6
      : options.socialResolution === true && interaction === "free" ? 5 : 3,
  };
}

export type V3ContextPackOptions = Readonly<{
  retrieved?: readonly RetrievedContextChunk[];
  optional?: readonly OptionalContextItem[];
  maxUnits?: number;
}>;

export function buildV3ContextPack(
  request: KpProposalRequest,
  options: V3ContextPackOptions = {},
): ContextPack {
  return buildContextPack({
    required: requiredContextFromKpRequest(request),
    retrieved: options.retrieved ?? [],
    optional: options.optional ?? [],
    maxUnits: options.maxUnits ?? 64_000,
  });
}

export function v3StaticQuerySeed(request: KpProposalRequest): Readonly<{
  structuralRefs: readonly string[];
  exactAliases: readonly string[];
  queryText: string;
}> {
  const required = requiredContextFromKpRequest(request);
  const sceneRef = typeof required.sceneDynamics.sceneRef === "string"
    ? required.sceneDynamics.sceneRef
    : "";
  return Object.freeze({
    structuralRefs: Object.freeze([
      required.bindings.rulesRef,
      required.bindings.moduleRef,
      ...(sceneRef.length === 0 ? [] : [sceneRef]),
      ...required.established.dynamicDefinitionRefs,
    ]),
    exactAliases: Object.freeze([]),
    queryText: required.intent.text,
  });
}
