import { registeredAbilityDefinition } from "../profiles/ability-compiler";
import {
  analyzeCombatMovement,
  canonicalCombatPoint,
  canonicalizeCombatPath,
  pathLengthMilliInches,
  rectangularFeatureEntity,
  type CanonicalCombatPoint,
} from "../profiles/combat-geometry";
import type { RuntimeProfileManifest } from "../profiles/types";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { authorityGeometryFeatureRecords } from "./authority-bindings";
import { turnMovementLimitMilliInches } from "./basic-actions";
import { besideTarget, footprintInsidePolygon, heldBodies, nextTo, SCENE_GRID_STEP } from "./carry";
import { ownCombatAbilityName } from "./combat-ability-names";
import { activeEncounter, canStillFight, encounterHostileTargets, encounterStandDown } from "./combat-encounters";
import { aimableAttack, combatBasicActionOffers, consumeTurnGrant, stepCombatWorld, targetsCreature } from "./combat-actions";
import { conditionMechanics, conditionSpeed } from "./condition-mechanics";
import type { AuthoritativeWorldState, JsonRecord, StepResult } from "./model";
import {
  NPC_BASIC_ACTIONS,
  NPC_READY_EVENTS,
  type NpcCombatTurnDestination,
  type NpcCombatTurnStep,
  type NpcCombatTurnTarget,
} from "./npc-combat-turn-state";
import { hiddenCondition, hidingOpponents, spatialRecordVisibleTo } from "./spatial-visibility";
import { isNonEmptyString, isRecord } from "./validation";

/** SPEC 0006 §§6、7: what the NPC whose turn it is may do now, read from its own
 * view. Nothing here is visible to the NPC that its own projection does not
 * show it: a creature hidden from it is never named, only "aim at a point"
 * is offered (SPEC 0012 §6.3, ADR 0097 decision 4). Rules judges every step
 * again when it is taken; the "now" flags are hints for the plan. */
export type NpcCombatTurnOptions = {
  schema: "zhuwei.npc-combat-turn-options/v1";
  npcRef: string;
  encounterRef: string;
  round: number;
  turn: { action: number; bonusAction: number; reaction: number; attacksRemaining: number; attacksPerAttackAction: number };
  movement: {
    remainingFeet: number;
    speedFeet: number;
    canMove: boolean;
    destinations: Array<{ ref: string; name: string; kind: "creature" | "feature"; reachableThisTurn: boolean | null }>;
    pointAllowed: boolean;
  };
  abilities: Array<{
    abilityRef: string;
    /** ADR 0113: what the NPC calls it (its weapon, a stat-block attack, a
     * spell, a built-in action), and how far it reaches or shoots. */
    name?: string;
    reachFeet?: number;
    rangeFeet?: number;
    longRangeFeet?: number;
    activation: string;
    targeting: "creature" | "point" | "none";
    targets: Array<{ ref: string; name: string; inReachNow: boolean }>;
    aimAtPointAllowed: boolean;
  }>;
  /** Reaction abilities the NPC holds; it keeps its reaction by ending its turn. */
  reactionAbilityRefs: string[];
  basicActions: Array<typeof NPC_BASIC_ACTIONS[number]>;
  help: { allyRefs: string[]; enemyRefs: string[] } | null;
  ready: { triggerRefs: string[]; events: Array<typeof NPC_READY_EVENTS[number]> } | null;
  /** SPEC 0012 §3.3 (ADR 0117): the fight as the NPC sees it -- whom it is
   * fighting, who among those it sees is fighting it, the others it sees in
   * the encounter, and whether each can still fight. `yieldRefs` are those
   * it may stop fighting, `turnOnRefs` those it may start fighting. */
  stance: {
    fighting: NpcCombatStanceCreature[];
    fightingYou: NpcCombatStanceCreature[];
    others: NpcCombatStanceCreature[];
    yieldRefs: string[];
    turnOnRefs: string[];
  };
  /** Whether it can say something aloud this turn. */
  speak: boolean;
  endTurn: true;
};

export type NpcCombatStanceCreature = { ref: string; name: string; canFight: boolean };

const PROBE_ROOT_PREFIX = "npc-turn-probe:";
const BUILTIN_ATTACK_REPLACEMENTS = ["action:grapple", "action:shove", "action:shove-away"];
const BASIC_ACTION_REFS: Readonly<Record<typeof NPC_BASIC_ACTIONS[number], string>> = {
  dash: "action:dash", dodge: "action:dodge", disengage: "action:disengage", hide: "action:hide", search: "action:search",
};

