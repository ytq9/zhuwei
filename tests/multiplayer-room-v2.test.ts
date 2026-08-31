import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";
import {
  observationProposal,
  privateFormProposal,
} from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:bob", sessionVersion: 1 }),
});
const CHARLIE = Object.freeze({
  principal: Object.freeze({ id: "principal:multi:charlie", sessionVersion: 1 }),
});

type RoomAdministrationCapability = unknown;

type MultiplayerAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: RoomAdministrationCapability, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
};

type Initialized = {
  stub: MultiplayerAuthority;
  administration: RoomAdministrationCapability;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function room(name: string): MultiplayerAuthority {
  return env.ROOMS.getByName(name) as unknown as MultiplayerAuthority;
}

function character(
  id: string,
  principalId: string,
  sceneId: "shrine" | "yard" | "cellar" = "shrine",
  proficiencyFields: RecordValue = {},
) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId,
      abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
      proficiencyBonus: 2,
      proficientSkills: [],
      resources: { resolve: 1 },
      ...proficiencyFields,
    },
  };
}

function campaignCharacter(id: string, principalId: string, currentHitPoints = 7) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId: "shrine",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      level: 3,
      scores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["stealth"],
      cantrips: [],
      prepared: [],
      features: ["feature:cunning-action", "feature:sneak-attack"],
      hp: { current: currentHitPoints, max: 18, temp: 0 },
      ac: 14,
      speed: 30,
      resources: {
        hitDice: { max: 3, used: 1 },
        resolve: 1,
      },
    },
  };
}

function wizardCampaignCharacter(id: string, principalId: string) {
  return {
    characterId: id,
    controllerPrincipalId: principalId,
    staticCard: {
      name: id,
      sceneId: "shrine",
      classId: "wizard",
      raceId: "human",
      subclassId: "school-of-evocation",
      level: 9,
      scores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
      proficiency: 4,
      skills: ["arcana"],
      cantrips: ["fire-bolt"],
      prepared: ["magic-missile"],
      features: ["feature:arcane-recovery"],
      hp: { current: 32, max: 38, temp: 0 },
      ac: 13,
      speed: 30,
      resources: {
        hitDice: { max: 9, used: 0 },
        arcaneRecovery: { max: 1, used: 0 },
        slot1: { max: 4, used: 2 },
        slot2: { max: 3, used: 0 },
        slot3: { max: 3, used: 1 },
        resolve: 1,
      },
    },
  };
}

function fatalAreaHazardDraft(): RecordValue {
  return {
    goal: "松开已经开裂的石梁支索，让坍落范围按现场几何结算",
    method: "扯动垂落的支索，使失去支撑的石梁坠入苏醒室",
    featureDescription: "悬在苏醒室上方、支索已经开裂的石梁",
    intendedOutcome: "石梁坠落并击中未能避开的范围内角色，随后成为瓦砾",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["wake"],
    effectMode: "area-hazard",
    activation: "check",
    checkAbility: "int",
    checkSkill: "investigation",
    checkDc: 1,
    checkMode: "normal",
    checkSuccessConsequence: "支索被扯断，石梁开始坠落。",
    checkFailureConsequence: "支索没有断裂，石梁仍被悬住。",
    material: "开裂石梁、磨损麻绳与松动铁环",
    centerXInches: -300,
    centerYInches: -240,
    elevationInches: 0,
    widthInches: 120,
    depthInches: 24,
    heightInches: 96,
    objectAc: 12,
    objectHitPoints: 12,
    damageThreshold: 3,
    immuneDamageTypes: ["poison", "psychic"],
    initialPhase: "tuned",
    phaseNames: ["tuned", "venting", "shattered"],
    phaseOpaque: [true, false, false],
    phaseImpassable: [true, false, true],
    phaseCover: ["threeQuarters", "half", "half"],
    phaseEffectPropagation: ["blocks", "passes", "passes"],
    phaseTerrain: ["normal", "normal", "rubble"],
    damageFromPhases: ["tuned"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: ["venting"],
    stuntFromPhases: ["tuned"],
    stuntToPhases: ["venting"],
    hazardFromPhases: ["venting"],
    hazardToPhases: ["shattered"],
    hazardTriggerPhase: "venting",
    hazardResolvedPhase: "shattered",
    trigger: "支索断裂后，石梁沿松脱的铁环垂直坠落",
    areaOriginElevationInches: 36,
    areaRadiusInches: 60,
    propagation: "straight",
    saveAbility: "dex",
    saveDc: 30,
    halfOnSuccess: false,
    damage: "1d4+18",
    damageType: "bludgeoning",
    condition: "prone",
    debrisOutcome: "断梁与碎石堆成阻挡通行的瓦砾",
  };
}

async function initialize(
  name: string,
  input: {
    members: Array<{ principalId: string; role: "host" | "player" | "observer" }>;
    characters: ReturnType<typeof character>[];
    runtimeProfiles?: unknown;
    fixtureFacts?: unknown[];
  },
): Promise<Initialized> {
  const stub = room(name);
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: input.members,
    characters: input.characters,
    ...(input.runtimeProfiles === undefined ? {} : { runtimeProfiles: input.runtimeProfiles }),
    ...(input.fixtureFacts === undefined ? {} : { fixtureFacts: input.fixtureFacts }),
  }), "multiplayer initialization");
  expect(initialized).toMatchObject({ created: true });
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  expect(capabilities.roomAdministration).toBeDefined();
  return { stub, administration: capabilities.roomAdministration };
}

function readModel(value: unknown): RecordValue {
  return record(record(value, "observation").readModel, "read model");
}

function prepared(value: unknown): RecordValue & {
  preparedActionId: string;
  rootActionId: string;
} {
  const result = record(value, "prepare outcome");
  expect(result).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return result as RecordValue & { preparedActionId: string; rootActionId: string };
}

async function commitObservationIntent(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  characterId: string,
  text: string,
  duration: { unit: "second" | "minute" | "hour"; value: number },
) {
  const action = prepared(await stub.prepare(context, {
    kind: "intent",
    submissionId,
    characterId,
    text,
  }));
  return record(await stub.commit(
    context,
    action.preparedActionId,
    observationProposal(action.rootActionId, {
      goal: text,
      method: text,
      duration,
      proposalAttemptId: `${submissionId}:proposal:1`,
    }),
  ), "multiplayer commit");
}

async function commitRetirement(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  characterId: string,
  text: string,
) {
  const action = prepared(await stub.prepare(context, {
    kind: "intent",
    submissionId,
    characterId,
    text,
  }));
  return record(await stub.commit(context, action.preparedActionId, {
    kind: "authenticatedCampaignAction",
    action: "retireCharacter",
    rootActionId: action.rootActionId,
    reason: text,
    continueAsNpc: false,
  }), "retirement commit");
}

async function commitRestStart(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  input: {
    submissionId: string;
    restKind: "short" | "long";
    mode: "personal" | "group";
    hitDiceToSpend: number;
    arcaneRecoverySlotLevels: number[];
  },
) {
  const action = prepared(await stub.prepare(context, {
    kind: "restStart",
    ...structuredClone(input),
  }));
  expect(action.resolutionMode).toBe("authorityDirect");
  return record(await stub.commit(context, action.preparedActionId, {
    kind: "authenticatedRestStart",
    rootActionId: action.rootActionId,
  }), "rest start commit");
}

