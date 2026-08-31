import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  executeNpcActorPlanDecision,
  npcActorPlanFormationProposal,
  npcMechanicalEncounterProposal,
  observationProposal,
  privateFormProposal,
} from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-room:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-room:bob", sessionVersion: 1 }),
});
const PLAYER_CHARACTER_ID = "character:combat-room:alice";
const ENCOUNTER_BASIS_REF = "fact:combat-room:sentinel-challenge";

const CHECKPOINTS = [
  "beforeRandomnessRequestCommit",
  "afterRandomnessRequestCommit",
  "afterRandomnessCandidateCommit",
  "afterOutcomeCommitBeforeResponse",
] as const;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
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

function encounterProposal(
  rootActionId: string,
  enemyId: string,
  options: { includeSaveAbility?: boolean } = {},
) {
  const encounterId = `encounter:${rootActionId}`;
  const enemySaveAbilityId = `ability:${rootActionId}:sentinel-cinder-burst`;
  const enemyDefinition = {
      entityId: enemyId,
      entityKind: "npc",
      name: "铁门哨兵",
      position: { x: "-180", y: "-240", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "60" },
      stats: { str: "14", dex: "20", con: "14", int: "8", wis: "10", cha: "8" },
      proficiencyBonus: "2",
      armorClass: "14",
      hitPoints: { current: "18", maximum: "18", temporary: "0" },
      speedInches: { walk: "360" },
      resources: {},
      deathPolicy: "defeatedAtZero",
      abilities: [
        {
          definitionId: `ability:${rootActionId}:sentinel-spear`,
          revision: "1",
          rulesBasis: "srd5.1-2014",
          activation: { kind: "attack", actionGrant: "attack" },
          target: { kind: "creature", count: "1", reachInches: "120", requiresSight: true },
          attack: { ability: "str", proficiency: true },
          damage: [{ type: "piercing", formula: "1d6+2" }],
        },
        ...(options.includeSaveAbility ? [{
          definitionId: enemySaveAbilityId,
          revision: "1",
          rulesBasis: "srd5.1-2014",
          activation: { kind: "action" },
          target: { kind: "creature", count: "1", rangeNormalInches: "2400", requiresSight: true },
          save: { ability: "dex", dc: "30", halfOnSuccess: true, onSuccess: "half" },
          damage: [{ type: "fire", formula: "1d4+1" }],
        }] : []),
      ],
  };
  const proposal = npcMechanicalEncounterProposal(rootActionId, {
    encounterRef: encounterId,
    sceneRef: "wake",
    causalBasisRefs: [ENCOUNTER_BASIS_REF],
    hostileEntityRefs: [enemyId],
    establishedEntryRefs: [enemyId],
    entries: [{ entityId: enemyId, name: "铁门哨兵", definition: enemyDefinition }],
  });
  return {
    proposal,
    encounterId,
    enemyId,
    enemySaveAbilityId,
    enemyDefinition,
  };
}

