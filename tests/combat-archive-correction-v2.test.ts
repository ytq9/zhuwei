import { env } from "cloudflare:workers";
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
  principal: Object.freeze({ id: "principal:combat-archive:alice", sessionVersion: 1 }),
});
const PLAYER_CHARACTER_ID = "character:combat-archive:alice";
const ENCOUNTER_BASIS_REF = "fact:combat-archive:sentinel-challenge";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
  commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
};

type CombatRoom = {
  stub: Authority;
  archiveExport: unknown;
  disasterRecovery: unknown;
  correction: unknown;
  encounterId: string;
  enemyId: string;
  enemyKnowledgeRef: string;
  beforeEncounterReadModel: RecordValue;
  encounterReceipt: RecordValue;
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

function authority(name: string): Authority {
  return env.ROOMS.getByName(name) as unknown as Authority;
}

function encounterProposal(rootActionId: string, enemyId: string) {
  const encounterId = `encounter:${rootActionId}`;
  return {
    encounterId,
    enemyId,
    proposal: npcMechanicalEncounterProposal(rootActionId, {
      encounterRef: encounterId,
      sceneRef: "wake",
      causalBasisRefs: [ENCOUNTER_BASIS_REF],
      hostileEntityRefs: [enemyId],
      establishedEntryRefs: [enemyId],
      entries: [{
        entityId: enemyId,
        name: "铁门哨兵",
        definition: {
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
          abilities: [{
            definitionId: `ability:${rootActionId}:sentinel-spear`,
            revision: "1",
            rulesBasis: "srd5.1-2014",
            activation: { kind: "attack", actionGrant: "attack" },
            target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
            attack: { ability: "str", proficiency: true },
            damage: [{ type: "piercing", formula: "1d6+2" }],
          }],
        },
      }],
    }),
  };
}

async function initializeCombatRoom(name: string): Promise<CombatRoom> {
  const stub = authority(name);
  const enemyId = `enemy:${name}:sentinel`;
  const enemyVisibilityRef = `knowledge:${name}:sentinel-visible`;
  const enemyKnowledgeRef = `knowledge:${name}:sentinel-battle-order`;
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
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
        resources: { secondWind: 1 },
        equipped: { main: "longsword", armor: "chain" },
        backpack: [],
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
  }), "combat archive initialization");
  expect(initialized).toMatchObject({ created: true });
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  const beforeEncounterReadModel = record(
    record(await stub.observe(ALICE), "before encounter observation").readModel,
    "before encounter read model",
  );

  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${name}:encounter`,
    characterId: PLAYER_CHARACTER_ID,
    text: "我拔剑迎击铁门旁现身的哨兵。",
  }), "prepared encounter");
  const encounter = encounterProposal(String(prepared.rootActionId), enemyId);
  let committed = record(await stub.commit(
    ALICE,
    String(prepared.preparedActionId),
    encounter.proposal,
  ), "encounter commit");
  if (committed.kind === "awaitingInput") {
    const pending = record(committed.pending, "initiative tie pending");
    expect(pending.choiceKind, JSON.stringify(committed)).toBe("initiativeTieOrder");
    const orderedEntityIds = list(pending.orderedEntityIds, "initiative tie candidates")
      .map((entityId) => String(entityId));
    const tieAnswer = record(await stub.prepare(ALICE, {
      kind: "answer",
      submissionId: `submission:${name}:initiative-tie`,
      pendingInputId: String(pending.pendingInputId),
      answer: { orderedEntityIds },
    }), "initiative tie answer prepare");
    expect(tieAnswer.kind, JSON.stringify(tieAnswer)).toBe("prepared");
    committed = record(await stub.commit(ALICE, String(tieAnswer.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(tieAnswer.rootActionId),
    }), "initiative tie answer commit");
  }
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");

  return {
    stub,
    archiveExport: capabilities.archiveExport,
    disasterRecovery: capabilities.disasterRecovery,
    correction: capabilities.correction,
    encounterId: encounter.encounterId,
    enemyId: encounter.enemyId,
    enemyKnowledgeRef,
    beforeEncounterReadModel,
    encounterReceipt: record(committed.receipt, "encounter receipt"),
  };
}

async function commitNpcEndTurn(room: CombatRoom) {
  const planRef = `actor-plan:combat-archive:${room.encounterId}:end-turn`;
  const activityRef = `activity:combat-archive:${room.encounterId}:end-turn`;
  const traceFactRef = `fact:combat-archive:${room.encounterId}:end-turn`;
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
          nextStep: "结束自己的当前回合",
        },
      ),
      decideDueActorPlan: async () => {
        throw new Error("the newly formed NPC ActorPlan must execute on the next intent");
      },
      narrate: async () => ({ body: "哨兵正在判断是否结束当前回合。", agencyClaims: [] }),
    },
  }, {
    kind: "intent",
    submissionId: `submission:${room.encounterId}:form-npc-end-turn`,
    text: "我保持戒备，留意哨兵是否准备结束这一回合。",
  }), "NPC end-turn ActorPlan formation");
  expect(formed.kind, JSON.stringify(formed)).toBe("committed");

  const ended = record(await handleRoomAction({
    principal: ALICE,
    authority: room.stub,
    kp: {
      decideDueActorPlan: async (request: RecordValue) => executeNpcActorPlanDecision(
        String(request.rootActionId),
        {
          planRef,
          mechanicalProposal: {
            operation: "endCombatTurn",
            encounterRef: room.encounterId,
          },
        },
      ),
      propose: async (request: RecordValue) => observationProposal(
        String(request.rootActionId),
        {
          goal: "确认哨兵结束回合后的现场",
          method: "保持自己的决定不变，只确认已经发生的可见结果",
          publicBasisRefs: [ENCOUNTER_BASIS_REF],
          duration: { unit: "second", value: 1 },
        },
      ),
      narrate: async () => ({ body: "哨兵结束了当前回合。", agencyClaims: [] }),
    },
  }, {
    kind: "intent",
    submissionId: `submission:${room.encounterId}:execute-npc-end-turn`,
    text: "我保持自己的决定不变，观察哨兵结束这一回合。",
  }), "NPC end-turn ActorPlan outcome");
  expect(ended.kind, JSON.stringify(ended)).toBe("committed");
}

async function openTargetChoice(room: CombatRoom) {
  const openedReadModel = record(
    record(await room.stub.observe(ALICE), "opened encounter observation").readModel,
    "opened encounter read model",
  );
  const activeEncounter = record(
    record(openedReadModel.encounters, "opened encounters")[room.encounterId],
    "opened encounter",
  );
  if (activeEncounter.activeEntityId === room.enemyId) {
    await commitNpcEndTurn(room);
  } else {
    expect(activeEncounter.activeEntityId).toBe(PLAYER_CHARACTER_ID);
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
    submissionId: `submission:${room.encounterId}:melee-advance`,
    movementMode: "walk",
    spatialRevision: String(tactical.spatialRevision) as `sha256:${string}`,
    path: [
      structuredClone(playerPosition) as { x: string; y: string; elevation: string },
      { x: "-240", y: "-240", elevation: "0" },
    ],
  }), "player melee advance");
  expect(advanced.kind, JSON.stringify(advanced)).toBe("committed");

  const beforeAttack = record(await room.stub.observe(ALICE), "before attack observation");
  const controlled = record(
    record(beforeAttack.readModel, "before attack read model").controlledCharacter,
    "controlled character",
  );
  const definitions = Object.values(record(
    record(controlled.combat, "controlled combat projection").definitions,
    "ability definitions",
  )).map((entry) => record(entry, "ability definition"));
  const improvisedStrike = definitions.find((entry) => entry.mechanicalKey === "improvised-strike");
  expect(improvisedStrike).toBeDefined();

  const attackPrepared = record(await room.stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${room.encounterId}:target-choice`,
    characterId: PLAYER_CHARACTER_ID,
    text: "我挥剑攻击，但还没有决定要攻击谁。",
  }), "attack prepare");
  const attackRoot = String(attackPrepared.rootActionId);
  const attack = record(await room.stub.commit(
    ALICE,
    String(attackPrepared.preparedActionId),
    privateFormProposal(attackRoot, "combat-action.v1", {
      goal: "挥剑攻击当前敌人",
      method: "使用手中武器发动一次近战攻击",
      intendedOutcome: "命中所选敌人并结算伤害",
      combatApproach: "近战武器攻击",
      abilityRef: String(improvisedStrike!.definitionId),
    })), "attack pending");
  expect(attack.kind, JSON.stringify(attack)).toBe("awaitingInput");
  return {
    pending: record(attack.pending, "target pending"),
    receipt: record(attack.receipt, "target pending receipt"),
    beforeAttackReadModel: record(beforeAttack.readModel, "before attack read model"),
  };
}