function entityId(entity: JsonRecord): string {
  return String(entity.id ?? entity.entityId);
}

function feet(milliInches: bigint): number {
  return Number(milliInches / 12_000n);
}

/** The hostility the encounter recorded for the NPC itself. */
function hostileRefs(state: AuthoritativeWorldState, npcId: string): string[] {
  const encounter = activeEncounter(state, npcId);
  if (encounter === undefined || !Array.isArray(encounter.hostilities)) return [];
  return [...new Set(encounter.hostilities.flatMap(relation => isRecord(relation) && Array.isArray(relation.fromEntityIds)
    && relation.fromEntityIds.includes(npcId) && Array.isArray(relation.toEntityIds) ? relation.toEntityIds.filter(isNonEmptyString) : []))].sort();
}

/** The creatures in the NPC's scene its own projection shows it. */
function seenCreatures(state: AuthoritativeWorldState, npcId: string): JsonRecord[] {
  const source = state.combatRuntime.entities[npcId];
  return Object.values(state.combatRuntime.entities).filter(entity => entityId(entity) !== npcId
    && entity.sceneId === source?.sceneId && entity.kind !== "environment" && isRecord(entity.position) && isRecord(entity.footprint)
    && spatialRecordVisibleTo(state, entity, npcId)).sort((left, right) => entityId(left).localeCompare(entityId(right)));
}

function seenFeatures(state: AuthoritativeWorldState, npcId: string): Array<{ ref: string; name: string; body: JsonRecord }> {
  const source = state.combatRuntime.entities[npcId];
  return [...authorityGeometryFeatureRecords(state)].flatMap(record => {
    if (record.sceneRef !== source?.sceneId || !spatialRecordVisibleTo(state, { ...record.feature, id: record.feature.featureId }, npcId)) return [];
    const body = rectangularFeatureEntity(record.feature, record.sceneRef);
    return body === undefined ? [] : [{ ref: record.feature.featureId,
      name: typeof record.feature.label === "string" ? record.feature.label : record.feature.featureId, body }];
  }).sort((left, right) => left.ref.localeCompare(right.ref));
}

/** SPEC 0012 §6.3 (ADR 0097 decision 4): someone hostile to the NPC hides
 * from it in its scene; the NPC may guess a point but is told no more. */
function enemyHiddenFrom(state: AuthoritativeWorldState, npcId: string): boolean {
  const source = state.combatRuntime.entities[npcId];
  return hostileRefs(state, npcId).some(enemyId => {
    const enemy = state.combatRuntime.entities[enemyId];
    return enemy !== undefined && enemy.lifeState !== "dead" && enemy.sceneId === source?.sceneId
      && hiddenCondition(enemy.conditions) !== undefined && hidingOpponents(state, enemyId, npcId);
  });
}

function abilityDefinition(state: AuthoritativeWorldState, abilityRef: string): JsonRecord | undefined {
  if (BUILTIN_ATTACK_REPLACEMENTS.includes(abilityRef)) return { definitionId: abilityRef, revision: "1", rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" }, target: { kind: "creature", count: "1", reachInches: "60" } };
  const stored = state.combatRuntime.definitions[abilityRef];
  if (!isRecord(stored)) return undefined;
  return isRecord(stored.mechanicGraph) ? registeredAbilityDefinition(stored) : stored;
}

function inchesToFeet(value: unknown): number | undefined {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,6})$/u.test(value) ? Number(value) / 12 : undefined;
}

/** SPEC 0006 §§6、7 (ADR 0113): an ability as the NPC knows its own -- its
 * name, and the reach or range its target allows. */
function describedAbility(state: AuthoritativeWorldState, abilityRef: string, target: JsonRecord | undefined):
  Pick<NpcCombatTurnOptions["abilities"][number], "name" | "reachFeet" | "rangeFeet" | "longRangeFeet"> {
  const name = ownCombatAbilityName(state, abilityRef);
  const reachFeet = inchesToFeet(target?.reachInches);
  const rangeFeet = inchesToFeet(target?.rangeNormalInches ?? target?.rangeInches);
  const longRangeFeet = inchesToFeet(target?.rangeLongInches);
  return { ...(name === undefined ? {} : { name }), ...(reachFeet === undefined ? {} : { reachFeet }),
    ...(rangeFeet === undefined ? {} : { rangeFeet }), ...(longRangeFeet === undefined ? {} : { longRangeFeet }) };
}