async function initializedRoom(
  checkpoint: string,
  options: { concentrationCaster?: boolean; transferSeat?: boolean } = {},
) {
  const roomId = `combat-room-randomness-v2-${checkpoint}`;
  const enemyId = `enemy:${roomId}:sentinel`;
  const enemyVisibilityRef = `knowledge:${roomId}:sentinel-visible`;
  const enemyKnowledgeRef = `knowledge:${roomId}:sentinel-battle-order`;
  const stub = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await stub.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      ...(options.transferSeat
        ? [{ principalId: BOB.principal.id, role: "player" as const }]
        : []),
    ],
    characters: [{
      characterId: PLAYER_CHARACTER_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        proficiency: 2,
        skills: ["athletics"],
        hp: { current: 20, max: 20, temp: 0 },
        ac: 15,
        speed: 30,
        resources: options.concentrationCaster
          ? { secondWind: 1, slot1: 1 }
          : { secondWind: 1 },
        equipped: { main: "longsword", armor: "chain" },
        backpack: [],
        ...(options.concentrationCaster
          ? { classId: "ranger", level: 2, prepared: ["ensnaring"] }
          : {}),
      },
    }],
    fixtureFacts: [{
      factRef: ENCOUNTER_BASIS_REF,
      kind: "establishedCommunicationChannel",
      participants: [PLAYER_CHARACTER_ID, enemyId],
    }, {
      knowledgeRef: enemyVisibilityRef,
      holderEntityId: enemyId,
      holderName: "铁门哨兵",
      sceneId: "wake",
      content: { observation: "铁门旁的哨兵清晰可见。" },
    }, {
      knowledgeRef: enemyKnowledgeRef,
      holderEntityId: enemyId,
      holderName: "铁门哨兵",
      sceneId: "wake",
      content: { order: "守住铁门，并按眼前战况采取自己的行动。" },
    }, {
      knowledgeRef: enemyVisibilityRef,
      holderEntityId: PLAYER_CHARACTER_ID,
      content: { observation: "铁门旁的哨兵清晰可见。" },
    }],
  }), "combat room initialization");
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${checkpoint}`,
    characterId: PLAYER_CHARACTER_ID,
    text: "我拔剑迎击铁门旁现身的哨兵。",
  }), "prepared encounter");
  const encounter = encounterProposal(String(prepared.rootActionId), enemyId, {
    includeSaveAbility: options.concentrationCaster === true,
  });
  return {
    stub,
    archiveExport: capabilities.archiveExport,
    roomAdministration: capabilities.roomAdministration,
    preparedActionId: String(prepared.preparedActionId),
    enemyKnowledgeRef,
    ...encounter,
  };
}

async function commitOpeningEncounterWithPlayerInitiative(room: {
  stub: Authority;
  preparedActionId: string;
  proposal: unknown;
}) {
  return runInDurableObject(room.stub as never, async (instance) => {
    const target = instance as unknown as {
      authorityRoll(sides: number): number;
      commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
    };
    const originalRoll = target.authorityRoll;
    const openingInitiativeFaces = [20, 1] as const;
    let rollIndex = 0;
    target.authorityRoll = (sides: number) => {
      expect(sides, "opening initiative die").toBe(20);
      const face = openingInitiativeFaces[rollIndex];
      if (face === undefined) {
        throw new Error("opening encounter requested unexpected extra randomness");
      }
      rollIndex += 1;
      return face;
    };
    try {
      const opened = await target.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      );
      expect(rollIndex, "opening initiative roll count").toBe(openingInitiativeFaces.length);
      return opened;
    } finally {
      target.authorityRoll = originalRoll;
    }
  });
}

type CombatRoom = Awaited<ReturnType<typeof initializedRoom>>;

async function prepareDueNpcAction(
  room: CombatRoom,
  suffix: string,
  label: string,
  mechanicalProposal: RecordValue,
  alternateTargetRef?: string,
) {
  const planRef = `actor-plan:combat-room:${suffix}`;
  const activityRef = `activity:combat-room:${suffix}`;
  const traceFactRef = `fact:combat-room:npc-action:${suffix}`;
  const formed = record(await handleRoomAction({
    principal: ALICE,
    authority: room.stub,
    kp: {
      propose: async (request: RecordValue) => npcActorPlanFormationProposal(
        String(request.rootActionId),
        {
          sceneRef: "wake",
          npcRef: room.enemyId,
          premiseKnowledgeRef: room.enemyKnowledgeRef,
          planRef,
          activityRef,
          traceFactRef,
          nextStep: label,
          ...(alternateTargetRef === undefined ? {} : { alternateTargetRef }),
        },
      ),
      decideDueActorPlan: async () => {
        throw new Error("a newly formed ActorPlan must execute on the next affected intent");
      },
      narrate: async () => ({ body: `哨兵正在判断是否${label}。`, agencyClaims: [] }),
    },
  }, {
    kind: "intent",
    submissionId: `submission:combat-room:form-npc-plan:${suffix}`,
    text: `我留意哨兵是否准备${label}。`,
  }), `${label} ActorPlan formation`);
  expect(formed.kind, JSON.stringify(formed)).toBe("committed");

  const prepared = record(await room.stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:combat-room:execute-npc-plan:${suffix}`,
    text: `我保持自己的决定不变，观察哨兵${label}。`,
  }), `${label} due ActorPlan prepare`);
  expect(prepared).toMatchObject({
    kind: "prepared",
    phase: "dueActorPlan",
  });
  const rootActionId = String(prepared.rootActionId);
  return {
    preparedActionId: String(prepared.preparedActionId),
    rootActionId,
    proposal: {
      ...executeNpcActorPlanDecision(rootActionId, {
        planRef,
        mechanicalProposal,
        ...(alternateTargetRef === undefined ? {} : { targetRef: alternateTargetRef }),
      }),
      rootActionId,
    } as RecordValue,
  };
}

async function commitNpcAction(
  room: CombatRoom,
  suffix: string,
  label: string,
  mechanicalProposal: RecordValue,
  alternateTargetRef?: string,
) {
  const prepared = await prepareDueNpcAction(
    room,
    suffix,
    label,
    mechanicalProposal,
    alternateTargetRef,
  );
  const continued = record(await room.stub.commit(
    ALICE,
    prepared.preparedActionId,
    structuredClone(prepared.proposal),
  ), `${label} due ActorPlan commit`);
  expect(continued).toMatchObject({
    kind: "continue",
    prepared: { phase: "playerIntent", preparedActionId: prepared.preparedActionId },
  });
  const completed = record(await room.stub.commit(
    ALICE,
    prepared.preparedActionId,
    observationProposal(prepared.rootActionId, {
      goal: `确认哨兵${label}后的现场`,
      method: "保持自己的决定不变，只确认已经发生的可见结果",
      publicBasisRefs: [ENCOUNTER_BASIS_REF],
      duration: { unit: "second", value: 1 },
    }),
  ), `${label} resumed player intent`);
  expect(completed.kind, JSON.stringify(completed)).toBe("committed");
  return { continued, completed };
}

