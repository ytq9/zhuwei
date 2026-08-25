import assert from "node:assert/strict";
import test from "node:test";

import { BLACK_OAK_WILL } from "../app/_runtime/lib/module/black-oak-will.ts";
import { assertModule } from "../app/_runtime/lib/module/schema.ts";
import { worldDefinitionErrors } from "../app/_runtime/lib/rules/compiler.ts";
import {
  applyEvents,
  createWorldState,
  project,
  replay,
  step,
} from "../app/_runtime/lib/rules/engine.ts";
import {
  LONG_REST_SECONDS,
  SHORT_REST_SECONDS,
  combineD20Modes,
  resolveD20Check,
} from "../app/_runtime/lib/rules/ruleset.ts";

const player = (id, sceneId = "wake") => ({
  id,
  kind: "player",
  name: id,
  sceneId,
  abilityScores: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  proficientSkills: ["athletics", "sleight"],
  expertiseSkills: [],
  capabilities: [],
  resources: {},
});

function commit(state, decision) {
  assert.notEqual(decision.kind, "rejected", decision.rejection?.message);
  return applyEvents(state, decision.events);
}

function command(state, id, actorId, body) {
  return { id, actorId, expectedVersion: state.version, ...body };
}

test("all persistent Black Oak locations are connected by declared portals", () => {
  const errors = worldDefinitionErrors(BLACK_OAK_WILL.world, {
    sceneIds: BLACK_OAK_WILL.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.id)),
    clueIds: BLACK_OAK_WILL.clues.map((clue) => clue.id),
    npcIds: BLACK_OAK_WILL.npcs.map((npc) => npc.id),
  });
  assert.deepEqual(errors, []);
});

test("rooms and modules reject 2024 or 5.5e ruleset mixing", () => {
  const invalidWorld = structuredClone(BLACK_OAK_WILL.world);
  invalidWorld.rulesetVersion = "dnd5e-2024";
  const errors = worldDefinitionErrors(invalidWorld, {
    sceneIds: BLACK_OAK_WILL.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.id)),
    clueIds: BLACK_OAK_WILL.clues.map((clue) => clue.id),
    npcIds: BLACK_OAK_WILL.npcs.map((npc) => npc.id),
  });
  assert.ok(errors.some((error) => /rulesetVersion 必须/.test(error)));

  const state = createWorldState(BLACK_OAK_WILL.world, [player("a")]);
  state.rulesetVersion = "dnd5e-2024";
  const decision = step(BLACK_OAK_WILL.world, state, command(state, "mixed-rules", "a", {
    kind: "advanceTime",
    duration: { unit: "round", value: 1 },
  }));
  assert.equal(decision.kind, "rejected");
  assert.equal(decision.rejection.code, "ruleset_mismatch");
});

test("the third will is transferred once and cannot be recreated by a later tool attempt", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [player("sanmu", "shrine")]);
  const attempt = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "take-will", "sanmu", {
      kind: "interact",
      interactionId: "retrieve-third-will",
    }),
  );
  assert.equal(attempt.kind, "awaitingRoll");
  state = commit(state, attempt);

  const resolved = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "roll-will", "sanmu", {
      kind: "resolveRoll",
      requestId: attempt.roll.id,
      rolls: [12],
    }),
  );
  assert.equal(resolved.kind, "committed");
  state = commit(state, resolved);
  assert.deepEqual(state.artifacts["artifact-third-will"], {
    artifactId: "artifact-third-will",
    status: "held",
    holderId: "sanmu",
  });
  assert.equal(state.knowledge.sanmu["c-third-will"], "full");

  const daggerAttempt = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "dagger-will", "sanmu", {
      kind: "interact",
      interactionId: "retrieve-third-will",
    }),
  );
  assert.equal(daggerAttempt.kind, "rejected");
  assert.equal(daggerAttempt.rejection.code, "already_resolved");
  assert.match(daggerAttempt.rejection.message, /没有第二份|不在原处/);
  assert.equal(Object.values(state.artifacts).filter((artifact) => artifact.artifactId === "artifact-third-will").length, 1);
});

test("an NPC-held key transfers once and is the authoritative door prerequisite", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    player("sanmu", "wake"),
    { ...player("varo", "wake"), kind: "npc", capabilities: ["nail-door"] },
  ]);
  assert.equal(
    project(BLACK_OAK_WILL.world, state, "sanmu").visibleArtifacts.some(
      (artifact) => artifact.id === "artifact-cellar-key",
    ),
    false,
  );
  const request = step(BLACK_OAK_WILL.world, state, command(state, "request-key", "sanmu", {
    kind: "interact",
    interactionId: "request-cellar-key-wake",
  }));
  assert.equal(request.kind, "awaitingRoll");
  state = commit(state, request);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "win-key", "sanmu", {
    kind: "resolveRoll",
    requestId: request.roll.id,
    rolls: [13],
  })));
  assert.deepEqual(state.artifacts["artifact-cellar-key"], {
    artifactId: "artifact-cellar-key",
    status: "held",
    holderId: "sanmu",
  });
  const repeated = step(BLACK_OAK_WILL.world, state, command(state, "request-key-again", "sanmu", {
    kind: "interact",
    interactionId: "request-cellar-key-wake",
  }));
  assert.equal(repeated.kind, "rejected");
  assert.equal(repeated.rejection.code, "already_resolved");

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "walk-yard", "sanmu", {
    kind: "move",
    portalId: "wake-yard",
    destinationId: "yard",
    mode: "personal",
  })));
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "unlock-cellar", "sanmu", {
    kind: "interact",
    interactionId: "unlock-cellar-door",
  })));
  assert.equal(state.portals["yard-cellar"], "open");
});

