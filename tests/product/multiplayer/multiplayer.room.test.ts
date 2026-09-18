/**
 * Room-side gate for SPEC 0007 §§1、2、3、4、5、6、7、8: membership, Seat, host
 * and CharacterControl changes are service-authoritative; a prepared action is
 * invalidated when control transfers and stays invalid after it transfers back;
 * group movement needs every member's consent; split locations keep fictional
 * time and causal frontiers separate while the spotlight stays bounded.
 *
 * The same file also carries SPEC 0008 lifecycle behaviour -- advancement,
 * chapter transition, retirement and a provenance-clean successor -- which is
 * why it is declared a gate for both.
 *
 * Rules-side behaviour for SPEC 0007 is gated by
 * tests/product/multiplayer/rules-multiplayer.test.mjs.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
  const { kind: _kind, ...command } = proposal;
  const action = prepared(await stub.prepare(context, { kind: "party", submissionId, command, displayText: text }));
  expect(action.resolutionMode).toBe("authorityDirect");
  return record(await stub.commit(
    context,
    action.preparedActionId,
    { kind: "authenticatedPartyAction", rootActionId: action.rootActionId },
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

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

describe("authoritative multiplayer room, group, time, and spotlight", () => {

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
});