async function commitChapterTransition(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  input: {
    submissionId: string;
    characterId: string;
    text: string;
    chapterRef: string;
  },
) {
  const action = prepared(await stub.prepare(context, {
    kind: "intent",
    submissionId: input.submissionId,
    characterId: input.characterId,
    text: input.text,
  }));
  return record(await stub.commit(
    context,
    action.preparedActionId,
    privateFormProposal(action.rootActionId, "materialization.v1", {
      goal: input.text,
      method: "依据当前章节结果进入下一章",
      proposedFact: JSON.stringify({
        schema: "zhuwei.campaign-lifecycle-draft/v1",
        action: "transitionChapter",
        chapterRef: input.chapterRef,
        storyAnchorRefs: [],
        sceneQuestion: "既有结果将如何塑造下一章？",
        activityTransitions: [],
      }),
      basisRefs: ["shrine"],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    }, `${input.submissionId}:proposal:1`),
  ), "chapter transition commit");
}

type AuthenticatedPartyProposal =
  | { kind: "authenticatedPartyAction"; action: "inviteMember"; targetCharacterId: string }
  | { kind: "authenticatedPartyAction"; action: "cancelInvitation"; pendingInputId: string }
  | { kind: "authenticatedPartyAction"; action: "leave" }
  | {
      kind: "authenticatedPartyAction";
      action: "transferLeadership";
      targetCharacterId: string;
    }
  | {
      kind: "authenticatedPartyAction";
      action: "proposeMove" | "moveIndividually";
      destinationSceneId: string;
      fictionTimeCostMicros: string;
    };

async function commitAuthenticatedPartyAction(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  text: string,
  proposal: AuthenticatedPartyProposal,
) {
  const action = prepared(await stub.prepare(context, {
    kind: "intent",
    submissionId,
    text,
  }));
  return record(await stub.commit(
    context,
    action.preparedActionId,
    { ...structuredClone(proposal), rootActionId: action.rootActionId },
  ), "authenticated party commit");
}

async function answerPending(
  stub: MultiplayerAuthority,
  context: typeof ALICE | typeof BOB | typeof CHARLIE,
  submissionId: string,
  pendingInputId: string,
  answer: unknown,
) {
  const action = prepared(await stub.prepare(context, {
    kind: "answer",
    submissionId,
    pendingInputId,
    answer,
  }));
  expect(action.resolutionMode).toBe("authorityDirect");
  return record(await stub.commit(
    context,
    action.preparedActionId,
    { kind: "authenticatedPendingAnswer", rootActionId: action.rootActionId },
  ), "pending answer commit");
}

