import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { productionActionPlanProposal } from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-vertical:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:combat-vertical:bob", sessionVersion: 1 }),
});
const ALICE_ID = "character:combat-vertical:alice";
const BOB_ID = "character:combat-vertical:bob";
const ENEMY_ID = "enemy:combat-vertical:sentinel";
const ENCOUNTER_ID = "encounter:combat-vertical:gate";
const HAZARD_FACT_ID = "fact:combat-vertical:unstable-brazier";
const ENEMY_ATTACK_ID = "ability:combat-vertical:sentinel-bolt";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
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

function character(characterId: string, controllerPrincipalId: string, name: string) {
  const alice = characterId === ALICE_ID;
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "yard",
      abilityScores: alice
        ? { str: 14, dex: 14, con: 14, int: 10, wis: 18, cha: 10 }
        : { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      hp: { current: alice ? 13 : 17, max: 20, temp: 0 },
      ac: 14,
      speed: 30,
      ...(alice ? {
        classId: "ranger",
        level: 2,
        prepared: ["ensnaring"],
        resources: { slot1: 1 },
      } : {}),
    },
  };
}

function sentinelDefinition() {
  return {
    entityId: ENEMY_ID,
    entityKind: "npc",
    name: "铁门哨兵",
    position: { x: "120", y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "1", dex: "30", con: "14", int: "8", wis: "10", cha: "8" },
    proficiencyBonus: "9",
    armorClass: "14",
    hitPoints: { current: "18", maximum: "18", temporary: "0" },
    speedInches: { walk: "360" },
    resources: {},
    deathPolicy: "defeatedAtZero",
    abilities: [{
      definitionId: ENEMY_ATTACK_ID,
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: { kind: "action" },
      target: { kind: "creature", count: "1", rangeNormalInches: "2400", requiresSight: true },
      save: { ability: "dex", dc: "30", halfOnSuccess: true, onSuccess: "half" },
      damage: [{ type: "piercing", formula: "1d4+1" }],
    }],
  };
}

