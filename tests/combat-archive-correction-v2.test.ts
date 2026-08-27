import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { productionActionPlanProposal } from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-archive:alice", sessionVersion: 1 }),
});

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

function encounterProposal(rootActionId: string) {
  const encounterId = `encounter:${rootActionId}`;
  const enemyId = `enemy:${rootActionId}:sentinel`;
  return {
    encounterId,
    enemyId,
    proposal: productionActionPlanProposal(rootActionId, {
      operation: "startCombat",
      encounterRef: encounterId,
      targetEntityRefs: [enemyId],
    }, {
      kind: "highRiskFeasible",
      goal: "拔剑迎击铁门旁现身的哨兵",
      method: "进入敌对遭遇并按权威先攻决定行动顺序",
      dynamicMaterializations: [{
        kind: "enemy",
        factRef: `fact:${rootActionId}:sentinel-appears`,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: {
          entityId: enemyId,
          entityKind: "npc",
          name: "铁门哨兵",
          position: { x: "60", y: "0", elevation: "0" },
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
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: "character:combat-archive:alice",
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "yard",
        scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        proficiency: 2,
        skills: ["athletics"],
        hp: { current: 20, max: 20, temp: 0 },
        ac: 15,
        speed: 30,
        resources: { secondWind: { current: 1, max: 1 } },
        equipped: { main: "longsword", armor: "chain-mail" },
        backpack: [{ itemId: "torch", quantity: 2 }],
      },
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
    characterId: "character:combat-archive:alice",
    text: "我拔剑迎击铁门旁现身的哨兵。",
  }), "prepared encounter");
  const encounter = encounterProposal(String(prepared.rootActionId));
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
    beforeEncounterReadModel,
    encounterReceipt: record(committed.receipt, "encounter receipt"),
  };
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
    const npcTurnPrepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: `submission:${room.encounterId}:npc-turn`,
      characterId: "character:combat-archive:alice",
      text: "我保持戒备，观察抢先行动的哨兵结束这一回合。",
    }), "NPC turn prepare");
    const npcTurn = productionActionPlanProposal(String(npcTurnPrepared.rootActionId), {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    }, {
      goal: "保持戒备并观察哨兵完成当前回合",
      method: "不替玩家行动，只让 KP 控制的哨兵结束自己的当前回合",
      npcActions: [{
        npcId: room.enemyId,
        goal: "结束当前哨兵回合",
        method: "哨兵没有可执行的更优行动，结束自己的当前回合",
        knowledgeRefs: [],
        mechanicalProposal: {
          operation: "endCombatTurn",
          encounterRef: room.encounterId,
        },
      }],
    });
    const npcTurnOutcome = record(await room.stub.commit(
      ALICE,
      String(npcTurnPrepared.preparedActionId),
      npcTurn,
    ), "NPC turn commit");
    expect(npcTurnOutcome.kind, JSON.stringify(npcTurnOutcome)).toBe("committed");
  } else {
    expect(activeEncounter.activeEntityId).toBe("character:combat-archive:alice");
  }

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
    characterId: "character:combat-archive:alice",
    text: "我挥剑攻击，但还没有决定要攻击谁。",
  }), "attack prepare");
  const attackRoot = String(attackPrepared.rootActionId);
  const attack = record(await room.stub.commit(ALICE, String(attackPrepared.preparedActionId), {
    kind: "checkRequired",
    rootActionId: attackRoot,
    goal: "挥剑攻击当前敌人",
    method: "使用手中武器发动一次近战攻击",
    publicBasisRefs: [],
    privateBasisRefs: [],
    risk: {
      warning: "必须由玩家明确选择一个当前合法目标。",
      successConsequences: ["攻击命中时结算伤害"],
      failureConsequences: ["攻击未命中且行动仍会消耗"],
      retryGate: ["situationAdvanced"],
    },
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal: {
      operation: "invokeCombatAction",
      abilityRef: String(improvisedStrike!.definitionId),
    },
    scene: {
      question: "阿莱莎要攻击哪一个当前合法目标？",
      pressure: "战斗仍在继续。",
      opportunities: [],
      conclusionCandidate: null,
    },
  }), "attack pending");
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
  });

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
  });

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
  });
});
