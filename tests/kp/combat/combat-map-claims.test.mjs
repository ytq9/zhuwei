import assert from "node:assert/strict";
import test from "node:test";

import {
  claimsCoverageOf,
  committedRangeUsesFrozenRenderableClaims,
  deriveAuthorityClaimsFromCommittedRange,
  frozenRenderableClaimsConform,
  isCombatMapRoot,
  mergeAdjacentCombatMoves,
  projectRenderableClaims,
} from "../../../app/_runtime/lib/rules/v2/claims.ts";
import { COMBAT_EVENT_TYPES } from "../../../app/_runtime/lib/rules/v2/combat-events.ts";

// Test level: T1 — deterministic Claims derivation for combat-map roots,
// without Room persistence or model I/O.
// SPEC 0014 §4 (ADR 0104): a player's structured act on the combat map, and an
// NPC's combat turn, are told from the claims Rules derives for each observer.
// Every event such a root can commit is either a claim or a listed record; a
// type that is neither would fail the root's derivation.

/** What a combat-map root commits beyond the combat event family: dice
 * requests, a jump, a shove, damage, death, Hide and Search rolls, condition
 * follow-ups, item costs, an object used outside the round, the hours a
 * stable creature takes to come round, and an NPC's turn plan. A stable
 * creature's recovery interrupted by healing or damage is covered by its
 * cause (see the derivation below). */
const COMBAT_MAP_EXTRA_EVENT_TYPES = [
  "RandomnessRequested", "DiceRolled", "CharacterJumped", "CharacterJumpedOnto", "CreaturePushed",
  "DamagePacketResolved", "CreatureDied", "HiddenPerceptionRolled", "ConditionStateSynchronized",
  "ItemUsed", "FictionTimeAdvanced", "ActivityStarted", "ActivityCompleted", "DefinitionRegistered",
  "NpcCombatTurnPlanned", "NpcCombatTurnStepTaken", "NpcCombatTurnSettled",
  // SPEC 0014 §4: climbing, swimming and falling on the combat map go to the KP.
  "CharacterClimbed", "CharacterFell",
];

test("every event a combat-map root can commit is a claim or a listed record", () => {
  const uncovered = [...new Set([...COMBAT_EVENT_TYPES, ...COMBAT_MAP_EXTRA_EVENT_TYPES])]
    .filter(eventType => claimsCoverageOf(eventType) === undefined);
  assert.deepEqual(uncovered, []);
  // The ones a player's act shows are claims; the turn and reaction
  // bookkeeping stays with the authority.
  for (const eventType of ["MovementSegmentCommitted", "AbilityInvoked", "DamagePacketResolved", "ConditionChanged",
    "ConcentrationTested", "ConcentrationEnded", "DeathSaveResolved", "HiddenPerceptionRolled", "CharacterJumped",
    "CharacterJumpedOnto", "TurnStarted", "EncounterConcluded", "CreatureDied",
    // ADR 0112: who stops fighting, and why the end is put to the players,
    // are told whatever the players answer.
    "HostilityChanged", "EncounterConclusionProposed"]) assert.equal(claimsCoverageOf(eventType), "claim", eventType);
  for (const eventType of ["ReactionOffered", "ReactionAnswered", "ReadiedActionCreated", "ReadiedActionTriggered",
    "ReadiedActionExpired", "TriggerInvalidated", "TurnEnded", "RoundEnded", "RoundStarted", "CombatPendingOpened",
    "CombatPendingClosed"]) assert.equal(claimsCoverageOf(eventType), "record", eventType);
});

test("combat-map roots are routed to claims by their root, whatever events they hold", () => {
  assert.equal(isCombatMapRoot("combat-act:move"), true);
  assert.equal(isCombatMapRoot("npc-turn:encounter:1:1:npc:naes:0"), true);
  assert.equal(isCombatMapRoot("root-action:intent"), false);
  assert.equal(committedRangeUsesFrozenRenderableClaims([{ eventType: "TurnEnded", rootActionId: "combat-act:end" }]), true);
  // A map move outside an encounter and a player's world act keep their own routes.
  assert.equal(committedRangeUsesFrozenRenderableClaims([{ eventType: "TurnEnded", rootActionId: "root-action:end" }]), false);
  assert.equal(committedRangeUsesFrozenRenderableClaims([{ eventType: "CharacterRepositioned", rootActionId: "root-action:map-move" }]), false);
});

const ACTOR = "character:alice", NAES = "npc:naes", STRIKE = "ability:alice:unarmed-strike";
const ROOT = "combat-act:strike";