describe("B53 natural-language combat vertical slice", () => {
  it("enters one multiplayer Encounter through Room Action and exposes only the viewer projection", async () => {
    const roomId = "combat-vertical-v2-natural-language-entry";
    let authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    }), "room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");
    const requests: RecordValue[] = [];
    const intentText = "我提醒博林避开摇晃的火盆，然后一起拔剑迎击铁门哨兵。";

    let outcome = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: RecordValue) => {
          requests.push(structuredClone(request));
          const rootActionId = String(request.rootActionId);
          return productionActionPlanProposal(rootActionId, {
            operation: "startCombat",
            encounterRef: ENCOUNTER_ID,
            memberRefs: [BOB_ID],
            targetEntityRefs: [ENEMY_ID],
          }, {
            kind: "highRiskFeasible",
            goal: "与博林共同迎击铁门哨兵",
            method: "避开摇晃火盆并进入敌对遭遇",
            dynamicMaterializations: [
              {
                kind: "hazard",
                factRef: HAZARD_FACT_ID,
                causalBasisRefs: [],
                visibilityPolicyRef: "visibility:scene-observers",
                definition: {
                  name: "摇晃的火盆",
                  warningEvidence: "火盆支架正在石地上轻微滑动",
                  trigger: "受撞击时倾倒",
                },
              },
              {
                kind: "enemy",
                factRef: "fact:combat-vertical:sentinel-arrives",
                causalBasisRefs: [],
                visibilityPolicyRef: "visibility:scene-observers",
                definition: sentinelDefinition(),
              },
            ],
          });
        },
        narrate: async () => ({ body: "你们避开火盆，哨兵横矛封住铁门。", agencyClaims: [] }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:combat-vertical:start",
      characterId: ALICE_ID,
      text: intentText,
    }), "natural-language combat outcome");

    expect(requests, JSON.stringify(requests)).toHaveLength(1);
    expect(record(requests[0].input, "KP request input")).toMatchObject({
      kind: "intent",
      text: intentText,
    });
    expect(record(requests[0].input, "KP request input")).not.toHaveProperty("characterId");
    if (outcome.kind === "awaitingInput") {
      const pending = record(outcome.pending, "initiative tie pending");
      expect(pending.choiceKind, JSON.stringify(outcome)).toBe("initiativeTieOrder");
      const orderedEntityIds = list(pending.orderedEntityIds, "initiative tie candidates")
        .map((entityId) => String(entityId));
      const tiePrincipal = orderedEntityIds[0] === BOB_ID ? BOB : ALICE;
      outcome = record(await handleRoomAction({
        principal: tiePrincipal,
        authority,
        kp: {
          propose: async () => { throw new Error("authenticated initiative answer must not call KP"); },
          narrate: async () => ({ body: "同点角色的先攻顺序已经明确。", agencyClaims: [] }),
        },
      }, {
        kind: "answer",
        submissionId: "submission:combat-vertical:initiative-tie",
        pendingInputId: String(pending.pendingInputId),
        answer: { orderedEntityIds },
      }), "initiative tie answer");
    }
    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");

    for (const [viewer, expectedCharacterId] of [[ALICE, ALICE_ID], [BOB, BOB_ID]] as const) {
      const observation = record(await authority.observe(viewer), `${expectedCharacterId} observation`);
      const readModel = record(observation.readModel, `${expectedCharacterId} read model`);
      expect(record(readModel.viewer, `${expectedCharacterId} viewer`)).toMatchObject({
        kind: "player",
        characterId: expectedCharacterId,
      });
      const encounter = record(
        record(readModel.encounters, `${expectedCharacterId} encounters`)[ENCOUNTER_ID],
        `${expectedCharacterId} encounter`,
      );
      expect(list(encounter.participantEntityIds, `${expectedCharacterId} participants`).sort())
        .toEqual([ALICE_ID, BOB_ID, ENEMY_ID].sort());
      const visibleFacts = list(readModel.visibleFacts, `${expectedCharacterId} visible facts`);
      expect(visibleFacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: HAZARD_FACT_ID }),
      ]));
      const enemy = record(record(readModel.entities, `${expectedCharacterId} entities`)[ENEMY_ID], "enemy projection");
      expect(enemy).not.toHaveProperty("abilities");
      expect(enemy).not.toHaveProperty("resources");
    }

    let turnSubmission = 0;
    const activeEntityId = async () => {
      const observation = record(await authority.observe(ALICE), "active-turn observation");
      const readModel = record(observation.readModel, "active-turn read model");
      return String(record(record(readModel.encounters, "active encounters")[ENCOUNTER_ID], "active encounter").activeEntityId);
    };
    const endPlayerTurn = async (
      principal: typeof ALICE | typeof BOB,
      characterId: typeof ALICE_ID | typeof BOB_ID,
    ) => {
      turnSubmission += 1;
      const ended = record(await handleRoomAction({
        principal,
        authority,
        kp: {
          propose: async (request: RecordValue) => productionActionPlanProposal(
            String(request.rootActionId),
            { operation: "endCombatTurn", encounterRef: ENCOUNTER_ID },
            { goal: "明确结束当前回合", method: "不替下一名战斗者选择行动" },
          ),
          narrate: async () => ({ body: "当前回合结束，决定权交给下一名战斗者。", agencyClaims: [] }),
        },
      }, {
        kind: "intent",
        submissionId: `submission:combat-vertical:end-player-${turnSubmission}`,
        characterId,
        text: "我明确结束自己的当前回合。",
      }), "player end-turn outcome");
      expect(ended.kind, JSON.stringify(ended)).toBe("committed");
    };
    const runNpcTurnAction = async (
      label: string,
      mechanicalProposal: RecordValue,
    ) => {
      turnSubmission += 1;
      return record(await handleRoomAction({
        principal: ALICE,
        authority,
        kp: {
          propose: async (request: RecordValue) => productionActionPlanProposal(
            String(request.rootActionId),
            {
              operation: "resolveDirectConsequences",
              duration: { unit: "second", value: 1 },
              frozenCosts: [],
              success: [],
              failure: [],
            },
            {
              goal: `观察哨兵${label}`,
              method: "玩家不替 NPC 决定；KP 只依据哨兵当前可见战场提出机械行动",
              npcActions: [{
                npcId: ENEMY_ID,
                goal: label,
                method: label,
                knowledgeRefs: [],
                mechanicalProposal: mechanicalProposal as never,
              }],
            },
          ),
          narrate: async () => ({ body: `哨兵${label}。`, agencyClaims: [] }),
        },
      }, {
        kind: "intent",
        submissionId: `submission:combat-vertical:npc-${turnSubmission}`,
        characterId: ALICE_ID,
        text: `我保持自己的决定不变，观察哨兵${label}。`,
      }), `NPC ${label} outcome`);
    };
    const endNpcTurn = async () => {
      const ended = await runNpcTurnAction("结束自己的当前回合", {
        operation: "endCombatTurn",
        encounterRef: ENCOUNTER_ID,
      });
      expect(ended.kind, JSON.stringify(ended)).toBe("committed");
    };
    const advanceTo = async (targetEntityId: string) => {
      for (let index = 0; index < 8; index += 1) {
        const active = await activeEntityId();
        if (active === targetEntityId) return;
        if (active === ALICE_ID) await endPlayerTurn(ALICE, ALICE_ID);
        else if (active === BOB_ID) await endPlayerTurn(BOB, BOB_ID);
        else if (active === ENEMY_ID) await endNpcTurn();
        else throw new Error(`unexpected active combatant: ${active}`);
      }
      throw new Error(`could not advance initiative to ${targetEntityId}`);
    };

    await advanceTo(ALICE_ID);
    const beforeConcentration = record(
      record(await authority.observe(ALICE), "Alice before concentration").readModel,
      "Alice before concentration read model",
    );
    const ensnaringStrike = Object.values(record(
      record(record(beforeConcentration.controlledCharacter, "Alice controlled character").combat, "Alice combat").definitions,
      "Alice combat definitions",
    )).map((entry) => record(entry, "Alice ability definition"))
      .find((definition) => definition.mechanicalKey === "spell:ensnaring");
    expect(ensnaringStrike).toBeDefined();
    const concentrationRequests: RecordValue[] = [];
    const concentrationCast = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: RecordValue) => {
          concentrationRequests.push(structuredClone(request));
          return productionActionPlanProposal(
            String(request.rootActionId),
            {
              operation: "invokeCombatAction",
              abilityRef: String(ensnaringStrike!.definitionId),
              targetEntityRef: ALICE_ID,
            },
            {
              kind: "highRiskFeasible",
              goal: "施放诱捕打击并开始专注",
              method: "在自己的回合对自己施放诱捕打击",
            },
          );
        },
        narrate: async () => ({ body: "荆棘般的魔力绕上阿莱莎的武器，她开始维持专注。", agencyClaims: [] }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:combat-vertical:ensnaring-strike",
      characterId: ALICE_ID,
      text: "轮到我时，我施放诱捕打击并维持专注。",
    }), "concentration cast outcome");
    expect(concentrationCast.kind, JSON.stringify({ concentrationCast, concentrationRequests })).toBe("committed");
    const concentratingReadModel = record(
      record(await authority.observe(ALICE), "Alice concentrating observation").readModel,
      "Alice concentrating read model",
    );
    expect(record(record(concentratingReadModel.entities, "visible entities")[ALICE_ID], "Alice combat entity").concentration)
      .toEqual(expect.objectContaining({ abilityRef: String(ensnaringStrike!.definitionId) }));

    await endPlayerTurn(ALICE, ALICE_ID);
    await advanceTo(ENEMY_ID);
    const enemyAttack = await runNpcTurnAction("以弩箭射击正在专注的阿莱莎", {
      operation: "invokeCombatAction",
      abilityRef: ENEMY_ATTACK_ID,
      targetEntityRef: ALICE_ID,
    });
    expect(enemyAttack.kind, JSON.stringify(enemyAttack)).toBe("committed");
    const damagedReadModel = record(
      record(await authority.observe(ALICE), "Alice damaged observation").readModel,
      "Alice damaged read model",
    );
    expect(Number(record(record(damagedReadModel.entities, "damaged visible entities")[ALICE_ID], "damaged Alice").hitPoints
      && record(record(record(damagedReadModel.entities, "damaged visible entities")[ALICE_ID], "damaged Alice").hitPoints, "damaged hit points").current))
      .toBeLessThan(13);

    const movement = await runNpcTurnAction("向东撤开二十尺", {
      operation: "moveCombatant",
      encounterRef: ENCOUNTER_ID,
      destinationRef: "east",
      destinationFeet: 20,
    });
    expect(movement.kind, JSON.stringify(movement)).toBe("awaitingInput");
    expect(movement.pending).toEqual({ kind: "pending" });

    const aliceDuringReaction = record(
      record(await authority.observe(ALICE), "Alice during private reaction").readModel,
      "Alice during private reaction read model",
    );
    expect(list(aliceDuringReaction.pendingInputs, "Alice private pending inputs")
      .some((entry) => record(entry, "Alice pending entry").choiceKind === "reaction"))
      .toBe(false);
    const bobBeforeDisconnect = record(
      record(await authority.observe(BOB), "Bob before disconnect").readModel,
      "Bob before disconnect read model",
    );
    const reactionBeforeDisconnect = record(
      list(bobBeforeDisconnect.pendingInputs, "Bob pending before disconnect")
        .find((entry) => record(entry, "Bob pending entry").choiceKind === "reaction"),
      "Bob reaction before disconnect",
    );
    expect(reactionBeforeDisconnect).toMatchObject({
      kind: "combatChoice",
      choiceKind: "reaction",
      candidateAbilityRefs: ["action:opportunity-attack"],
    });
    expect(reactionBeforeDisconnect).not.toHaveProperty("controllerEntityId");

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const bobAfterReconnect = record(
      record(await authority.observe(BOB, { channel: "reconnect" }), "Bob after reconnect").readModel,
      "Bob after reconnect read model",
    );
    const reactionAfterReconnect = record(
      list(bobAfterReconnect.pendingInputs, "Bob pending after reconnect")
        .find((entry) => record(entry, "Bob reconnected pending entry").choiceKind === "reaction"),
      "Bob reaction after reconnect",
    );
    expect(reactionAfterReconnect).toEqual(reactionBeforeDisconnect);

    const reacted = record(await handleRoomAction({
      principal: BOB,
      authority,
      kp: {
        propose: async () => { throw new Error("authenticated opportunity reaction must not call KP"); },
        narrate: async () => ({ body: "博林抓住空当挥出一击，哨兵随后完成撤步。", agencyClaims: [] }),
      },
    }, {
      kind: "answer",
      submissionId: "submission:combat-vertical:opportunity-reaction",
      pendingInputId: String(reactionAfterReconnect.pendingInputId),
      answer: {
        kind: "useReaction",
        abilityRef: "action:opportunity-attack",
        targetEntityId: ENEMY_ID,
      },
    }), "opportunity reaction after reconnect");
    expect(reacted.kind, JSON.stringify(reacted)).toBe("committed");
    const afterMovement = record(
      record(await authority.observe(BOB), "Bob after movement").readModel,
      "Bob after movement read model",
    );
    expect(record(record(afterMovement.entities, "post-movement entities")[ENEMY_ID], "moved enemy").position)
      .toEqual({ x: "360", y: "0", elevation: "0" });

    await endNpcTurn();
    const continuityBefore = new Map<string, unknown>();
    for (const [viewer, expectedCharacterId] of [[ALICE, ALICE_ID], [BOB, BOB_ID]] as const) {
      const readModel = record(
        record(await authority.observe(viewer), `${expectedCharacterId} continuity observation`).readModel,
        `${expectedCharacterId} continuity read model`,
      );
      const self = record(record(readModel.entities, "continuity entities")[expectedCharacterId], "continuity self");
      continuityBefore.set(expectedCharacterId, {
        hitPoints: structuredClone(self.hitPoints),
        position: structuredClone(self.position),
        conditions: structuredClone(self.conditions),
      });
    }

    const conclusionRequests: RecordValue[] = [];
    const proposed = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: RecordValue) => {
          conclusionRequests.push(structuredClone(request));
          return productionActionPlanProposal(String(request.rootActionId), {
            operation: "proposeEncounterConclusion",
            encounterRef: ENCOUNTER_ID,
            targetEntityRefs: [ENEMY_ID],
            outcome: "npcSurrendered",
          }, {
            goal: "接受已经放下武器的哨兵投降",
            method: "让每名仍存活的玩家分别确认是否结束遭遇",
            npcActions: [{
              npcId: ENEMY_ID,
              goal: "停止敌对并提出投降",
              method: "哨兵只依据眼前两名持械角色和自己的处境放下武器",
              knowledgeRefs: [],
              mechanicalProposal: null,
            }],
          });
        },
        narrate: async () => ({ body: "哨兵放下武器，等待你们分别表态。", agencyClaims: [] }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:combat-vertical:surrender",
      characterId: ALICE_ID,
      text: "哨兵已经放下武器投降；如果博林也同意，我们就停战。",
    }), "natural-language encounter conclusion proposal");

    expect(proposed.kind, JSON.stringify(proposed)).toBe("awaitingInput");
    expect(conclusionRequests).toHaveLength(1);
    const firstPending = record(proposed.pending, "first conclusion pending");
    expect(firstPending).toMatchObject({
      kind: "combatChoice",
      choiceKind: "encounterConclusion",
    });
    expect(firstPending).not.toHaveProperty("controllerEntityId");

    const noKpForAnswer = {
      propose: async () => { throw new Error("authenticated combat answer must not call KP"); },
      narrate: async () => ({ body: "双方已经完成各自的明确表态。", agencyClaims: [] }),
    };
    const aliceAccepted = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKpForAnswer,
    }, {
      kind: "answer",
      submissionId: "submission:combat-vertical:alice-accepts",
      pendingInputId: String(firstPending.pendingInputId),
      answer: { kind: "acceptEncounterConclusion" },
    }), "Alice conclusion acceptance");
    expect(aliceAccepted.kind, JSON.stringify(aliceAccepted)).toBe("awaitingInput");
    expect(aliceAccepted.pending).toEqual({ kind: "pending" });
    const bobPendingObservation = record(await authority.observe(BOB), "Bob pending observation");
    const bobPendingReadModel = record(bobPendingObservation.readModel, "Bob pending read model");
    const secondPending = record(
      list(bobPendingReadModel.pendingInputs, "Bob pending inputs")
        .find((entry) => record(entry, "Bob pending entry").choiceKind === "encounterConclusion"),
      "second conclusion pending",
    );
    expect(secondPending).toMatchObject({
      kind: "combatChoice",
      choiceKind: "encounterConclusion",
    });
    expect(secondPending).not.toHaveProperty("controllerEntityId");

    const bobAccepted = record(await handleRoomAction({
      principal: BOB,
      authority,
      kp: noKpForAnswer,
    }, {
      kind: "answer",
      submissionId: "submission:combat-vertical:bob-accepts",
      pendingInputId: String(secondPending.pendingInputId),
      answer: { kind: "acceptEncounterConclusion" },
    }), "Bob conclusion acceptance");
    expect(bobAccepted.kind, JSON.stringify(bobAccepted)).toBe("committed");

    for (const [viewer, expectedCharacterId] of [[ALICE, ALICE_ID], [BOB, BOB_ID]] as const) {
      const observation = record(await authority.observe(viewer), `${expectedCharacterId} concluded observation`);
      const readModel = record(observation.readModel, `${expectedCharacterId} concluded read model`);
      const encounter = record(record(readModel.encounters, "concluded encounters")[ENCOUNTER_ID], "concluded encounter");
      expect(encounter.status).toBe("concluded");
      expect(record(readModel.story, "ongoing story").status).toBe("active");
      const self = record(record(readModel.entities, "visible entities")[expectedCharacterId], "self combat entity");
      expect({
        hitPoints: structuredClone(self.hitPoints),
        position: structuredClone(self.position),
        conditions: structuredClone(self.conditions),
      }).toEqual(continuityBefore.get(expectedCharacterId));
      expect(list(readModel.visibleFacts, "concluded visible facts")).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: HAZARD_FACT_ID }),
      ]));
    }

    const exported = record(
      await authority.exportAuthoritativeArchive(capabilities.archiveExport),
      "archive export",
    );
    const events = list(record(exported.archive, "archive").events, "archive events")
      .map((entry) => record(entry, "archive event"));
    const startRootActionId = String(record(outcome.receipt, "receipt").rootActionId);
    const startEvents = events.filter((event) => event.rootActionId === startRootActionId);
    expect(startEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "DefinitionRegistered",
      "CanonicalFactDeclared",
      "EncounterStarted",
    ]));
    const encounterStarted = record(
      startEvents.find((event) => event.eventType === "EncounterStarted")?.payload,
      "EncounterStarted payload",
    );
    expect(list(record(encounterStarted.encounter, "started encounter").battlefieldFactIds, "battlefield fact ids"))
      .toContain(HAZARD_FACT_ID);
    const concentrationRootActionId = String(record(concentrationCast.receipt, "concentration receipt").rootActionId);
    const concentrationEvents = events.filter((event) => event.rootActionId === concentrationRootActionId);
    expect(concentrationEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "ResourceSpent",
      "ConcentrationStarted",
    ]));
    const damageRootActionId = String(record(enemyAttack.receipt, "damage receipt").rootActionId);
    const damageEvents = events.filter((event) => event.rootActionId === damageRootActionId);
    expect(damageEvents.filter((event) => event.eventType === "DamagePacketResolved")).toHaveLength(1);
    expect(damageEvents.filter((event) => event.eventType === "ConcentrationTested")).toHaveLength(1);
    const movementRootActionId = String(record(movement.receipt, "movement receipt").rootActionId);
    const movementEvents = events.filter((event) => event.rootActionId === movementRootActionId);
    expect(movementEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "ReactionOffered",
      "ReactionAnswered",
      "MovementSegmentCommitted",
    ]));
    expect(movementEvents.filter((event) => event.eventType === "ReactionOffered")).toHaveLength(1);
    expect(movementEvents.filter((event) => event.eventType === "ReactionAnswered")).toHaveLength(1);
    expect(record(
      movementEvents.find((event) => event.eventType === "MovementSegmentCommitted")?.payload,
      "movement segment payload",
    ).entityPatch).toEqual(expect.objectContaining({
      position: { x: "360", y: "0", elevation: "0" },
    }));
    const conclusionRootActionId = String(record(proposed.receipt, "conclusion receipt").rootActionId);
    const conclusionEvents = events.filter((event) => event.rootActionId === conclusionRootActionId);
    expect(conclusionEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "NpcPlanFormed",
      "EncounterConclusionProposed",
      "ReactionAnswered",
      "EncounterConcluded",
    ]));
  }, 60_000);
});