function legal(result: StepResult | undefined): boolean {
  return result !== undefined && result.kind !== "rejected" && result.kind !== "needsKp" && result.kind !== "initialized";
}

/** A dry run of the same Rules step the turn would take, on a probe root. */
function probe(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): boolean {
  try { return legal(stepCombatWorld(profiles, state, { ...input, rootActionId: `${PROBE_ROOT_PREFIX}${String(input.sourceEntityId)}` })); }
  catch { return false; }
}

function remainingMovement(state: AuthoritativeWorldState, npcId: string): { remaining: bigint; speed: bigint } {
  const entity = state.combatRuntime.entities[npcId];
  const walk = isRecord(entity?.speedInches) ? entity.speedInches.walk : undefined;
  const spent = isRecord(entity?.movement) ? String(entity.movement.spentMilliInches ?? "0") : "0";
  if (entity === undefined || typeof walk !== "string" || !/^(0|[1-9][0-9]*)$/u.test(walk) || !/^(0|[1-9][0-9]*)$/u.test(spent)) {
    return { remaining: 0n, speed: 0n };
  }
  const speed = conditionSpeed(state, npcId, walk);
  const speedInches = speed.canMove ? String(speed.speed) : "0";
  const left = turnMovementLimitMilliInches(entity, speedInches) - BigInt(spent);
  return { remaining: left > 0n ? left : 0n, speed: BigInt(speedInches) * 1000n };
}