async function commitPlayerCombatAction(
  room: CombatRoom,
  suffix: string,
  label: string,
  abilityRef: string,
  targetEntityId: string,
) {
  const prepared = record(await room.stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:combat-room:player-action:${suffix}`,
    text: label,
  }), `${label} prepare`);
  const rootActionId = String(prepared.rootActionId);
  const awaitingTarget = record(await room.stub.commit(
    ALICE,
    String(prepared.preparedActionId),
    privateFormProposal(rootActionId, "combat-action.v1", {
      goal: label,
      method: label,
      intendedOutcome: label,
      combatApproach: "使用已经投影给当前角色的明确能力",
      abilityRef,
    }),
  ), `${label} target selection`);
  expect(awaitingTarget).toMatchObject({
    kind: "awaitingInput",
    pending: {
      kind: "combatChoice",
      choiceKind: "target",
      candidateEntityIds: expect.arrayContaining([targetEntityId]),
    },
  });
  const pending = record(awaitingTarget.pending, `${label} target pending`);
  const answer = record(await room.stub.prepare(ALICE, {
    kind: "answer",
    submissionId: `submission:combat-room:player-target:${suffix}`,
    pendingInputId: String(pending.pendingInputId),
    answer: { kind: "selectTarget", targetEntityId },
  }), `${label} target answer prepare`);
  return record(await room.stub.commit(ALICE, String(answer.preparedActionId), {
    kind: "authenticatedPendingAnswer",
    rootActionId: String(answer.rootActionId),
  }), `${label} target answer commit`);
}

async function commitPlayerEndTurn(room: CombatRoom, suffix: string) {
  return record(await handleRoomAction({
    principal: ALICE,
    authority: room.stub,
    kp: {
      propose: async () => {
        throw new Error("structured combatEndTurn must not call KP");
      },
      narrate: async () => ({ body: "阿莱莎明确结束了自己的当前回合。", agencyClaims: [] }),
    },
  }, {
    kind: "combatEndTurn",
    submissionId: `submission:combat-room:end-player-turn:${suffix}`,
  }), "structured player end turn");
}

async function preparedConcentrationAttack(scenario: string) {
  const room = await initializedRoom(`npc-save-damage-concentration-${scenario}`, {
    concentrationCaster: true,
  });
  const opened = record(
    await commitOpeningEncounterWithPlayerInitiative(room),
    "opened concentration encounter",
  );
  expect(opened.kind, JSON.stringify(opened)).toBe("committed");

  const activeEntityId = async () => {
    const observed = record(await room.stub.observe(ALICE), "combat observation");
    const readModel = record(observed.readModel, "combat read model");
    const encounter = record(
      record(readModel.encounters, "active encounters")[room.encounterId],
      "active encounter",
    );
    return String(encounter.activeEntityId);
  };

  expect(await activeEntityId()).toBe(PLAYER_CHARACTER_ID);

  const beforeCast = record(await room.stub.observe(ALICE), "before concentration cast");
  const controlled = record(
    record(beforeCast.readModel, "before cast read model").controlledCharacter,
    "controlled character",
  );
  const definitions = Object.values(record(
    record(controlled.combat, "controlled combat").definitions,
    "combat definitions",
  )).map((definition) => record(definition, "combat definition"));
  const ensnaring = definitions.find((definition) => definition.mechanicalKey === "spell:ensnaring");
  expect(ensnaring).toBeDefined();
  const cast = await commitPlayerCombatAction(
    room,
    `concentration:${scenario}`,
    "施放诱捕打击并开始专注",
    String(ensnaring!.definitionId),
    PLAYER_CHARACTER_ID,
  );
  expect(cast.kind, JSON.stringify(cast)).toBe("committed");

  const endedPlayerTurn = await commitPlayerEndTurn(room, `concentration:${scenario}`);
  expect(endedPlayerTurn.kind, JSON.stringify(endedPlayerTurn)).toBe("committed");
  expect(await activeEntityId()).toBe(room.enemyId);

  const attackPrepared = await prepareDueNpcAction(
    room,
    `concentration-attack:${scenario}`,
    "观察哨兵以火焰逼迫正在专注的阿莱莎作出豁免",
    {
      operation: "invokeCombatAction",
      abilityRef: room.enemySaveAbilityId,
      targetEntityRef: PLAYER_CHARACTER_ID,
    },
    PLAYER_CHARACTER_ID,
  );
  return { room, attackPrepared };
}

describe("Room DO multi-request combat randomness", () => {
  it("defers CharacterControl transfer until a journaled randomness wave settles", async () => {
    const room = await initializedRoom("control-transfer-settlement-gate", {
      transferSeat: true,
    });
    const raced = await runInDurableObject(room.stub as never, async (instance) => {
      const target = instance as unknown as Authority & {
        authorityRecoveryCheckpoint?: (name: string) => void;
      };
      let signalRequestCommitted!: () => void;
      const requestCommitted = new Promise<void>((resolve) => {
        signalRequestCommitted = resolve;
      });
      let signaled = false;
      target.authorityRecoveryCheckpoint = (name) => {
        if (name === "afterRandomnessRequestCommit" && !signaled) {
          signaled = true;
          signalRequestCommitted();
        }
      };
      const openingCommit = target.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      );
      await requestCommitted;
      const command = {
        commandId: "room-admin:combat-randomness-control-transfer",
        kind: "transferControl",
        characterId: "character:combat-room:alice",
        fromSeatId: `seat:${ALICE.principal.id}`,
        toSeatId: `seat:${BOB.principal.id}`,
      };
      const blocked = await target.applyRoomAdministration(
        room.roomAdministration,
        structuredClone(command),
      );
      const settled = await openingCommit;
      const transferred = await target.applyRoomAdministration(
        room.roomAdministration,
        structuredClone(command),
      );
      delete target.authorityRecoveryCheckpoint;
      return { blocked, settled, transferred };
    });
    expect(raced.blocked).toMatchObject({
      kind: "retryableFailure",
      code: "roomAdministrationRandomnessSettlementPending",
    });
    expect(record(raced.settled, "settled opening combat").kind)
      .toMatch(/^(?:awaitingInput|committed)$/u);
    expect(raced.transferred).toMatchObject({ kind: "committed" });
  });

  for (const checkpoint of CHECKPOINTS) {
    it(`recovers a two-request initiative batch at ${checkpoint}`, async () => {
      const room = await initializedRoom(checkpoint);
      const harnessStub = room.stub as never;
      await expect(runInDurableObject(harnessStub, async (instance) => {
        const target = instance as unknown as {
          authorityRecoveryCheckpoint?: (name: string) => void;
          commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
        };
        target.authorityRecoveryCheckpoint = (name: string) => {
          if (name === checkpoint) throw new Error(`simulated-crash:${checkpoint}`);
        };
        return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
      })).rejects.toThrow(`simulated-crash:${checkpoint}`);

      await evictDurableObject(harnessStub);
      const recovered = record(await room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ), "recovered combat commit");
      expect(["committed", "awaitingInput"]).toContain(recovered.kind);
      const receipt = record(recovered.receipt, "combat receipt");
      expect(list(receipt.randomnessCommitments, "combat randomness commitments")).toHaveLength(2);
      const kpProjection = record(recovered.kpProjection, "combat KP projection");
      const mechanical = record(kpProjection.mechanicalResult, "combat mechanics");
      const randomness = list(mechanical.randomness, "combat randomness");
      expect(randomness).toHaveLength(2);
      expect(randomness.every((entry) => list(record(entry, "draw").faces, "faces").length === 1)).toBe(true);

      const responseLostRetry = record(await room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ), "response-lost retry");
      expect(responseLostRetry.receipt).toEqual(receipt);
      expect(record(responseLostRetry.kpProjection, "retry projection").mechanicalResult)
        .toEqual(mechanical);

      if (recovered.kind === "awaitingInput") {
        const pending = record(recovered.pending, "recovered initiative tie pending");
        expect(pending.choiceKind).toBe("initiativeTieOrder");
        const tiePrepared = record(await room.stub.prepare(ALICE, {
          kind: "answer",
          submissionId: `submission:combat-room:${checkpoint}:initiative-tie`,
          pendingInputId: String(pending.pendingInputId),
          answer: {
            orderedEntityIds: list(pending.orderedEntityIds, "recovered initiative tie order"),
          },
        }), "recovered initiative tie answer prepare");
        const tieCommitted = record(await room.stub.commit(
          ALICE,
          String(tiePrepared.preparedActionId),
          {
            kind: "authenticatedPendingAnswer",
            rootActionId: String(tiePrepared.rootActionId),
          },
        ), "recovered initiative tie answer commit");
        expect(tieCommitted.kind, JSON.stringify(tieCommitted)).toBe("committed");
      }

      const exported = record(await room.stub.exportAuthoritativeArchive(
        room.archiveExport,
      ), "combat archive export");
      const archive = record(exported.archive, "combat archive");
      const events = list(archive.events, "combat events").map((entry) => record(entry, "event"));
      const request = events.find((event) => event.eventType === "RandomnessRequested");
      const resolution = record(record(request?.payload, "request payload").resolution, "resolution");
      expect(list(resolution.randomnessRequests, "archived request batch")).toHaveLength(2);
      expect(events.filter((event) => event.eventType === "RoundStarted")).toHaveLength(1);
    });
  }

  it("keeps target choice pending, rejects a forged candidate, and resumes from the authenticated answer without KP", async () => {
    const room = await initializedRoom("target-pending");
    let opened = record(await room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    ), "opened encounter");
    if (opened.kind === "awaitingInput") {
      const pending = record(opened.pending, "target-pending initiative tie");
      const tiePrepared = record(await room.stub.prepare(ALICE, {
        kind: "answer",
        submissionId: "submission:combat-room:target-pending-initiative-tie",
        pendingInputId: String(pending.pendingInputId),
        answer: {
          orderedEntityIds: list(pending.orderedEntityIds, "target-pending tie order"),
        },
      }), "target-pending tie answer prepare");
      opened = record(await room.stub.commit(ALICE, String(tiePrepared.preparedActionId), {
        kind: "authenticatedPendingAnswer",
        rootActionId: String(tiePrepared.rootActionId),
      }), "target-pending tie answer commit");
    }
    expect(opened.kind).toBe("committed");

    const openedObservation = record(await room.stub.observe(ALICE), "opened encounter observation");
    const openedReadModel = record(openedObservation.readModel, "opened encounter read model");
    const openedEncounter = record(
      record(openedReadModel.encounters, "opened encounters")[room.encounterId],
      "opened active encounter",
    );
    if (openedEncounter.activeEntityId === room.enemyId) {
      await commitNpcAction(
        room,
        "target-pending:end-turn",
        "结束自己的当前回合",
        { operation: "endCombatTurn", encounterRef: room.encounterId },
      );
    } else {
      expect(openedEncounter.activeEntityId).toBe(PLAYER_CHARACTER_ID);
    }

    const beforeAdvance = record(await room.stub.observe(ALICE), "before melee advance");
    const beforeAdvanceReadModel = record(beforeAdvance.readModel, "before advance read model");
    const tactical = record(beforeAdvanceReadModel.tacticalProjection, "before advance tactical projection");
    const playerPosition = record(record(tactical.self, "player tactical self").position, "player position");
    const advanced = record(await handleRoomAction({
      principal: ALICE,
      authority: room.stub,
      kp: {
        propose: async () => {
          throw new Error("structured combat movement must not call KP");
        },
        narrate: async () => ({ body: "阿莱莎逼近到长剑可及的距离。", agencyClaims: [] }),
      },
    }, {
      kind: "movement",
      submissionId: "submission:combat-room:target-pending-advance",
      movementMode: "walk",
      spatialRevision: String(tactical.spatialRevision) as `sha256:${string}`,
      path: [
        structuredClone(playerPosition) as { x: string; y: string; elevation: string },
        { x: "-240", y: "-240", elevation: "0" },
      ],
    }), "player melee advance");
    expect(advanced.kind, JSON.stringify(advanced)).toBe("committed");

    const attackPrepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:combat-room:attack-without-target",
      characterId: "character:combat-room:alice",
      text: "我挥剑攻击，但还没有决定要攻击谁。",
    }), "attack prepare");
    const attackRoot = String(attackPrepared.rootActionId);
    const beforeAttack = record(await room.stub.observe(ALICE), "before attack observation");
    const beforeAttackReadModel = record(beforeAttack.readModel, "before attack read model");
    const controlled = record(beforeAttackReadModel.controlledCharacter, "controlled character");
    const combat = record(controlled.combat, "controlled combat projection");
    const definitions = Object.values(record(combat.definitions, "controlled ability definitions"))
      .map((definition) => record(definition, "ability definition"));
    const improvisedStrike = definitions.find((definition) =>
      definition.mechanicalKey === "improvised-strike");
    expect(improvisedStrike).toBeDefined();
    const attack = record(await room.stub.commit(
      ALICE,
      String(attackPrepared.preparedActionId),
      privateFormProposal(attackRoot, "combat-action.v1", {
        goal: "挥剑攻击当前敌人",
        method: "使用手中武器发动一次近战攻击",
        intendedOutcome: "命中玩家随后明确选择的当前合法目标",
        combatApproach: "使用手中武器发动一次近战攻击",
        abilityRef: String(improvisedStrike!.definitionId),
      }),
    ), "attack pending");
    expect(attack.kind, JSON.stringify(attack)).toBe("awaitingInput");
    const pending = record(attack.pending, "target pending");
    expect(pending.kind).toBe("combatChoice");
    expect(pending.choiceKind).toBe("target");
    const pendingInputId = String(pending.pendingInputId);
    const enemyId = room.enemyId;

    const forgedPrepared = record(await room.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:combat-room:forged-target",
      pendingInputId,
      answer: { kind: "selectTarget", targetEntityId: "enemy:not-a-candidate" },
    }), "forged answer prepare");
    expect(forgedPrepared.resolutionMode).toBe("authorityDirect");
    await expect(room.stub.commit(ALICE, String(forgedPrepared.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(forgedPrepared.rootActionId),
    })).resolves.toMatchObject({ kind: "rejected", code: "invalidRulesInput" });

    const answerPrepared = record(await room.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:combat-room:select-target",
      pendingInputId,
      answer: { kind: "selectTarget", targetEntityId: enemyId },
    }), "target answer prepare");
    expect(answerPrepared.resolutionMode).toBe("authorityDirect");
    const resolved = record(await room.stub.commit(ALICE, String(answerPrepared.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(answerPrepared.rootActionId),
    }), "target answer commit");
    expect(resolved.kind, JSON.stringify(resolved)).toBe("committed");
    expect(list(record(resolved.receipt, "answer receipt").randomnessCommitments, "attack commitments").length)
      .toBeGreaterThanOrEqual(2);
    const observed = record(await room.stub.observe(ALICE), "post-answer observation");
    const readModel = record(observed.readModel, "post-answer read model");
    expect(list(readModel.pendingInputs, "pending inputs"))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId })]));

    const exported = record(await room.stub.exportAuthoritativeArchive(room.archiveExport), "archive export");
    const eventTypes = list(record(exported.archive, "archive").events, "archive events")
      .map((event) => String(record(event, "event").eventType));
    expect(eventTypes).toEqual(expect.arrayContaining([
      "CombatPendingOpened",
      "CombatPendingClosed",
      "AbilityInvoked",
    ]));
  }, 30_000);

  for (const recoveryCase of [
    { checkpoint: "beforeRandomnessRequestCommit", crashOnHit: 2 },
    { checkpoint: "afterRandomnessRequestCommit", crashOnHit: 2 },
    { checkpoint: "afterRandomnessCandidateCommit", crashOnHit: 2 },
    { checkpoint: "afterOutcomeCommitBeforeResponse", crashOnHit: 1 },
  ] as const) {
    const multiWaveCheckpoint = recoveryCase.checkpoint;
    it(`recovers NPC save damage followed by a concentration-save wave at ${multiWaveCheckpoint}`, async () => {
    const { room, attackPrepared } = await preparedConcentrationAttack(multiWaveCheckpoint);
    let checkpointHits = 0;
    let archiveGenerationBefore: number | undefined;
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance, state) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        authorityStore: {
          archiveProgress(): { pending: boolean; generation: number } | undefined;
        };
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      if (multiWaveCheckpoint === "afterOutcomeCommitBeforeResponse") {
        archiveGenerationBefore = target.authorityStore.archiveProgress()?.generation;
        await state.storage.deleteAlarm();
      }
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name !== multiWaveCheckpoint) return;
        checkpointHits += 1;
        if (checkpointHits === recoveryCase.crashOnHit) {
          throw new Error(`simulated-second-wave-crash:${multiWaveCheckpoint}`);
        }
      };
      return target.commit(
        ALICE,
        attackPrepared.preparedActionId,
        structuredClone(attackPrepared.proposal),
      );
    })).rejects.toThrow(`simulated-second-wave-crash:${multiWaveCheckpoint}`);
    expect(checkpointHits).toBe(recoveryCase.crashOnHit);
    if (multiWaveCheckpoint !== "afterOutcomeCommitBeforeResponse") {
      await expect(room.stub.exportAuthoritativeArchive(room.archiveExport)).resolves.toMatchObject({
        kind: "retryableFailure",
        code: "archiveSettlementPending",
      });
    }
    if (multiWaveCheckpoint === "afterOutcomeCommitBeforeResponse") {
      expect(archiveGenerationBefore).toBeTypeOf("number");
      const afterCrash = await runInDurableObject(harnessStub, async (instance, state) => {
        const target = instance as unknown as {
          authorityStore: {
            archiveProgress(): { pending: boolean; generation: number } | undefined;
          };
        };
        return {
          progress: target.authorityStore.archiveProgress(),
          alarm: await state.storage.getAlarm(),
        };
      });
      expect(afterCrash.progress).toMatchObject({
        pending: true,
        generation: archiveGenerationBefore! + 3,
      });
      expect(afterCrash.alarm).toBeNull();

      const cachedBeforeEviction = record(await room.stub.commit(
        ALICE,
        attackPrepared.preparedActionId,
        structuredClone(attackPrepared.proposal),
      ), "cached outcome archive resume");
      expect(cachedBeforeEviction).toMatchObject({
        kind: "continue",
        prepared: { phase: "playerIntent", preparedActionId: attackPrepared.preparedActionId },
      });
      const resumedArchive = await runInDurableObject(harnessStub, async (instance, state) => {
        const target = instance as unknown as {
          authorityStore: {
            archiveProgress(): { pending: boolean; generation: number } | undefined;
          };
        };
        return {
          progress: target.authorityStore.archiveProgress(),
          alarm: await state.storage.getAlarm(),
        };
      });
      expect(resumedArchive.progress?.pending).toBe(true);
      expect(resumedArchive.alarm).not.toBeNull();
      await runInDurableObject(harnessStub, async (_instance, state) => {
        await state.storage.deleteAlarm();
      });
    }
    await evictDurableObject(harnessStub);

    if (multiWaveCheckpoint === "afterOutcomeCommitBeforeResponse") {
      const repairedArchive = await runInDurableObject(harnessStub, async (instance, state) => {
        const target = instance as unknown as {
          authorityStore: {
            archiveProgress(): { pending: boolean; generation: number } | undefined;
          };
        };
        return {
          progress: target.authorityStore.archiveProgress(),
          alarm: await state.storage.getAlarm(),
        };
      });
      expect(repairedArchive.progress?.pending).toBe(true);
      expect(repairedArchive.alarm).not.toBeNull();
    }

    const attacked = record(await room.stub.commit(
      ALICE,
      attackPrepared.preparedActionId,
      structuredClone(attackPrepared.proposal),
    ), "recovered multi-wave attack");
    expect(attacked).toMatchObject({
      kind: "continue",
      prepared: { phase: "playerIntent", preparedActionId: attackPrepared.preparedActionId },
    });
    const attackedPrepared = record(attacked.prepared, "recovered multi-wave prepared stage");
    const receipt = record(attackedPrepared.receipt, "multi-wave receipt");
    const commitments = list(receipt.randomnessCommitments, "multi-wave commitments");
    expect(commitments).toHaveLength(3);
    expect(new Set(commitments.map((entry) => String(record(entry, "commitment").randomnessId))).size)
      .toBe(3);
    const projection = record(attackedPrepared.kpProjection, "multi-wave KP projection");
    const mechanics = record(projection.mechanicalResult, "multi-wave mechanics");
    expect(list(mechanics.randomness, "multi-wave faces")).toHaveLength(3);

    const retry = record(await room.stub.commit(
      ALICE,
      attackPrepared.preparedActionId,
      structuredClone(attackPrepared.proposal),
    ), "multi-wave response-lost retry");
    const retryPrepared = record(retry.prepared, "multi-wave retry prepared stage");
    expect(retryPrepared.receipt).toEqual(receipt);
    expect(record(retryPrepared.kpProjection, "retry projection").mechanicalResult)
      .toEqual(mechanics);

    const exported = record(await room.stub.exportAuthoritativeArchive(room.archiveExport), "multi-wave archive");
    const events = list(record(exported.archive, "archive").events, "archive events")
      .map((event) => record(event, "archive event"))
      .filter((event) => event.rootActionId === receipt.rootActionId);
    expect(events.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(2);
    expect(events.filter((event) => event.eventType === "DamagePacketResolved")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "ConcentrationTested")).toHaveLength(1);
    expect(receipt.eventRange).toEqual(expect.objectContaining({
      first: events[0].eventSeq,
      last: events[events.length - 1].eventSeq,
    }));
    }, 60_000);
  }

  it("gives concurrent duplicate multi-wave commits the same Receipt and faces", async () => {
    const { room, attackPrepared } = await preparedConcentrationAttack("concurrent-duplicate");
    const concurrent = await runInDurableObject(room.stub as never, async (instance) => {
      const target = instance as unknown as {
        authorityRandomnessJournalRequest(value: unknown): Promise<unknown>;
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalJournalRequest = target.authorityRandomnessJournalRequest.bind(target);
      let journalRequestCalls = 0;
      let releaseSlow!: () => void;
      let signalSlowPaused!: () => void;
      const slowGate = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      const slowPaused = new Promise<void>((resolve) => {
        signalSlowPaused = resolve;
      });
      target.authorityRandomnessJournalRequest = async (value: unknown) => {
        journalRequestCalls += 1;
        if (journalRequestCalls === 1) {
          signalSlowPaused();
          await slowGate;
        }
        return originalJournalRequest(value);
      };

      let candidateHits = 0;
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name !== "afterRandomnessCandidateCommit") return;
        candidateHits += 1;
        if (candidateHits === 2) {
          releaseSlow();
          throw new Error("simulated-fast-call-crash-after-two-waves");
        }
      };
      const slow = target.commit(
        ALICE,
        attackPrepared.preparedActionId,
        structuredClone(attackPrepared.proposal),
      );
      await slowPaused;
      const fast = target.commit(
        ALICE,
        attackPrepared.preparedActionId,
        structuredClone(attackPrepared.proposal),
      ).catch((error: unknown) => {
        expect(error).toEqual(new Error("simulated-fast-call-crash-after-two-waves"));
        return target.commit(
          ALICE,
          attackPrepared.preparedActionId,
          structuredClone(attackPrepared.proposal),
        );
      });
      const [leftValue, rightValue] = await Promise.all([slow, fast]);
      return { leftValue, rightValue, candidateHits };
    });
    expect(concurrent.candidateHits).toBe(2);
    const { leftValue, rightValue } = concurrent;
    const left = record(leftValue, "left concurrent multi-wave commit");
    const right = record(rightValue, "right concurrent multi-wave commit");
    expect(left.kind, JSON.stringify(left)).toBe("continue");
    expect(right.kind, JSON.stringify(right)).toBe("continue");
    const leftPrepared = record(left.prepared, "left concurrent prepared stage");
    const rightPrepared = record(right.prepared, "right concurrent prepared stage");
    expect(rightPrepared.receipt).toEqual(leftPrepared.receipt);
    const leftMechanical = record(
      record(leftPrepared.kpProjection, "left concurrent projection").mechanicalResult,
      "left concurrent mechanics",
    );
    const rightMechanical = record(
      record(rightPrepared.kpProjection, "right concurrent projection").mechanicalResult,
      "right concurrent mechanics",
    );
    expect(rightMechanical).toEqual(leftMechanical);
    expect(list(leftMechanical.randomness, "concurrent multi-wave faces")).toHaveLength(3);
    const receipt = record(leftPrepared.receipt, "concurrent multi-wave receipt");
    expect(list(receipt.randomnessCommitments, "concurrent multi-wave commitments"))
      .toHaveLength(3);

    const exported = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "concurrent multi-wave archive");
    const events = list(record(exported.archive, "archive").events, "archive events")
      .map((event) => record(event, "archive event"))
      .filter((event) => event.rootActionId === receipt.rootActionId);
    expect(events.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(2);
    expect(events.filter((event) => event.eventType === "DamagePacketResolved")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "ConcentrationTested")).toHaveLength(1);
  }, 60_000);

  it("returns an NPC target decision to KP for same-root revision without a half commit or automatic target", async () => {
    const room = await initializedRoom("npc-target-revision");
    const opened = record(
      await commitOpeningEncounterWithPlayerInitiative(room),
      "opened NPC-turn encounter",
    );
    expect(opened.kind).toBe("committed");

    const openedObservation = record(await room.stub.observe(ALICE), "opened NPC-turn observation");
    const openedReadModel = record(openedObservation.readModel, "opened NPC-turn read model");
    const activeEncounter = record(
      record(openedReadModel.encounters, "opened NPC-turn encounters")[room.encounterId],
      "opened NPC-turn active encounter",
    );
    if (activeEncounter.activeEntityId === PLAYER_CHARACTER_ID) {
      const ended = await commitPlayerEndTurn(room, "npc-target-revision");
      expect(ended.kind, JSON.stringify(ended)).toBe("committed");
    } else {
      expect(activeEncounter.activeEntityId).toBe(room.enemyId);
    }

    const abilityRef = String(record(
      list(record(room.enemyDefinition, "enemy").abilities, "enemy abilities")[0],
      "enemy ability",
    ).definitionId);
    const due = await prepareDueNpcAction(
      room,
      "npc-target-revision",
      "用长矛刺击自己能看见且合法的目标",
      { operation: "invokeCombatAction", abilityRef },
      PLAYER_CHARACTER_ID,
    );
    const firstDecision = structuredClone(due.proposal);
    delete firstDecision.targetRef;
    const firstAttempt = record(await room.stub.commit(
      ALICE,
      due.preparedActionId,
      firstDecision,
    ), "NPC target decision request");
    expect(firstAttempt.kind, JSON.stringify(firstAttempt)).toBe("needsKp");
    expect(list(firstAttempt.diagnostics, "KP revision diagnostics"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "kpDecisionRequired" })]));

    const beforeRevision = record(
      await room.stub.exportAuthoritativeArchive(room.archiveExport),
      "archive before NPC target revision",
    );
    const beforeRevisionEvents = list(
      record(beforeRevision.archive, "archive before revision").events,
      "events before revision",
    ).map((event) => record(event, "event before revision"));
    expect(beforeRevisionEvents.filter((event) =>
      event.eventType === "NpcActionCommitted"
      && record(event.payload, "NPC action payload before revision").planId
        === record(due.proposal, "due proposal").planId
    )).toHaveLength(0);
    expect(beforeRevisionEvents.filter((event) => event.eventType === "AbilityInvoked"))
      .toHaveLength(0);

    const secondDecision = {
      ...structuredClone(due.proposal),
      mechanicalProposal: {
        operation: "invokeCombatAction",
        abilityRef,
        targetEntityRef: PLAYER_CHARACTER_ID,
      },
    };
    const continued = record(await room.stub.commit(
      ALICE,
      due.preparedActionId,
      secondDecision,
    ), "revised NPC target decision");
    expect(continued, JSON.stringify(continued)).toMatchObject({
      kind: "continue",
      prepared: { phase: "playerIntent", preparedActionId: due.preparedActionId },
    });
    const continuedPrepared = record(continued.prepared, "revised NPC prepared stage");
    const receipt = record(continuedPrepared.receipt, "NPC revision receipt");
    expect(list(receipt.randomnessCommitments, "NPC attack commitments").length).toBeGreaterThan(0);

    const outcome = record(await room.stub.commit(
      ALICE,
      due.preparedActionId,
      observationProposal(due.rootActionId, {
        goal: "确认哨兵明确目标后的攻击结果",
        method: "保持自己的决定不变，只观察已经发生的攻击",
        publicBasisRefs: [ENCOUNTER_BASIS_REF],
        duration: { unit: "second", value: 1 },
      }),
    ), "resumed player observation after NPC revision");
    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");

    const exported = record(await room.stub.exportAuthoritativeArchive(room.archiveExport), "archive export");
    const actionEvents = list(record(exported.archive, "archive").events, "events")
      .map((event) => record(event, "event"))
      .filter((event) => event.rootActionId === receipt.rootActionId);
    expect(actionEvents.filter((event) => event.eventType === "NpcActionCommitted")).toHaveLength(1);
    expect(actionEvents.filter((event) => event.eventType === "ResourceChanged")).toHaveLength(0);
    expect(actionEvents.filter((event) => event.eventType === "AbilityInvoked")).toHaveLength(1);
    expect(actionEvents.filter((event) => event.eventType === "CombatPendingOpened")).toHaveLength(0);
    const afterRevision = record(await room.stub.observe(ALICE), "post-revision observation");
    expect(record(
      record(afterRevision.readModel, "post-revision read model").controlledCharacter,
      "post-revision controlled character",
    )).toMatchObject({ resources: { secondWind: 1 } });
  }, 60_000);
});