test("a locked cellar portal blocks both movement and remote shrine interaction", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [player("sanmu", "yard")]);
  const move = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "walk-through-wall", "sanmu", {
      kind: "move",
      portalId: "yard-cellar",
      destinationId: "cellar",
      mode: "personal",
    }),
  );
  assert.equal(move.kind, "rejected");
  assert.equal(move.rejection.code, "unreachable");

  const pushRemoteShrine = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "push-remote-shrine", "sanmu", {
      kind: "interact",
      interactionId: "move-stone-seat",
    }),
  );
  assert.equal(pushRemoteShrine.kind, "rejected");
  assert.equal(pushRemoteShrine.rejection.code, "unreachable");

  const breakDoor = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "break-door", "sanmu", {
      kind: "interact",
      interactionId: "force-cellar-door",
    }),
  );
  state = commit(state, breakDoor);
  const breakRoll = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "break-door-roll", "sanmu", {
      kind: "resolveRoll",
      requestId: breakDoor.roll.id,
      rolls: [15],
    }),
  );
  state = commit(state, breakRoll);
  assert.equal(state.portals["yard-cellar"], "destroyed");

  const legalMove = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "enter-cellar", "sanmu", {
      kind: "move",
      portalId: "yard-cellar",
      destinationId: "cellar",
      mode: "personal",
    }),
  );
  state = commit(state, legalMove);
  assert.equal(state.entities.sanmu.sceneId, "cellar");
});

test("5e checks calculate proficiency, expertise, advantage and disadvantage deterministically", () => {
  assert.equal(combineD20Modes(true, true), "normal");
  assert.equal(combineD20Modes(true, false), "advantage");
  const advantage = resolveD20Check({
    rolls: [4, 17],
    mode: "advantage",
    abilityScore: 14,
    proficiencyBonus: 2,
    proficiency: "proficient",
    dc: 20,
  });
  assert.deepEqual(advantage, { d20: 17, modifier: 4, total: 21, success: true });
  const expertise = resolveD20Check({
    rolls: [10],
    mode: "normal",
    abilityScore: 12,
    proficiencyBonus: 2,
    proficiency: "expertise",
    dc: 15,
  });
  assert.equal(expertise.total, 15);
  assert.equal(expertise.success, true);
  const naturalOneCheck = resolveD20Check({
    rolls: [1],
    mode: "normal",
    abilityScore: 20,
    proficiencyBonus: 6,
    proficiency: "expertise",
    dc: 18,
  });
  assert.equal(naturalOneCheck.success, true, "5e ability checks do not auto-fail on a natural 1");
});

test("guidance, inspiration and halfling lucky are validated and spent by the rules core", () => {
  const boosted = {
    ...player("a", "shrine"),
    resources: { inspiration: 1 },
    resourceRules: { inspiration: { max: 1, recovery: "none" } },
    featureIds: ["halflingLucky"],
    activeEffects: ["guidance"],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [boosted]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "ask-roll", "a", {
    kind: "interact",
    interactionId: "retrieve-third-will",
  })));
  const rollId = Object.keys(state.pendingRolls)[0];
  const decision = step(BLACK_OAK_WILL.world, state, command(state, "boosted-roll", "a", {
    kind: "resolveRoll",
    requestId: rollId,
    rolls: [10, 12],
    boosts: { useInspiration: true, guidanceRoll: 2, luckyReplacedOnes: 1 },
  }));
  assert.equal(decision.kind, "committed");
  state = commit(state, decision);
  assert.equal(state.entities.a.resources.inspiration, 0);
  assert.ok(!state.entities.a.activeEffects.includes("guidance"));
  assert.equal(state.artifacts["artifact-third-will"].holderId, "a");
  const resolved = decision.events.find((event) => event.type === "RollResolved");
  assert.equal(resolved.total, 18);
});