export function npcCombatTurnOptions(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  npcId: string,
): NpcCombatTurnOptions | undefined {
  const source = state.combatRuntime.entities[npcId];
  const encounter = activeEncounter(state, npcId);
  if (source === undefined || encounter === undefined || encounter.activeEntityId !== npcId
    || state.entities[npcId]?.kind !== "npc" || !isNonEmptyString(encounter.encounterId)) return undefined;
  const facts = conditionMechanics(state, npcId);
  const turn = isRecord(source.turn) ? source.turn : {};
  const count = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : 0;
  const hostiles = new Set(hostileRefs(state, npcId));
  const creatures = seenCreatures(state, npcId);
  const name = (ref: string) => state.entities[ref]?.name ?? ref;
  const movement = remainingMovement(state, npcId);
  const canMove = facts.canMove && movement.remaining > 0n;
  const hiddenEnemy = enemyHiddenFrom(state, npcId);
  const destinations: NpcCombatTurnOptions["movement"]["destinations"] = canMove ? [
    ...creatures.filter(creature => creature.lifeState !== "dead").map(creature => {
      const walk = planNpcEncounterWalk(profiles, state, npcId, { kind: "nextTo", ref: entityId(creature) });
      return { ref: entityId(creature), name: name(entityId(creature)), kind: "creature" as const,
        reachableThisTurn: walk.kind === "stay" || (walk.kind === "walk" && walk.complete) };
    }),
    ...seenFeatures(state, npcId).map(feature => ({ ref: feature.ref, name: feature.name, kind: "feature" as const, reachableThisTurn: null })),
  ] : [];
  const abilities: NpcCombatTurnOptions["abilities"] = [];
  const reactionAbilityRefs: string[] = [];
  const refs = [...new Set([...(Array.isArray(source.abilityRefs) ? source.abilityRefs.filter(isNonEmptyString) : []),
    ...BUILTIN_ATTACK_REPLACEMENTS])];
  for (const abilityRef of refs) {
    const definition = abilityDefinition(state, abilityRef);
    const activation = isRecord(definition?.activation) && isNonEmptyString(definition.activation.kind) ? definition.activation.kind : undefined;
    if (definition === undefined || activation === undefined) continue;
    if (activation === "reaction" || activation === "reactionSpell") { reactionAbilityRefs.push(abilityRef); continue; }
    if (!facts.canAct || consumeTurnGrant(source, definition, abilityRef) === undefined) continue;
    const target = isRecord(definition.target) ? definition.target : undefined;
    const described = describedAbility(state, abilityRef, target);
    if (targetsCreature(definition)) {
      const healing = isRecord(definition.healing) || isRecord(definition.temporaryHitPoints) || definition.mechanicalKey === "stabilize";
      const candidates = target?.selfOnly === true ? [source]
        : healing ? [source, ...creatures.filter(creature => !hostiles.has(entityId(creature)))]
          : creatures.filter(creature => hostiles.has(entityId(creature)) && creature.lifeState !== "dead"
            // SPEC 0012 §6.3 (ADR 0113): the one grappled or shoved picks
            // its own skill to resist, and a player's pick has no way into an
            // NPC's turn, so such a contest is never offered against one.
            && !(BUILTIN_ATTACK_REPLACEMENTS.includes(abilityRef) && state.entities[entityId(creature)]?.kind === "player"));
      const aim = aimableAttack(definition) && hiddenEnemy;
      if (candidates.length === 0 && !aim) continue;
      abilities.push({ abilityRef, ...described, activation, targeting: "creature", aimAtPointAllowed: aim,
        targets: candidates.map(candidate => ({ ref: entityId(candidate), name: name(entityId(candidate)),
          inReachNow: probe(profiles, state, { kind: "invokeAbility", sourceEntityId: npcId, abilityRef,
            parameters: { targetEntityIds: [entityId(candidate)] } }) })) });
    } else if (target?.kind === "area") {
      abilities.push({ abilityRef, ...described, activation, targeting: "point", targets: [], aimAtPointAllowed: false });
    } else {
      abilities.push({ abilityRef, ...described, activation, targeting: "none", targets: [], aimAtPointAllowed: false });
    }
  }
  const offers = combatBasicActionOffers(state, npcId);
  const basicActions = NPC_BASIC_ACTIONS.filter(action => facts.canAct
    && (action === "hide" ? offers.hide : action === "search" ? offers.search : true)
    && probe(profiles, state, { kind: "invokeAbility", sourceEntityId: npcId, abilityRef: BASIC_ACTION_REFS[action], parameters: {} }));
  // SPEC 0012 §3.3 (ADR 0117): only creatures it sees are named; hostility
  // toward it is what it sees of them.
  const participants = (encounter.participantEntityIds as unknown[]).filter(isNonEmptyString);
  const stanceOf = (creature: JsonRecord): NpcCombatStanceCreature => ({ ref: entityId(creature), name: name(entityId(creature)),
    canFight: canStillFight(state, encounter, entityId(creature)) });
  const fightingYou = (creature: JsonRecord) => encounterHostileTargets(encounter, entityId(creature)).includes(npcId);
  const inEncounter = creatures.filter(creature => participants.includes(entityId(creature)));
  const fighting = creatures.filter(creature => hostiles.has(entityId(creature)));
  return {
    schema: "zhuwei.npc-combat-turn-options/v1",
    npcRef: npcId,
    encounterRef: encounter.encounterId,
    round: Number(encounter.round),
    turn: { action: count(turn.action), bonusAction: count(turn.bonusAction), reaction: count(turn.reaction),
      attacksRemaining: count(turn.attacksRemaining), attacksPerAttackAction: Math.max(1, count(source.attacksPerAttackAction)) },
    movement: { remainingFeet: feet(movement.remaining), speedFeet: feet(movement.speed), canMove, destinations, pointAllowed: canMove },
    abilities,
    reactionAbilityRefs: reactionAbilityRefs.sort(),
    basicActions,
    help: facts.canAct && offers.help !== null && count(turn.action) > 0 ? structuredClone(offers.help) : null,
    ready: facts.canAct && offers.ready !== null && count(turn.action) > 0
      ? { triggerRefs: [...offers.ready.triggerRefs], events: [...NPC_READY_EVENTS] } : null,
    stance: {
      fighting: fighting.map(stanceOf),
      fightingYou: creatures.filter(fightingYou).map(stanceOf),
      others: inEncounter.filter(creature => !hostiles.has(entityId(creature)) && !fightingYou(creature)).map(stanceOf),
      yieldRefs: facts.canAct ? fighting.map(entityId) : [],
      turnOnRefs: facts.canAct ? inEncounter.filter(creature => !hostiles.has(entityId(creature)) && creature.lifeState !== "dead").map(entityId) : [],
    },
    speak: facts.canAct && facts.canSpeak,
    endTurn: true,
  };
}

/** True when the NPC can do nothing but end its turn: it cannot act or move.
 * There is no choice to ask it for (SPEC 0006 §§6、7 forbids inventing one, not
 * recording the only legal transition). */
export function npcCombatTurnHasNoChoice(options: NpcCombatTurnOptions): boolean {
  return !options.movement.canMove && options.abilities.length === 0 && options.basicActions.length === 0
    && options.help === null && options.ready === null && !options.speak
    && options.stance.yieldRefs.length === 0 && options.stance.turnOnRefs.length === 0;
}

