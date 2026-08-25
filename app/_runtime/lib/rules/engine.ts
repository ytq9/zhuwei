import type {
  ActivityState,
  ArtifactState,
  ClueLayer,
  Command,
  Decision,
  DecisionOutcome,
  EntityState,
  PendingRoll,
  PlayerProjection,
  Predicate,
  RestAttempt,
  RuleEffect,
  RuleRejection,
  SquadState,
  WorldDefinition,
  WorldEvent,
  WorldPredicate,
  WorldState,
} from "./model";
import {
  LONG_REST_LIMIT_SECONDS,
  LONG_REST_SECONDS,
  MAX_SPOTLIGHT_SKEW,
  RULESET_VERSION,
  SHORT_REST_SECONDS,
  combineD20Modes,
  durationSeconds,
  resolveD20Check,
} from "./ruleset";

export type InitialEntity = Pick<EntityState, "id" | "kind" | "name"> &
  Partial<Omit<EntityState, "id" | "kind" | "name">>;

type UnstampedEvent = WorldEvent extends infer Event
  ? Event extends WorldEvent
    ? Omit<Event, "id" | "commandId" | "version" | "atSeconds">
    : never
  : never;

const DEFAULT_ABILITIES = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
} as const;

export function createWorldState(
  definition: WorldDefinition,
  entities: InitialEntity[],
  squads: SquadState[] = [],
): WorldState {
  if (definition.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`不支持规则集 ${definition.rulesetVersion}`);
  }
  const entityStates = Object.fromEntries(
    entities.map((entity) => {
      const sceneId = entity.sceneId ?? definition.initialSceneId;
      return [
        entity.id,
        {
          id: entity.id,
          kind: entity.kind,
          name: entity.name,
          active: entity.active ?? true,
          level: entity.level ?? 3,
          sceneId,
          visitedSceneIds: entity.visitedSceneIds ?? [sceneId],
          abilityScores: entity.abilityScores ?? { ...DEFAULT_ABILITIES },
          proficiencyBonus: entity.proficiencyBonus ?? 2,
          proficientSkills: entity.proficientSkills ?? [],
          expertiseSkills: entity.expertiseSkills ?? [],
          capabilities: entity.capabilities ?? [],
          spellLevels: entity.spellLevels ?? {},
          spellActionCosts: entity.spellActionCosts ?? {},
          featureIds: entity.featureIds ?? [],
          activeEffects: entity.activeEffects ?? [],
          attacks: entity.attacks ?? [],
          resources: entity.resources ?? {},
          resourceRules: entity.resourceRules ?? {},
          hp: entity.hp,
          deathSaves: entity.deathSaves ?? { successes: 0, failures: 0 },
          ac: entity.ac ?? 10,
          speedFeet: entity.speedFeet ?? 30,
          lastLongRestCompletedAt: entity.lastLongRestCompletedAt,
        } satisfies EntityState,
      ];
    }),
  );
  return {
    rulesetVersion: RULESET_VERSION,
    version: 0,
    entities: entityStates,
    portals: Object.fromEntries(
      definition.portals.map((portal) => [portal.id, portal.initialState]),
    ),
    artifacts: Object.fromEntries(
      definition.artifacts.map((artifact) => [
        artifact.id,
        artifact.initialHolderId
          ? ({
              artifactId: artifact.id,
              status: "held",
              holderId: artifact.initialHolderId,
            } satisfies ArtifactState)
          : ({
              artifactId: artifact.id,
              status: "placed",
              sceneId: artifact.initialSceneId,
            } satisfies ArtifactState),
      ]),
    ),
    knowledge: Object.fromEntries(
      entities.map((entity) => [
        entity.id,
        entity.kind === "npc"
          ? structuredClone(definition.npcInitialKnowledge?.[entity.id] ?? {})
          : {},
      ]),
    ),
    timelines: Object.fromEntries(
      entities.map((entity) => [
        entity.id,
        { spotlightBeat: 0, fictionSeconds: 0, causalVersion: 0 },
      ]),
    ),
    causalFrontierSeconds: 0,
    pendingRolls: {},
    activities: {},
    rests: {},
    squads: Object.fromEntries(squads.map((squad) => [squad.id, squad])),
    squadInvites: {},
    combats: {},
    scheduledEvents: Object.fromEntries(
      definition.scheduledEvents.map((event) => [event.id, "pending" as const]),
    ),
    flags: {},
    processedCommandIds: [],
  };
}

function reject(code: RuleRejection["code"], message: string): DecisionOutcome {
  return { kind: "rejected", rejection: { code, message } };
}

function actorTime(state: WorldState, actorId: string): number {
  return state.timelines[actorId]?.fictionSeconds ?? 0;
}

function actorBeat(state: WorldState, actorId: string): number {
  return state.timelines[actorId]?.spotlightBeat ?? 0;
}

function spotlightRejection(
  state: WorldState,
  actorId: string,
  addedBeats: number,
): RuleRejection | null {
  if (addedBeats <= 0) return null;
  const actor = state.entities[actorId];
  if (!actor) return { code: "unknown_actor", message: "行动者不在房间中。" };
  const activePlayers = Object.values(state.entities).filter(
    (entity) =>
      entity.kind === "player" &&
      entity.active !== false &&
      state.rests[entity.id]?.status !== "resting",
  );
  if (
    activePlayers.length < 2 ||
    activePlayers.every((entity) => entity.sceneId === actor.sceneId)
  ) {
    return null;
  }
  const minimum = Math.min(...activePlayers.map((entity) => actorBeat(state, entity.id)));
  if (actorBeat(state, actorId) - minimum + addedBeats > MAX_SPOTLIGHT_SKEW) {
    return {
      code: "not_allowed",
      message: `这条分支已经领先 ${MAX_SPOTLIGHT_SKEW} 拍，请等待另一边行动或原地等待。`,
    };
  }
  return null;
}

function stampEvents(
  state: WorldState,
  command: Command,
  bodies: UnstampedEvent[],
  outcome: "committed" | "awaitingRoll",
): WorldEvent[] {
  const all: UnstampedEvent[] = [...bodies, { type: "CommandRecorded", outcome }];
  let atSeconds = actorTime(state, command.actorId);
  return all.map((body, index) => {
    if (body.type === "FictionTimeAdvanced") atSeconds = body.toSeconds;
    if (body.type === "TimelinesSynchronized") atSeconds = body.toSeconds;
    return {
      ...body,
      id: `${command.id}:${index + 1}`,
      commandId: command.id,
      version: state.version + index + 1,
      atSeconds,
    };
  }) as WorldEvent[];
}

function layerValue(layer: ClueLayer | undefined): number {
  if (layer === "full") return 3;
  if (layer === "partial") return 2;
  if (layer === "hint") return 1;
  return 0;
}

export function worldPredicateMatches(
  state: WorldState,
  predicate: WorldPredicate,
): boolean {
  if (predicate.kind === "not") return !worldPredicateMatches(state, predicate.predicate);
  if (predicate.kind === "flagEquals") return state.flags[predicate.flag] === predicate.value;
  if (predicate.kind === "flagAtLeast") {
    const value = state.flags[predicate.flag];
    return typeof value === "number" && value >= predicate.value;
  }
  if (predicate.kind === "portalState") {
    return state.portals[predicate.portalId] === predicate.state;
  }
  if (predicate.kind === "artifactStatus") {
    const artifact = state.artifacts[predicate.artifactId];
    return (
      artifact?.status === predicate.status &&
      (predicate.holderId === undefined || artifact.holderId === predicate.holderId)
    );
  }
  if (predicate.kind === "entityAt") {
    return state.entities[predicate.entityId]?.sceneId === predicate.sceneId;
  }
  if (predicate.kind === "entityKnows") {
    return (
      layerValue(state.knowledge[predicate.entityId]?.[predicate.clueId]) >=
      layerValue(predicate.minimumLayer ?? "hint")
    );
  }
  const players = Object.values(state.entities).filter(
    (entity) => entity.kind === "player" && entity.active !== false,
  );
  return (
    players.length > 0 &&
    players.every(
      (entity) =>
        layerValue(state.knowledge[entity.id]?.[predicate.clueId]) >=
        layerValue(predicate.minimumLayer ?? "hint"),
    )
  );
}

export function predicateMatches(
  state: WorldState,
  actorId: string,
  predicate: Predicate,
): boolean {
  const actor = state.entities[actorId];
  if (!actor) return false;
  if (predicate.kind === "not") {
    return !predicateMatches(state, actorId, predicate.predicate);
  }
  if (predicate.kind === "actorAt") return actor.sceneId === predicate.sceneId;
  if (predicate.kind === "entityAt") {
    return state.entities[predicate.entityId]?.sceneId === predicate.sceneId;
  }
  if (predicate.kind === "artifactAt") {
    const artifact = state.artifacts[predicate.artifactId];
    return artifact?.status === "placed" && artifact.sceneId === predicate.sceneId;
  }
  if (predicate.kind === "artifactHeldByActor") {
    const artifact = state.artifacts[predicate.artifactId];
    return artifact?.status === "held" && artifact.holderId === actorId;
  }
  if (predicate.kind === "artifactHeldByEntity") {
    const artifact = state.artifacts[predicate.artifactId];
    return artifact?.status === "held" && artifact.holderId === predicate.entityId;
  }
  if (predicate.kind === "portalState") {
    return state.portals[predicate.portalId] === predicate.state;
  }
  if (predicate.kind === "flagEquals") {
    return state.flags[predicate.flag] === predicate.value;
  }
  if (predicate.kind === "actorKnows") {
    const actual = state.knowledge[actorId]?.[predicate.clueId];
    return layerValue(actual) >= layerValue(predicate.minimumLayer ?? "hint");
  }
  return actor.capabilities.includes(predicate.capability);
}

function effectRejection(
  definition: WorldDefinition,
  state: WorldState,
  actorId: string,
  effect: RuleEffect,
): RuleRejection | null {
  if (effect.kind === "transferArtifact") {
    const artifact = state.artifacts[effect.artifactId];
    if (!artifact) return { code: "unknown_target", message: "目标物件不存在。" };
    if (
      artifact.status === "consumed" ||
      artifact.status === "destroyed" ||
      (artifact.status === "held" && artifact.holderId === actorId)
    ) {
      return { code: "already_resolved", message: "这件唯一物品已经不在原处，没有第二份。" };
    }
  }
  if (effect.kind === "setPortalState" && !(effect.portalId in state.portals)) {
    return { code: "unknown_target", message: "目标通道不存在。" };
  }
  if (effect.kind === "moveActor") {
    const actor = state.entities[actorId];
    const portalDefinition = definition.portals.find(
      (candidate) => candidate.id === effect.portalId,
    );
    const portal = state.portals[effect.portalId];
    if (!actor || !portalDefinition || portal === undefined) {
      return { code: "unknown_target", message: "NPC 移动的行动者或通道不存在。" };
    }
    const validTraversal =
      (actor.sceneId === portalDefinition.from && effect.to === portalDefinition.to) ||
      (actor.sceneId === portalDefinition.to && effect.to === portalDefinition.from);
    if (!validTraversal) {
      return { code: "unreachable", message: "NPC 已不在计划通道的出发端。" };
    }
    if (portal !== "open" && portal !== "destroyed") {
      return { code: "unreachable", message: "NPC 计划不能越过关闭或锁住的通道。" };
    }
  }
  if (effect.kind === "spendResource") {
    const current = state.entities[actorId]?.resources[effect.resource] ?? 0;
    if (current < effect.amount) {
      return { code: "not_allowed", message: `没有足够的${effect.resource}。` };
    }
  }
  return null;
}