function combatRange({ aimed = false, extra = [] } = {}) {
  const state = {
    roomId: "room:combat-claims", runtimeEpochId: "epoch:combat-claims",
    entities: {},
    campaignRuntime: { definitions: {}, activities: {
      "activity:stable-recovery:npc:naes": { activityId: "activity:stable-recovery:npc:naes", activityKind: "stableRecovery2014",
        characterId: NAES, status: "active" },
    } },
    combatRuntime: { definitions: { [STRIKE]: { definitionId: STRIKE, mechanicalKey: "unarmed-strike",
      activation: { kind: "attack", actionGrant: "attack" } } }, effects: {},
      entities: { [ACTOR]: { lifeState: "alive", conditions: {} }, [NAES]: { lifeState: "unconscious", conditions: { dodging: true } } } },
  };
  let seq = 20;
  const event = (eventType, payload, extraFields = {}) => ({ eventId: `event:epoch:combat-claims:${++seq}`, eventSeq: String(seq), eventType,
    rootActionId: ROOT, roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, scopeProofHash: `sha256:${"1".repeat(64)}`,
    visibilityPolicyId: "visibility:combat-observers", secrecy: "public", resolutionId: null, payload, ...extraFields });
  const resolutionId = `resolution:${ROOT}:1`;
  const attack = aimed
    ? { aimedPoint: { x: "270", y: "270", elevation: "0" }, cover: "none", rolls: [20, 4], selected: 20, attackBonus: 5, total: 25, hit: true, criticalIfHit: false }
    : { mode: "normal", rolls: [20], selected: 20, attackBonus: 5, total: 25, hit: true, criticalIfHit: false };
  const events = [
    event("RandomnessRequested", { resolution: { resolutionId, rootActionId: ROOT,
      operation: { kind: "resolveCombatAbility", sourceEntityId: ACTOR, abilityRef: STRIKE, targetEntityIds: [NAES] } } },
      { visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" }),
    event("AbilityInvoked", { sourceEntityId: ACTOR, abilityRef: STRIKE, mechanicalResult: { attack }, sourcePatch: {} }, { resolutionId }),
    event("ActivityInterrupted", { activityId: "activity:stable-recovery:npc:naes", cause: { kind: "damage", sourceDefinitionId: STRIKE } }, { resolutionId }),
    event("DamagePacketResolved", { encounterId: "encounter:1", sourceDefinitionId: STRIKE, targetEntityId: NAES,
      components: [{ type: "bludgeoning", rolled: 11, defense: "none", applied: 11 }], totalApplied: 11, targetPatch: {} }, { resolutionId }),
    event("ConditionChanged", { entityId: NAES, conditions: {} }, { visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" }),
    event("DeathSaveResolved", { entityId: NAES, roll: 7, natural: 7, successes: 0, failures: 1, entityPatch: { lifeState: "unconscious", conditions: {} } }),
    event("TurnEnded", { encounterId: "encounter:1", sourceEntityId: ACTOR }),
    ...extra.map(([eventType, payload]) => event(eventType, payload)),
  ];
  return { receipt: { receiptId: `receipt:${ROOT}:${seq}`, rootActionId: ROOT, status: "committed",
    eventRange: { fromEventSeq: events[0].eventSeq, toEventSeq: events.at(-1).eventSeq } },
    actorCharacterId: ACTOR, priorState: structuredClone(state), state, events };
}

const seeAll = { viewerKey: "principal:alice\u001fcharacter:alice", refs: [ACTOR, NAES, "visibility:combat-observers",
  `visibility:character-controller:${ACTOR}`], displayNames: { [ACTOR]: "阿丽丝", [NAES]: "奈斯" } };

test("an attack is told with its outcome and total to whoever sees attacker and target, and its damage in public words", () => {
  const authority = deriveAuthorityClaimsFromCommittedRange(combatRange());
  const claims = projectRenderableClaims(authority, seeAll).claims;
  const hit = claims.find(claim => claim.outcomeCode === "criticalHit");
  assert.deepEqual([hit.actorRef, hit.targetRefs, hit.check, hit.summary],
    [ACTOR, [NAES], { kind: "attack", result: "success", total: 25 }, "这次攻击是重击，命中了目标。"]);
  assert.ok(hit.narrationFacts.includes("攻击命中") && hit.narrationFacts.includes("检定总值为 25"), JSON.stringify(hit.narrationFacts));
  assert.equal(claims.find(claim => claim.outcomeCode === "damageApplied").summary, "目标承受了 11 点钝击伤害。");
  assert.equal(claims.find(claim => claim.outcomeCode === "deathSave").summary, "目标进行了死亡豁免，目前累计成功 0 次、失败 1 次。");
  // SPEC 0016 §8.2: the strike names the creature struck, not the attacker
  // (round 175's writer turned a blow that named the attacker around).
  const strike = claims.find(claim => claim.kind === "abilityEffectApplied");
  assert.deepEqual([strike.effect.summary, strike.sourceRef, strike.targetRefs], ["出手攻击。", ACTOR, [NAES]]);
  // The stable creature's recovery timer and Dodge lapsing are the
  // authority's; nothing else of the turn's bookkeeping reaches the Viewer.
  assert.equal(claims.some(claim => /闪避/.test(JSON.stringify(claim))), false);
  // A Viewer who does not see Naes is told neither the attack on it nor its damage.
  const unseen = projectRenderableClaims(authority, { ...seeAll, refs: seeAll.refs.filter(ref => ref !== NAES),
    displayNames: { [ACTOR]: "阿丽丝" } }).claims;
  assert.equal(unseen.some(claim => ["criticalHit", "damageApplied", "deathSave"].includes(claim.outcomeCode)), false);
  assert.equal(JSON.stringify(unseen).includes(NAES), false);
});

test("an attack aimed at a point names no creature, even when it found one", () => {
  const authority = deriveAuthorityClaimsFromCommittedRange(combatRange({ aimed: true }));
  const outcome = authority.claims.find(claim => claim.outcomeCode === "criticalHit");
  assert.equal(outcome.targetRefs, undefined);
  assert.equal(outcome.summary, "朝瞄准的位置出手，重击命中。");
  // Nor a total, which would hint at the die its hidden mode picked.
  assert.deepEqual(outcome.check, { kind: "attack", result: "success" });
  // A Viewer who cannot see the creature there learns only that the blow landed.
  const blind = projectRenderableClaims(authority, { ...seeAll, refs: seeAll.refs.filter(ref => ref !== NAES),
    displayNames: { [ACTOR]: "阿丽丝" } }).claims;
  assert.deepEqual(blind.filter(claim => claim.kind === "mechanicalOutcome" && claim.outcomeCode !== undefined).map(claim => claim.outcomeCode), ["criticalHit"]);
  assert.equal(JSON.stringify(blind).includes(NAES), false);
});

test("an event that is neither a claim nor a listed record fails the combat-map root's derivation", () => {
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange(combatRange({ extra: [["SafetyPauseRequested", {}]] })),
    /VNEXT_CLAIM_EVENT_UNKNOWN:SafetyPauseRequested/u);
});

// SPEC 0014 §4 (ADR 0108): round 168 told Naes's turn as "先后移动了约3尺、
// 4尺、8尺和14尺" and read Dodge's rules out. A move is committed in segments
// so reactions can interrupt it; one creature's adjacent segments are one
// claim, and a built-in action is told by what it looks like.
test("one creature's adjacent move segments are one claim; Dodge is told as it looks, not as its rules", () => {
  const move = (milli) => ["MovementSegmentCommitted", { encounterId: "encounter:1", sourceEntityId: NAES, path: [],
    distanceMilliInches: String(milli), movementAuthority: "activeTurn", movementMode: "walk", entityPatch: {} }];
  const range = combatRange({ extra: [move(36_000), move(48_000), move(96_000),
    ["AbilityInvoked", { sourceEntityId: NAES, abilityRef: "action:dodge", mechanicalResult: { abilityRef: "action:dodge" }, sourcePatch: {} }],
    move(168_000), ["TurnStarted", { encounterId: "encounter:1", sourceEntityId: ACTOR }]] });
  const authority = deriveAuthorityClaimsFromCommittedRange(range);
  // Each segment is its own claim, projected at its own moment ...
  assert.equal(authority.claims.filter(claim => claim.outcomeCode === "movedInCombat").length, 4);
  const segments = range.events.filter(event => event.eventType === "MovementSegmentCommitted").map(event => event.eventId);
  const projected = projectRenderableClaims(authority, { ...seeAll, refs: [...seeAll.refs, ...segments] });
  // ... and a Viewer's adjacent ones are one move: 3 + 4 + 8 feet, then 14 after the Dodge between them.
  const merged = mergeAdjacentCombatMoves(projected.claims, range.events);
  const moves = merged.filter(claim => claim.outcomeCode === "movedInCombat");
  assert.deepEqual(moves.map(claim => [claim.summary, claim.narrationFacts]),
    [["该角色移动了约 15 尺。", ["该角色移动了约 15 尺"]], ["该角色移动了约 14 尺。", ["该角色移动了约 14 尺"]]]);
  assert.deepEqual(moves[0].basisRefs.filter(ref => segments.includes(ref)), segments.slice(0, 3));
  assert.equal(frozenRenderableClaimsConform({ ...projected, claims: merged }), true);
  // A Viewer who saw only the last segment is told only that one.
  const late = projectRenderableClaims({ ...authority, claims: authority.claims.filter(claim => !segments.slice(0, 3).some(id => claim.basis.authorityRefs.includes(id))) },
    { ...seeAll, refs: [...seeAll.refs, ...segments] });
  assert.deepEqual(mergeAdjacentCombatMoves(late.claims, range.events).filter(claim => claim.outcomeCode === "movedInCombat").map(claim => claim.summary), ["该角色移动了约 14 尺。"]);
  const dodge = projected.claims.find(claim => claim.kind === "abilityEffectApplied" && claim.abilityRef === "action:dodge");
  assert.equal(dodge.effect.summary, "全神戒备，专心躲闪攻击。");
  assert.doesNotMatch(JSON.stringify(dodge.narrationFacts), /劣势|优势|豁免/u);
});