function destinationIssue(options: NpcCombatTurnOptions, to: NpcCombatTurnDestination): string | undefined {
  if (to.kind === "point") return options.movement.pointAllowed ? undefined : "move:point-unavailable";
  return options.movement.destinations.some(destination => destination.ref === to.ref) ? undefined : "move:destination-unknown";
}

function targetIssue(options: NpcCombatTurnOptions, abilityRef: string, target: NpcCombatTurnTarget): string | undefined {
  const ability = options.abilities.find(entry => entry.abilityRef === abilityRef);
  if (ability === undefined) return "ability:unavailable";
  if (ability.targeting === "none") return target.kind === "none" ? undefined : "ability:takes-no-target";
  if (ability.targeting === "point") return target.kind === "point" ? undefined : "ability:needs-point";
  if (target.kind === "point") return ability.aimAtPointAllowed ? undefined : "ability:point-unavailable";
  if (target.kind !== "creature") return "ability:needs-target";
  return ability.targets.some(entry => entry.ref === target.ref) ? undefined : "ability:target-unavailable";
}

/** Structural check of a plan against the options it was chosen from: every
 * name it uses is one it was offered, and it spends no action, bonus action
 * or attack the NPC does not have. Distances and later legality are Rules'.
 * ADR 0117: it says something at most once; once it stops fighting someone
 * it does not attack them in the same plan; turning on someone comes last,
 * right before the end of the turn, and the rest of the turn is asked again. */
export function npcCombatTurnPlanIssues(options: NpcCombatTurnOptions, steps: readonly NpcCombatTurnStep[]): string[] {
  const issues: string[] = [];
  let action = options.turn.action, bonus = options.turn.bonusAction, attacks = options.turn.attacksRemaining;
  let spoke = false;
  const yielded = new Set<string>();
  const struckYielded = (target: NpcCombatTurnTarget) => target.kind === "creature" && yielded.has(target.ref);
  const spend = (activation: string): boolean => {
    if (activation === "attack") {
      if (attacks > 0) { attacks -= 1; return true; }
      if (action > 0) { action -= 1; attacks = options.turn.attacksPerAttackAction - 1; return true; }
      return false;
    }
    if (["action", "actionSpell", "useObject"].includes(activation)) { if (action <= 0) return false; action -= 1; return true; }
    if (["bonusAction", "bonusActionSpell"].includes(activation)) { if (bonus <= 0) return false; bonus -= 1; return true; }
    return activation === "free";
  };
  steps.forEach((step, index) => {
    const at = (issue: string) => issues.push(`steps[${index}]:${issue}`);
    if (step.kind === "move") {
      const issue = destinationIssue(options, step.to);
      if (issue !== undefined) at(issue);
    } else if (step.kind === "ability") {
      const issue = targetIssue(options, step.abilityRef, step.target);
      if (issue !== undefined) at(issue);
      if (struckYielded(step.target)) at("ability:target-yielded");
      const ability = options.abilities.find(entry => entry.abilityRef === step.abilityRef);
      if (ability !== undefined && !spend(ability.activation)) at("ability:no-turn-grant");
    } else if (step.kind === "basic") {
      if (step.action === "help") {
        if (options.help === null || !options.help.allyRefs.includes(step.allyRef)
          || (step.enemyRef !== null && !options.help.enemyRefs.includes(step.enemyRef))) at("help:unavailable");
        if (step.enemyRef !== null && yielded.has(step.enemyRef)) at("help:enemy-yielded");
      } else if (!options.basicActions.includes(step.action)) at("basic:unavailable");
      if (!spend("action")) at("basic:no-action");
    } else if (step.kind === "ready") {
      if (options.ready === null || !options.ready.triggerRefs.includes(step.trigger.ref)) at("ready:unavailable");
      const issue = step.response.kind === "move" ? destinationIssue(options, step.response.to)
        : targetIssue(options, step.response.abilityRef, step.response.target);
      if (issue !== undefined) at(`ready:${issue}`);
      if (step.response.kind === "ability" && struckYielded(step.response.target)) at("ready:target-yielded");
      if (!spend("action")) at("ready:no-action");
    } else if (step.kind === "speak") {
      if (!options.speak) at("speak:unavailable");
      else if (spoke) at("speak:once");
      spoke = true;
    } else if (step.kind === "yield") {
      if (step.fromRefs.some(ref => !options.stance.yieldRefs.includes(ref) || yielded.has(ref))) at("yield:not-fighting");
      for (const ref of step.fromRefs) yielded.add(ref);
    } else if (step.kind === "turnOn") {
      if (step.targetRefs.some(ref => !options.stance.turnOnRefs.includes(ref))) at("turnOn:unavailable");
      if (steps[index + 1]?.kind !== "endTurn") at("turnOn:must-precede-endTurn");
    }
  });
  return issues;
}