function effectsToEvents(
  definition: WorldDefinition,
  state: WorldState,
  actorId: string,
  effects: RuleEffect[],
): UnstampedEvent[] | RuleRejection {
  const events: UnstampedEvent[] = [];
  let working = state;
  for (const effect of effects) {
    const invalid = effectRejection(definition, working, actorId, effect);
    if (invalid) return invalid;
    let event: UnstampedEvent;
    if (effect.kind === "transferArtifact") {
      event = { type: "ArtifactTransferred", artifactId: effect.artifactId, holderId: actorId };
    } else if (effect.kind === "moveActor") {
      event = {
        type: "EntityMoved",
        entityId: actorId,
        from: working.entities[actorId].sceneId,
        to: effect.to,
        portalId: effect.portalId,
      };
    } else if (effect.kind === "setPortalState") {
      event = { type: "PortalStateChanged", portalId: effect.portalId, state: effect.state };
    } else if (effect.kind === "revealClue") {
      event = { type: "ClueLearned", viewerId: actorId, clueId: effect.clueId, layer: effect.layer };
    } else if (effect.kind === "setFlag") {
      event = { type: "FlagSet", flag: effect.flag, value: effect.value };
    } else if (effect.kind === "damage") {
      event = {
        type: "EntityDamaged",
        entityId: actorId,
        amount: effect.amount,
        damageType: effect.damageType,
      };
    } else if (effect.kind === "heal") {
      event = { type: "EntityHealed", entityId: actorId, amount: effect.amount };
    } else {
      event = {
        type: "ResourceSpent",
        entityId: actorId,
        resource: effect.resource,
        amount: effect.amount,
      };
    }
    events.push(event);
    working = previewState(working, [event]);
  }
  return events;
}

function recoveryEvents(
  state: WorldState,
  actorId: string,
  rest: RestAttempt,
): UnstampedEvent[] {
  const actor = state.entities[actorId];
  if (!actor) return [];
  const events: UnstampedEvent[] = [];
  for (const [resource, rule] of Object.entries(actor.resourceRules)) {
    const recovers =
      rule.recovery === "shortOrLong" ||
      (rest.kind === "short" && rule.recovery === "short") ||
      (rest.kind === "long" && rule.recovery === "long");
    if (!recovers) continue;
    const current = actor.resources[resource] ?? 0;
    const amount =
      rest.kind === "long" && resource === "hitDice"
        ? Math.min(rule.max - current, Math.max(1, Math.floor(rule.max / 2)))
        : rule.max - current;
    if (amount > 0) {
      events.push({ type: "ResourceRecovered", entityId: actorId, resource, amount });
    }
  }
  if (rest.kind === "long" && actor.hp && actor.hp.current < actor.hp.max) {
    events.push({ type: "EntityHealed", entityId: actorId, amount: actor.hp.max - actor.hp.current });
  }
  if (rest.kind === "short") {
    const hitDiceRolls = rest.options?.hitDiceRolls ?? [];
    if (hitDiceRolls.length) {
      events.push({
        type: "ResourceSpent",
        entityId: actorId,
        resource: "hitDice",
        amount: hitDiceRolls.length,
      });
      const conModifier = Math.floor(((actor.abilityScores.con ?? 10) - 10) / 2);
      const healing = hitDiceRolls.reduce(
        (sum, roll) => sum + Math.max(1, roll + conModifier),
        0,
      );
      if (healing > 0) events.push({ type: "EntityHealed", entityId: actorId, amount: healing });
    }
    const arcane = rest.options?.arcaneRecovery;
    if (arcane) {
      events.push({
        type: "ResourceSpent",
        entityId: actorId,
        resource: "arcaneRecovery",
        amount: 1,
      });
      if (arcane === 1) {
        events.push({ type: "ResourceRecovered", entityId: actorId, resource: "slot1", amount: 1 });
      } else if ((actor.resources.slot2 ?? 0) < (actor.resourceRules.slot2?.max ?? 0)) {
        events.push({ type: "ResourceRecovered", entityId: actorId, resource: "slot2", amount: 1 });
      } else {
        events.push({ type: "ResourceRecovered", entityId: actorId, resource: "slot1", amount: 2 });
      }
    }
  }
  return events;
}

function timeParticipants(state: WorldState, actorId: string, fromSeconds: number) {
  const actor = state.entities[actorId];
  const ids = new Set<string>([actorId]);
  if (!actor) return ids;
  for (const entity of Object.values(state.entities)) {
    if (entity.active === false) continue;
    const time = state.timelines[entity.id]?.fictionSeconds ?? 0;
    if (entity.sceneId === actor.sceneId && time <= fromSeconds) ids.add(entity.id);
    if (
      entity.kind === "player" &&
      state.rests[entity.id]?.status === "resting" &&
      time <= fromSeconds
    ) {
      ids.add(entity.id);
    }
  }
  return ids;
}

function scheduledEventApplies(
  state: WorldState,
  actorId: string,
  participantIds: Set<string>,
  requestedTo: number,
  event: WorldDefinition["scheduledEvents"][number],
) {
  const actor = state.entities[actorId];
  if (!actor) return false;
  if (event.scope.kind === "entity") return participantIds.has(event.scope.entityId);
  if (event.scope.kind === "location") return event.scope.sceneId === actor.sceneId;
  const playerTimes = Object.values(state.entities)
    .filter((entity) => entity.kind === "player" && entity.active !== false)
    .map((entity) =>
      participantIds.has(entity.id)
        ? Math.max(state.timelines[entity.id]?.fictionSeconds ?? 0, requestedTo)
        : (state.timelines[entity.id]?.fictionSeconds ?? 0),
    );
  return (
    playerTimes.length > 0 &&
    state.causalFrontierSeconds < event.atSeconds &&
    Math.min(...playerTimes) >= event.atSeconds
  );
}

function timeEvents(
  definition: WorldDefinition,
  state: WorldState,
  actorId: string,
  seconds: number,
  spotlightBeats: number,
  activeActivity?: ActivityState,
): UnstampedEvent[] {
  if (seconds <= 0 && spotlightBeats <= 0) return [];
  const from = actorTime(state, actorId);
  const requestedTo = from + seconds;
  const participantIds = timeParticipants(state, actorId, from);
  const projectedPlayerTimes = Object.values(state.entities)
    .filter((entity) => entity.kind === "player" && entity.active !== false)
    .map((entity) =>
      participantIds.has(entity.id)
        ? Math.max(state.timelines[entity.id]?.fictionSeconds ?? 0, requestedTo)
        : (state.timelines[entity.id]?.fictionSeconds ?? 0),
    );
  const projectedCausalFrontier = projectedPlayerTimes.length
    ? Math.min(...projectedPlayerTimes)
    : requestedTo;
  const due = definition.scheduledEvents
    .filter(
      (event) =>
        state.scheduledEvents[event.id] === "pending" &&
        (event.scope.kind === "global" || event.atSeconds > from) &&
        event.atSeconds <= requestedTo &&
        scheduledEventApplies(state, actorId, participantIds, requestedTo, event),
    )
    .sort((a, b) => a.atSeconds - b.atSeconds);
  const restCompletions = [...participantIds]
    .map((entityId) => state.rests[entityId])
    .filter((rest): rest is RestAttempt => Boolean(rest?.status === "resting"))
    .map((rest) => ({ rest, atSeconds: rest.startedAt + rest.requiredSeconds }))
    .filter(
      ({ rest, atSeconds }) =>
        (state.timelines[rest.actorId]?.fictionSeconds ?? 0) < atSeconds &&
        atSeconds <= requestedTo,
    );
  const scheduledStarts = due.map((event) => {
    const plan = definition.npcPlans.find((candidate) => candidate.id === event.npcPlanId);
    const activity = plan
      ? {
          id: `activity:npc:${event.id}`,
          actorId: plan.actorId,
          kind: "npcPlan" as const,
          sourceId: plan.id,
          name: plan.id,
          startedAt: event.atSeconds,
          completesAt: event.atSeconds + durationSeconds(plan.duration),
          status: "active" as const,
        }
      : undefined;
    return { event, plan, activity };
  });
  const existingNpcActivities = Object.values(state.activities ?? {})
    .filter(
      (activity) =>
        activity.kind === "npcPlan" &&
        activity.status === "active" &&
        (participantIds.has(activity.actorId) ||
          projectedCausalFrontier >= activity.completesAt) &&
        activity.completesAt <= requestedTo,
    )
    .map((activity) => ({
      activity,
      plan: definition.npcPlans.find((candidate) => candidate.id === activity.sourceId),
      atSeconds: Math.max(from, activity.completesAt),
    }));
  const milestones: Array<
    | { kind: "scheduled"; atSeconds: number; event: (typeof due)[number]; plan?: WorldDefinition["npcPlans"][number]; activity?: ActivityState }
    | { kind: "rest"; atSeconds: number; rest: RestAttempt }
    | { kind: "npcActivity"; atSeconds: number; activity: ActivityState; plan?: WorldDefinition["npcPlans"][number] }
  > = [
    ...scheduledStarts.map((entry) => ({
      kind: "scheduled" as const,
      atSeconds: entry.event.atSeconds,
      ...entry,
    })),
    ...restCompletions.map((entry) => ({ kind: "rest" as const, ...entry })),
    ...existingNpcActivities.map((entry) => ({ kind: "npcActivity" as const, ...entry })),
    ...scheduledStarts.flatMap((entry) =>
      entry.activity &&
      entry.activity.completesAt <= requestedTo &&
      (participantIds.has(entry.activity.actorId) ||
        projectedCausalFrontier >= entry.activity.completesAt)
        ? [{
            kind: "npcActivity" as const,
            atSeconds: entry.activity.completesAt,
            activity: entry.activity,
            plan: entry.plan,
          }]
        : [],
    ),
  ];
  const priority = { rest: 0, scheduled: 1, npcActivity: 2 } as const;
  milestones.sort((a, b) => a.atSeconds - b.atSeconds || priority[a.kind] - priority[b.kind]);
  const bodies: UnstampedEvent[] = [];
  const startedActivityIds = new Set(
    Object.values(state.activities ?? {})
      .filter((activity) => activity.status === "active")
      .map((activity) => activity.id),
  );
  let cursor = from;
  let usedBeat = false;
  for (const milestone of milestones) {
    if (milestone.atSeconds > cursor) {
      bodies.push({
        type: "FictionTimeAdvanced",
        entityIds: [...participantIds],
        fromSeconds: cursor,
        toSeconds: milestone.atSeconds,
        spotlightBeats: usedBeat ? 0 : spotlightBeats,
      });
      usedBeat = true;
      cursor = milestone.atSeconds;
    }
    const milestoneState = previewState(state, bodies);
    if (milestone.kind === "rest") {
      bodies.push({
        type: "RestCompleted",
        actorId: milestone.rest.actorId,
        rest: milestone.rest.kind,
      });
      bodies.push(...recoveryEvents(state, milestone.rest.actorId, milestone.rest));
      continue;
    }
    if (milestone.kind === "npcActivity") {
      if (!startedActivityIds.has(milestone.activity.id) || !milestone.plan) continue;
      const npcTime = actorTime(milestoneState, milestone.activity.actorId);
      if (npcTime < milestone.atSeconds) {
        bodies.push({
          type: "FictionTimeAdvanced",
          entityIds: [milestone.activity.actorId],
          fromSeconds: npcTime,
          toSeconds: milestone.atSeconds,
          spotlightBeats: 0,
        });
      }
      const planEvents = effectsToEvents(
        definition,
        previewState(state, bodies),
        milestone.activity.actorId,
        milestone.plan.effects,
      );
      if (Array.isArray(planEvents)) {
        bodies.push({ type: "ActivityCompleted", activityId: milestone.activity.id });
        bodies.push(...planEvents);
      } else {
        bodies.push({
          type: "ActivityFailed",
          activityId: milestone.activity.id,
          reason: planEvents.message,
        });
      }
      startedActivityIds.delete(milestone.activity.id);
      continue;
    }
    const event = milestone.event;
    const plan = milestone.plan;
    const predicateActorId = plan?.actorId ?? actorId;
    if (
      (event.cancelIf ?? []).some((predicate) =>
        predicateMatches(milestoneState, predicateActorId, predicate),
      )
    ) {
      bodies.push({ type: "ScheduledEventCancelled", scheduledEventId: event.id });
      continue;
    }
    if (
      !(event.conditions ?? []).every((predicate) =>
        predicateMatches(milestoneState, predicateActorId, predicate),
      )
    ) {
      bodies.push({ type: "ScheduledEventCancelled", scheduledEventId: event.id });
      continue;
    }
    if (!plan) {
      bodies.push({ type: "ScheduledEventCancelled", scheduledEventId: event.id });
      continue;
    }
    const npc = milestoneState.entities[plan.actorId];
    const knows = plan.requiredKnowledge?.every(
      (clueId) => milestoneState.knowledge[plan.actorId]?.[clueId],
    );
    const capable = plan.requiredCapabilities?.every((capability) =>
      npc?.capabilities.includes(capability),
    );
    const legal = (plan.prerequisites ?? []).every((predicate) =>
      predicateMatches(milestoneState, plan.actorId, predicate),
    );
    if (!npc || knows === false || capable === false || !legal) {
      bodies.push({ type: "ScheduledEventCancelled", scheduledEventId: event.id });
      continue;
    }
    bodies.push({
      type: "ScheduledEventAttempted",
      scheduledEventId: event.id,
      npcPlanId: plan.id,
    });
    if (milestone.activity) {
      const npcTime = actorTime(milestoneState, milestone.activity.actorId);
      if (npcTime < milestone.atSeconds) {
        bodies.push({
          type: "FictionTimeAdvanced",
          entityIds: [milestone.activity.actorId],
          fromSeconds: npcTime,
          toSeconds: milestone.atSeconds,
          spotlightBeats: 0,
        });
      }
      bodies.push({ type: "ActivityStarted", activity: milestone.activity });
      startedActivityIds.add(milestone.activity.id);
    }
    const interruptible = new Map<string, string | undefined>();
    if (activeActivity && participantIds.has(activeActivity.actorId)) {
      interruptible.set(activeActivity.actorId, activeActivity.id);
    }
    for (const activity of Object.values(state.activities ?? {})) {
      if (
        activity.status === "active" &&
        participantIds.has(activity.actorId) &&
        activity.id !== milestone.activity?.id
      ) {
        interruptible.set(activity.actorId, activity.id);
      }
    }
    for (const entityId of participantIds) {
      if (state.rests[entityId]?.status === "resting") {
        interruptible.set(entityId, interruptible.get(entityId));
      }
    }
    const mustStop =
      event.interruption === "mustResolveFirst" ||
      (event.interruption === "mayInterruptActivity" && interruptible.size > 0);
    if (mustStop) {
      for (const [entityId, activityId] of interruptible) {
        bodies.push({
          type: "ActivityInterrupted",
          actorId: entityId,
          activityId,
          scheduledEventId: event.id,
        });
      }
      return bodies;
    }
  }
  if (requestedTo > cursor || (!usedBeat && spotlightBeats > 0)) {
    bodies.push({
      type: "FictionTimeAdvanced",
      entityIds: [...participantIds],
      fromSeconds: cursor,
      toSeconds: requestedTo,
      spotlightBeats: usedBeat ? 0 : spotlightBeats,
    });
  }
  return bodies;
}