test("short and long rests complete from Fiction Time, never from spotlight beats", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [player("sanmu")]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "short-rest", "sanmu", { kind: "startRest", rest: "short" }),
    ),
  );
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "wait-59", "sanmu", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 59 },
        spotlightBeats: 20,
      }),
    ),
  );
  assert.equal(state.rests.sanmu.status, "resting");
  assert.equal(state.timelines.sanmu.fictionSeconds, SHORT_REST_SECONDS - 60);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "wait-last-minute", "sanmu", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 1 },
      }),
    ),
  );
  assert.equal(state.rests.sanmu.status, "completed");

  let longState = createWorldState(BLACK_OAK_WILL.world, [player("lian")]);
  longState = commit(
    longState,
    step(
      BLACK_OAK_WILL.world,
      longState,
      command(longState, "long-rest", "lian", { kind: "startRest", rest: "long" }),
    ),
  );
  longState = commit(
    longState,
    step(
      BLACK_OAK_WILL.world,
      longState,
      command(longState, "wait-eight-hours", "lian", {
        kind: "advanceTime",
        duration: { unit: "hour", value: 8 },
        spotlightBeats: 1,
      }),
    ),
  );
  assert.equal(longState.timelines.lian.fictionSeconds, LONG_REST_SECONDS);
  assert.equal(longState.rests.lian.status, "completed");
  const secondLongRest = step(
    BLACK_OAK_WILL.world,
    longState,
    command(longState, "long-rest-again", "lian", { kind: "startRest", rest: "long" }),
  );
  assert.equal(secondLongRest.kind, "rejected");
  assert.equal(secondLongRest.rejection.code, "rest_ineligible");
});

test("a declared NPC event interrupts an activity at its exact Fiction Time", () => {
  const world = structuredClone(BLACK_OAK_WILL.world);
  world.scheduledEvents[0].conditions = [];
  let state = createWorldState(world, [
    player("sanmu", "yard"),
    {
      ...player("varo", "wake"),
      kind: "npc",
      capabilities: ["nail-door"],
    },
  ]);
  state.portals["yard-cellar"] = "destroyed";
  const decision = step(
    world,
    state,
    command(state, "search-half-hour", "sanmu", {
      kind: "advanceTime",
      duration: { unit: "minute", value: 30 },
      spotlightBeats: 1,
    }),
  );
  assert.equal(decision.kind, "committed");
  assert.ok(decision.events.some((event) => event.type === "ScheduledEventAttempted"));
  assert.ok(decision.events.some((event) => event.type === "ActivityInterrupted"));
  state = commit(state, decision);
  assert.equal(state.timelines.sanmu.fictionSeconds, 20 * 60);
  assert.equal(state.scheduledEvents["varo-door-deadline"], "attempted");
});

test("interrupted activities withhold effects and NPC plan effects land only on completion", () => {
  const world = structuredClone(BLACK_OAK_WILL.world);
  world.scheduledEvents[0] = {
    ...world.scheduledEvents[0],
    atSeconds: 30,
    conditions: [],
  };
  world.npcPlans[0] = {
    ...world.npcPlans[0],
    duration: { unit: "minute", value: 1 },
    effects: [{ kind: "setFlag", flag: "npc-plan-complete", value: true }],
  };
  let state = createWorldState(world, [
    player("sanmu", "yard"),
    { ...player("varo", "wake"), kind: "npc", capabilities: ["nail-door"] },
  ]);
  state.portals["yard-cellar"] = "destroyed";
  state = commit(
    state,
    step(
      world,
      state,
      command(state, "long-activity", "sanmu", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 2 },
        spotlightBeats: 1,
      }),
    ),
  );
  assert.equal(state.timelines.sanmu.fictionSeconds, 30);
  assert.equal(state.flags["npc-plan-complete"], undefined);
  assert.equal(state.activities["activity:long-activity"].status, "interrupted");
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "active");

  state = commit(
    state,
    step(
      world,
      state,
      command(state, "resolve-plan", "sanmu", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 1 },
      }),
    ),
  );
  assert.equal(state.timelines.sanmu.fictionSeconds, 90);
  assert.equal(state.flags["npc-plan-complete"], true);
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "completed");
});

test("an unrelated split-location turn cannot complete an NPC activity elsewhere", () => {
  const world = structuredClone(BLACK_OAK_WILL.world);
  world.scheduledEvents[0] = {
    ...world.scheduledEvents[0],
    atSeconds: 30,
    conditions: [],
  };
  world.npcPlans[0] = {
    ...world.npcPlans[0],
    duration: { unit: "minute", value: 1 },
    effects: [{ kind: "setFlag", flag: "yard-plan-complete", value: true }],
  };
  let state = createWorldState(world, [
    player("yard-player", "yard"),
    player("cellar-player", "cellar"),
    { ...player("varo", "wake"), kind: "npc", capabilities: ["nail-door"] },
  ]);
  state.portals["yard-cellar"] = "destroyed";
  state = commit(
    state,
    step(
      world,
      state,
      command(state, "cellar-reaches-deadline", "cellar-player", {
        kind: "advanceTime",
        duration: { unit: "round", value: 5 },
      }),
    ),
  );
  state = commit(
    state,
    step(
      world,
      state,
      command(state, "start-yard-plan", "yard-player", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 2 },
        spotlightBeats: 1,
      }),
    ),
  );
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "active");

  state = commit(
    state,
    step(
      world,
      state,
      command(state, "unrelated-cellar-time", "cellar-player", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 2 },
      }),
    ),
  );
  assert.equal(state.flags["yard-plan-complete"], undefined);
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "active");

  state = commit(
    state,
    step(
      world,
      state,
      command(state, "finish-yard-plan", "yard-player", {
        kind: "advanceTime",
        duration: { unit: "minute", value: 1 },
      }),
    ),
  );
  assert.equal(state.flags["yard-plan-complete"], true);
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "completed");
});