type Walk = { kind: "stay" } | { kind: "walk"; path: CanonicalCombatPoint[]; complete: boolean } | { kind: "unavailable" };

const NEIGHBOURS: readonly (readonly [bigint, bigint])[] = [
  [1n, 0n], [-1n, 0n], [0n, 1n], [0n, -1n], [1n, 1n], [1n, -1n], [-1n, 1n], [-1n, -1n],
];
const MAX_SEARCH_NODES = 4096;

/** SPEC 0014 §4: a walk inside an encounter, planned on the scene lattice the
 * map moves use (ADR 0087), then cut to what this turn's movement allows by
 * the same Rules movement step the walk will take. `complete` says whether
 * the whole route fits. */
export function planNpcEncounterWalk(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  npcId: string,
  to: NpcCombatTurnDestination,
): Walk {
  const mover = state.combatRuntime.entities[npcId];
  const encounter = activeEncounter(state, npcId);
  const sceneRef = String(mover?.sceneId ?? "");
  const scene = state.combatRuntime.scenes[sceneRef];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  const start = mover === undefined ? undefined : canonicalCombatPoint(mover.position);
  if (mover === undefined || encounter === undefined || start === undefined || !isRecord(mover.footprint)
    || !isCanonicalTacticalGeometry(geometry)) return { kind: "unavailable" };
  const held = heldBodies(state, npcId, sceneRef);
  const others = Object.values(state.combatRuntime.entities).filter(entity => entity.sceneId === sceneRef
    && entityId(entity) !== npcId && !held.includes(entity));
  const hostiles = new Set(hostileRefs(state, npcId));
  const body: JsonRecord = { id: npcId, entityId: npcId, sceneId: sceneRef, footprint: structuredClone(mover.footprint),
    ...(typeof mover.sizeCategory === "string" ? { sizeCategory: mover.sizeCategory } : {}) };
  const at = (point: CanonicalCombatPoint): JsonRecord => ({ ...body, position: point });
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  const inside = (point: CanonicalCombatPoint) => footprintInsidePolygon(point, mover, boundary);
  const clear = (from: CanonicalCombatPoint, end: CanonicalCombatPoint) =>
    analyzeCombatMovement(at(from), [], scene as JsonRecord, [from, end], new Set()).ok;
  const free = (from: CanonicalCombatPoint, end: CanonicalCombatPoint) =>
    analyzeCombatMovement(at(from), others, scene as JsonRecord, [from, end], hostiles).ok;
  let reached: (point: CanonicalCombatPoint) => boolean;
  let endpoints: CanonicalCombatPoint[];
  if (to.kind === "nextTo") {
    const creature = state.combatRuntime.entities[to.ref];
    const target = creature !== undefined && creature.sceneId === sceneRef && spatialRecordVisibleTo(state, creature, npcId)
      ? creature : seenFeatures(state, npcId).find(feature => feature.ref === to.ref)?.body;
    if (target === undefined || to.ref === npcId) return { kind: "unavailable" };
    reached = point => nextTo(at(point), target);
    if (reached(start)) return { kind: "stay" };
    endpoints = besideTarget(target, mover, start.elevation).filter(point => inside(point) && reached(point));
  } else {
    const exact = { x: to.x, y: to.y, elevation: start.elevation };
    if (exact.x === start.x && exact.y === start.y) return { kind: "stay" };
    if (!inside(exact)) return { kind: "unavailable" };
    reached = point => point.x === exact.x && point.y === exact.y;
    endpoints = [exact];
  }
  const key = (point: CanonicalCombatPoint) => `${point.x},${point.y}`;
  const xs = boundary.map(point => point.x), ys = boundary.map(point => point.y);
  const [minX, maxX, minY, maxY] = [xs.reduce((a, b) => b < a ? b : a), xs.reduce((a, b) => b > a ? b : a),
    ys.reduce((a, b) => b < a ? b : a), ys.reduce((a, b) => b > a ? b : a)];
  const cost = new Map<string, bigint>([[key(start), 0n]]);
  const previous = new Map<string, CanonicalCombatPoint>();
  const open: CanonicalCombatPoint[] = [start];
  const done = new Set<string>();
  const pathTo = (end: CanonicalCombatPoint): CanonicalCombatPoint[] => {
    const path = [end];
    for (let point = previous.get(key(end)); point !== undefined; point = previous.get(key(point))) path.unshift(point);
    return path;
  };
  const compare = (left: bigint, right: bigint) => left < right ? -1 : left > right ? 1 : 0;
  const before = (left: CanonicalCombatPoint, right: CanonicalCombatPoint) => (compare(cost.get(key(left))!, cost.get(key(right))!)
    || compare(BigInt(left.y), BigInt(right.y)) || compare(BigInt(left.x), BigInt(right.x))) < 0;
  let found: CanonicalCombatPoint[] | undefined;
  while (open.length > 0 && done.size < MAX_SEARCH_NODES) {
    let pick = 0;
    for (let index = 1; index < open.length; index++) if (before(open[index], open[pick])) pick = index;
    const current = open.splice(pick, 1)[0];
    if (done.has(key(current))) continue;
    done.add(key(current));
    if (current !== start && reached(current) && free(previous.get(key(current))!, current)) { found = pathTo(current); break; }
    const entered = endpoints.find(end => key(end) !== key(current)
      && abs(BigInt(end.x) - BigInt(current.x)) <= SCENE_GRID_STEP && abs(BigInt(end.y) - BigInt(current.y)) <= SCENE_GRID_STEP
      && clear(current, end) && free(current, end));
    if (entered !== undefined) { found = [...pathTo(current), entered]; break; }
    for (const next of latticeNeighbours(current)) {
      const nx = BigInt(next.x), ny = BigInt(next.y);
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || done.has(key(next)) || !inside(next) || !clear(current, next)) continue;
      const through = cost.get(key(current))! + BigInt(pathLengthMilliInches([current, next]));
      const known = cost.get(key(next));
      if (known !== undefined && known <= through) continue;
      cost.set(key(next), through);
      previous.set(key(next), current);
      open.push(next);
    }
  }
  const route = found === undefined ? undefined : canonicalizeCombatPath(found);
  if (route === undefined) return { kind: "unavailable" };
  // The longest prefix of the route this turn's movement and the Rules
  // movement step accept; a route cut short ends at a lattice point on it.
  for (let end = found!.length; end >= 2; end -= 1) {
    const path = canonicalizeCombatPath(found!.slice(0, end));
    if (path === undefined) continue;
    if (probe(profiles, state, { kind: "moveCombatant", encounterId: encounter.encounterId, sourceEntityId: npcId,
      movementMode: "walk", path })) return { kind: "walk", path, complete: end === found!.length };
  }
  return { kind: "unavailable" };
}