function actorSquad(state: WorldState, actorId: string) {
  return Object.values(state.squads).find((squad) => squad.memberIds.includes(actorId));
}

function freshCombatEconomy(speedFeet = 30) {
  return {
    action: true,
    bonusAction: true,
    reaction: true,
    movement: true,
    objectInteraction: true,
    movementFeet: speedFeet,
  };
}

function initiativeTotal(entity: EntityState, face: number) {
  return face + Math.floor(((entity.abilityScores.dex ?? 10) - 10) / 2);
}

function combatById(state: WorldState, combatId: string) {
  return Object.values(state.combats).find(
    (combat) => combat.id === combatId && combat.status === "active",
  );
}

function combatCost(
  state: WorldState,
  actorId: string,
  cost: "action" | "bonusAction" | "reaction" | "movement" | "objectInteraction",
): { event?: UnstampedEvent; rejection?: RuleRejection; inCombat: boolean } {
  const actor = state.entities[actorId];
  const combat = state.combats[actor.sceneId];
  if (!combat || combat.status !== "active") return { inCombat: false };
  const combatant = combat.order.find((entry) => entry.entityId === actorId);
  if (!combatant) {
    return {
      inCombat: true,
      rejection: { code: "not_allowed", message: "角色尚未加入当前地点的战斗。" },
    };
  }
  if (cost !== "reaction" && combat.order[combat.activeIndex]?.entityId !== actorId) {
    return { inCombat: true, rejection: { code: "not_allowed", message: "还没轮到该角色。" } };
  }
  if (combatant.economy[cost] === false) {
    return {
      inCombat: true,
      rejection: { code: "not_allowed", message: "本回合对应的行动资源已经使用。" },
    };
  }
  return {
    inCombat: true,
    event: { type: "CombatActionSpent", sceneId: combat.sceneId, entityId: actorId, cost },
  };
}

function mitigatedDamage(target: EntityState, amount: number, damageType: string) {
  const rageResists = new Set(["bludgeoning", "piercing", "slashing", "physical"]);
  return target.activeEffects.includes("rage") && rageResists.has(damageType)
    ? Math.floor(amount / 2)
    : amount;
}

function commandActivity(input: {
  id: string;
  actorId: string;
  kind: ActivityState["kind"];
  sourceId: string;
  name: string;
  startedAt: number;
  durationSeconds: number;
}): ActivityState {
  return {
    id: `activity:${input.id}`,
    actorId: input.actorId,
    kind: input.kind,
    sourceId: input.sourceId,
    name: input.name,
    startedAt: input.startedAt,
    completesAt: input.startedAt + input.durationSeconds,
    status: "active",
  };
}

function activityReached(
  fromSeconds: number,
  activity: ActivityState,
  bodies: UnstampedEvent[],
) {
  let reached = fromSeconds;
  for (const body of bodies) {
    if (body.type === "FictionTimeAdvanced") reached = Math.max(reached, body.toSeconds);
    if (body.type === "TimelinesSynchronized") reached = Math.max(reached, body.toSeconds);
  }
  return (
    reached >= activity.completesAt &&
    !bodies.some(
      (body) => body.type === "ActivityInterrupted" && body.activityId === activity.id,
    )
  );
}

function previewState(state: WorldState, bodies: UnstampedEvent[]): WorldState {
  let atSeconds = 0;
  const events = bodies.map((body, index) => {
    if (body.type === "FictionTimeAdvanced") atSeconds = body.toSeconds;
    if (body.type === "TimelinesSynchronized") atSeconds = body.toSeconds;
    return {
      ...body,
      id: `preview:${index + 1}`,
      commandId: "preview",
      version: state.version + index + 1,
      atSeconds,
    } as WorldEvent;
  });
  return applyEvents(state, events);
}

function stepInteraction(
  definition: WorldDefinition,
  state: WorldState,
  command: Extract<Command, { kind: "interact" }>,
): DecisionOutcome {
  const interaction = definition.interactions.find((candidate) => candidate.id === command.interactionId);
  if (!interaction) return reject("unknown_target", "当前模组没有这个交互。 ");
  const actor = state.entities[command.actorId];
  if (state.combats[actor.sceneId]?.status === "active") {
    return reject("not_allowed", "战斗中需通过回合动作处理场景交互。 ");
  }
  if (actor.sceneId !== interaction.sceneId) {
    return reject("unreachable", "目标不在角色当前能够接触的地点。 ");
  }
  const skew = spotlightRejection(state, command.actorId, interaction.spotlightBeats);
  if (skew) return { kind: "rejected", rejection: skew };
  for (const predicate of interaction.prerequisites ?? []) {
    if (!predicateMatches(state, command.actorId, predicate)) {
      const code =
        predicate.kind === "artifactAt" ||
        predicate.kind === "artifactHeldByActor" ||
        predicate.kind === "artifactHeldByEntity"
          ? "already_resolved"
          : "precondition_failed";
      return reject(code, code === "already_resolved" ? "目标物件已经不在原处，没有第二份。" : "当前条件不足以完成这个行动。 ");
    }
  }
  const preflight = effectsToEvents(
    definition,
    state,
    command.actorId,
    interaction.success,
  );
  if (!Array.isArray(preflight)) return { kind: "rejected", rejection: preflight };

  if (interaction.resolution.kind === "check") {
    const roll: PendingRoll = {
      id: `roll:${command.id}`,
      actorId: command.actorId,
      interactionId: interaction.id,
      ability: interaction.resolution.ability,
      skill: interaction.resolution.skill,
      dc: interaction.resolution.dc,
      mode: interaction.resolution.mode ?? "normal",
      reason: interaction.resolution.reason,
      success: interaction.success,
      failure: interaction.failure ?? [],
      duration: interaction.duration,
      spotlightBeats: interaction.spotlightBeats,
    };
    const events = stampEvents(state, command, [{ type: "RollRequested", roll }], "awaitingRoll");
    return { kind: "awaitingRoll", roll, events };
  }
  const seconds = durationSeconds(interaction.duration);
  const activity = commandActivity({
    id: command.id,
    actorId: command.actorId,
    kind: "interaction",
    sourceId: interaction.id,
    name: interaction.name,
    startedAt: actorTime(state, command.actorId),
    durationSeconds: seconds,
  });
  const bodies: UnstampedEvent[] = [{ type: "ActivityStarted", activity }];
  const timed = timeEvents(
    definition,
    state,
    command.actorId,
    seconds,
    interaction.spotlightBeats,
    activity,
  );
  bodies.push(...timed);
  if (activityReached(actorTime(state, command.actorId), activity, timed)) {
    const effects = effectsToEvents(
      definition,
      previewState(state, bodies),
      command.actorId,
      interaction.success,
    );
    if (!Array.isArray(effects)) return { kind: "rejected", rejection: effects };
    bodies.push({ type: "ActivityCompleted", activityId: activity.id }, ...effects);
  }
  return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
}