test("global Fiction Time lets a declared NPC move through a portal and alter the plot", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    player("yard-player", "yard"),
    player("cellar-player", "cellar"),
    { ...player("varo", "wake"), kind: "npc", capabilities: ["nail-door"] },
  ]);
  state.portals["yard-cellar"] = "destroyed";

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "yard-twenty", "yard-player", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 20 },
  })));
  assert.equal(state.scheduledEvents["varo-door-deadline"], "pending");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "cellar-twenty", "cellar-player", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 20 },
  })));
  assert.equal(state.scheduledEvents["varo-door-deadline"], "attempted");
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "active");
  assert.equal(state.entities.varo.sceneId, "wake");

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "yard-thirty", "yard-player", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 10 },
  })));
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "active");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "cellar-thirty", "cellar-player", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 10 },
  })));
  assert.equal(state.activities["activity:npc:varo-door-deadline"].status, "completed");
  assert.equal(state.entities.varo.sceneId, "yard");
  assert.equal(state.timelines.varo.fictionSeconds, 30 * 60);
  assert.equal(state.portals["yard-cellar"], "locked");
});

test("NPC plans require separately declared knowledge and capabilities", () => {
  const blockedWorld = structuredClone(BLACK_OAK_WILL.world);
  blockedWorld.scheduledEvents[0].conditions = [];
  blockedWorld.scheduledEvents[0].cancelIf = [];
  blockedWorld.npcPlans[0].requiredKnowledge = ["c-third-will"];
  blockedWorld.npcInitialKnowledge = {};
  const entities = [
    player("sanmu", "yard"),
    { ...player("varo", "wake"), kind: "npc", capabilities: ["nail-door"] },
  ];
  const blockedState = createWorldState(blockedWorld, entities);
  const blocked = step(blockedWorld, blockedState, command(blockedState, "blocked-plan", "sanmu", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 30 },
    spotlightBeats: 1,
  }));
  assert.equal(blocked.kind, "committed");
  assert.ok(blocked.events.some((event) => event.type === "ScheduledEventCancelled"));
  assert.ok(!blocked.events.some((event) => event.type === "ScheduledEventAttempted"));

  const allowedWorld = structuredClone(blockedWorld);
  allowedWorld.npcInitialKnowledge = { varo: { "c-third-will": "full" } };
  const allowedState = createWorldState(allowedWorld, entities);
  const allowed = step(allowedWorld, allowedState, command(allowedState, "allowed-plan", "sanmu", {
    kind: "advanceTime",
    duration: { unit: "minute", value: 30 },
    spotlightBeats: 1,
  }));
  assert.equal(allowed.kind, "committed");
  assert.ok(allowed.events.some((event) => event.type === "ScheduledEventAttempted"));
});

test("group rest requires all votes while an individual may leave and rest immediately", () => {
  const squad = { id: "party", captainId: "a", memberIds: ["a", "b"] };
  let state = createWorldState(BLACK_OAK_WILL.world, [player("a"), player("b")], [squad]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "propose", "a", { kind: "proposeGroupRest", squadId: "party", rest: "short" }),
    ),
  );
  assert.equal(state.rests.a, undefined);
  assert.deepEqual(state.restVote.agreedIds, ["a"]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "vote-b", "b", { kind: "voteGroupRest", voteId: state.restVote.id, agree: true }),
    ),
  );
  assert.equal(state.rests.a.status, "resting");
  assert.equal(state.rests.b.status, "resting");

  let soloState = createWorldState(BLACK_OAK_WILL.world, [player("a"), player("b")], [squad]);
  soloState = commit(
    soloState,
    step(
      BLACK_OAK_WILL.world,
      soloState,
      command(soloState, "solo-rest", "b", { kind: "startRest", rest: "short" }),
    ),
  );
  assert.equal(soloState.rests.b.status, "resting");
  assert.equal(Object.values(soloState.squads).some((entry) => entry.memberIds.includes("b")), false);
});

test("command ids are idempotent, event replay is deterministic, and projection contains no secret plan", () => {
  const initial = createWorldState(BLACK_OAK_WILL.world, [player("a", "shrine"), player("b", "yard")]);
  const decision = step(
    BLACK_OAK_WILL.world,
    initial,
    command(initial, "once", "a", { kind: "interact", interactionId: "retrieve-third-will" }),
  );
  const state = commit(initial, decision);
  assert.equal(decision.commandId, "once");
  assert.equal(decision.decisionId, "decision:once");
  const duplicate = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "once", "a", { kind: "interact", interactionId: "retrieve-third-will" }),
  );
  assert.equal(duplicate.kind, "rejected");
  assert.equal(duplicate.rejection.code, "duplicate_command");
  assert.equal(duplicate.decisionId, decision.decisionId);
  assert.deepEqual(replay(initial, decision.events), state);

  const aView = project(BLACK_OAK_WILL.world, state, "a");
  const bView = project(BLACK_OAK_WILL.world, state, "b");
  assert.equal(aView.pendingRolls.length, 1);
  assert.equal(bView.pendingRolls.length, 0);
  const serialized = JSON.stringify({ aView, bView });
  assert.doesNotMatch(serialized, /"success"|"failure"|npcPlans|scheduledEvents|truth|artifact-third-will.*c-third-will/);
  assert.ok(!aView.visibleEntities.some((entity) => entity.id === "b"));
});

