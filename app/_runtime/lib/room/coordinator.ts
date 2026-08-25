import type { Command, WorldDefinition, WorldState } from "../rules/model";

export const TURN_TICKET_TTL_MS = 2 * 60 * 1000;
export const UX_LEASE_TTL_MS = 3 * 60 * 1000;

function addEffectScopes(
  scopes: Set<string>,
  definition: WorldDefinition,
  actorId: string,
  effect: WorldDefinition["npcPlans"][number]["effects"][number],
) {
  if (effect.kind === "transferArtifact") scopes.add(`artifact:${effect.artifactId}`);
  if (effect.kind === "moveActor") {
    scopes.add(`entity:${actorId}`);
    scopes.add(`portal:${effect.portalId}`);
    const portal = definition.portals.find((candidate) => candidate.id === effect.portalId);
    if (portal) {
      scopes.add(`scene:${portal.from}`);
      scopes.add(`scene:${portal.to}`);
    }
  }
  if (effect.kind === "setPortalState") scopes.add(`portal:${effect.portalId}`);
  if (effect.kind === "setFlag") scopes.add(`flag:${effect.flag}`);
  if (effect.kind === "revealClue") scopes.add(`knowledge:${actorId}`);
  if (effect.kind === "spendResource" || effect.kind === "damage" || effect.kind === "heal") {
    scopes.add(`entity:${actorId}`);
  }
}

function addTimedWorldScopes(
  scopes: Set<string>,
  definition: WorldDefinition,
  state: WorldState,
  actorId: string,
) {
  const actorScene = state.entities[actorId]?.sceneId;
  for (const event of definition.scheduledEvents) {
    if (state.scheduledEvents[event.id] !== "pending") continue;
    const relevant =
      event.scope.kind === "global" ||
      (event.scope.kind === "location" && event.scope.sceneId === actorScene) ||
      (event.scope.kind === "entity" &&
        state.entities[event.scope.entityId]?.sceneId === actorScene);
    if (!relevant) continue;
    scopes.add(`scheduled:${event.id}`);
    if (event.scope.kind === "global") scopes.add("world-time");
    const plan = definition.npcPlans.find((candidate) => candidate.id === event.npcPlanId);
    if (!plan) continue;
    scopes.add(`entity:${plan.actorId}`);
    for (const effect of plan.effects) addEffectScopes(scopes, definition, plan.actorId, effect);
  }
  for (const activity of Object.values(state.activities)) {
    if (activity.kind !== "npcPlan" || activity.status !== "active") continue;
    scopes.add(`activity:${activity.id}`);
    scopes.add(`entity:${activity.actorId}`);
    const plan = definition.npcPlans.find((candidate) => candidate.id === activity.sourceId);
    for (const effect of plan?.effects ?? []) {
      addEffectScopes(scopes, definition, activity.actorId, effect);
    }
  }
}

function interactionScopes(
  definition: WorldDefinition,
  state: WorldState,
  actorId: string,
  interactionId: string,
) {
  const scopes = new Set<string>([
    `entity:${actorId}`,
    `scene:${state.entities[actorId]?.sceneId ?? "unknown"}`,
    `interaction:${interactionId}`,
  ]);
  const interaction = definition.interactions.find((candidate) => candidate.id === interactionId);
  for (const predicate of interaction?.prerequisites ?? []) {
    const current = predicate.kind === "not" ? predicate.predicate : predicate;
    if (
      current.kind === "artifactAt" ||
      current.kind === "artifactHeldByActor" ||
      current.kind === "artifactHeldByEntity"
    ) {
      scopes.add(`artifact:${current.artifactId}`);
    }
    if (current.kind === "entityAt") scopes.add(`entity:${current.entityId}`);
    if (current.kind === "portalState") scopes.add(`portal:${current.portalId}`);
    if (current.kind === "flagEquals") scopes.add(`flag:${current.flag}`);
  }
  for (const effect of [...(interaction?.success ?? []), ...(interaction?.failure ?? [])]) {
    addEffectScopes(scopes, definition, actorId, effect);
  }
  return scopes;
}