function latticeNeighbours(point: CanonicalCombatPoint): CanonicalCombatPoint[] {
  const x = BigInt(point.x), y = BigInt(point.y);
  const at = (nx: bigint, ny: bigint) => ({ x: nx.toString(), y: ny.toString(), elevation: point.elevation });
  if (x % SCENE_GRID_STEP === 0n && y % SCENE_GRID_STEP === 0n) {
    return NEIGHBOURS.map(([dx, dy]) => at(x + dx * SCENE_GRID_STEP, y + dy * SCENE_GRID_STEP));
  }
  const floor = (value: bigint) => { const rest = value % SCENE_GRID_STEP; return rest === 0n ? value : value - rest - (rest < 0n ? SCENE_GRID_STEP : 0n); };
  const xs = [...new Set([floor(x), floor(x) + (x % SCENE_GRID_STEP === 0n ? 0n : SCENE_GRID_STEP)])];
  const ys = [...new Set([floor(y), floor(y) + (y % SCENE_GRID_STEP === 0n ? 0n : SCENE_GRID_STEP)])];
  return xs.flatMap(nx => ys.map(ny => at(nx, ny)));
}

function abs(value: bigint): bigint { return value < 0n ? -value : value; }

/** SPEC 0012 §3.3 (ADR 0117): the hostility change an NPC's own yield or
 * turn makes, judged on the state it is taken from: it may stop fighting
 * only creatures it is fighting and sees, and start fighting only living
 * creatures of the encounter it sees and is not fighting. A yield accepts a
 * surrender when every one it stops fighting had already stood down from
 * it; it is a surrender when one of them is still fighting it. */