test("module compiler rejects unknown references and unreachable persistent locations", () => {
  const invalid = structuredClone(BLACK_OAK_WILL.world);
  invalid.portals = invalid.portals.filter((portal) => portal.id !== "cellar-shrine");
  invalid.interactions[0].success.push({ kind: "transferArtifact", artifactId: "missing", to: "actor" });
  const errors = worldDefinitionErrors(invalid, {
    sceneIds: BLACK_OAK_WILL.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.id)),
    clueIds: BLACK_OAK_WILL.clues.map((clue) => clue.id),
    npcIds: BLACK_OAK_WILL.npcs.map((npc) => npc.id),
  });
  assert.ok(errors.some((error) => /missing/.test(error)));
  assert.ok(errors.some((error) => /shrine/.test(error) && /不可达/.test(error)));
});

test("module compiler rejects duplicate artifacts, open effects, undeclared NPC capability and secret world keys", () => {
  const invalid = structuredClone(BLACK_OAK_WILL.world);
  invalid.artifacts.push(structuredClone(invalid.artifacts[0]));
  invalid.interactions[0].success.push({ kind: "freeformPatch", path: "truth" });
  invalid.interactions[0].success.push({ kind: "moveActor", portalId: "wake-yard", to: "yard" });
  invalid.npcPlans[0].requiredCapabilities.push("teleport-without-declaration");
  invalid.npcPlans[0].effects.push({ kind: "moveActor", portalId: "wake-yard", to: "cellar" });
  const errors = worldDefinitionErrors(invalid, {
    sceneIds: BLACK_OAK_WILL.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.id)),
    clueIds: BLACK_OAK_WILL.clues.map((clue) => clue.id),
    npcIds: BLACK_OAK_WILL.npcs.map((npc) => npc.id),
  });
  assert.ok(errors.some((error) => /Artifact id 重复/.test(error)));
  assert.ok(errors.some((error) => /不允许的 5e effect/.test(error)));
  assert.ok(errors.some((error) => /未声明所需能力/.test(error)));
  assert.ok(errors.some((error) => /moveActor 只允许用于 NPC Plan/.test(error)));
  assert.ok(errors.some((error) => /NPC 移动终点不在通道/.test(error)));

  const secret = structuredClone(BLACK_OAK_WILL);
  secret.world.secret = "玩家不该收到的答案";
  assert.throws(() => assertModule(secret), /结构化世界不能携带秘密文本字段/);
});

test("spotlight beats cap split-screen lead but never replace Fiction Time", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    player("a", "wake"),
    player("b", "yard"),
  ]);
  for (let index = 0; index < 3; index += 1) {
    state = commit(
      state,
      step(
        BLACK_OAK_WILL.world,
        state,
        command(state, `a-${index}`, "a", {
          kind: "advanceTime",
          duration: { unit: "minute", value: 1 },
          spotlightBeats: 1,
        }),
      ),
    );
  }
  const fourth = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "a-fourth", "a", {
      kind: "advanceTime",
      duration: { unit: "hour", value: 2 },
      spotlightBeats: 1,
    }),
  );
  assert.equal(fourth.kind, "rejected");
  assert.match(fourth.rejection.message, /3 拍/);
  const wait = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "a-waits", "a", {
      kind: "advanceTime",
      duration: { unit: "minute", value: 1 },
      spotlightBeats: 0,
    }),
  );
  assert.equal(wait.kind, "committed");
});

test("same-location time and a passive personal rest advance together", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [player("a"), player("b")]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "rest-a", "a", { kind: "startRest", rest: "short" }),
    ),
  );
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "b-searches", "b", {
        kind: "advanceTime",
        duration: { unit: "hour", value: 1 },
        spotlightBeats: 1,
      }),
    ),
  );
  assert.equal(state.timelines.a.fictionSeconds, SHORT_REST_SECONDS);
  assert.equal(state.timelines.b.fictionSeconds, SHORT_REST_SECONDS);
  assert.equal(state.rests.a.status, "completed");
});