function stepResolveRoll(
  definition: WorldDefinition,
  state: WorldState,
  command: Extract<Command, { kind: "resolveRoll" }>,
): DecisionOutcome {
  const pending = state.pendingRolls[command.requestId];
  if (!pending || pending.actorId !== command.actorId) {
    return reject("unknown_target", "这个检定已经不存在或不属于该角色。 ");
  }
  const actor = state.entities[command.actorId];
  const boosts = command.boosts ?? {};
  if (boosts.useInspiration && (actor.resources.inspiration ?? 0) < 1) {
    return reject("not_allowed", "角色没有可花费的激励。 ");
  }
  if (
    boosts.guidanceRoll !== undefined &&
    (!actor.activeEffects.includes("guidance") ||
      !Number.isInteger(boosts.guidanceRoll) ||
      boosts.guidanceRoll < 1 ||
      boosts.guidanceRoll > 4)
  ) {
    return reject("invalid_roll", "神导术加值不存在或 d4 点数不合法。 ");
  }
  if (
    boosts.luckyReplacedOnes !== undefined &&
    (!actor.featureIds.includes("halflingLucky") ||
      !Number.isInteger(boosts.luckyReplacedOnes) ||
      boosts.luckyReplacedOnes < 0 ||
      boosts.luckyReplacedOnes > 2)
  ) {
    return reject("invalid_roll", "半身人幸运重掷记录不合法。 ");
  }
  const effectiveMode = combineD20Modes(
    pending.mode === "advantage" || Boolean(boosts.useInspiration),
    pending.mode === "disadvantage",
  );
  const proficiency = pending.skill
    ? actor.expertiseSkills.includes(pending.skill)
      ? "expertise"
      : actor.proficientSkills.includes(pending.skill)
        ? "proficient"
        : "none"
    : "none";
  let result;
  try {
    result = resolveD20Check({
      rolls: command.rolls,
      mode: effectiveMode,
      abilityScore: actor.abilityScores[pending.ability],
      proficiencyBonus: actor.proficiencyBonus,
      proficiency,
      dc: pending.dc,
    });
  } catch (error) {
    return reject("invalid_roll", error instanceof Error ? error.message : "d20 不合法");
  }
  const seconds = durationSeconds(pending.duration);
  const activity = commandActivity({
    id: command.id,
    actorId: command.actorId,
    kind: "interaction",
    sourceId: pending.interactionId,
    name: pending.reason,
    startedAt: actorTime(state, command.actorId),
    durationSeconds: seconds,
  });
  const bodies: UnstampedEvent[] = [
    {
      type: "RollResolved",
      requestId: pending.id,
      success: result.total + (boosts.guidanceRoll ?? 0) >= pending.dc,
      total: result.total + (boosts.guidanceRoll ?? 0),
    },
    { type: "ActivityStarted", activity },
  ];
  if (boosts.useInspiration) {
    bodies.push({
      type: "ResourceSpent",
      entityId: actor.id,
      resource: "inspiration",
      amount: 1,
    });
  }
  if (boosts.guidanceRoll !== undefined) {
    bodies.push({ type: "ActiveEffectSet", entityId: actor.id, effectId: "guidance", active: false });
  }
  const timed = timeEvents(
    definition,
    state,
    command.actorId,
    seconds,
    pending.spotlightBeats,
    activity,
  );
  bodies.push(...timed);
  if (activityReached(actorTime(state, command.actorId), activity, timed)) {
    const effects = effectsToEvents(
      definition,
      previewState(state, bodies),
      command.actorId,
      result.total + (boosts.guidanceRoll ?? 0) >= pending.dc
        ? pending.success
        : pending.failure,
    );
    if (!Array.isArray(effects)) return { kind: "rejected", rejection: effects };
    bodies.push({ type: "ActivityCompleted", activityId: activity.id }, ...effects);
  }
  return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
}

function stepMove(
  definition: WorldDefinition,
  state: WorldState,
  command: Extract<Command, { kind: "move" }>,
): DecisionOutcome {
  const portal = definition.portals.find((candidate) => candidate.id === command.portalId);
  if (!portal) return reject("unknown_target", "通道不存在。 ");
  const actor = state.entities[command.actorId];
  if (state.combats[actor.sceneId]?.status === "active") {
    return reject("not_allowed", "战斗中不能用探索移动越过地点通道。 ");
  }
  const validDestination =
    (actor.sceneId === portal.from && command.destinationId === portal.to) ||
    (actor.sceneId === portal.to && command.destinationId === portal.from);
  if (!validDestination) return reject("unreachable", "该通道不能从当前位置到达目标。 ");
  const skew = spotlightRejection(state, command.actorId, 1);
  if (skew) return { kind: "rejected", rejection: skew };
  const portalState = state.portals[portal.id];
  if (portalState !== "open" && portalState !== "destroyed") {
    return reject("unreachable", "通道尚未打开，不能越过。 ");
  }
  if (!(portal.prerequisites ?? []).every((predicate) => predicateMatches(state, command.actorId, predicate))) {
    return reject("precondition_failed", "通道的通过条件尚未满足。 ");
  }
  const squad = actorSquad(state, command.actorId);
  let movers = [command.actorId];
  const bodies: UnstampedEvent[] = [];
  if (command.mode === "squad") {
    if (!squad || squad.captainId !== command.actorId) {
      return reject("not_allowed", "只有队长能组织整队移动。 ");
    }
    movers = squad.memberIds.filter((id) => state.entities[id]?.sceneId === actor.sceneId);
  } else if (squad && squad.memberIds.length > 1) {
    bodies.push({ type: "SquadLeft", squadId: squad.id, actorId: command.actorId });
  }
  for (const entityId of movers) {
    bodies.push({
      type: "EntityMoved",
      entityId,
      from: actor.sceneId,
      to: command.destinationId,
      portalId: portal.id,
    });
  }
  bodies.push(
    ...timeEvents(
      definition,
      state,
      command.actorId,
      durationSeconds(portal.traversalTime),
      1,
    ),
  );
  const destinationOccupants = Object.values(state.entities)
    .filter(
      (entity) =>
        entity.active !== false &&
        entity.sceneId === command.destinationId &&
        !movers.includes(entity.id),
    )
    .map((entity) => entity.id);
  if (destinationOccupants.length) {
    const synchronized = [...movers, ...destinationOccupants];
    const travelTo = actorTime(state, command.actorId) + durationSeconds(portal.traversalTime);
    bodies.push({
      type: "TimelinesSynchronized",
      entityIds: synchronized,
      toSeconds: Math.max(
        travelTo,
        ...destinationOccupants.map((id) => actorTime(state, id)),
      ),
      toSpotlightBeat: Math.max(
        actorBeat(state, command.actorId) + 1,
        ...destinationOccupants.map((id) => actorBeat(state, id)),
      ),
    });
  }
  return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
}

function startRestEvent(
  state: WorldState,
  actorId: string,
  kind: "short" | "long",
  options: Extract<Command, { kind: "startRest" }>["options"] = undefined,
):
  | { event: UnstampedEvent }
  | { rejection: RuleRejection } {
  const now = actorTime(state, actorId);
  const current = state.rests[actorId];
  if (current?.status === "resting") {
    return { rejection: { code: "rest_ineligible", message: "角色已经在休息。" } };
  }
  const actor = state.entities[actorId];
  if (state.combats[actor.sceneId]?.status === "active") {
    return { rejection: { code: "rest_ineligible", message: "战斗中不能开始休整。" } };
  }
  if (kind === "long" && actor.hp && actor.hp.current < 1) {
    return {
      rejection: {
        code: "rest_ineligible",
        message: "角色必须在长休开始时至少有 1 点生命值，才能获得长休益处。",
      },
    };
  }
  if (
    kind === "long" &&
    actor.lastLongRestCompletedAt !== undefined &&
    now - actor.lastLongRestCompletedAt < LONG_REST_LIMIT_SECONDS
  ) {
    return { rejection: { code: "rest_ineligible", message: "距离上次长休完成还不足 24 小时。" } };
  }
  if (kind === "long" && (options?.hitDiceRolls?.length || options?.arcaneRecovery)) {
    return { rejection: { code: "not_allowed", message: "生命骰与奥术恢复只在短休结算。" } };
  }
  const hitDiceRolls = options?.hitDiceRolls ?? [];
  const hitDie = actor.resourceRules.hitDice?.die;
  if (
    hitDiceRolls.length > (actor.resources.hitDice ?? 0) ||
    hitDiceRolls.some(
      (roll) => !hitDie || !Number.isInteger(roll) || roll < 1 || roll > hitDie,
    )
  ) {
    return { rejection: { code: "invalid_roll", message: "生命骰数量或点数不合法。" } };
  }
  if (
    options?.arcaneRecovery &&
    (!actor.featureIds.includes("arcaneRecovery") || (actor.resources.arcaneRecovery ?? 0) < 1)
  ) {
    return { rejection: { code: "not_allowed", message: "奥术恢复今日已经使用或角色没有该特征。" } };
  }
  const rest: RestAttempt = {
    actorId,
    kind,
    startedAt: now,
    requiredSeconds: kind === "short" ? SHORT_REST_SECONDS : LONG_REST_SECONDS,
    status: "resting",
    options,
  };
  return { event: { type: "RestStarted", rest } };
}

