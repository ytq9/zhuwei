import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { productionActionPlanProposal } from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-room:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-room:bob", sessionVersion: 1 }),
});

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
  options: { includeSaveAbility?: boolean } = {},
) {
  const encounterId = `encounter:${rootActionId}`;
  const enemyId = `enemy:${rootActionId}:sentinel`;
  const enemySaveAbilityId = `ability:${rootActionId}:sentinel-cinder-burst`;
  const enemyDefinition = {
      entityId: `enemy:${rootActionId}:sentinel`,
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
      abilities: [
        {
          definitionId: `ability:${rootActionId}:sentinel-spear`,
          revision: "1",
          rulesBasis: "srd5.1-2014",
          activation: { kind: "attack", actionGrant: "attack" },
          target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
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
  const proposal = productionActionPlanProposal(rootActionId, {
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
      definition: enemyDefinition,
    }],
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
  const stub = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await stub.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      ...(options.transferSeat
        ? [{ principalId: BOB.principal.id, role: "player" as const }]
        : []),
    ],
    characters: [{
      characterId: "character:combat-room:alice",
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
        resources: options.concentrationCaster
          ? { secondWind: 1, slot1: 1 }
          : { secondWind: { current: 1, max: 1 } },
        equipped: { main: "longsword", armor: "chain-mail" },
        backpack: [{ itemId: "torch", quantity: 2 }],
        ...(options.concentrationCaster
          ? { classId: "ranger", level: 2, prepared: ["ensnaring"] }
          : {}),
      },
    }],
  }), "combat room initialization");
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${checkpoint}`,
    characterId: "character:combat-room:alice",
    text: "我拔剑迎击铁门旁现身的哨兵。",
  }), "prepared encounter");
  const encounter = encounterProposal(String(prepared.rootActionId), {
    includeSaveAbility: options.concentrationCaster === true,
  });
  return {
    stub,
    archiveExport: capabilities.archiveExport,
    roomAdministration: capabilities.roomAdministration,
    preparedActionId: String(prepared.preparedActionId),
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

async function preparedConcentrationAttack(scenario: string) {
  const room = await initializedRoom(`npc-save-damage-concentration-${scenario}`, {
    concentrationCaster: true,
  });
  const opened = record(
    await commitOpeningEncounterWithPlayerInitiative(room),
    "opened concentration encounter",
  );
  expect(opened.kind, JSON.stringify(opened)).toBe("committed");

  let submission = 0;
  const activeEntityId = async () => {
    const observed = record(await room.stub.observe(ALICE), "combat observation");
    const readModel = record(observed.readModel, "combat read model");
    const encounter = record(
      record(readModel.encounters, "active encounters")[room.encounterId],
      "active encounter",
    );
    return String(encounter.activeEntityId);
  };
  const prepareIntent = async (
    label: string,
    mechanicalProposal: RecordValue,
    options: {
      kind?: "directSuccess" | "highRiskFeasible";
      npcActions?: RecordValue[];
    } = {},
  ) => {
    submission += 1;
    const prepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: `submission:combat-room:concentration-${scenario}-${submission}`,
      characterId: "character:combat-room:alice",
      text: label,
    }), `${label} prepare`);
    return {
      preparedActionId: String(prepared.preparedActionId),
      proposal: productionActionPlanProposal(
        String(prepared.rootActionId),
        mechanicalProposal as never,
        {
          ...(options.kind === undefined ? {} : { kind: options.kind }),
          goal: label,
          method: label,
          npcActions: (options.npcActions ?? []) as never,
        },
      ) as RecordValue,
    };
  };
  const commitIntent = async (
    label: string,
    mechanicalProposal: RecordValue,
    options: {
      kind?: "directSuccess" | "highRiskFeasible";
      npcActions?: RecordValue[];
    } = {},
  ) => {
    const prepared = await prepareIntent(label, mechanicalProposal, options);
    return record(await room.stub.commit(
      ALICE,
      prepared.preparedActionId,
      structuredClone(prepared.proposal),
    ), `${label} commit`);
  };

  expect(await activeEntityId()).toBe("character:combat-room:alice");

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
  const cast = await commitIntent("施放诱捕打击并开始专注", {
    operation: "invokeCombatAction",
    abilityRef: String(ensnaring!.definitionId),
    targetEntityRef: "character:combat-room:alice",
  }, { kind: "highRiskFeasible" });
  expect(cast.kind, JSON.stringify(cast)).toBe("committed");

  const endedPlayerTurn = await commitIntent("明确结束自己的当前回合", {
    operation: "endCombatTurn",
    encounterRef: room.encounterId,
  });
  expect(endedPlayerTurn.kind, JSON.stringify(endedPlayerTurn)).toBe("committed");
  expect(await activeEntityId()).toBe(room.enemyId);

  const attackPrepared = await prepareIntent(
    "观察哨兵以火焰逼迫正在专注的阿莱莎作出豁免",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      npcActions: [{
        npcId: room.enemyId,
        goal: "以火焰逼迫正在专注的阿莱莎作出豁免",
        method: "使用权威豁免伤害能力攻击阿莱莎",
        knowledgeRefs: [],
        mechanicalProposal: {
          operation: "invokeCombatAction",
          abilityRef: room.enemySaveAbilityId,
          targetEntityRef: "character:combat-room:alice",
        },
      }],
    },
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
      const npcTurnPrepared = record(await room.stub.prepare(ALICE, {
        kind: "intent",
        submissionId: "submission:combat-room:observe-npc-turn",
        characterId: "character:combat-room:alice",
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
      await expect(room.stub.commit(
        ALICE,
        String(npcTurnPrepared.preparedActionId),
        npcTurn,
      )).resolves.toMatchObject({ kind: "committed" });
    } else {
      expect(openedEncounter.activeEntityId).toBe("character:combat-room:alice");
    }

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
    expect(resolved.kind).toBe("committed");
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
  });

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
      expect(cachedBeforeEviction.kind).toBe("committed");
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
    expect(attacked.kind, JSON.stringify(attacked)).toBe("committed");
    const receipt = record(attacked.receipt, "multi-wave receipt");
    const commitments = list(receipt.randomnessCommitments, "multi-wave commitments");
    expect(commitments).toHaveLength(3);
    expect(new Set(commitments.map((entry) => String(record(entry, "commitment").randomnessId))).size)
      .toBe(3);
    const projection = record(attacked.kpProjection, "multi-wave KP projection");
    const mechanics = record(projection.mechanicalResult, "multi-wave mechanics");
    expect(list(mechanics.randomness, "multi-wave faces")).toHaveLength(3);

    const retry = record(await room.stub.commit(
      ALICE,
      attackPrepared.preparedActionId,
      structuredClone(attackPrepared.proposal),
    ), "multi-wave response-lost retry");
    expect(retry.receipt).toEqual(receipt);
    expect(record(retry.kpProjection, "retry projection").mechanicalResult)
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
    });
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
    expect(left.kind, JSON.stringify(left)).toBe("committed");
    expect(right.kind, JSON.stringify(right)).toBe("committed");
    expect(right.receipt).toEqual(left.receipt);
    const leftMechanical = record(
      record(left.kpProjection, "left concurrent projection").mechanicalResult,
      "left concurrent mechanics",
    );
    const rightMechanical = record(
      record(right.kpProjection, "right concurrent projection").mechanicalResult,
      "right concurrent mechanics",
    );
    expect(rightMechanical).toEqual(leftMechanical);
    expect(list(leftMechanical.randomness, "concurrent multi-wave faces")).toHaveLength(3);
    const receipt = record(left.receipt, "concurrent multi-wave receipt");
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
  });

  it("returns an NPC target decision to KP for same-root revision without a half commit or automatic target", async () => {
    const room = await initializedRoom("npc-target-revision");
    const opened = record(await room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    ), "opened NPC-turn encounter");
    expect(opened.kind).toBe("committed");

    const openedObservation = record(await room.stub.observe(ALICE), "opened NPC-turn observation");
    const openedReadModel = record(openedObservation.readModel, "opened NPC-turn read model");
    const activeEncounter = record(
      record(openedReadModel.encounters, "opened NPC-turn encounters")[room.encounterId],
      "opened NPC-turn active encounter",
    );
    if (activeEncounter.activeEntityId === "character:combat-room:alice") {
      const endTurnPrepared = record(await room.stub.prepare(ALICE, {
        kind: "intent",
        submissionId: "submission:combat-room:alice-explicitly-ends-turn",
        characterId: "character:combat-room:alice",
        text: "我明确结束自己的当前回合，把决定权交给下一名战斗者。",
      }), "explicit end-turn prepare");
      const ended = record(await room.stub.commit(
        ALICE,
        String(endTurnPrepared.preparedActionId),
        productionActionPlanProposal(String(endTurnPrepared.rootActionId), {
          operation: "endCombatTurn",
          encounterRef: room.encounterId,
        }, {
          goal: "由玩家明确结束自己的当前回合",
          method: "结束回合且不替下一名战斗者选择行动",
        }),
      ), "explicit end-turn commit");
      expect(ended.kind, JSON.stringify(ended)).toBe("committed");
    } else {
      expect(activeEncounter.activeEntityId).toBe(room.enemyId);
    }

    const enemyId = room.enemyId;
    const abilityRef = String(record(
      list(record(room.enemyDefinition, "enemy").abilities, "enemy abilities")[0],
      "enemy ability",
    ).definitionId);
    const proposals: RecordValue[] = [];
    const proposal = (targetEntityRef?: string): RecordValue => ({
      kind: "directSuccess",
      goal: "保持戒备，同时让哨兵依自己所见采取行动",
      method: "阿莱莎稳住呼吸；哨兵根据战场视野决定刺击目标",
      publicBasisRefs: [],
      privateBasisRefs: [],
      risk: {
        warning: "敌方仍握有武器。",
        successConsequences: ["玩家资源变化并结算哨兵行动"],
        failureConsequences: [],
        retryGate: ["situationAdvanced"],
      },
      pendingInput: null,
      dynamicMaterializations: [],
      npcActions: [{
        npcId: enemyId,
        goal: "攻击眼前可见的敌对角色",
        method: "用长矛刺击自己能看见且合法的目标",
        knowledgeRefs: [],
        mechanicalProposal: {
          operation: "invokeCombatAction",
          abilityRef,
          ...(targetEntityRef === undefined ? {} : { targetEntityRef }),
        },
      }],
      mechanicalProposal: {
        operation: "changeResource",
        resourceRef: "secondWind",
        amount: -1,
      },
      scene: {
        question: "哨兵会攻击哪个自己能看见的合法目标？",
        pressure: "战斗仍在继续。",
        opportunities: [],
        conclusionCandidate: null,
      },
      proposalAttemptId: targetEntityRef === undefined
        ? "proposal:npc-target:1"
        : "proposal:npc-target:2",
    });

    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority: room.stub,
      kp: {
        propose: async (request: RecordValue) => {
          proposals.push(structuredClone(request));
          return proposal(proposals.length === 1 ? undefined : "character:combat-room:alice");
        },
        narrate: async () => ({ body: "哨兵依据眼前局势作出了明确选择。", agencyClaims: [] }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:combat-room:npc-target-revision",
      characterId: "character:combat-room:alice",
      text: "我稳住呼吸，观察哨兵接下来会怎么做。",
    }), "NPC target revision outcome");

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    expect(proposals).toHaveLength(2);
    expect(list(proposals[1].diagnostics, "KP revision diagnostics"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "kpDecisionRequired" })]));
    const receipt = record(outcome.receipt, "NPC revision receipt");
    expect(list(receipt.randomnessCommitments, "NPC attack commitments").length).toBeGreaterThan(0);

    const exported = record(await room.stub.exportAuthoritativeArchive(room.archiveExport), "archive export");
    const actionEvents = list(record(exported.archive, "archive").events, "events")
      .map((event) => record(event, "event"))
      .filter((event) => event.rootActionId === receipt.rootActionId);
    expect(actionEvents.filter((event) => event.eventType === "ResourceChanged")).toHaveLength(1);
    expect(actionEvents.filter((event) => event.eventType === "AbilityInvoked")).toHaveLength(1);
    expect(actionEvents.filter((event) => event.eventType === "CombatPendingOpened")).toHaveLength(0);
  });
});