test("short-rest choices spend hit dice and recover only declared 5e resources", () => {
  const rested = {
    ...player("a"),
    hp: { current: 4, max: 20 },
    resources: { hitDice: 3, surge: 0, slot1: 1, arcaneRecovery: 1 },
    resourceRules: {
      hitDice: { max: 3, recovery: "long", die: 10 },
      surge: { max: 1, recovery: "shortOrLong" },
      slot1: { max: 4, recovery: "long" },
      arcaneRecovery: { max: 1, recovery: "long" },
    },
    featureIds: ["arcaneRecovery"],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [rested]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "rest", "a", {
        kind: "startRest",
        rest: "short",
        options: { hitDiceRolls: [7], arcaneRecovery: 1 },
      }),
    ),
  );
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "hour", "a", {
        kind: "advanceTime",
        duration: { unit: "hour", value: 1 },
      }),
    ),
  );
  assert.equal(state.entities.a.resources.hitDice, 2);
  assert.equal(state.entities.a.resources.surge, 1);
  assert.equal(state.entities.a.resources.slot1, 2);
  assert.equal(state.entities.a.resources.arcaneRecovery, 0);
  assert.equal(state.entities.a.hp.current, 12, "d10 7 + CON 1 heals 8");
});

test("spell slots, feature uses, combat action economy and six-second rounds are authoritative", () => {
  const fighter = {
    ...player("a"),
    ac: 15,
    hp: { current: 20, max: 20 },
    spellLevels: { light: 0, cure: 1 },
    spellActionCosts: { light: "action", cure: "action" },
    featureIds: ["secondWind"],
    resources: { slot1: 1, secondWind: 1 },
    resourceRules: {
      slot1: { max: 1, recovery: "long" },
      secondWind: { max: 1, recovery: "shortOrLong" },
    },
    attacks: [{ id: "sword", name: "剑", attackBonus: 5, damage: { count: 1, sides: 8, bonus: 3, damageType: "slashing" } }],
  };
  const foe = {
    ...player("foe"),
    kind: "npc",
    ac: 12,
    hp: { current: 20, max: 20 },
    attacks: [{ id: "claw", name: "爪", attackBonus: 3, damage: { count: 1, sides: 4, bonus: 1, damageType: "slashing" } }],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [fighter, foe]);
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "combat", "a", {
        kind: "startCombat",
        targetIds: ["foe"],
        initiativeRolls: { a: 18, foe: 8 },
      }),
    ),
  );
  const combatId = state.combats.wake.id;
  const inventedAdvantage = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "invented-advantage", "a", {
      kind: "combatAttack",
      combatId,
      targetId: "foe",
      attackId: "sword",
      mode: "advantage",
      d20Rolls: [12, 15],
      damageRolls: [5],
    }),
  );
  assert.equal(inventedAdvantage.kind, "rejected");
  assert.equal(inventedAdvantage.rejection.code, "invalid_roll");
  state = commit(
    state,
    step(
      BLACK_OAK_WILL.world,
      state,
      command(state, "attack", "a", {
        kind: "combatAttack",
        combatId,
        targetId: "foe",
        attackId: "sword",
        mode: "normal",
        d20Rolls: [20],
        damageRolls: [5, 6],
      }),
    ),
  );
  assert.equal(state.entities.foe.hp.current, 6, "critical doubles dice but not the +3 modifier");
  const secondAction = step(
    BLACK_OAK_WILL.world,
    state,
    command(state, "second-action", "a", {
      kind: "castSpell",
      spellId: "light",
    }),
  );
  assert.equal(secondAction.kind, "rejected");
  state = commit(
    state,
    step(BLACK_OAK_WILL.world, state, command(state, "end-a", "a", { kind: "endCombatTurn", combatId })),
  );
  assert.equal(state.timelines.a.fictionSeconds, 0, "one turn is not one six-second round");
  state = commit(
    state,
    step(BLACK_OAK_WILL.world, state, command(state, "end-foe", "foe", { kind: "endCombatTurn", combatId })),
  );
  assert.equal(state.combats.wake.round, 2);
  assert.equal(state.timelines.a.fictionSeconds, 6);
  assert.equal(state.timelines.foe.fictionSeconds, 6);
});

test("combat movement spends feet and resolves 2014 opportunity attacks unless disengaging", () => {
  const fighter = {
    ...player("a"),
    ac: 15,
    hp: { current: 20, max: 20 },
    speedFeet: 30,
    attacks: [{ id: "sword", name: "剑", attackBonus: 5, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 8, bonus: 3, damageType: "slashing" } }],
  };
  const foe = {
    ...player("foe"),
    kind: "npc",
    ac: 12,
    hp: { current: 20, max: 20 },
    attacks: [{ id: "claw", name: "爪", attackBonus: 3, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 4, bonus: 1, damageType: "slashing" } }],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [fighter, foe]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "start", "a", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { a: 18, foe: 8 },
  })));
  const combatId = state.combats.wake.id;
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "move", "a", {
    kind: "combatMove",
    combatId,
    toPositionFeet: 30,
    mode: "normal",
    opportunityRolls: { foe: { d20Roll: 15, damageRolls: [4] } },
  })));
  const moved = state.combats.wake.order.find((entry) => entry.entityId === "a");
  const enemy = state.combats.wake.order.find((entry) => entry.entityId === "foe");
  assert.equal(moved.positionFeet, 30);
  assert.equal(moved.economy.movementFeet, 0);
  assert.equal(enemy.economy.reaction, false);
  assert.equal(state.entities.a.hp.current, 15);

  let disengage = createWorldState(BLACK_OAK_WILL.world, [fighter, foe]);
  disengage = commit(disengage, step(BLACK_OAK_WILL.world, disengage, command(disengage, "start-2", "a", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { a: 18, foe: 8 },
  })));
  disengage = commit(disengage, step(BLACK_OAK_WILL.world, disengage, command(disengage, "disengage", "a", {
    kind: "combatMove",
    combatId: disengage.combats.wake.id,
    toPositionFeet: 30,
    mode: "disengage",
    opportunityRolls: {},
  })));
  assert.equal(disengage.entities.a.hp.current, 20);
  assert.equal(disengage.combats.wake.order.find((entry) => entry.entityId === "a").economy.action, false);
  assert.equal(disengage.combats.wake.order.find((entry) => entry.entityId === "foe").economy.reaction, true);
});