function decide(
  definition: WorldDefinition,
  state: WorldState,
  command: Command,
): DecisionOutcome {
  if (definition.rulesetVersion !== state.rulesetVersion || state.rulesetVersion !== RULESET_VERSION) {
    return reject("ruleset_mismatch", "房间规则集与模组规则集不一致。 ");
  }
  if (state.processedCommandIds.includes(command.id)) {
    return reject("duplicate_command", "这个命令已经提交过。 ");
  }
  if (command.expectedVersion !== state.version) {
    return reject("stale_state", "房间状态已经变化，请基于新快照重新裁决。 ");
  }
  if (!state.entities[command.actorId] || state.entities[command.actorId].active === false) {
    return reject("unknown_actor", "行动者不在房间中。 ");
  }
  if (state.rests[command.actorId]?.status === "resting" && !["advanceTime", "interruptRest"].includes(command.kind)) {
    return reject("not_allowed", "角色正在休息；可以继续等待或提前结束休息。 ");
  }
  if (command.kind === "interact") return stepInteraction(definition, state, command);
  if (command.kind === "resolveRoll") return stepResolveRoll(definition, state, command);
  if (command.kind === "move") return stepMove(definition, state, command);
  if (command.kind === "startCombat") {
    const actor = state.entities[command.actorId];
    if (state.combats[actor.sceneId]?.status === "active") {
      return reject("already_resolved", "这个地点已经处于战斗中。 ");
    }
    const participantIds = [...new Set([command.actorId, ...command.targetIds])];
    if (participantIds.length < 2) return reject("unknown_target", "战斗至少需要两个参与者。 ");
    const participants = participantIds.map((id) => state.entities[id]);
    if (
      participants.some(
        (entity) =>
          !entity ||
          entity.active === false ||
          entity.sceneId !== actor.sceneId ||
          (entity.hp?.current ?? 1) <= 0,
      )
    ) {
      return reject("unreachable", "所有战斗参与者必须在同一地点且仍能参战。 ");
    }
    if (
      participantIds.some((id) => {
        const face = command.initiativeRolls[id];
        return !Number.isInteger(face) || face < 1 || face > 20;
      })
    ) {
      return reject("invalid_roll", "每名参与者都需要一颗合法的先攻 d20。 ");
    }
    const initiatorSide = `side:initiator:${command.id}`;
    const oppositionSide = `side:opposition:${command.id}`;
    const order = participantIds
      .map((entityId) => ({
        entityId,
        side: entityId === command.actorId ? initiatorSide : oppositionSide,
        initiative: initiativeTotal(state.entities[entityId], command.initiativeRolls[entityId]),
        economy: freshCombatEconomy(state.entities[entityId].speedFeet),
        attackedThisTurn: false,
        deathSaveRolledThisTurn: false,
        positionFeet: 0,
      }))
      .sort(
        (a, b) =>
          b.initiative - a.initiative ||
          (state.entities[b.entityId].abilityScores.dex ?? 10) -
            (state.entities[a.entityId].abilityScores.dex ?? 10) ||
          a.entityId.localeCompare(b.entityId),
      );
    const bodies: UnstampedEvent[] = [
      {
        type: "CombatStarted",
        combat: {
          id: `combat:${command.id}`,
          sceneId: actor.sceneId,
          initiatorSide,
          oppositionSide,
          round: 1,
          activeIndex: 0,
          order,
          status: "active",
        },
      },
    ];
    for (const entityId of participantIds) {
      if (state.rests[entityId]?.status === "resting") {
        bodies.push({ type: "RestInterrupted", actorId: entityId });
      }
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "joinCombat") {
    const combat = combatById(state, command.combatId);
    const actor = state.entities[command.actorId];
    if (!combat || actor.sceneId !== combat.sceneId) {
      return reject("unreachable", "角色不在这个战场。 ");
    }
    if (combat.order.some((entry) => entry.entityId === actor.id)) {
      return reject("already_resolved", "角色已经在这场战斗中。 ");
    }
    if (!Number.isInteger(command.initiativeRoll) || command.initiativeRoll < 1 || command.initiativeRoll > 20) {
      return reject("invalid_roll", "先攻必须是一颗合法的 d20。 ");
    }
    const sideWith = command.sideWithId
      ? combat.order.find((entry) => entry.entityId === command.sideWithId)
      : undefined;
    if (command.sideWithId && !sideWith) {
      return reject("unknown_target", "指定的同阵营参战者不在这场战斗中。 ");
    }
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{
          type: "CombatantJoined",
          sceneId: combat.sceneId,
          combatant: {
            entityId: actor.id,
            side:
              sideWith?.side ??
              (actor.kind === "player" ? combat.initiatorSide : combat.oppositionSide),
            initiative: initiativeTotal(actor, command.initiativeRoll),
            economy: freshCombatEconomy(actor.speedFeet),
            attackedThisTurn: false,
            deathSaveRolledThisTurn: false,
            positionFeet: 0,
          },
        }],
        "committed",
      ),
    };
  }
  if (command.kind === "spendCombatAction") {
    const combat = combatById(state, command.combatId);
    if (!combat) return reject("unknown_target", "这场战斗不存在。 ");
    const combatant = combat.order.find((entry) => entry.entityId === command.actorId);
    if (!combatant) return reject("not_allowed", "角色不在这场战斗中。 ");
    const active = combat.order[combat.activeIndex]?.entityId === command.actorId;
    if (command.cost !== "reaction" && !active) {
      return reject("not_allowed", "还没轮到该角色。 ");
    }
    if (combatant.economy[command.cost] === false) {
      return reject("not_allowed", "本回合对应的行动资源已经使用。 ");
    }
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{
          type: "CombatActionSpent",
          sceneId: combat.sceneId,
          entityId: command.actorId,
          cost: command.cost,
        }],
        "committed",
      ),
    };
  }
  if (command.kind === "rollDeathSave") {
    const actor = state.entities[command.actorId];
    const combat = state.combats[actor.sceneId];
    const combatant = combat?.order.find((entry) => entry.entityId === actor.id);
    if (
      !combat ||
      combat.status !== "active" ||
      combat.order[combat.activeIndex]?.entityId !== actor.id ||
      !combatant
    ) {
      return reject("not_allowed", "只有轮到自己的战斗回合时才能掷死亡豁免。 ");
    }
    if (
      actor.kind !== "player" ||
      (actor.hp?.current ?? 1) !== 0 ||
      actor.activeEffects.includes("stable") ||
      actor.activeEffects.includes("dead")
    ) {
      return reject("not_allowed", "角色当前不需要死亡豁免。 ");
    }
    if (combatant.deathSaveRolledThisTurn) {
      return reject("already_resolved", "本回合已经掷过死亡豁免。 ");
    }
    if (!Number.isInteger(command.d20Roll) || command.d20Roll < 1 || command.d20Roll > 20) {
      return reject("invalid_roll", "死亡豁免必须是一颗合法的 d20。 ");
    }
    let successes = actor.deathSaves.successes;
    let failures = actor.deathSaves.failures;
    let outcome: "pending" | "stable" | "revived" | "dead" = "pending";
    if (command.d20Roll === 20) {
      outcome = "revived";
      successes = 0;
      failures = 0;
    } else if (command.d20Roll === 1) {
      failures = Math.min(3, failures + 2);
    } else if (command.d20Roll >= 10) {
      successes = Math.min(3, successes + 1);
    } else {
      failures = Math.min(3, failures + 1);
    }
    if (failures >= 3) outcome = "dead";
    else if (successes >= 3) outcome = "stable";
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{
          type: "DeathSaveResolved",
          entityId: actor.id,
          d20Roll: command.d20Roll,
          successes,
          failures,
          outcome,
        }],
        "committed",
      ),
    };
  }
  if (command.kind === "combatAttack") {
    const combat = combatById(state, command.combatId);
    const actor = state.entities[command.actorId];
    const target = state.entities[command.targetId];
    if (
      !combat ||
      !combat.order.some((entry) => entry.entityId === actor.id) ||
      !combat.order.some((entry) => entry.entityId === command.targetId) ||
      !target ||
      target.activeEffects.includes("dead")
    ) {
      return reject("unknown_target", "攻击者或目标不在这场战斗中。 ");
    }
    if ((actor.hp?.current ?? 1) <= 0 || actor.activeEffects.includes("dead")) {
      return reject("not_allowed", "失去意识或死亡的角色不能攻击。 ");
    }
    const attack = actor.attacks.find((entry) => entry.id === command.attackId);
    if (!attack) return reject("not_allowed", "角色没有这个攻击方式。 ");
    const attackerCombatant = combat.order.find((entry) => entry.entityId === actor.id)!;
    const targetCombatant = combat.order.find((entry) => entry.entityId === target.id)!;
    const attackSide =
      attackerCombatant.side === targetCombatant.side
        ? `side:break:${command.id}`
        : attackerCombatant.side;
    const distance = Math.abs(attackerCombatant.positionFeet - targetCombatant.positionFeet);
    if (attack.kind !== "ranged" && distance > (attack.reachFeet ?? 5)) {
      return reject("unreachable", `目标在 ${distance} 英尺外，超出这次近战攻击的触及。`);
    }
    let rangedDisadvantage = false;
    if (attack.kind === "ranged") {
      const normalRange = attack.normalRangeFeet ?? 80;
      const longRange = attack.longRangeFeet ?? normalRange * 4;
      if (distance > longRange) {
        return reject("unreachable", `目标在 ${distance} 英尺外，超过武器的最长射程。`);
      }
      const adjacentHostile = combat.order.some((entry) => {
        const entity = state.entities[entry.entityId];
        return (
          entry.side !== attackSide &&
          (entity.hp?.current ?? 1) > 0 &&
          Math.abs(entry.positionFeet - attackerCombatant.positionFeet) <= 5
        );
      });
      rangedDisadvantage = distance > normalRange || adjacentHostile;
    }
    const downedWithinFiveFeet = (target.hp?.current ?? 1) === 0 && distance <= 5;
    const requiredMode = combineD20Modes(downedWithinFiveFeet, rangedDisadvantage);
    if (command.mode !== requiredMode) {
      return reject(
        "invalid_roll",
        "攻击的优势与劣势必须按距离、失去意识状态和 5 英尺内敌人合并后掷骰。 ",
      );
    }
    if (attack.ammoResource && (actor.resources[attack.ammoResource] ?? 0) < 1) {
      return reject(
        "not_allowed",
        attack.ammoResource === "arrow" ? "箭矢已经用尽。 " : "弩矢已经用尽。 ",
      );
    }
    const expectedD20 = command.mode === "normal" ? 1 : 2;
    if (
      command.d20Rolls.length !== expectedD20 ||
      command.d20Rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 20)
    ) {
      return reject("invalid_roll", "攻击 d20 数量或点数不合法。 ");
    }
    const face =
      command.mode === "advantage"
        ? Math.max(...command.d20Rolls)
        : command.mode === "disadvantage"
          ? Math.min(...command.d20Rolls)
          : command.d20Rolls[0];
    const attackTotal = face + attack.attackBonus;
    const hit = face === 20 || (face !== 1 && attackTotal >= target.ac);
    const critical = hit && (face === 20 || downedWithinFiveFeet);
    const expectedDamageDice = attack.damage.count * (critical ? 2 : 1);
    if (
      command.damageRolls.length !== expectedDamageDice ||
      command.damageRolls.some(
        (roll) => !Number.isInteger(roll) || roll < 1 || roll > attack.damage.sides,
      )
    ) {
      return reject("invalid_roll", "伤害骰数量或点数不合法。 ");
    }
    const cost = command.cost ?? "action";
    const attackCost = combatCost(state, actor.id, cost);
    if (attackCost.rejection) return { kind: "rejected", rejection: attackCost.rejection };
    const rawDamage = hit
      ? Math.max(0, command.damageRolls.reduce((sum, roll) => sum + roll, 0) + attack.damage.bonus)
      : 0;
    const damage = mitigatedDamage(target, rawDamage, attack.damage.damageType);
    const bodies: UnstampedEvent[] = [];
    if (attackSide !== attackerCombatant.side) {
      bodies.push({
        type: "CombatantSideChanged",
        sceneId: combat.sceneId,
        entityId: actor.id,
        side: attackSide,
      });
    }
    if (attackCost.event) bodies.push(attackCost.event);
    if (attack.ammoResource) {
      bodies.push({
        type: "ResourceSpent",
        entityId: actor.id,
        resource: attack.ammoResource,
        amount: 1,
      });
    }
    if (cost === "bonusAction") {
      const combatant = combat.order.find((entry) => entry.entityId === actor.id);
      if (!combatant?.attackedThisTurn) {
        return reject("not_allowed", "战争祭司要先在本回合使用攻击动作。 ");
      }
      if ((actor.resources.warPriest ?? 0) < 1) {
        return reject("not_allowed", "战争祭司次数已经用完。 ");
      }
      bodies.push({ type: "ResourceSpent", entityId: actor.id, resource: "warPriest", amount: 1 });
    }
    bodies.push({
      type: "CombatAttackResolved",
      sceneId: combat.sceneId,
      attackerId: actor.id,
      targetId: target.id,
      attackId: attack.id,
      attackTotal,
      hit,
      critical,
      damage,
    });
    if (damage > 0) {
      bodies.push({
        type: "EntityDamaged",
        entityId: target.id,
        amount: damage,
        damageType: attack.damage.damageType,
      });
      const currentHp = target.hp?.current ?? 1;
      if (currentHp > 0 && damage >= currentHp) {
        const massive = damage - currentHp >= (target.hp?.max ?? Number.POSITIVE_INFINITY);
        bodies.push({
          type: "EntityDropped",
          entityId: target.id,
          outcome: target.kind === "npc" || massive ? "dead" : "unconscious",
        });
      } else if (currentHp === 0 && target.kind === "player") {
        const failures = Math.min(3, target.deathSaves.failures + (critical ? 2 : 1));
        bodies.push({
          type: "DeathSaveResolved",
          entityId: target.id,
          d20Roll: 0,
          successes: target.deathSaves.successes,
          failures,
          outcome: failures >= 3 ? "dead" : "pending",
        });
      }
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "combatMove") {
    const combat = combatById(state, command.combatId);
    const actor = state.entities[command.actorId];
    const mover = combat?.order.find((entry) => entry.entityId === actor.id);
    if (!combat || !mover || combat.order[combat.activeIndex]?.entityId !== actor.id) {
      return reject("not_allowed", "只有当前行动者能在这场战斗中移动。 ");
    }
    if ((actor.hp?.current ?? 1) <= 0 || actor.activeEffects.includes("dead")) {
      return reject("not_allowed", "失去意识或死亡的角色不能移动。 ");
    }
    if (!Number.isInteger(command.toPositionFeet)) {
      return reject("invalid_roll", "战场位置必须使用整数英尺。 ");
    }
    const feet = Math.abs(command.toPositionFeet - mover.positionFeet);
    if (feet < 1) return reject("not_allowed", "角色没有实际移动。 ");
    const bodies: UnstampedEvent[] = [];
    let movementAvailable = mover.economy.movementFeet ?? actor.speedFeet;
    if (command.mode === "dash" || command.mode === "disengage") {
      const cost = actor.featureIds.includes("cunningAction") ? "bonusAction" : "action";
      const spent = combatCost(state, actor.id, cost);
      if (spent.rejection) return { kind: "rejected", rejection: spent.rejection };
      if (spent.event) bodies.push(spent.event);
      if (command.mode === "dash") movementAvailable += actor.speedFeet;
    }
    if (feet > movementAvailable) {
      return reject("not_allowed", `本回合最多还能移动 ${movementAvailable} 英尺。`);
    }
    const threats = command.mode === "disengage"
      ? []
      : combat.order.filter((entry) => {
          const enemy = state.entities[entry.entityId];
          const reach = enemy?.attacks.find((attack) => attack.kind !== "ranged")?.reachFeet ?? 5;
          return (
            enemy?.active !== false &&
            entry.side !== mover.side &&
            (enemy.hp?.current ?? 1) > 0 &&
            entry.economy.reaction !== false &&
            Math.abs(mover.positionFeet - entry.positionFeet) <= reach &&
            Math.abs(command.toPositionFeet - entry.positionFeet) > reach
          );
        });
    const expectedThreatIds = new Set(threats.map((entry) => entry.entityId));
    const submittedThreatIds = Object.keys(command.opportunityRolls);
    if (
      submittedThreatIds.length !== expectedThreatIds.size ||
      submittedThreatIds.some((id) => !expectedThreatIds.has(id))
    ) {
      return reject("invalid_roll", "借机攻击骰必须与实际离开触及范围的敌人逐一对应。 ");
    }
    let incomingDamage = 0;
    for (const threat of threats) {
      const enemy = state.entities[threat.entityId];
      const attack = enemy.attacks.find((entry) => entry.kind !== "ranged");
      const rolls = command.opportunityRolls[enemy.id];
      if (!attack || !rolls || !Number.isInteger(rolls.d20Roll) || rolls.d20Roll < 1 || rolls.d20Roll > 20) {
        return reject("invalid_roll", `${enemy.name} 的借机攻击骰不合法。`);
      }
      const critical = rolls.d20Roll === 20;
      const expectedDice = attack.damage.count * (critical ? 2 : 1);
      if (
        rolls.damageRolls.length !== expectedDice ||
        rolls.damageRolls.some(
          (roll) => !Number.isInteger(roll) || roll < 1 || roll > attack.damage.sides,
        )
      ) {
        return reject("invalid_roll", `${enemy.name} 的借机伤害骰不合法。`);
      }
      const attackTotal = rolls.d20Roll + attack.attackBonus;
      const hit = critical || (rolls.d20Roll !== 1 && attackTotal >= actor.ac);
      const rawDamage = hit
        ? Math.max(
            0,
            rolls.damageRolls.reduce((sum, roll) => sum + roll, 0) + attack.damage.bonus,
          )
        : 0;
      const damage = mitigatedDamage(actor, rawDamage, attack.damage.damageType);
      bodies.push({
        type: "CombatActionSpent",
        sceneId: combat.sceneId,
        entityId: enemy.id,
        cost: "reaction",
      });
      bodies.push({
        type: "CombatAttackResolved",
        sceneId: combat.sceneId,
        attackerId: enemy.id,
        targetId: actor.id,
        attackId: attack.id,
        attackTotal,
        hit,
        critical,
        damage,
      });
      if (damage > 0) {
        incomingDamage += damage;
        bodies.push({
          type: "EntityDamaged",
          entityId: actor.id,
          amount: damage,
          damageType: attack.damage.damageType,
        });
      }
    }
    const currentHp = actor.hp?.current ?? 1;
    if (incomingDamage >= currentHp) {
      const massive = incomingDamage - currentHp >= (actor.hp?.max ?? Number.POSITIVE_INFINITY);
      bodies.push({
        type: "EntityDropped",
        entityId: actor.id,
        outcome: actor.kind === "npc" || massive ? "dead" : "unconscious",
      });
    }
    if ((actor.hp?.current ?? 1) - incomingDamage > 0) {
      bodies.push({
        type: "CombatantMoved",
        sceneId: combat.sceneId,
        entityId: actor.id,
        fromPositionFeet: mover.positionFeet,
        toPositionFeet: command.toPositionFeet,
        feet,
        mode: command.mode,
      });
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "endCombatTurn") {
    const combat = combatById(state, command.combatId);
    if (!combat || combat.order[combat.activeIndex]?.entityId !== command.actorId) {
      return reject("not_allowed", "只有当前行动者能结束回合。 ");
    }
    const activeEntity = state.entities[command.actorId];
    const activeCombatant = combat.order[combat.activeIndex];
    if (
      activeEntity.kind === "player" &&
      (activeEntity.hp?.current ?? 1) === 0 &&
      !activeEntity.activeEffects.includes("stable") &&
      !activeEntity.activeEffects.includes("dead") &&
      !activeCombatant.deathSaveRolledThisTurn
    ) {
      return reject("not_allowed", "先结算本回合的死亡豁免。 ");
    }
    const survivingSides = new Set(
      combat.order
        .filter((entry) => !state.entities[entry.entityId]?.activeEffects.includes("dead"))
        .map((entry) => entry.side),
    );
    if (survivingSides.size < 2) {
      return {
        kind: "committed",
        events: stampEvents(
          state,
          command,
          [{ type: "CombatEnded", sceneId: combat.sceneId, reason: "一方已经没有仍在战斗中的成员" }],
          "committed",
        ),
      };
    }
    let nextIndex = combat.activeIndex;
    for (let offset = 1; offset <= combat.order.length; offset += 1) {
      const candidate = (combat.activeIndex + offset) % combat.order.length;
      if (!state.entities[combat.order[candidate].entityId].activeEffects.includes("dead")) {
        nextIndex = candidate;
        break;
      }
    }
    const wrapped = nextIndex === 0;
    const nextRound = wrapped ? combat.round + 1 : combat.round;
    const bodies: UnstampedEvent[] = [
      { type: "SpotlightAdvanced", entityId: command.actorId, beats: 1 },
      {
        type: "CombatTurnAdvanced",
        sceneId: combat.sceneId,
        fromEntityId: command.actorId,
        toEntityId: combat.order[nextIndex].entityId,
        round: nextRound,
      },
    ];
    if (wrapped) {
      bodies.push(
        ...timeEvents(definition, state, command.actorId, durationSeconds({ unit: "round", value: 1 }), 0),
      );
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "castSpell") {
    const actor = state.entities[command.actorId];
    const skew = spotlightRejection(state, actor.id, 1);
    if (skew) return { kind: "rejected", rejection: skew };
    const spellLevel = actor.spellLevels[command.spellId];
    if (spellLevel === undefined) return reject("not_allowed", "角色没有准备或掌握这个法术。 ");
    const bodies: UnstampedEvent[] = [];
    const castingCost = actor.spellActionCosts[command.spellId] ?? "action";
    const combatCasting = combatCost(state, actor.id, castingCost);
    if (combatCasting.rejection) {
      return { kind: "rejected", rejection: combatCasting.rejection };
    }
    if (combatCasting.event) bodies.push(combatCasting.event);
    let slotLevel: 0 | 1 | 2 = 0;
    if (spellLevel > 0) {
      slotLevel = command.slotLevel ?? (spellLevel as 1 | 2);
      if (slotLevel < spellLevel || slotLevel > 2) {
        return reject("not_allowed", "所选法术位不能施放这个法术。 ");
      }
      const resource = `slot${slotLevel}`;
      if ((actor.resources[resource] ?? 0) < 1) {
        return reject("not_allowed", `${slotLevel} 环法术位已经用完。`);
      }
      bodies.push({ type: "ResourceSpent", entityId: actor.id, resource, amount: 1 });
    }
    bodies.push({ type: "SpellCast", entityId: actor.id, spellId: command.spellId, slotLevel });
    if (command.spellId === "guidance" || command.spellId === "bless") {
      for (const effectId of actor.activeEffects.filter(
        (effect) => effect === "guidance" || effect === "bless",
      )) {
        bodies.push({ type: "ActiveEffectSet", entityId: actor.id, effectId, active: false });
      }
      bodies.push({
        type: "ActiveEffectSet",
        entityId: actor.id,
        effectId: command.spellId,
        active: true,
      });
    }
    if (!combatCasting.inCombat) {
      bodies.push(
        ...timeEvents(definition, state, actor.id, durationSeconds({ unit: "round", value: 1 }), 1),
      );
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "useFeature") {
    const actor = state.entities[command.actorId];
    const skew = spotlightRejection(state, actor.id, 1);
    if (skew) return { kind: "rejected", rejection: skew };
    if (!actor.featureIds.includes(command.featureId)) {
      return reject("not_allowed", "角色没有这个可用特征。 ");
    }
    const resource = command.featureId;
    if ((actor.resources[resource] ?? 0) < 1) {
      return reject("not_allowed", "这个特征的次数或物资已经用完。 ");
    }
    const bodies: UnstampedEvent[] = [
      { type: "ResourceSpent", entityId: actor.id, resource, amount: 1 },
    ];
    const featureCost =
      command.featureId === "rage" || command.featureId === "secondWind"
        ? "bonusAction"
        : command.featureId === "surge"
          ? null
          : "action";
    const combatFeature = featureCost
      ? combatCost(state, actor.id, featureCost)
      : { inCombat: Boolean(state.combats[actor.sceneId]?.status === "active") };
    if (combatFeature.rejection) {
      return { kind: "rejected", rejection: combatFeature.rejection };
    }
    if (combatFeature.event) bodies.unshift(combatFeature.event);
    let total: number | undefined;
    if (command.featureId === "secondWind") {
      const rolls = command.rolls ?? [];
      if (rolls.length !== 1 || !Number.isInteger(rolls[0]) || rolls[0] < 1 || rolls[0] > 10) {
        return reject("invalid_roll", "回气必须提交一颗合法的 d10。 ");
      }
      const healing = rolls[0] + actor.level;
      total = healing;
      bodies.push({ type: "EntityHealed", entityId: actor.id, amount: healing });
    } else if (command.featureId === "breath") {
      const rolls = command.rolls ?? [];
      if (
        rolls.length !== 2 ||
        rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 6)
      ) {
        return reject("invalid_roll", "吐息必须提交两颗合法的 d6。 ");
      }
      total = rolls[0] + rolls[1];
    } else if (command.featureId === "rage") {
      bodies.push({ type: "ActiveEffectSet", entityId: actor.id, effectId: "rage", active: true });
    }
    bodies.push({ type: "FeatureUsed", entityId: actor.id, featureId: command.featureId, total });
    if (!combatFeature.inCombat) {
      bodies.push(
        ...timeEvents(definition, state, actor.id, durationSeconds({ unit: "round", value: 1 }), 1),
      );
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "advanceTime") {
    if (state.combats[state.entities[command.actorId].sceneId]?.status === "active") {
      return reject("not_allowed", "战斗中的时间按 6 秒轮次推进。 ");
    }
    const beats = Math.max(0, Math.floor(command.spotlightBeats ?? 0));
    const skew = spotlightRejection(state, command.actorId, beats);
    if (skew) return { kind: "rejected", rejection: skew };
    const seconds = durationSeconds(command.duration);
    const activity = commandActivity({
      id: command.id,
      actorId: command.actorId,
      kind: "general",
      sourceId: "advanceTime",
      name: beats > 0 ? "继续当前行动" : "等待",
      startedAt: actorTime(state, command.actorId),
      durationSeconds: seconds,
    });
    const bodies: UnstampedEvent[] = [{ type: "ActivityStarted", activity }];
    const timed = timeEvents(
      definition,
      state,
      command.actorId,
      seconds,
      beats,
      activity,
    );
    bodies.push(...timed);
    if (activityReached(actorTime(state, command.actorId), activity, timed)) {
      bodies.push({ type: "ActivityCompleted", activityId: activity.id });
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "startRest") {
    const started = startRestEvent(state, command.actorId, command.rest, command.options);
    if ("rejection" in started) return { kind: "rejected", rejection: started.rejection };
    const bodies: UnstampedEvent[] = [];
    const squad = actorSquad(state, command.actorId);
    if (squad && squad.memberIds.length > 1) {
      bodies.push({ type: "SquadLeft", squadId: squad.id, actorId: command.actorId });
    }
    bodies.push(started.event);
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "interruptRest") {
    if (state.rests[command.actorId]?.status !== "resting") {
      return reject("rest_ineligible", "角色当前没有在休息。 ");
    }
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{ type: "RestInterrupted", actorId: command.actorId }],
        "committed",
      ),
    };
  }
  if (command.kind === "leaveSquad") {
    const squad = actorSquad(state, command.actorId);
    if (!squad) return reject("not_allowed", "角色当前不在队伍中。 ");
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{ type: "SquadLeft", squadId: squad.id, actorId: command.actorId }],
        "committed",
      ),
    };
  }
  if (command.kind === "inviteSquad") {
    const actor = state.entities[command.actorId];
    const target = state.entities[command.targetId];
    if (!target || target.active === false || target.kind !== "player" || target.id === actor.id) {
      return reject("unknown_target", "邀请对象不是这桌的另一名玩家。 ");
    }
    if (actor.sceneId !== target.sceneId) {
      return reject("unreachable", "双方必须在同一地点才能组队。 ");
    }
    const mine = actorSquad(state, command.actorId);
    const theirs = actorSquad(state, command.targetId);
    if (mine?.memberIds.includes(command.targetId)) {
      return reject("already_resolved", "你们已经在同一队。 ");
    }
    if (mine && mine.captainId !== command.actorId) {
      return reject("not_allowed", "已有队伍时由队长邀请新成员。 ");
    }
    if (theirs) return reject("not_allowed", "对方已经在另一支队伍中。 ");
    if (
      Object.values(state.squadInvites).some(
        (invite) => invite.fromId === command.actorId || invite.toId === command.targetId,
      )
    ) {
      return reject("not_allowed", "已经有一条相关的组队邀请。 ");
    }
    const invite = {
      id: `squad-invite:${command.id}`,
      fromId: command.actorId,
      toId: command.targetId,
      sceneId: actor.sceneId,
    };
    return {
      kind: "committed",
      events: stampEvents(state, command, [{ type: "SquadInvited", invite }], "committed"),
    };
  }
  if (command.kind === "respondSquadInvite") {
    const invite = state.squadInvites[command.inviteId];
    if (!invite || invite.toId !== command.actorId) {
      return reject("not_allowed", "没有发给该角色的组队邀请。 ");
    }
    const bodies: UnstampedEvent[] = [
      { type: "SquadInviteCleared", inviteId: invite.id },
    ];
    if (command.accept) {
      const from = state.entities[invite.fromId];
      const to = state.entities[invite.toId];
      if (!from || !to || from.sceneId !== to.sceneId || from.sceneId !== invite.sceneId) {
        return reject("unreachable", "双方已经不在同一地点，邀请失效。 ");
      }
      const mine = actorSquad(state, invite.fromId);
      if (actorSquad(state, invite.toId)) {
        return reject("not_allowed", "受邀者已经加入另一支队伍。 ");
      }
      if (mine && mine.captainId !== invite.fromId) {
        return reject("not_allowed", "发起人已不再是队长。 ");
      }
      bodies.push({
        type: "SquadUpserted",
        squad: mine
          ? { ...mine, memberIds: [...mine.memberIds, invite.toId] }
          : {
              id: `squad:${command.id}`,
              captainId: invite.fromId,
              memberIds: [invite.fromId, invite.toId],
            },
      });
    }
    return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
  }
  if (command.kind === "cancelSquadInvite") {
    const invite = state.squadInvites[command.inviteId];
    if (!invite || invite.fromId !== command.actorId) {
      return reject("not_allowed", "只能取消自己发出的组队邀请。 ");
    }
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{ type: "SquadInviteCleared", inviteId: invite.id }],
        "committed",
      ),
    };
  }
  if (command.kind === "transferSquadCaptain") {
    const squad = state.squads[command.squadId];
    if (
      !squad ||
      squad.captainId !== command.actorId ||
      !squad.memberIds.includes(command.targetId) ||
      command.targetId === command.actorId
    ) {
      return reject("not_allowed", "只能把队长交给同队的另一名成员。 ");
    }
    return {
      kind: "committed",
      events: stampEvents(
        state,
        command,
        [{ type: "SquadCaptainTransferred", squadId: squad.id, captainId: command.targetId }],
        "committed",
      ),
    };
  }
  if (command.kind === "proposeGroupRest") {
    const squad = state.squads[command.squadId];
    if (!squad?.memberIds.includes(command.actorId)) {
      return reject("not_allowed", "只有队伍成员可以发起集体休息。 ");
    }
    if (state.restVote) return reject("not_allowed", "已经有一项集体休息表决。 ");
    const vote = {
      id: `rest-vote:${command.id}`,
      squadId: squad.id,
      kind: command.rest,
      proposerId: command.actorId,
      eligibleIds: [...squad.memberIds],
      agreedIds: [command.actorId],
      options: { [command.actorId]: command.options ?? {} },
    };
    return {
      kind: "committed",
      events: stampEvents(state, command, [{ type: "RestVoteProposed", vote }], "committed"),
    };
  }
  const vote = state.restVote;
  if (!vote || vote.id !== command.voteId || !vote.eligibleIds.includes(command.actorId)) {
    return reject("not_allowed", "这项休息表决不存在或角色没有投票资格。 ");
  }
  const bodies: UnstampedEvent[] = [
    {
      type: "RestVoteCast",
      voteId: vote.id,
      actorId: command.actorId,
      agree: command.agree,
      options: command.options,
    },
  ];
  if (!command.agree) {
    bodies.push({ type: "RestVoteCleared", voteId: vote.id });
  } else {
    const agreed = new Set([...vote.agreedIds, command.actorId]);
    if (vote.eligibleIds.every((id) => agreed.has(id))) {
      for (const actorId of vote.eligibleIds) {
        const option =
          actorId === command.actorId
            ? (command.options ?? {})
            : (vote.options[actorId] ?? {});
        const started = startRestEvent(state, actorId, vote.kind, option);
        if ("rejection" in started) return { kind: "rejected", rejection: started.rejection };
        bodies.push(started.event);
      }
      bodies.push({ type: "RestVoteCleared", voteId: vote.id });
    }
  }
  return { kind: "committed", events: stampEvents(state, command, bodies, "committed") };
}