function npcStanceInput(state: AuthoritativeWorldState, encounterId: string, npcId: string, rootActionId: string,
  step: Extract<NpcCombatTurnStep, { kind: "yield" | "turnOn" }>): JsonRecord | undefined {
  const encounter = state.combatRuntime.encounters[encounterId];
  const self = state.combatRuntime.entities[npcId];
  if (encounter === undefined || self === undefined) return undefined;
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(isNonEmptyString) : [];
  const current = encounterHostileTargets(encounter, npcId);
  const seen = (ref: string) => { const body = state.combatRuntime.entities[ref];
    return body !== undefined && body.sceneId === self.sceneId && spatialRecordVisibleTo(state, body, npcId); };
  const change = (targetEntityIds: string[], reason: string) => ({ kind: "changeEncounterHostility", encounterId, rootActionId,
    sourceEntityId: npcId, targetEntityIds: [...targetEntityIds].sort(), reason });
  if (step.kind === "yield") {
    if (step.fromRefs.some(ref => !current.includes(ref) || !seen(ref))) return undefined;
    const accepted = step.fromRefs.every(ref => encounterStandDown(encounter, ref)?.fromEntityIds.includes(npcId) === true);
    const surrendered = step.fromRefs.some(ref => encounterHostileTargets(encounter, ref).includes(npcId));
    return change(current.filter(ref => !step.fromRefs.includes(ref)),
      accepted ? "playersSurrendered" : surrendered ? "npcSurrendered" : "npcStoppedFighting");
  }
  if (step.targetRefs.some(ref => ref === npcId || current.includes(ref) || !participants.includes(ref) || !seen(ref)
    || state.combatRuntime.entities[ref]?.lifeState === "dead")) return undefined;
  return change([...current, ...step.targetRefs], "npcTurnedHostile");
}

function targetParameters(state: AuthoritativeWorldState, npcId: string, abilityRef: string, target: NpcCombatTurnTarget): JsonRecord | undefined {
  const elevation = String((state.combatRuntime.entities[npcId]?.position as JsonRecord | undefined)?.elevation ?? "0");
  if (target.kind === "none") return {};
  if (target.kind === "creature") return { targetEntityIds: [target.ref] };
  const definition = abilityDefinition(state, abilityRef);
  const point = { x: target.x, y: target.y, elevation };
  return isRecord(definition?.target) && definition.target.kind === "area" ? { areaOrigin: point } : { targetPoint: point };
}

/** The Rules input of one plan step on the state it is taken from, or "stay"
 * for a walk to where the NPC already stands; undefined when the step cannot
 * be formed now (no route, an unknown reference). */
export function npcCombatTurnStepInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  encounterId: string,
  npcId: string,
  rootActionId: string,
  step: NpcCombatTurnStep,
): JsonRecord | "stay" | undefined {
  const source = { rootActionId, sourceEntityId: npcId };
  if (step.kind === "endTurn") return { kind: "endTurn", encounterId, ...source };
  if (step.kind === "speak") return undefined;
  if (step.kind === "yield" || step.kind === "turnOn") return npcStanceInput(state, encounterId, npcId, rootActionId, step);
  if (step.kind === "move") {
    const walk = planNpcEncounterWalk(profiles, state, npcId, step.to);
    return walk.kind === "stay" ? "stay" : walk.kind === "walk"
      ? { kind: "moveCombatant", encounterId, movementMode: "walk", path: walk.path, ...source } : undefined;
  }
  if (step.kind === "ability") {
    const parameters = targetParameters(state, npcId, step.abilityRef, step.target);
    return parameters === undefined ? undefined : { kind: "invokeAbility", abilityRef: step.abilityRef, parameters, ...source };
  }
  if (step.kind === "basic") {
    if (step.action === "help") return { kind: "invokeAbility", abilityRef: "action:help", ...source,
      parameters: { targetEntityId: step.allyRef, ...(step.enemyRef === null ? {} : { againstEntityId: step.enemyRef }) } };
    return { kind: "invokeAbility", abilityRef: BASIC_ACTION_REFS[step.action], parameters: {}, ...source };
  }
  const trigger = { kind: "perceivable", event: step.trigger.event, sourceEntityId: step.trigger.ref };
  if (step.response.kind === "move") {
    const walk = planNpcEncounterWalk(profiles, state, npcId, step.response.to);
    if (walk.kind !== "walk") return undefined;
    return { kind: "readyAction", encounterId, trigger, response: { kind: "move", movementMode: "walk", path: walk.path }, ...source };
  }
  const parameters = targetParameters(state, npcId, step.response.abilityRef, step.response.target);
  return parameters === undefined ? undefined : { kind: "readyAction", encounterId, trigger,
    response: { kind: "invokeAbility", abilityRef: step.response.abilityRef, parameters }, ...source };
}