describe("authoritative multiplayer room, group, time, and spotlight", () => {
  it("carries exact-v4 Expertise and saves through Room control and successor synchronization", async () => {
    const predecessorId = "character:multi:v4-predecessor";
    const successorId = "character:multi:v4-successor";
    const initialized = await initialize("multiplayer-v4-proficiency-lifecycle", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(predecessorId, ALICE.principal.id, "shrine", {
        proficientSkills: ["investigation"],
        expertise: ["investigation"],
        proficientSaves: ["dex", "int"],
      })],
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    });
    expect(readModel(await initialized.stub.observe(ALICE)).controlledCharacter).toMatchObject({
      characterId: predecessorId,
      proficientSkills: ["investigation"],
      expertiseSkills: ["investigation"],
      proficientSaves: ["dex", "int"],
      combat: expect.any(Object),
    });

    const retired = await commitRetirement(
      initialized.stub,
      ALICE,
      "submission:v4-proficiency:retire",
      predecessorId,
      "我结束前任的冒险生涯，并安排一名继任者加入。",
    );
    expect(retired.kind, JSON.stringify(retired)).toBe("committed");

    const successor = character(successorId, ALICE.principal.id, "shrine", {
      proficientSkills: ["stealth"],
      expertiseSkills: ["stealth"],
      expertise: ["stealth"],
      proficientSaves: ["dex", "int"],
    });
    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:v4-proficiency-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: successor,
      worldEntry: "继任者按已固化人物卡加入神龛。",
    })).resolves.toMatchObject({ kind: "committed" });
    expect(readModel(await initialized.stub.observe(ALICE)).controlledCharacter).toMatchObject({
      characterId: successorId,
      proficientSkills: ["stealth"],
      expertiseSkills: ["stealth"],
      proficientSaves: ["dex", "int"],
      combat: expect.any(Object),
    });
  });

  it("freezes a personal wizard's canonical multi-slot Arcane Recovery choice", async () => {
    const characterId = "character:multi:personal-arcane-recovery";
    const initialized = await initialize("multiplayer-v2-personal-arcane-recovery", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [wizardCampaignCharacter(characterId, ALICE.principal.id)],
    });

    const started = await commitRestStart(
      initialized.stub,
      ALICE,
      {
        submissionId: "submission:personal-arcane-recovery:start",
        restKind: "short",
        mode: "personal",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [3, 1, 1],
      },
    );
    expect(started.kind, JSON.stringify(started)).toBe("committed");

    const observed = readModel(await initialized.stub.observe(ALICE));
    expect(list(observed.activities, "personal rest activities")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        characterId,
        restKind: "short",
        recoveryChoice: {
          hitDiceToSpend: 0,
          arcaneRecoverySlotLevels: [1, 1, 3],
        },
        status: "active",
      }),
    ]));
  });

  it("owns short-rest hit-die faces and commits recovery only after fictional time", async () => {
    const characterId = "character:multi:resting-fighter";
    const base = campaignCharacter(characterId, ALICE.principal.id, 4);
    const initialized = await initialize("multiplayer-v2-authoritative-rest", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        ...base,
        staticCard: {
          ...base.staticCard,
          classId: "fighter",
          subclassId: "champion",
          scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
          hp: { current: 4, max: 20, temp: 0 },
          resources: {
            hitDice: { max: 3, used: 1 },
            surge: { max: 1, used: 1 },
            slot1: { max: 2, used: 2 },
            resolve: 1,
          },
        },
      }],
    });

    const started = await commitRestStart(
      initialized.stub,
      ALICE,
      {
        submissionId: "submission:rest:start",
        restKind: "short",
        mode: "personal",
        hitDiceToSpend: 1,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect(started.kind, JSON.stringify(started)).toBe("committed");
    const startRoot = String(record(started.receipt, "rest start receipt").rootActionId);
    const activityId = `activity:${startRoot}`;

    const premature = await commitObservationIntent(
      initialized.stub,
      ALICE,
      "submission:rest:premature",
      characterId,
      "这一小时还没过去，我确认休整尚未到期。",
      { unit: "second", value: 1 },
    );
    expect(premature.kind, JSON.stringify(premature)).toBe("committed");
    expect(list(readModel(await initialized.stub.observe(ALICE)).activities, "premature rest activities"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ activityId, status: "active" }),
      ]));

    const passage = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:rest:time-passage",
      characterId,
      text: "保持休息，直到完整一小时过去。",
    }));
    const elapsed = record(await initialized.stub.commit(
      ALICE,
      passage.preparedActionId,
      observationProposal(passage.rootActionId, {
        goal: "完成不受打扰的一小时短休。",
        method: "在安全处包扎并补水。",
        duration: { unit: "hour", value: 1 },
        proposalAttemptId: "proposal:rest:time-passage",
      }),
    ), "fictional rest time");
    expect(elapsed.kind, JSON.stringify(elapsed)).toBe("committed");

    const completed = await commitObservationIntent(
      initialized.stub,
      ALICE,
      "submission:rest:complete",
      characterId,
      "一小时已经过去，我确认休整结果。",
      { unit: "second", value: 1 },
    );
    expect(completed.kind, JSON.stringify(completed)).toBe("committed");
    const commitments = list(
      record(completed.receipt, "rest completion receipt").randomnessCommitments,
      "rest randomness commitments",
    );
    expect(commitments).toHaveLength(1);
    const restDraw = record(commitments[0], "rest draw");
    expect(restDraw).not.toHaveProperty("faces");
    const mechanical = record(
      record(completed.kpProjection, "rest KP projection").mechanicalResult,
      "rest mechanical result",
    );
    const randomDraws = list(mechanical.randomness, "rest authoritative draws");
    const faces = list(record(randomDraws[0], "rest authoritative draw").faces, "rest faces");
    expect(faces).toHaveLength(1);
    expect(Number(faces[0])).toBeGreaterThanOrEqual(1);
    expect(Number(faces[0])).toBeLessThanOrEqual(10);

    const observed = readModel(await initialized.stub.observe(ALICE));
    const rested = record(observed.controlledCharacter, "rested fighter");
    expect(record(rested.hitPoints, "rested hit points").current)
      .toBe(Math.min(20, 4 + Number(faces[0]) + 2));
    expect(record(rested.resources, "rested resources")).toMatchObject({
      hitDice: 1,
      surge: 1,
      slot1: 0,
      resolve: 1,
    });
  });

  it("routes group-rest consent through trusted pending ownership without auto-resting another player", async () => {
    const aliceId = "character:multi:group-rest:alice";
    const bobId = "character:multi:group-rest:bob";
    const initialized = await initialize("multiplayer-v2-authoritative-group-rest", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(aliceId, ALICE.principal.id, 10),
        wizardCampaignCharacter(bobId, BOB.principal.id),
      ],
    });
    const invitation = await commitAuthenticatedPartyAction(
      initialized.stub,
      ALICE,
      "submission:group-rest:invite",
      "我邀请鲍勃同行。",
      { kind: "authenticatedPartyAction", action: "inviteMember", targetCharacterId: bobId },
    );
    const partyPendingId = String(record(invitation.pending, "party pending").pendingInputId);
    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:join",
      partyPendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const offered = await commitRestStart(
      initialized.stub,
      ALICE,
      {
        submissionId: "submission:group-rest:offer",
        restKind: "short",
        mode: "group",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
    const groupRestQuestion = "是否自愿加入短休？请自行选择恢复资源。";
    const aliceAfterOffer = record(
      await initialized.stub.observe(ALICE),
      "Alice after group rest offer",
    );
    const bobAfterOffer = record(
      await initialized.stub.observe(BOB),
      "Bob after group rest offer",
    );
    expect(JSON.stringify(bobAfterOffer.transcript)).toContain(groupRestQuestion);
    expect(JSON.stringify(aliceAfterOffer.transcript)).not.toContain(groupRestQuestion);
    const bobRead = readModel(bobAfterOffer);
    const groupPending = list(bobRead.pendingInputs, "Bob group rest pending")
      .map((entry) => record(entry, "group pending entry"))
      .find((entry) => entry.kind === "groupRestConsent");
    expect(groupPending).toBeDefined();
    const groupPendingId = String(groupPending!.pendingInputId);
    expect(record(groupPending!.options, "group rest options")).toMatchObject({
      initiatorCharacterId: aliceId,
      restKind: "short",
      offeredAtFictionMicros: "0",
    });

    await expect(initialized.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:group-rest:forged-answer",
      pendingInputId: groupPendingId,
      answer: { kind: "restNow", restKind: "short", mode: "group", hitDice: 1, arcane: 0 },
    })).resolves.toMatchObject({ kind: "rejected", code: "pendingInputUnauthorized" });
    expect(list(readModel(await initialized.stub.observe(BOB)).pendingInputs, "pending survives forged answer"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]));

    const legacyArcane = await answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:legacy-arcane",
      groupPendingId,
      { kind: "restNow", restKind: "short", mode: "group", hitDice: 0, arcane: 1 },
    );
    expect(legacyArcane).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    const invalidArcane = await answerPending(
      initialized.stub,
      BOB,
      "submission:group-rest:invalid-arcane",
      groupPendingId,
      {
        kind: "restNow",
        restKind: "short",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [0, 6, 1.5],
      },
    );
    expect(invalidArcane).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    const reconnected = room("multiplayer-v2-authoritative-group-rest");
    expect(list(readModel(await reconnected.observe(BOB)).pendingInputs, "pending after reconnect"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]));

    const accepted = await answerPending(
      reconnected,
      BOB,
      "submission:group-rest:accept",
      groupPendingId,
      {
        kind: "restNow",
        restKind: "short",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [3, 1, 1],
      },
    );
    expect(accepted.kind, JSON.stringify(accepted)).toBe("committed");
    const bobAfterConsent = record(
      await initialized.stub.observe(BOB),
      "Bob after group rest consent",
    );
    expect(JSON.stringify(bobAfterConsent.transcript)).toContain(groupRestQuestion);
    const after = readModel(bobAfterConsent);
    expect(list(after.pendingInputs, "pending after consent")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pendingInputId: groupPendingId })]),
    );
    expect(list(after.activities, "Bob activities")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        characterId: bobId,
        restKind: "short",
        recoveryChoice: { hitDiceToSpend: 0, arcaneRecoverySlotLevels: [1, 1, 3] },
        startedAtFictionMicros: "0",
        status: "active",
      }),
    ]));
  });

  it("rejects Arcane Recovery choices from a private long-rest consent", async () => {
    const aliceId = "character:multi:long-rest:alice";
    const bobId = "character:multi:long-rest:bob";
    const initialized = await initialize("multiplayer-v2-authoritative-long-rest", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(aliceId, ALICE.principal.id, 10),
        wizardCampaignCharacter(bobId, BOB.principal.id),
      ],
    });
    const invitation = await commitAuthenticatedPartyAction(
      initialized.stub,
      ALICE,
      "submission:long-rest:invite",
      "我邀请鲍勃同行。",
      { kind: "authenticatedPartyAction", action: "inviteMember", targetCharacterId: bobId },
    );
    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:join",
      String(record(invitation.pending, "long-rest party pending").pendingInputId),
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const offered = await commitRestStart(
      initialized.stub,
      ALICE,
      {
        submissionId: "submission:long-rest:offer",
        restKind: "long",
        mode: "group",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
    const pendingInputId = String(record(offered.pending, "long-rest consent pending").pendingInputId);

    const invalid = await answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:invalid-arcane-recovery",
      pendingInputId,
      {
        kind: "restNow",
        restKind: "long",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [1],
      },
    );
    expect(invalid).toMatchObject({ kind: "rejected", code: "invalidPendingResolution" });

    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:long-rest:accept",
      pendingInputId,
      {
        kind: "restNow",
        restKind: "long",
        mode: "group",
        hitDice: 0,
        arcaneRecoverySlotLevels: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
  });

  it("commits advancement, chapter transition, retirement, and a provenance-clean successor through Room authority", async () => {
    const predecessorId = "character:multi:campaign-predecessor";
    const successorId = "character:multi:campaign-successor";
    const witnessId = "character:multi:campaign-witness";
    const milestoneSourceFactId = "fact:multi:campaign:chapter-result";
    const initialized = await initialize("multiplayer-v2-long-campaign", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(predecessorId, ALICE.principal.id),
        campaignCharacter(witnessId, BOB.principal.id),
      ],
      fixtureFacts: [{
        factRef: milestoneSourceFactId,
        kind: "establishedCommunicationChannel",
        participants: [predecessorId, witnessId],
      }],
    });

    const milestoneAction = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:milestone",
      characterId: predecessorId,
      text: "这一章的目标已经达成，我要结算里程碑成长。",
    }));
    const milestone = record(await initialized.stub.commit(
      ALICE,
      milestoneAction.preparedActionId,
      {
        kind: "authenticatedCampaignAction",
        action: "grantMilestone",
        rootActionId: milestoneAction.rootActionId,
        sourceFactIds: [milestoneSourceFactId],
      },
    ), "milestone commit");
    expect(milestone.kind, JSON.stringify(milestone)).toBe("awaitingInput");
    const milestonePending = record(milestone.pending, "advancement pending");
    expect(milestonePending).toMatchObject({
      kind: "advancementChoice",
      options: {
        classId: "rogue",
        newLevel: 4,
        hitPointMethod: "fixed2014",
        abilityScoreBudget: 2,
      },
    });
    const advanced = await answerPending(
      initialized.stub,
      ALICE,
      "submission:campaign:advancement-choice",
      String(milestonePending.pendingInputId),
      {
        classId: "rogue",
        newLevel: 4,
        hitPointMethod: "fixed2014",
        selectedFeatureIds: ["feature:ability-score-improvement"],
        abilityScoreIncreases: { dex: 2 },
      },
    );
    expect(advanced.kind).toBe("committed");
    const advancedRead = readModel(await initialized.stub.observe(ALICE));
    expect(record(advancedRead.controlledCharacter, "advanced character")).toMatchObject({
      characterId: predecessorId,
      level: 4,
      abilityScores: { dex: 18 },
      hitPoints: { current: 7, maximum: 24 },
      proficiencyBonus: 2,
      resourceMaximums: { hitDice: 4 },
    });

    const transitioned = await commitChapterTransition(
      initialized.stub,
      ALICE,
      {
        submissionId: "submission:campaign:transition-chapter",
        characterId: predecessorId,
        text: "我确认本章结果，并进入以既有后果为锚点的下一章。",
        chapterRef: "chapter:campaign:second",
      },
    );
    expect(transitioned.kind, JSON.stringify(transitioned)).toBe("committed");
    const chapterRead = readModel(await initialized.stub.observe(ALICE));
    expect(list(chapterRead.chapters, "chapter continuity projection")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chapterId: "chapter:opening",
          status: "concluded",
          continuityManifestHash: expect.stringMatching(/^sha256:/),
          nextChapterId: "chapter:campaign:second",
        }),
        expect.objectContaining({
          chapterId: "chapter:campaign:second",
          status: "active",
        }),
      ]),
    );
    const retired = await commitRetirement(
      initialized.stub,
      ALICE,
      "submission:campaign:retire",
      predecessorId,
      "我选择留在这里重建守钥人组织，并结束冒险者生涯。",
    );
    expect(retired.kind, JSON.stringify(retired)).toBe("committed");
    await expect(initialized.stub.observe(ALICE)).resolves.toMatchObject({
      readModel: {
        controlledCharacter: null,
        lifecycle: {
          kind: "successorRequired",
          defaultPredecessorCharacterId: predecessorId,
        },
      },
    });
    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:retired-predecessor-cannot-act",
      characterId: predecessorId,
      text: "我仍以已经退役的前任身份行动。",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });

    const successorSeed = campaignCharacter(successorId, ALICE.principal.id, 18);
    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:introduce-campaign-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: successorSeed,
      worldEntry: "受守钥人邀请来到神龛，明确接过下一章的冒险席位。",
    })).resolves.toMatchObject({ kind: "committed" });

    const successorRead = readModel(await room("multiplayer-v2-long-campaign").observe(ALICE));
    expect(record(successorRead.controlledCharacter, "successor character")).toMatchObject({
      characterId: successorId,
      level: 3,
      hitPoints: { current: 18, maximum: 18 },
    });
    expect(list(successorRead.knowledge, "successor knowledge")).toEqual([]);
    expect(record(successorRead.controlledCharacter, "successor mechanics").combat).toBeDefined();

    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:campaign:successor-forged-actor",
      characterId: predecessorId,
      text: "我调查新章节的入口。",
    })).resolves.toMatchObject({
      kind: "prepared",
      kpProjection: {
        actorProjection: {
          controlledCharacter: { characterId: successorId },
        },
      },
    });
  }, 15_000);

  it("records typed knowledge, relationship, promise, and debt consequences through current Forms", async () => {
    const actorId = "character:multi:typed-consequences:actor";
    const witnessId = "character:multi:typed-consequences:witness";
    const unavailableId = "character:multi:typed-consequences:other-scene";
    const factRef = "fact:multi:typed-consequences:chapter-result";
    const knowledgeRef = "knowledge:multi:typed-consequences:private-sigil";
    const relationshipRef = "relationship:multi:typed-consequences:witness";
    const promiseRef = "promise:multi:typed-consequences:witness";
    const debtRef = "debt:multi:typed-consequences:witness";
    const initialized = await initialize("multiplayer-v2-typed-world-consequences", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CHARLIE.principal.id, role: "player" },
      ],
      characters: [
        character(actorId, ALICE.principal.id),
        character(witnessId, BOB.principal.id),
        character(unavailableId, CHARLIE.principal.id, "yard"),
      ],
    });
    const unavailableAction = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:typed-world-consequences:other-scene",
      text: "我试图把另一场景的人写成这次关系后果的参与者。",
    }));
    await expect(initialized.stub.commit(
      ALICE,
      unavailableAction.preparedActionId,
      privateFormProposal(unavailableAction.rootActionId, "materialization.v1", {
        goal: "把另一场景的人写入本次关系后果",
        method: "commitWorldConsequences",
        proposedFact: JSON.stringify({
          schema: "zhuwei.world-consequence-draft/v1",
          factRef: "fact:multi:typed-consequences:unavailable-target",
          summary: "另一场景的人参与了这次约定。",
          consequences: [{
            kind: "updateRelationship",
            relationshipRef: "relationship:multi:typed-consequences:unavailable-target",
            counterpartyRefs: [unavailableId],
            change: "未经同场事实支持的关系变化",
          }],
        }),
        basisRefs: ["shrine", unavailableId],
        resolution: "direct",
        durationUnit: "second",
        durationValue: 1,
      }, "proposal:multi:typed-world-consequences:unavailable-target"),
    )).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "privateOrUnknownReference" })],
    });
    const action = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:typed-world-consequences",
      characterId: "forged:actor-is-ignored",
      text: "我辨认暗号，并与见证人同时明确关系、承诺和债务。",
    }));
    const draft = {
      schema: "zhuwei.world-consequence-draft/v1",
      factRef,
      summary: "见证人确认银叶暗号，并与守钥人完成本次约定。",
      consequences: [
        {
          kind: "acquireKnowledge",
          knowledgeRef,
          content: "银叶暗号指向旧王室密道",
        },
        {
          kind: "updateRelationship",
          relationshipRef,
          counterpartyRefs: [witnessId],
          change: "共同守护神龛的私人信任",
        },
        {
          kind: "recordPromise",
          promiseRef,
          counterpartyRef: witnessId,
          content: "在月圆前守住神龛",
          condition: "下一次月圆前",
        },
        {
          kind: "recordDebt",
          debtRef,
          counterpartyRef: witnessId,
          obligation: "偿还重铸神龛门锁的费用",
          condition: "下一次月圆前",
        },
      ],
    };
    const formDraft = {
      goal: "辨认暗号，并与见证人同时明确关系、承诺和债务",
      method: "commitWorldConsequences",
      proposedFact: JSON.stringify(draft),
      basisRefs: ["shrine", witnessId],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    };
    await expect(initialized.stub.commit(
      ALICE,
      action.preparedActionId,
      privateFormProposal(action.rootActionId, "materialization.v1", {
        ...formDraft,
        proposedFact: JSON.stringify({
          ...draft,
          actorCharacterId: actorId,
          event: { eventType: "KnowledgeAcquired" },
          state: { resources: { resolve: 99 } },
          visibility: "visibility:public",
        }),
      }, "proposal:multi:typed-world-consequences:forged"),
    )).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "invalidRulesInput" })],
    });
    const beforeCommit = readModel(await initialized.stub.observe(ALICE));
    expect(list(beforeCommit.knowledge, "knowledge after rejected authority fields")).toEqual([]);
    expect(list(beforeCommit.relationships, "relationships after rejected authority fields")).toEqual([]);
    expect(list(beforeCommit.promises, "promises after rejected authority fields")).toEqual([]);
    expect(list(beforeCommit.debts, "debts after rejected authority fields")).toEqual([]);

    const committed = record(await initialized.stub.commit(
      ALICE,
      action.preparedActionId,
      privateFormProposal(
        action.rootActionId,
        "materialization.v1",
        formDraft,
        "proposal:multi:typed-world-consequences:valid",
      ),
    ), "typed world consequences");
    expect(committed.kind, JSON.stringify(committed)).toBe("committed");

    const actorRead = readModel(await initialized.stub.observe(ALICE));
    expect(list(actorRead.knowledge, "actor consequence knowledge")).toEqual([
      expect.objectContaining({ knowledgeRef, content: "银叶暗号指向旧王室密道" }),
    ]);
    expect(list(actorRead.relationships, "actor consequence relationships")).toEqual([
      expect.objectContaining({ relationshipId: relationshipRef }),
    ]);
    expect(list(actorRead.promises, "actor consequence promises")).toEqual([
      expect.objectContaining({ promiseId: promiseRef }),
    ]);
    expect(list(actorRead.debts, "actor consequence debts")).toEqual([
      expect.objectContaining({ debtId: debtRef }),
    ]);
    expect(list(actorRead.visibleFacts, "actor consequence facts")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: factRef, kind: "worldConsequence" })]),
    );

    const witnessRead = readModel(await initialized.stub.observe(BOB));
    expect(list(witnessRead.knowledge, "witness private knowledge")).toEqual([]);
    expect(list(witnessRead.relationships, "witness consequence relationships")).toEqual([
      expect.objectContaining({ relationshipId: relationshipRef }),
    ]);
    expect(list(witnessRead.promises, "witness consequence promises")).toEqual([
      expect.objectContaining({ promiseId: promiseRef }),
    ]);
    expect(list(witnessRead.debts, "witness consequence debts")).toEqual([
      expect.objectContaining({ debtId: debtRef }),
    ]);
  });

  it("establishes and consumes an exact inheritance authorization through a current entry point", async () => {
    const predecessorId = "character:multi:inheritance-predecessor";
    const successorId = "character:multi:inheritance-successor";
    const witnessId = "character:multi:inheritance-witness";
    const knowledgeRef = "knowledge:multi:inheritance-private-sigil";
    const authorizationId = "inheritance-authorization:multi:private-sigil";
    const initialized = await initialize("multiplayer-v2-exact-inheritance", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        campaignCharacter(predecessorId, ALICE.principal.id),
        campaignCharacter(witnessId, BOB.principal.id),
      ],
      fixtureFacts: [{
        knowledgeRef,
        holderEntityId: predecessorId,
        content: "银叶暗号指向旧王室密道",
      }],
    });
    expect(list(readModel(await initialized.stub.observe(ALICE)).knowledge, "predecessor knowledge"))
      .toEqual([expect.objectContaining({ knowledgeRef })]);

    await expect(commitRetirement(
      initialized.stub,
      ALICE,
      "submission:inheritance:retire-predecessor",
      predecessorId,
      "我退役并保留银叶暗号，等待世界内遗嘱明确后续归属。",
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:introduce-inheritance-successor",
      kind: "introduceSuccessor",
      principalId: ALICE.principal.id,
      predecessorCharacterId: predecessorId,
      character: campaignCharacter(successorId, ALICE.principal.id, 18),
      worldEntry: "继任者作为独立人物来到神龛，不自动取得前任的秘密。",
    })).resolves.toMatchObject({ kind: "committed" });
    expect(list(readModel(await initialized.stub.observe(ALICE)).knowledge, "clean successor knowledge"))
      .toEqual([]);

    const unrelatedPrepared = prepared(await initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:inheritance:unrelated-seat",
      characterId: witnessId,
      text: "我试图替另一个 Seat 的前任建立继承来源。",
    }));
    await expect(initialized.stub.commit(BOB, unrelatedPrepared.preparedActionId, {
      kind: "authenticatedCampaignAction",
      action: "establishInheritanceSource",
      rootActionId: unrelatedPrepared.rootActionId,
      inheritanceSourceKind: "will",
      publicClause: "无关 Seat 伪造的遗嘱条款",
      inheritanceAuthorization: {
        authorizationId: "inheritance-authorization:multi:forged-seat",
        kind: "knowledge",
        sourceRef: knowledgeRef,
        targetRef: knowledgeRef,
        scope: "acquireExactKnowledge",
      },
    })).resolves.toMatchObject({ kind: "rejected", code: "privateOrUnknownReference" });

    const sourcePrepared = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:inheritance:establish-source",
      characterId: predecessorId,
      text: "我在现场宣读前任留下的遗嘱，只授权取得银叶暗号。",
    }));
    const sourceProposal = {
      kind: "authenticatedCampaignAction",
      action: "establishInheritanceSource",
      rootActionId: sourcePrepared.rootActionId,
      inheritanceSourceKind: "will",
      publicClause: "仅将银叶暗号的含义交给继任者",
      inheritanceAuthorization: {
        authorizationId,
        kind: "knowledge",
        sourceRef: knowledgeRef,
        targetRef: knowledgeRef,
        scope: "acquireExactKnowledge",
      },
    };
    await expect(initialized.stub.commit(ALICE, sourcePrepared.preparedActionId, {
      ...structuredClone(sourceProposal),
      actorCharacterId: predecessorId,
      predecessorCharacterId: witnessId,
      successorCharacterId: witnessId,
    })).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "invalidMechanicalProposal" })],
    });
    const established = record(await initialized.stub.commit(
      ALICE,
      sourcePrepared.preparedActionId,
      sourceProposal,
    ), "exact inheritance source");
    expect(established.kind, JSON.stringify(established)).toBe("committed");

    const afterSource = readModel(await initialized.stub.observe(ALICE));
    expect(list(afterSource.knowledge, "knowledge before transfer")).toEqual([]);
    const sourceFact = list(afterSource.visibleFacts, "visible inheritance facts")
      .map((entry) => record(entry, "inheritance fact"))
      .find((entry) => entry.kind === "inheritanceSource");
    expect(sourceFact).toMatchObject({
      id: expect.stringMatching(/^fact:inheritance:/),
      subjectRefs: [predecessorId, successorId],
      value: {
        kind: "will",
        publicClause: "仅将银叶暗号的含义交给继任者",
      },
    });
    const sourceFactId = String(sourceFact?.id);
    expect(list(
      readModel(await initialized.stub.observe(BOB)).visibleFacts,
      "unrelated viewer inheritance facts",
    )).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceFactId }),
    ]));

    const transferPrepared = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:inheritance:transfer-exact-source",
      characterId: witnessId,
      text: "我依照已宣读的遗嘱取得这一条知识，不取得其他前任状态。",
    }));
    const transferProposal = {
      kind: "authenticatedCampaignAction",
      action: "transferInheritance",
      rootActionId: transferPrepared.rootActionId,
      inheritanceSourceFactRef: sourceFactId,
      inheritanceAuthorizationRef: authorizationId,
    };
    await expect(initialized.stub.commit(ALICE, transferPrepared.preparedActionId, {
      ...structuredClone(transferProposal),
      actorCharacterId: predecessorId,
      successorCharacterId: witnessId,
    })).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "invalidMechanicalProposal" })],
    });
    const transferred = record(await initialized.stub.commit(
      ALICE,
      transferPrepared.preparedActionId,
      transferProposal,
    ), "exact inheritance transfer");
    expect(transferred.kind, JSON.stringify(transferred)).toBe("committed");

    const inheritedRead = readModel(await initialized.stub.observe(ALICE));
    const inheritedKnowledge = list(inheritedRead.knowledge, "exact inherited knowledge");
    expect(inheritedKnowledge).toHaveLength(1);
    expect(record(inheritedKnowledge[0], "inherited knowledge")).toMatchObject({
      characterId: successorId,
      knowledgeRef,
      content: "银叶暗号指向旧王室密道",
      sourceCharacterId: predecessorId,
      provenanceChain: expect.arrayContaining([sourceFactId, authorizationId]),
    });
    expect(list(inheritedRead.relationships, "non-inherited relationships")).toEqual([]);
    expect(list(inheritedRead.promises, "non-inherited promises")).toEqual([]);
    expect(list(inheritedRead.debts, "non-inherited debts")).toEqual([]);

    const consumedPrepared = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:inheritance:cannot-reuse-authorization",
      characterId: successorId,
      text: "我试图再次使用同一项已经消费的继承授权。",
    }));
    await expect(initialized.stub.commit(ALICE, consumedPrepared.preparedActionId, {
      ...structuredClone(transferProposal),
      rootActionId: consumedPrepared.rootActionId,
    })).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({ code: "inheritanceAuthorizationConsumed" })],
    });
    expect(list(
      readModel(await initialized.stub.observe(ALICE)).knowledge,
      "knowledge after consumed authorization retry",
    )).toHaveLength(1);
  }, 15_000);

  it("revokes control after a fatal noncombat consequence submitted through a current typed Form", async () => {
    const characterId = "character:multi:fatal-hazard";
    const predecessor = campaignCharacter(characterId, ALICE.principal.id, 1);
    const initialized = await initialize("multiplayer-v2-fatal-noncombat-consequence", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        ...predecessor,
        staticCard: {
          ...predecessor.staticCard,
          sceneId: "wake",
        },
      }],
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    });

    const action = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:fatal-noncombat-consequence",
      characterId,
      text: "我扯断已经开裂的支索，让石梁按已冻结的范围危险坠落。",
    }));
    const fatal = record(await initialized.stub.commit(
      ALICE,
      action.preparedActionId,
      privateFormProposal(
        action.rootActionId,
        "environmental-stunt.v1",
        fatalAreaHazardDraft(),
        "proposal:multi:fatal-noncombat-consequence:1",
      ),
    ), "fatal noncombat consequence");
    expect(fatal.kind, JSON.stringify(fatal)).toBe("committed");

    expect(readModel(await initialized.stub.observe(ALICE))).toMatchObject({
      controlledCharacter: null,
      lifecycle: {
        kind: "successorRequired",
        defaultPredecessorCharacterId: characterId,
        eligiblePredecessors: [expect.objectContaining({
          characterId,
          tenureStatus: "dead",
        })],
      },
    });
    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:dead-predecessor-cannot-act",
      characterId,
      text: "我继续以已经死亡的前任行动。",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });
  });

  it("makes membership, Seat, host, and CharacterControl changes service-authoritative", async () => {
    const initialized = await initialize("multiplayer-v2-seat-lifecycle", {
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character("character:multi:alice", ALICE.principal.id)],
    });

    await expect(initialized.stub.applyRoomAdministration(ALICE, {
      commandId: "room-admin:forged-join",
      kind: "grantSeat",
      principal: BOB.principal,
    })).resolves.toMatchObject({ kind: "rejected", code: "roomAdministrationUnauthorized" });

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:join-bob",
      kind: "grantSeat",
      principal: BOB.principal,
      role: "player",
      character: character("character:multi:bob", BOB.principal.id),
    })).resolves.toMatchObject({ kind: "committed" });

    const bobRead = readModel(await initialized.stub.observe(BOB));
    expect(record(bobRead.controlledCharacter, "Bob character").characterId)
      .toBe("character:multi:bob");
    expect(list(bobRead.roomMembers, "public room members")).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalId: ALICE.principal.id, role: "host", seatStatus: "active" }),
      expect.objectContaining({ principalId: BOB.principal.id, role: "player", seatStatus: "active" }),
    ]));

    await expect(initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:multi:bob-forges-alice",
      characterId: "character:multi:alice",
      text: "我替爱丽丝行动。",
    })).resolves.toMatchObject({
      kind: "prepared",
      kpProjection: {
        actorProjection: {
          controlledCharacter: { characterId: "character:multi:bob" },
        },
      },
    });

    const pendingPrepared = prepared(await initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:multi:bob-pending",
      characterId: "character:multi:bob",
      text: "我检查两根外观相同的拉杆。",
    }));
    const pendingSource = record(await initialized.stub.commit(
      BOB,
      pendingPrepared.preparedActionId,
      privateFormProposal(pendingPrepared.rootActionId, "clarification.v1", {
        goal: "确认鲍勃要拉动哪一根拉杆",
        question: "你要拉警铃还是闸门？",
        choices: ["警铃", "闸门"],
      }, "submission:multi:bob-pending:proposal:1"),
    ), "Bob pending commit");
    expect(pendingSource.kind).toBe("awaitingInput");
    const pendingInputId = String(record(pendingSource.pending, "Bob pending").pendingInputId);

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:remove-bob",
      kind: "removeMember",
      principalId: BOB.principal.id,
      reason: "hostRemoved",
    })).resolves.toMatchObject({ kind: "committed" });
    await expect(initialized.stub.observe(BOB)).resolves.toMatchObject({
      kind: "rejected",
      code: "seatInactive",
    });
    await expect(initialized.stub.prepare(BOB, {
      kind: "answer",
      submissionId: "submission:multi:removed-answer",
      pendingInputId,
      answer: "gate",
    })).resolves.toMatchObject({ kind: "rejected" });

    await expect(initialized.stub.applyRoomAdministration(initialized.administration, {
      commandId: "room-admin:transfer-host",
      kind: "transferHost",
      fromPrincipalId: ALICE.principal.id,
      toPrincipalId: CHARLIE.principal.id,
    })).resolves.toMatchObject({ kind: "rejected", code: "targetSeatUnavailable" });
  });

  it("invalidates a prepared action when CharacterControl transfers to another active Seat", async () => {
    const characterId = "character:multi:control-transfer";
    const initialized = await initialize("multiplayer-v2-prepared-control-transfer", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [character(characterId, ALICE.principal.id)],
    });
    const frozen = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:prepared-before-transfer",
      characterId,
      text: "我准备检查神龛边缘的刻痕。",
    }));
    const proposal = observationProposal(frozen.rootActionId, {
      goal: "检查神龛边缘的刻痕",
      method: "沿神龛边缘辨认磨损",
      duration: { unit: "second", value: 1 },
      proposalAttemptId: "proposal:multi:prepared-before-transfer",
    });
    const raced = await runInDurableObject(initialized.stub as never, async (instance) => {
      const target = instance as unknown as MultiplayerAuthority & {
        authorityMechanicalInput(...args: unknown[]): Promise<unknown>;
      };
      const originalMechanicalInput = target.authorityMechanicalInput.bind(target);
      let releaseCommit!: () => void;
      let signalCommitPaused!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const commitPaused = new Promise<void>((resolve) => {
        signalCommitPaused = resolve;
      });
      let paused = false;
      target.authorityMechanicalInput = async (...args: unknown[]) => {
        if (!paused) {
          paused = true;
          signalCommitPaused();
          await commitGate;
        }
        return originalMechanicalInput(...args);
      };
      const oldControllerCommit = target.commit(
        ALICE,
        frozen.preparedActionId,
        structuredClone(proposal),
      );
      await commitPaused;
      const transfer = await target.applyRoomAdministration(initialized.administration, {
        commandId: "room-admin:transfer-prepared-character",
        kind: "transferControl",
        characterId,
        fromSeatId: `seat:${ALICE.principal.id}`,
        toSeatId: `seat:${BOB.principal.id}`,
      });
      releaseCommit();
      const commit = await oldControllerCommit;
      target.authorityMechanicalInput = originalMechanicalInput;
      return { commit, transfer };
    });
    expect(raced.transfer).toMatchObject({ kind: "committed" });
    expect(raced.commit).toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });
    await expect(initialized.stub.commit(
      ALICE,
      frozen.preparedActionId,
      structuredClone(proposal),
    )).resolves.toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });
    await expect(initialized.stub.commit(
      BOB,
      frozen.preparedActionId,
      structuredClone(proposal),
    )).resolves.toMatchObject({ kind: "rejected", code: "preparedActionUnauthorized" });

    const bobPrepared = prepared(await initialized.stub.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:multi:after-control-transfer",
      characterId,
      text: "我现在检查神龛边缘的刻痕。",
    }));
    expect(record(bobPrepared.kpProjection, "transferred KP projection")).toMatchObject({
      actorProjection: { controlledCharacter: { characterId } },
    });
  });

  it("keeps a stale prepared action invalid after CharacterControl transfers away and back", async () => {
    const characterId = "character:multi:control-round-trip";
    const initialized = await initialize("multiplayer-v2-prepared-control-round-trip", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [character(characterId, ALICE.principal.id)],
    });
    const frozen = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:prepared-before-control-round-trip",
      characterId,
      text: "我按原先看到的状态检查神龛边缘。",
    }));
    const proposal = observationProposal(frozen.rootActionId, {
      goal: "按已冻结现场检查神龛边缘",
      method: "沿神龛边缘辨认磨损",
      duration: { unit: "second", value: 1 },
      proposalAttemptId: "proposal:multi:control-round-trip",
    });
    const raced = await runInDurableObject(initialized.stub as never, async (instance) => {
      const target = instance as unknown as MultiplayerAuthority & {
        authorityMechanicalInput(...args: unknown[]): Promise<unknown>;
      };
      const originalMechanicalInput = target.authorityMechanicalInput.bind(target);
      let releaseCommit!: () => void;
      let signalCommitPaused!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const commitPaused = new Promise<void>((resolve) => {
        signalCommitPaused = resolve;
      });
      let paused = false;
      target.authorityMechanicalInput = async (...args: unknown[]) => {
        if (!paused) {
          paused = true;
          signalCommitPaused();
          await commitGate;
        }
        return originalMechanicalInput(...args);
      };
      const staleCommit = target.commit(
        ALICE,
        frozen.preparedActionId,
        structuredClone(proposal),
      );
      await commitPaused;
      const away = await target.applyRoomAdministration(initialized.administration, {
        commandId: "room-admin:round-trip-away",
        kind: "transferControl",
        characterId,
        fromSeatId: `seat:${ALICE.principal.id}`,
        toSeatId: `seat:${BOB.principal.id}`,
      });
      const back = await target.applyRoomAdministration(initialized.administration, {
        commandId: "room-admin:round-trip-back",
        kind: "transferControl",
        characterId,
        fromSeatId: `seat:${BOB.principal.id}`,
        toSeatId: `seat:${ALICE.principal.id}`,
      });
      releaseCommit();
      const commit = await staleCommit;
      target.authorityMechanicalInput = originalMechanicalInput;
      return { away, back, commit };
    });
    expect(raced.away).toMatchObject({ kind: "committed" });
    expect(raced.back).toMatchObject({ kind: "committed" });
    expect(raced.commit).toMatchObject({ kind: "rejected", code: "scopeConflict" });
    await expect(initialized.stub.commit(
      ALICE,
      frozen.preparedActionId,
      structuredClone(proposal),
    )).resolves.toMatchObject({ kind: "rejected", code: "scopeConflict" });
    await expect(initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:fresh-after-control-round-trip",
      characterId,
      text: "我按当前状态重新检查神龛边缘。",
    })).resolves.toMatchObject({ kind: "prepared" });
  });

  it("requires every member's consent for atomic group movement and lets one character atomically leave", async () => {
    const roomName = "multiplayer-v2-party-group";
    const initialized = await initialize(roomName, {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:multi:alice", ALICE.principal.id, "shrine"),
        character("character:multi:bob", BOB.principal.id, "shrine"),
      ],
    });

    const forged = prepared(await initialized.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:multi:forged-party-shape",
      text: "我邀请鲍勃同行。",
    }));
    await expect(initialized.stub.commit(ALICE, forged.preparedActionId, {
      kind: "authenticatedPartyAction",
      action: "inviteMember",
      targetCharacterId: "character:multi:bob",
      rootActionId: forged.rootActionId,
      injected: true,
    })).resolves.toMatchObject({ kind: "needsKp" });
    expect(list(readModel(await initialized.stub.observe(ALICE)).partyGroups, "groups after invalid shape"))
      .toEqual([]);

    const invitation = await commitAuthenticatedPartyAction(
      initialized.stub,
      ALICE,
      "submission:multi:invite-bob",
      "我邀请鲍勃同行。",
      {
        kind: "authenticatedPartyAction",
        action: "inviteMember",
        targetCharacterId: "character:multi:bob",
      },
    );
    expect(invitation.kind).toBe("awaitingInput");
    const invitePendingId = String(record(invitation.pending, "party invitation").pendingInputId);
    expect(list(readModel(await initialized.stub.observe(ALICE)).pendingInputs, "Alice pending"))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        pendingInputId: invitePendingId,
        access: "initiator",
        question: "等待对方回应同行邀请。",
      })]));
    expect(list(readModel(await initialized.stub.observe(BOB)).pendingInputs, "Bob pending"))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        pendingInputId: invitePendingId,
        access: "controller",
      })]));

    await expect(initialized.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:multi:forged-party-answer",
      pendingInputId: invitePendingId,
      answer: { accept: true },
    })).resolves.toMatchObject({ kind: "rejected", code: "pendingInputUnauthorized" });

    await expect(answerPending(
      room(roomName),
      BOB,
      "submission:multi:accept-party",
      invitePendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });

    const moveProposal = await commitAuthenticatedPartyAction(
      initialized.stub,
      ALICE,
      "submission:multi:group-move",
      "我组织同行者一起前往庭院。",
      {
        kind: "authenticatedPartyAction",
        action: "proposeMove",
        destinationSceneId: "yard",
        fictionTimeCostMicros: "60000000",
      },
    );
    expect(moveProposal.kind).toBe("awaitingInput");
    const movePendingId = String(record(moveProposal.pending, "group move pending").pendingInputId);
    expect(record(readModel(await initialized.stub.observe(ALICE)).controlledCharacter, "Alice before move").sceneId)
      .toBe("shrine");
    expect(record(readModel(await initialized.stub.observe(BOB)).controlledCharacter, "Bob before move").sceneId)
      .toBe("shrine");

    await expect(answerPending(
      initialized.stub,
      BOB,
      "submission:multi:accept-move",
      movePendingId,
      { accept: true },
    )).resolves.toMatchObject({ kind: "committed" });
    expect(record(readModel(await initialized.stub.observe(ALICE)).controlledCharacter, "Alice after move").sceneId)
      .toBe("yard");
    expect(record(readModel(await initialized.stub.observe(BOB)).controlledCharacter, "Bob after move").sceneId)
      .toBe("yard");

    await expect(commitAuthenticatedPartyAction(
      initialized.stub,
      BOB,
      "submission:multi:individual-move",
      "我独自进入地窖。",
      {
        kind: "authenticatedPartyAction",
        action: "moveIndividually",
        destinationSceneId: "cellar",
        fictionTimeCostMicros: "30000000",
      },
    )).resolves.toMatchObject({ kind: "committed" });
    const aliceAfterSplit = readModel(await initialized.stub.observe(ALICE));
    const bobAfterSplit = readModel(await initialized.stub.observe(BOB));
    expect(record(aliceAfterSplit.controlledCharacter, "Alice split location").sceneId).toBe("yard");
    expect(record(bobAfterSplit.controlledCharacter, "Bob split location").sceneId).toBe("cellar");
    expect(list(bobAfterSplit.partyGroups, "Bob groups")).toEqual([]);
  });

  it("keeps split-location fictional time and causal frontiers separate while spotlight stays within three beats", async () => {
    const initialized = await initialize("multiplayer-v2-time-frontier", {
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:multi:alice", ALICE.principal.id, "shrine"),
        character("character:multi:bob", BOB.principal.id, "yard"),
      ],
    });

    await expect(commitObservationIntent(
      initialized.stub,
      ALICE,
      "submission:multi:alice-two-minutes",
      "character:multi:alice",
      "我花两分钟仔细检查神龛。",
      { unit: "minute", value: 2 },
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(commitObservationIntent(
      initialized.stub,
      BOB,
      "submission:multi:bob-five-seconds",
      "character:multi:bob",
      "我花五秒确认院门是否上锁。",
      { unit: "second", value: 5 },
    )).resolves.toMatchObject({ kind: "committed" });

    const aliceRead = readModel(await initialized.stub.observe(ALICE));
    const bobRead = readModel(await initialized.stub.observe(BOB));
    expect(record(aliceRead.fictionTime, "Alice time").nowMicros).toBe("120000000");
    expect(record(bobRead.fictionTime, "Bob time").nowMicros).toBe("5000000");
    expect(record(aliceRead.causalFrontier, "Alice frontier").sceneId).toBe("shrine");
    expect(record(bobRead.causalFrontier, "Bob frontier").sceneId).toBe("yard");

    const ledger = record(aliceRead.spotlightLedger, "spotlight ledger");
    const aliceBeat = Number(record(ledger["character:multi:alice"], "Alice spotlight").decisionBeats);
    const bobBeat = Number(record(ledger["character:multi:bob"], "Bob spotlight").decisionBeats);
    expect(Math.abs(aliceBeat - bobBeat)).toBeLessThanOrEqual(3);

    const beforeDisconnect = structuredClone(bobRead);
    const reconnected = readModel(await room("multiplayer-v2-time-frontier").observe(
      BOB,
      { channel: "reconnect" },
    ));
    expect(reconnected.fictionTime).toEqual(beforeDisconnect.fictionTime);
    expect(reconnected.causalFrontier).toEqual(beforeDisconnect.causalFrontier);
    expect(reconnected.spotlightLedger).toEqual(beforeDisconnect.spotlightLedger);
  });
});