function projectedPending(observation: unknown, pendingInputId: string): RecordValue {
  const readModel = record(record(observation, "observation").readModel, "read model");
  const pending = list(readModel.pendingInputs, "projected pending inputs")
    .map((entry) => record(entry, "projected pending input"))
    .find((entry) => entry.pendingInputId === pendingInputId);
  expect(pending, `pending ${pendingInputId}`).toBeDefined();
  return pending!;
}

function readModel(observation: unknown): RecordValue {
  return record(record(observation, "observation").readModel, "read model");
}

function combatView(readModelValue: RecordValue) {
  const controlled = record(readModelValue.controlledCharacter, "controlled character");
  return {
    controlledCombat: controlled.combat,
    entities: readModelValue.entities,
    encounters: readModelValue.encounters,
    story: readModelValue.story,
    pendingInputs: readModelValue.pendingInputs,
    fictionTime: readModelValue.fictionTime,
  };
}

describe("combat archive recovery and correction", () => {
  it("restores a combat target choice so reconnect can reject forgery and continue a legal answer", async () => {
    const source = await initializeCombatRoom("combat-archive-target-source");
    const targetChoice = await openTargetChoice(source);
    const opened = targetChoice.pending;
    const pendingInputId = String(opened.pendingInputId);
    const beforeArchive = projectedPending(await source.stub.observe(ALICE), pendingInputId);
    expect(beforeArchive).toMatchObject({
      kind: "combatChoice",
      choiceKind: "target",
      candidateEntityIds: [source.enemyId],
    });

    const exported = record(await source.stub.exportAuthoritativeArchive(
      source.archiveExport,
    ), "combat archive export");
    const target = authority("combat-archive-target-restored");
    await expect(target.restoreAuthoritativeArchive(
      source.disasterRecovery,
      structuredClone(exported.archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });

    expect(projectedPending(await target.observe(ALICE), pendingInputId)).toEqual(beforeArchive);

    const forgedPrepared = record(await target.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:combat-archive:forged-target",
      pendingInputId,
      answer: { kind: "selectTarget", targetEntityId: "enemy:not-a-candidate" },
    }), "forged answer prepare");
    expect(forgedPrepared.kind).toBe("prepared");
    await expect(target.commit(ALICE, String(forgedPrepared.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(forgedPrepared.rootActionId),
    })).resolves.toMatchObject({ kind: "rejected", code: "invalidRulesInput" });
    expect(projectedPending(await target.observe(ALICE), pendingInputId)).toEqual(beforeArchive);

    const legalPrepared = record(await target.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:combat-archive:legal-target",
      pendingInputId,
      answer: { kind: "selectTarget", targetEntityId: source.enemyId },
    }), "legal answer prepare");
    expect(legalPrepared.kind).toBe("prepared");
    await expect(target.commit(ALICE, String(legalPrepared.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(legalPrepared.rootActionId),
    })).resolves.toMatchObject({ kind: "committed" });
    const after = record(record(await target.observe(ALICE), "after legal answer").readModel, "read model");
    expect(list(after.pendingInputs, "remaining pending inputs"))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId })]));
  }, 30_000);

  it("corrects an encounter root to its complete pre-combat runtime and rebuilds that projection", async () => {
    const room = await initializeCombatRoom("combat-correction-encounter-source");
    const afterEncounter = readModel(await room.stub.observe(ALICE));
    expect(Object.keys(record(afterEncounter.encounters, "active encounters")))
      .toContain(room.encounterId);

    const correction = record(await room.stub.commitCorrection(room.correction, {
      correctionId: "correction:combat:encounter:1",
      receiptId: room.encounterReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "该遭遇不应开始；恢复遭遇、先攻、轮次、回合与待决前的完整运行态。",
    }), "encounter correction");
    expect(correction).toMatchObject({
      kind: "committed",
      strategy: "causalBranch",
      receipt: { status: "committed" },
    });

    const correctedReadModel = readModel(await room.stub.observe(ALICE));
    expect(combatView(correctedReadModel)).toEqual(combatView(room.beforeEncounterReadModel));
    expect(correctedReadModel.runtimeProfiles)
      .toEqual(room.beforeEncounterReadModel.runtimeProfiles);

    const exported = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "corrected encounter archive export");
    const restored = authority("combat-correction-encounter-restored");
    await expect(restored.restoreAuthoritativeArchive(
      room.disasterRecovery,
      structuredClone(exported.archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(readModel(await restored.observe(ALICE))).toEqual(correctedReadModel);
  }, 30_000);

  it("corrects a combat pending root and rebuilds the exact pre-choice turn state", async () => {
    const room = await initializeCombatRoom("combat-correction-pending-source");
    const targetChoice = await openTargetChoice(room);
    const pendingInputId = String(targetChoice.pending.pendingInputId);
    expect(projectedPending(await room.stub.observe(ALICE), pendingInputId)).toMatchObject({
      kind: "combatChoice",
      choiceKind: "target",
      candidateEntityIds: [room.enemyId],
    });
    const beforeCorrectionExport = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "pre-correction pending archive export");
    const pendingRootEventTypes = list(
      record(beforeCorrectionExport.archive, "pre-correction pending archive").events,
      "pre-correction events",
    )
      .map((entry) => record(entry, "pre-correction event"))
      .filter((entry) => entry.rootActionId === targetChoice.receipt.rootActionId)
      .map((entry) => entry.eventType);
    expect(pendingRootEventTypes).toContain("CombatPendingOpened");

    const correction = record(await room.stub.commitCorrection(room.correction, {
      correctionId: "correction:combat:pending:1",
      receiptId: targetChoice.receipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "该攻击待决不应打开；恢复候选、待决与当前回合改变之前的运行态。",
    }), "combat pending correction");
    expect(correction).toMatchObject({
      kind: "committed",
      strategy: "causalBranch",
      receipt: { status: "committed" },
    });

    const correctedReadModel = readModel(await room.stub.observe(ALICE));
    expect(combatView(correctedReadModel))
      .toEqual(combatView(targetChoice.beforeAttackReadModel));
    expect(correctedReadModel.runtimeProfiles)
      .toEqual(targetChoice.beforeAttackReadModel.runtimeProfiles);
    expect(list(correctedReadModel.pendingInputs, "corrected pending inputs"))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ pendingInputId })]));
    await expect(room.stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:combat-correction:stale-pending",
      pendingInputId,
      answer: { kind: "selectTarget", targetEntityId: room.enemyId },
    })).resolves.toMatchObject({ kind: "rejected", code: "pendingInputUnauthorized" });

    const exported = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "corrected pending archive export");
    const restored = authority("combat-correction-pending-restored");
    await expect(restored.restoreAuthoritativeArchive(
      room.disasterRecovery,
      structuredClone(exported.archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(readModel(await restored.observe(ALICE))).toEqual(correctedReadModel);
  }, 30_000);
});