export function step(
  definition: WorldDefinition,
  state: WorldState,
  command: Command,
): Decision {
  return {
    ...decide(definition, state, command),
    decisionId: `decision:${command.id}`,
    commandId: command.id,
  };
}

export function applyEvents(state: WorldState, events: WorldEvent[]): WorldState {
  const next = structuredClone(state);
  next.activities ??= {};
  for (const event of events) {
    if (event.version !== next.version + 1) {
      throw new Error(`事件版本不连续：需要 ${next.version + 1}，收到 ${event.version}`);
    }
    next.version = event.version;
    if (event.type === "CommandRecorded") {
      if (!next.processedCommandIds.includes(event.commandId)) next.processedCommandIds.push(event.commandId);
    } else if (event.type === "EntityJoined") {
      next.entities[event.entity.id] = event.entity;
      next.timelines[event.entity.id] = event.timeline;
      next.knowledge[event.entity.id] = {};
    } else if (event.type === "EntityRejoined") {
      const entity = next.entities[event.entityId];
      if (entity) entity.active = true;
    } else if (event.type === "EntityDeparted") {
      const entity = next.entities[event.entityId];
      if (entity) entity.active = false;
      const rest = next.rests[event.entityId];
      if (rest?.status === "resting") rest.status = "interrupted";
      for (const [squadId, squad] of Object.entries(next.squads)) {
        if (!squad.memberIds.includes(event.entityId)) continue;
        squad.memberIds = squad.memberIds.filter((id) => id !== event.entityId);
        if (squad.captainId === event.entityId) squad.captainId = squad.memberIds[0] ?? "";
        if (squad.memberIds.length < 2) delete next.squads[squadId];
      }
      for (const invite of Object.values(next.squadInvites)) {
        if (invite.fromId === event.entityId || invite.toId === event.entityId) {
          delete next.squadInvites[invite.id];
        }
      }
      if (next.restVote?.eligibleIds.includes(event.entityId)) delete next.restVote;
      for (const combat of Object.values(next.combats)) {
        const removedIndex = combat.order.findIndex((entry) => entry.entityId === event.entityId);
        if (removedIndex < 0) continue;
        const removedActive = removedIndex === combat.activeIndex;
        combat.order.splice(removedIndex, 1);
        if (!combat.order.length) {
          combat.status = "ended";
          combat.activeIndex = 0;
        } else if (removedIndex < combat.activeIndex) {
          combat.activeIndex -= 1;
        } else if (removedActive) {
          combat.activeIndex %= combat.order.length;
          combat.order[combat.activeIndex].economy = freshCombatEconomy(
            next.entities[combat.order[combat.activeIndex].entityId]?.speedFeet ?? 30,
          );
        }
      }
      const activePlayers = Object.values(next.entities).filter(
        (candidate) => candidate.kind === "player" && candidate.active !== false,
      );
      next.causalFrontierSeconds = activePlayers.length
        ? Math.min(
            ...activePlayers.map(
              (candidate) => next.timelines[candidate.id]?.fictionSeconds ?? 0,
            ),
          )
        : 0;
    } else if (event.type === "EntityLoadoutSynchronized") {
      const entity = next.entities[event.entityId];
      if (entity) {
        entity.ac = event.ac;
        entity.attacks = event.attacks;
        entity.capabilities = event.capabilities;
      }
    } else if (event.type === "RollRequested") {
      next.pendingRolls[event.roll.id] = event.roll;
    } else if (event.type === "RollResolved") {
      delete next.pendingRolls[event.requestId];
    } else if (event.type === "ArtifactTransferred") {
      next.artifacts[event.artifactId] = {
        artifactId: event.artifactId,
        status: "held",
        holderId: event.holderId,
      };
    } else if (event.type === "PortalStateChanged") {
      next.portals[event.portalId] = event.state;
    } else if (event.type === "ClueLearned") {
      next.knowledge[event.viewerId] ??= {};
      const old = next.knowledge[event.viewerId][event.clueId];
      if (layerValue(event.layer) > layerValue(old)) {
        next.knowledge[event.viewerId][event.clueId] = event.layer;
      }
    } else if (event.type === "FlagSet") {
      next.flags[event.flag] = event.value;
    } else if (event.type === "EntityDamaged") {
      const hp = next.entities[event.entityId]?.hp;
      if (hp) hp.current = Math.max(0, hp.current - event.amount);
    } else if (event.type === "EntityHealed") {
      const entity = next.entities[event.entityId];
      const hp = entity?.hp;
      if (hp) {
        hp.current = Math.min(hp.max, hp.current + event.amount);
        if (hp.current > 0) {
          entity.deathSaves = { successes: 0, failures: 0 };
          entity.activeEffects = entity.activeEffects.filter(
            (effect) => effect !== "unconscious" && effect !== "stable",
          );
        }
      }
    } else if (event.type === "ResourceSpent") {
      const entity = next.entities[event.entityId];
      entity.resources[event.resource] = Math.max(0, (entity.resources[event.resource] ?? 0) - event.amount);
    } else if (event.type === "ResourceRecovered") {
      const entity = next.entities[event.entityId];
      const maximum = entity.resourceRules[event.resource]?.max ?? Number.POSITIVE_INFINITY;
      entity.resources[event.resource] = Math.min(
        maximum,
        (entity.resources[event.resource] ?? 0) + event.amount,
      );
    } else if (event.type === "ActiveEffectSet") {
      const entity = next.entities[event.entityId];
      entity.activeEffects = event.active
        ? [...new Set([...entity.activeEffects, event.effectId])]
        : entity.activeEffects.filter((effect) => effect !== event.effectId);
    } else if (event.type === "CombatStarted") {
      next.combats[event.combat.sceneId] = event.combat;
    } else if (event.type === "CombatEnded") {
      const combat = next.combats[event.sceneId];
      if (combat) combat.status = "ended";
    } else if (event.type === "CombatantSideChanged") {
      const combatant = next.combats[event.sceneId]?.order.find(
        (entry) => entry.entityId === event.entityId,
      );
      if (combatant) combatant.side = event.side;
    } else if (event.type === "CombatantJoined") {
      const combat = next.combats[event.sceneId];
      if (combat) {
        const activeId = combat.order[combat.activeIndex]?.entityId;
        combat.order = [...combat.order, event.combatant].sort(
          (a, b) => b.initiative - a.initiative || a.entityId.localeCompare(b.entityId),
        );
        combat.activeIndex = Math.max(
          0,
          combat.order.findIndex((entry) => entry.entityId === activeId),
        );
      }
    } else if (event.type === "CombatActionSpent") {
      const combatant = next.combats[event.sceneId]?.order.find(
        (entry) => entry.entityId === event.entityId,
      );
      if (combatant) combatant.economy[event.cost] = false;
    } else if (event.type === "CombatAttackResolved") {
      const combatant = next.combats[event.sceneId]?.order.find(
        (entry) => entry.entityId === event.attackerId,
      );
      if (combatant) combatant.attackedThisTurn = true;
    } else if (event.type === "CombatantMoved") {
      const combatant = next.combats[event.sceneId]?.order.find(
        (entry) => entry.entityId === event.entityId,
      );
      if (combatant) {
        combatant.positionFeet = event.toPositionFeet;
        const granted =
          event.mode === "dash" ? (next.entities[event.entityId]?.speedFeet ?? 30) : 0;
        combatant.economy.movementFeet = Math.max(
          0,
          (combatant.economy.movementFeet ?? 0) + granted - event.feet,
        );
        combatant.economy.movement = combatant.economy.movementFeet > 0;
      }
    } else if (event.type === "EntityDropped") {
      const entity = next.entities[event.entityId];
      if (entity) {
        entity.activeEffects = [
          ...new Set([
            ...entity.activeEffects.filter(
              (effect) => effect !== "stable" && effect !== "unconscious" && effect !== "dead",
            ),
            event.outcome === "dead" ? "dead" : "unconscious",
          ]),
        ];
        entity.deathSaves = { successes: 0, failures: 0 };
      }
    } else if (event.type === "DeathSaveResolved") {
      const entity = next.entities[event.entityId];
      if (entity) {
        entity.deathSaves = {
          successes: event.successes,
          failures: event.failures,
        };
        const combatant = next.combats[entity.sceneId]?.order.find(
          (entry) => entry.entityId === entity.id,
        );
        if (combatant) combatant.deathSaveRolledThisTurn = true;
        if (event.outcome === "revived" && entity.hp) {
          entity.hp.current = 1;
          entity.activeEffects = entity.activeEffects.filter(
            (effect) => effect !== "unconscious" && effect !== "stable",
          );
        } else if (event.outcome === "stable") {
          entity.activeEffects = [
            ...new Set([...entity.activeEffects.filter((effect) => effect !== "unconscious"), "stable"]),
          ];
        } else if (event.outcome === "dead") {
          entity.activeEffects = [
            ...new Set([...entity.activeEffects.filter((effect) => effect !== "unconscious" && effect !== "stable"), "dead"]),
          ];
        }
      }
    } else if (event.type === "CombatTurnAdvanced") {
      const combat = next.combats[event.sceneId];
      if (combat) {
        combat.round = event.round;
        combat.activeIndex = Math.max(
          0,
          combat.order.findIndex((entry) => entry.entityId === event.toEntityId),
        );
        const active = combat.order[combat.activeIndex];
        if (active) {
          active.economy = freshCombatEconomy(
            next.entities[active.entityId]?.speedFeet ?? 30,
          );
          active.attackedThisTurn = false;
          active.deathSaveRolledThisTurn = false;
        }
      }
    } else if (event.type === "EntityMoved") {
      const entity = next.entities[event.entityId];
      entity.sceneId = event.to;
      if (!entity.visitedSceneIds.includes(event.to)) entity.visitedSceneIds.push(event.to);
      for (const invite of Object.values(next.squadInvites)) {
        if (invite.fromId === event.entityId || invite.toId === event.entityId) {
          delete next.squadInvites[invite.id];
        }
      }
    } else if (event.type === "FictionTimeAdvanced") {
      for (const entityId of event.entityIds) {
        const timeline = next.timelines[entityId];
        timeline.fictionSeconds = Math.max(timeline.fictionSeconds, event.toSeconds);
        timeline.spotlightBeat += event.spotlightBeats;
        timeline.causalVersion = event.version;
      }
      const players = Object.values(next.entities).filter(
        (entity) => entity.kind === "player" && entity.active !== false,
      );
      next.causalFrontierSeconds = players.length
        ? Math.min(...players.map((entity) => next.timelines[entity.id].fictionSeconds))
        : 0;
    } else if (event.type === "TimelinesSynchronized") {
      for (const entityId of event.entityIds) {
        const timeline = next.timelines[entityId];
        timeline.fictionSeconds = Math.max(timeline.fictionSeconds, event.toSeconds);
        timeline.spotlightBeat = Math.max(timeline.spotlightBeat, event.toSpotlightBeat);
        timeline.causalVersion = event.version;
      }
      const players = Object.values(next.entities).filter(
        (entity) => entity.kind === "player" && entity.active !== false,
      );
      next.causalFrontierSeconds = players.length
        ? Math.min(...players.map((entity) => next.timelines[entity.id].fictionSeconds))
        : 0;
    } else if (event.type === "SpotlightAdvanced") {
      const timeline = next.timelines[event.entityId];
      timeline.spotlightBeat += event.beats;
      timeline.causalVersion = event.version;
    } else if (event.type === "ScheduledEventAttempted") {
      next.scheduledEvents[event.scheduledEventId] = "attempted";
    } else if (event.type === "ScheduledEventCancelled") {
      next.scheduledEvents[event.scheduledEventId] = "cancelled";
    } else if (event.type === "ActivityStarted") {
      next.activities[event.activity.id] = event.activity;
    } else if (event.type === "ActivityCompleted") {
      const activity = next.activities[event.activityId];
      if (activity) activity.status = "completed";
    } else if (event.type === "ActivityFailed") {
      const activity = next.activities[event.activityId];
      if (activity) activity.status = "failed";
    } else if (event.type === "ActivityInterrupted") {
      if (event.activityId) {
        const activity = next.activities[event.activityId];
        if (activity) activity.status = "interrupted";
      }
      const rest = next.rests[event.actorId];
      if (rest?.status === "resting") rest.status = "interrupted";
    } else if (event.type === "RestStarted") {
      next.rests[event.rest.actorId] = event.rest;
    } else if (event.type === "RestInterrupted") {
      const rest = next.rests[event.actorId];
      if (rest) rest.status = "interrupted";
    } else if (event.type === "RestCompleted") {
      const rest = next.rests[event.actorId];
      if (rest) rest.status = "completed";
      if (event.rest === "long") {
        next.entities[event.actorId].lastLongRestCompletedAt = next.timelines[event.actorId].fictionSeconds;
      }
      next.entities[event.actorId].activeEffects = next.entities[event.actorId].activeEffects.filter(
        (effect) => effect !== "rage",
      );
    } else if (event.type === "SquadLeft") {
      const squad = next.squads[event.squadId];
      if (squad) {
        squad.memberIds = squad.memberIds.filter((id) => id !== event.actorId);
        if (squad.captainId === event.actorId) squad.captainId = squad.memberIds[0] ?? "";
        if (squad.memberIds.length < 2) delete next.squads[event.squadId];
      }
    } else if (event.type === "SquadInvited") {
      next.squadInvites[event.invite.id] = event.invite;
    } else if (event.type === "SquadInviteCleared") {
      delete next.squadInvites[event.inviteId];
    } else if (event.type === "SquadUpserted") {
      next.squads[event.squad.id] = event.squad;
    } else if (event.type === "SquadCaptainTransferred") {
      const squad = next.squads[event.squadId];
      if (squad) squad.captainId = event.captainId;
    } else if (event.type === "RestVoteProposed") {
      next.restVote = event.vote;
    } else if (event.type === "RestVoteCast") {
      if (next.restVote?.id === event.voteId && event.agree) {
        next.restVote.agreedIds = [...new Set([...next.restVote.agreedIds, event.actorId])];
        next.restVote.options[event.actorId] = event.options ?? {};
      }
    } else if (event.type === "RestVoteCleared") {
      if (next.restVote?.id === event.voteId) delete next.restVote;
    }
  }
  return next;
}