export function commandScopes(
  definition: WorldDefinition,
  state: WorldState,
  command: Command,
): string[] {
  const scopes = new Set<string>([`entity:${command.actorId}`]);
  let advancesTime = false;
  if (command.kind === "interact") {
    for (const scope of interactionScopes(definition, state, command.actorId, command.interactionId)) {
      scopes.add(scope);
    }
    advancesTime =
      definition.interactions.find((candidate) => candidate.id === command.interactionId)
        ?.resolution.kind === "automatic";
  }
  if (command.kind === "resolveRoll") {
    advancesTime = true;
    const pending = state.pendingRolls[command.requestId];
    scopes.add(`roll:${command.requestId}`);
    if (pending) {
      for (const scope of interactionScopes(definition, state, command.actorId, pending.interactionId)) {
        scopes.add(scope);
      }
    }
  } else if (command.kind === "move") {
    advancesTime = true;
    scopes.add(`portal:${command.portalId}`);
    scopes.add(`scene:${state.entities[command.actorId]?.sceneId ?? "unknown"}`);
    scopes.add(`scene:${command.destinationId}`);
    const squad = Object.values(state.squads).find((candidate) =>
      candidate.memberIds.includes(command.actorId),
    );
    if (squad) scopes.add(`squad:${squad.id}`);
  } else if (command.kind === "advanceTime") {
    advancesTime = true;
    scopes.add(`timeline:${command.actorId}`);
    scopes.add(`scene:${state.entities[command.actorId]?.sceneId ?? "unknown"}`);
  } else if (command.kind === "castSpell" || command.kind === "useFeature") {
    advancesTime = true;
    scopes.add(`timeline:${command.actorId}`);
    scopes.add(`scene:${state.entities[command.actorId]?.sceneId ?? "unknown"}`);
    scopes.add(`resources:${command.actorId}`);
  } else if (command.kind === "startCombat") {
    const sceneId = state.entities[command.actorId]?.sceneId ?? "unknown";
    scopes.add(`combat:${sceneId}`);
    scopes.add(`scene:${sceneId}`);
    for (const targetId of command.targetIds) scopes.add(`entity:${targetId}`);
  } else if (
    command.kind === "joinCombat" ||
    command.kind === "spendCombatAction" ||
    command.kind === "combatAttack" ||
    command.kind === "combatMove" ||
    command.kind === "rollDeathSave" ||
    command.kind === "endCombatTurn"
  ) {
    const combat = command.kind === "rollDeathSave"
      ? state.combats[state.entities[command.actorId]?.sceneId ?? ""]
      : Object.values(state.combats).find(
          (candidate) => candidate.id === command.combatId,
        );
    scopes.add(`combat:${combat?.sceneId ?? (command.kind === "rollDeathSave" ? "unknown" : command.combatId)}`);
    if (command.kind === "joinCombat" && command.sideWithId) {
      scopes.add(`entity:${command.sideWithId}`);
    }
    if (command.kind === "combatAttack") {
      scopes.add(`entity:${command.targetId}`);
      scopes.add(`resources:${command.actorId}`);
    }
    if (command.kind === "combatMove") {
      for (const reactorId of Object.keys(command.opportunityRolls)) {
        scopes.add(`entity:${reactorId}`);
      }
    }
    if (command.kind === "endCombatTurn") {
      advancesTime = true;
      scopes.add(`timeline:${command.actorId}`);
    }
  } else if (command.kind === "startRest" || command.kind === "interruptRest") {
    scopes.add(`rest:${command.actorId}`);
    scopes.add(`timeline:${command.actorId}`);
    const squad = Object.values(state.squads).find((candidate) =>
      candidate.memberIds.includes(command.actorId),
    );
    if (squad) scopes.add(`squad:${squad.id}`);
  } else if (command.kind === "leaveSquad") {
    const squad = Object.values(state.squads).find((candidate) =>
      candidate.memberIds.includes(command.actorId),
    );
    if (squad) scopes.add(`squad:${squad.id}`);
  } else if (command.kind === "inviteSquad") {
    scopes.add(`entity:${command.targetId}`);
    scopes.add("squad-invites");
    const squad = Object.values(state.squads).find((candidate) =>
      candidate.memberIds.includes(command.actorId),
    );
    if (squad) scopes.add(`squad:${squad.id}`);
  } else if (command.kind === "respondSquadInvite" || command.kind === "cancelSquadInvite") {
    scopes.add("squad-invites");
    const invite = state.squadInvites[command.inviteId];
    if (invite) {
      scopes.add(`entity:${invite.fromId}`);
      const squad = Object.values(state.squads).find((candidate) =>
        candidate.memberIds.includes(invite.fromId),
      );
      if (squad) scopes.add(`squad:${squad.id}`);
    }
  } else if (command.kind === "transferSquadCaptain") {
    scopes.add(`squad:${command.squadId}`);
    scopes.add(`entity:${command.targetId}`);
  } else if (command.kind === "proposeGroupRest") {
    scopes.add(`squad:${command.squadId}`);
    scopes.add("rest-vote");
  } else if (command.kind === "voteGroupRest") {
    scopes.add("rest-vote");
    if (state.restVote) scopes.add(`squad:${state.restVote.squadId}`);
  }
  if (advancesTime) addTimedWorldScopes(scopes, definition, state, command.actorId);
  return [...scopes].sort();
}

export function scopeConflict(
  ticketVersions: Record<string, number>,
  currentVersions: Record<string, number>,
  scopes: string[],
) {
  return scopes.find(
    (scope) => (ticketVersions[scope] ?? 0) !== (currentVersions[scope] ?? 0),
  );
}

export function advanceScopeVersions(
  current: Record<string, number>,
  scopes: string[],
  version: number,
) {
  const next = { ...current };
  for (const scope of scopes) next[scope] = version;
  return next;
}