test("combat sides, not player or NPC type, determine hostility", () => {
  const duelist = (id, kind = "player") => ({
    ...player(id),
    kind,
    ac: 12,
    hp: { current: 12, max: 12 },
    attacks: [{ id: "blade", name: "刃", attackBonus: 4, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 6, bonus: 2, damageType: "slashing" } }],
  });
  let state = createWorldState(BLACK_OAK_WILL.world, [
    duelist("a"),
    duelist("b"),
    duelist("c"),
    duelist("ally-npc", "npc"),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "pvp-start", "a", {
    kind: "startCombat",
    targetIds: ["b"],
    initiativeRolls: { a: 18, b: 8 },
  })));
  const combatId = state.combats.wake.id;
  assert.notEqual(
    state.combats.wake.order.find((entry) => entry.entityId === "a").side,
    state.combats.wake.order.find((entry) => entry.entityId === "b").side,
  );
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "c-joins", "c", {
    kind: "joinCombat",
    combatId,
    initiativeRoll: 6,
  })));
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "ally-joins", "ally-npc", {
    kind: "joinCombat",
    combatId,
    initiativeRoll: 5,
    sideWithId: "a",
  })));
  const actorSide = state.combats.wake.order.find((entry) => entry.entityId === "a").side;
  assert.equal(state.combats.wake.order.find((entry) => entry.entityId === "c").side, actorSide);
  assert.equal(state.combats.wake.order.find((entry) => entry.entityId === "ally-npc").side, actorSide);
  const pvpAttack = step(BLACK_OAK_WILL.world, state, command(state, "pvp-hit", "a", {
    kind: "combatAttack",
    combatId,
    targetId: "b",
    attackId: "blade",
    mode: "normal",
    d20Rolls: [15],
    damageRolls: [3],
  }));
  assert.equal(pvpAttack.kind, "committed");
  const friendlyAttack = step(BLACK_OAK_WILL.world, state, command(state, "friendly-fire", "a", {
    kind: "combatAttack",
    combatId,
    targetId: "c",
    attackId: "blade",
    mode: "normal",
    d20Rolls: [15],
    damageRolls: [3],
  }));
  assert.equal(friendlyAttack.kind, "committed");
  state = commit(state, friendlyAttack);
  assert.notEqual(
    state.combats.wake.order.find((entry) => entry.entityId === "a").side,
    state.combats.wake.order.find((entry) => entry.entityId === "c").side,
  );
});

test("zero hit points and death saves follow the 2014 combat sequence", () => {
  const hero = {
    ...player("hero"),
    ac: 10,
    hp: { current: 5, max: 20 },
    attacks: [{ id: "sword", name: "剑", attackBonus: 4, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 8, bonus: 2, damageType: "slashing" } }],
  };
  const foe = {
    ...player("foe"),
    kind: "npc",
    ac: 12,
    hp: { current: 12, max: 12 },
    attacks: [{ id: "claw", name: "爪", attackBonus: 5, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 4, bonus: 5, damageType: "slashing" } }],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [hero, foe]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "start-death", "foe", {
    kind: "startCombat",
    targetIds: ["hero"],
    initiativeRolls: { foe: 18, hero: 8 },
  })));
  const combatId = state.combats.wake.id;
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "drop", "foe", {
    kind: "combatAttack",
    combatId,
    targetId: "hero",
    attackId: "claw",
    mode: "normal",
    d20Rolls: [15],
    damageRolls: [1],
  })));
  assert.equal(state.entities.hero.hp.current, 0);
  assert.ok(state.entities.hero.activeEffects.includes("unconscious"));
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "end-foe-death", "foe", {
    kind: "endCombatTurn",
    combatId,
  })));
  const prematureEnd = step(BLACK_OAK_WILL.world, state, command(state, "premature", "hero", {
    kind: "endCombatTurn",
    combatId,
  }));
  assert.equal(prematureEnd.kind, "rejected");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "natural-20", "hero", {
    kind: "rollDeathSave",
    d20Roll: 20,
  })));
  assert.equal(state.entities.hero.hp.current, 1);
  assert.deepEqual(state.entities.hero.deathSaves, { successes: 0, failures: 0 });
  assert.ok(!state.entities.hero.activeEffects.includes("unconscious"));
});