export function replay(initial: WorldState, events: WorldEvent[]): WorldState {
  return applyEvents(initial, events);
}

export function project(
  definition: WorldDefinition,
  state: WorldState,
  viewerId: string,
): PlayerProjection {
  const viewer = state.entities[viewerId];
  if (!viewer) throw new Error("观察者不在世界状态中");
  const squad = actorSquad(state, viewerId);
  return {
    rulesetVersion: state.rulesetVersion,
    version: state.version,
    viewer: {
      id: viewer.id,
      name: viewer.name,
      sceneId: viewer.sceneId,
      visitedSceneIds: [...viewer.visitedSceneIds],
      timeline: state.timelines[viewerId],
      rest: state.rests[viewerId],
      hp: viewer.hp,
      ac: viewer.ac,
      speedFeet: viewer.speedFeet,
      deathSaves: { ...viewer.deathSaves },
      activeEffects: [...viewer.activeEffects],
      availableRollBoosts: [
        ...(viewer.activeEffects.includes("guidance") ? ["guidance" as const] : []),
        ...((viewer.resources.inspiration ?? 0) > 0 ? ["inspiration" as const] : []),
        ...(viewer.featureIds.includes("halflingLucky") ? ["lucky" as const] : []),
      ],
      resources: Object.entries(viewer.resources).map(([id, current]) => ({
        id,
        current,
        max: viewer.resourceRules[id]?.max,
      })),
      attacks: structuredClone(viewer.attacks),
    },
    visibleEntities: Object.values(state.entities)
      .filter(
        (entity) =>
          entity.active !== false &&
          (entity.id === viewerId || entity.sceneId === viewer.sceneId),
      )
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        condition: entity.activeEffects.includes("dead")
          ? ("dead" as const)
          : (entity.hp?.current ?? 1) === 0
            ? ("down" as const)
            : ("active" as const),
      })),
    visibleArtifacts: definition.artifacts.flatMap((artifact) => {
      const current = state.artifacts[artifact.id];
      const visible =
        (current.status === "placed" &&
          current.sceneId === viewer.sceneId &&
          artifact.initialVisibility === "obvious") ||
        (current.status === "held" && current.holderId === viewerId) ||
        (current.status === "held" &&
          artifact.initialVisibility === "obvious" &&
          state.entities[current.holderId ?? ""]?.sceneId === viewer.sceneId);
      return visible
        ? [{ id: artifact.id, name: artifact.name, status: current.status as "placed" | "held", holderId: current.holderId }]
        : [];
    }),
    knowledge: Object.entries(state.knowledge[viewerId] ?? {}).map(([clueId, layer]) => ({
      clueId,
      layer,
    })),
    portals: definition.portals.flatMap((portal) => {
      if (portal.from === viewer.sceneId) return [{ id: portal.id, to: portal.to, state: state.portals[portal.id] }];
      if (portal.to === viewer.sceneId) return [{ id: portal.id, to: portal.from, state: state.portals[portal.id] }];
      return [];
    }),
    pendingRolls: Object.values(state.pendingRolls)
      .filter((roll) => roll.actorId === viewerId)
      .map((roll) => ({
        id: roll.id,
        ability: roll.ability,
        skill: roll.skill,
        dc: roll.dc,
        mode: roll.mode,
        reason: roll.reason,
      })),
    squad,
    squadInvites: Object.values(state.squadInvites).filter(
      (invite) => invite.fromId === viewerId || invite.toId === viewerId,
    ),
    restVote:
      state.restVote?.eligibleIds.includes(viewerId) ? structuredClone(state.restVote) : undefined,
    combat:
      state.combats[viewer.sceneId]?.status === "active"
        ? structuredClone(state.combats[viewer.sceneId])
        : undefined,
    reachedEndings: (definition.endings ?? [])
      .filter((ending) => ending.when.every((predicate) => worldPredicateMatches(state, predicate)))
      .map(({ id, name, outcome, publicText }) => ({ id, name, outcome, publicText })),
  };
}