test("ranged attacks apply 2014 close-range disadvantage", () => {
  const archer = {
    ...player("archer"),
    resources: { arrow: 1 },
    resourceRules: { arrow: { max: 1, recovery: "none" } },
    attacks: [{ id: "bow", name: "短弓", attackBonus: 5, kind: "ranged", ammoResource: "arrow", normalRangeFeet: 80, longRangeFeet: 320, damage: { count: 1, sides: 6, bonus: 3, damageType: "piercing" } }],
  };
  const foe = {
    ...player("foe"),
    kind: "npc",
    ac: 12,
    hp: { current: 10, max: 10 },
    attacks: [{ id: "claw", name: "爪", attackBonus: 3, kind: "melee", reachFeet: 5, damage: { count: 1, sides: 4, bonus: 1, damageType: "slashing" } }],
  };
  let state = createWorldState(BLACK_OAK_WILL.world, [archer, foe]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "start-range", "archer", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { archer: 18, foe: 8 },
  })));
  const combatId = state.combats.wake.id;
  const illegal = step(BLACK_OAK_WILL.world, state, command(state, "normal-shot", "archer", {
    kind: "combatAttack",
    combatId,
    targetId: "foe",
    attackId: "bow",
    mode: "normal",
    d20Rolls: [15],
    damageRolls: [3],
  }));
  assert.equal(illegal.kind, "rejected");
  assert.equal(illegal.rejection.code, "invalid_roll");
  const legal = step(BLACK_OAK_WILL.world, state, command(state, "disadvantaged-shot", "archer", {
    kind: "combatAttack",
    combatId,
    targetId: "foe",
    attackId: "bow",
    mode: "disadvantage",
    d20Rolls: [17, 12],
    damageRolls: [3],
  }));
  assert.equal(legal.kind, "committed");
  state = commit(state, legal);
  assert.equal(state.entities.archer.resources.arrow, 0);

  const emptyArcher = { ...archer, resources: { arrow: 0 } };
  let empty = createWorldState(BLACK_OAK_WILL.world, [emptyArcher, foe]);
  empty = commit(empty, step(BLACK_OAK_WILL.world, empty, command(empty, "start-empty", "archer", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { archer: 18, foe: 8 },
  })));
  const noAmmo = step(BLACK_OAK_WILL.world, empty, command(empty, "empty-shot", "archer", {
    kind: "combatAttack",
    combatId: empty.combats.wake.id,
    targetId: "foe",
    attackId: "bow",
    mode: "disadvantage",
    d20Rolls: [17, 12],
    damageRolls: [3],
  }));
  assert.equal(noAmmo.kind, "rejected");
  assert.equal(noAmmo.rejection.code, "not_allowed");
});

test("ending predicates become public only after their structured facts are true", () => {
  const state = createWorldState(BLACK_OAK_WILL.world, [player("a", "shrine"), player("b", "yard")]);
  assert.deepEqual(project(BLACK_OAK_WILL.world, state, "a").reachedEndings, []);
  state.artifacts["artifact-third-will"] = {
    artifactId: "artifact-third-will",
    status: "held",
    holderId: "a",
  };
  state.flags["stone-seat-destroyed"] = true;
  const reached = project(BLACK_OAK_WILL.world, state, "b").reachedEndings;
  assert.deepEqual(reached.map((ending) => ending.id), ["ending-seat-destroyed"]);
  assert.doesNotMatch(JSON.stringify(reached), /亡妻|枯骨会|真正死因/);
});

test("squad invitations and captain transfer never gate a member's personal action", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [player("a"), player("b")]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "invite", "a", { kind: "inviteSquad", targetId: "b" })));
  const inviteId = Object.keys(state.squadInvites)[0];
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "accept", "b", { kind: "respondSquadInvite", inviteId, accept: true })));
  const squad = Object.values(state.squads)[0];
  assert.equal(squad.captainId, "a");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "pass", "a", { kind: "transferSquadCaptain", squadId: squad.id, targetId: "b" })));
  assert.equal(state.squads[squad.id].captainId, "b");
  const memberCannotCommand = step(BLACK_OAK_WILL.world, state, command(state, "member-move", "a", {
    kind: "move",
    portalId: "wake-yard",
    destinationId: "yard",
    mode: "squad",
  }));
  assert.equal(memberCannotCommand.kind, "rejected");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "captain-move", "b", {
    kind: "move",
    portalId: "wake-yard",
    destinationId: "yard",
    mode: "squad",
  })));
  assert.equal(state.entities.a.sceneId, "yard");
  assert.equal(state.entities.b.sceneId, "yard");
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "personal-rest", "a", { kind: "startRest", rest: "short" })));
  assert.equal(state.rests.a.status, "resting");
  assert.equal(Object.values(state.squads).some((entry) => entry.memberIds.includes("a")), false);
});
