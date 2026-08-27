import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  directConsequencesProposal,
  productionActionPlanProposal,
} from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

type Principal = Readonly<{
  principal: Readonly<{ id: string; sessionVersion: number }>;
}>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:stage4-world:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:stage4-world:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:stage4-world:carol", sessionVersion: 1 }),
});

const ALICE_ID = "character:stage4-world:alice";
const BOB_ID = "character:stage4-world:bob";
const CAROL_ID = "character:stage4-world:carol";

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function character(characterId: string, name: string, sceneId: string, hp = 20) {
  return {
    characterId,
    controllerPrincipalId: characterId === ALICE_ID
      ? ALICE.principal.id
      : characterId === BOB_ID
        ? BOB.principal.id
        : CAROL.principal.id,
    staticCard: {
      name,
      sceneId,
      scores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["investigation"],
      hp: { current: hp, max: 20, temp: 0 },
      ac: 12,
      speed: 30,
      resources: {},
      equipped: {},
      backpack: [],
    },
  };
}

async function initialize(
  roomId: string,
  characters = [character(ALICE_ID, "阿莱莎", "wake")],
) {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const members = characters.map((entry, index) => ({
    principalId: entry.controllerPrincipalId,
    role: index === 0 ? "host" : "player",
  }));
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members,
    characters,
  }), `${roomId} initialization`);
  expect(initialized.created).toBe(true);
  return {
    authority,
    archiveCapability: record(
      initialized.serviceCapabilities,
      `${roomId} service capabilities`,
    ).archiveExport,
  };
}

async function archiveEvents(authority: Authority, capability: unknown) {
  const exported = record(
    await authority.exportAuthoritativeArchive(capability),
    "archive export",
  );
  const archive = record(exported.archive, "archive");
  return list(archive.events, "archive events").map((entry) => record(entry, "archive event"));
}

async function act(
  authority: Authority,
  principal: Principal,
  submissionId: string,
  text: string,
  proposal: (rootActionId: string, request: JsonRecord) => JsonRecord,
) {
  return record(await handleRoomAction({
    principal,
    authority,
    kp: {
      async propose(value) {
        const request = record(value, `${submissionId} proposal request`);
        return proposal(String(request.rootActionId), request);
      },
      async narrate() {
        return { body: "权威世界已经按已提交结果变化。", agencyClaims: [] };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} outcome`);
}

function rootEvents(events: JsonRecord[], outcome: JsonRecord) {
  const rootActionId = String(record(outcome.receipt, "receipt").rootActionId);
  return events.filter((event) => event.rootActionId === rootActionId);
}

describe("Stage 4 world/campaign responsibility-interface verticals", () => {
  it("registers an absent passage and destination scene, then moves there in the same Root Action", async () => {
    const room = await initialize("stage4-world-dynamic-passage-v2");
    const destinationSceneId = "scene:stage4:sealed-archive";
    const locationRef = "location:stage4:sealed-archive";
    const passageRef = "passage:stage4:wake-to-sealed-archive";

    const outcome = await act(
      room.authority,
      ALICE,
      "submission:stage4:dynamic-passage",
      "我沿着刚发现的旋梯进入此前无人登记的密档室。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "发现可通行的旋梯并立即进入密档室",
        method: "确认台阶承重后沿旋梯下行",
        duration: { unit: "minute", value: 1 },
        dynamicMaterializations: [
          {
            kind: "location",
            factRef: locationRef,
            causalBasisRefs: [],
            visibilityPolicyRef: "visibility:scene-observers",
            definition: { sceneId: destinationSceneId, name: "封存档案室" },
          },
          {
            kind: "passage",
            factRef: passageRef,
            causalBasisRefs: [],
            visibilityPolicyRef: "visibility:scene-observers",
            definition: {
              passageId: passageRef,
              fromSceneRef: "wake",
              toSceneRef: destinationSceneId,
              traversal: "石墙后的旋梯",
            },
          },
        ],
        success: [{ kind: "moveEntity", entityRef: ALICE_ID, sceneRef: destinationSceneId }],
      }) as JsonRecord,
    );

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    const events = rootEvents(await archiveEvents(room.authority, room.archiveCapability), outcome);
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "DefinitionRegistered",
      "CanonicalFactDeclared",
      "CharacterMoved",
    ]));
    expect(events.filter((event) => event.eventType === "DefinitionRegistered")
      .map((event) => record(record(event.payload, "definition payload").definition, "definition").definitionId))
      .toEqual(expect.arrayContaining([locationRef, passageRef]));
    expect(record(
      record(events.find((event) => event.eventType === "CharacterMoved")!.payload, "movement payload"),
      "movement payload",
    ).destinationSceneId).toBe(destinationSceneId);
    expect(JSON.stringify(outcome.readModel)).toContain(destinationSceneId);
  });

  it("commits a legitimate empty-room result without forcing combat, clues, or rewards", async () => {
    const room = await initialize("stage4-world-empty-room-v2");
    const outcome = await act(
      room.authority,
      ALICE,
      "submission:stage4:empty-room",
      "我仔细查看这间闲置耳房。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "确认耳房内是否有值得处理的事物",
        method: "依次检查地面、墙角和唯一一只空柜",
        duration: { unit: "minute", value: 10 },
        dynamicMaterializations: [{
          kind: "fact",
          factRef: "fact:stage4:empty-side-room",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: {
            finding: "房间确实空置，没有敌人、线索、宝物或可领取奖励",
          },
        }],
        success: [],
      }) as JsonRecord,
    );

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    const events = rootEvents(await archiveEvents(room.authority, room.archiveCapability), outcome);
    const eventTypes = events.map((event) => String(event.eventType));
    expect(eventTypes).toEqual(expect.arrayContaining([
      "DefinitionRegistered",
      "CanonicalFactDeclared",
      "FeasibilityRuled",
    ]));
    expect(eventTypes.some((eventType) => [
      "ArtifactMaterialized",
      "ArtifactAcquired",
      "KnowledgeAcquired",
      "EncounterStarted",
      "InitiativeEstablished",
      "MilestoneGranted",
      "ExperienceAwarded",
      "ResourceChanged",
    ].includes(eventType))).toBe(false);
  });

  it("lets exactly one of two concurrent requests acquire one unique artifact", async () => {
    const room = await initialize("stage4-world-unique-artifact-race-v2", [
      character(ALICE_ID, "阿莱莎", "wake"),
      character(BOB_ID, "柏然", "wake"),
    ]);
    const artifactId = "artifact:stage4:single-brass-key";
    const artifactDefinitionRef = "item:stage4:single-brass-key";
    const materialized = await act(
      room.authority,
      ALICE,
      "submission:stage4:materialize-key",
      "我看见石台上只有一把黄铜钥匙。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "确认石台上的唯一黄铜钥匙",
        method: "仅观察它的位置，不拿取",
        dynamicMaterializations: [{
          kind: "item",
          factRef: artifactDefinitionRef,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: { artifactId, name: "唯一黄铜钥匙", sceneRef: "wake" },
        }],
      }) as JsonRecord,
    );
    expect(materialized.kind, JSON.stringify(materialized)).toBe("committed");

    let arrivals = 0;
    let release!: () => void;
    const bothProposalsReady = new Promise<void>((resolve) => { release = resolve; });
    const contender = (principal: Principal, suffix: string) =>
      handleRoomAction({
        principal,
        authority: room.authority,
        kp: {
          async propose(value) {
            arrivals += 1;
            if (arrivals === 2) release();
            await bothProposalsReady;
            const request = record(value, `${suffix} proposal request`);
            return productionActionPlanProposal(String(request.rootActionId), {
              operation: "acquireArtifact",
              artifactRef: artifactId,
            }, {
              goal: "拿起石台上的唯一黄铜钥匙",
              method: "伸手取走眼前唯一的一把钥匙",
            });
          },
          async narrate() {
            return { body: "石台上的唯一钥匙已经有了归属。", agencyClaims: [] };
          },
        },
      }, {
        kind: "intent",
        submissionId: `submission:stage4:key-race:${suffix}`,
        text: "我立刻拿起那把唯一的黄铜钥匙。",
      });

    const outcomes = (await Promise.all([
      contender(ALICE, "alice"),
      contender(BOB, "bob"),
    ])).map((outcome) => record(outcome, "artifact race outcome"));
    expect(outcomes.filter((outcome) => outcome.kind === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind !== "committed")).toHaveLength(1);

    const events = await archiveEvents(room.authority, room.archiveCapability);
    const acquisitions = events.filter((event) =>
      event.eventType === "ArtifactAcquired"
      && record(event.payload, "artifact acquisition payload").artifactId === artifactId);
    expect(acquisitions).toHaveLength(1);
    expect([ALICE_ID, BOB_ID]).toContain(
      record(acquisitions[0].payload, "winning acquisition payload").characterId,
    );
  });

  it("keeps two readers' knowledge after the letter is destroyed and never backfills an unread later arrival", async () => {
    const room = await initialize("stage4-world-destroyed-letter-knowledge-v2", [
      character(ALICE_ID, "阿莱莎", "wake"),
      character(BOB_ID, "柏然", "wake"),
      character(CAROL_ID, "卡萝", "yard"),
    ]);
    const artifactId = "artifact:stage4:sealed-letter";
    const definitionRef = "item:stage4:sealed-letter";
    const knowledgeRef = "knowledge:stage4:letter-rendezvous";

    const acquired = await act(
      room.authority,
      ALICE,
      "submission:stage4:letter-acquire",
      "我拿起桌上仅有的密封信。",
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "acquireArtifact",
        artifactRef: artifactId,
      }, {
        goal: "拿起桌上唯一的密封信",
        method: "亲手取得信件",
        dynamicMaterializations: [{
          kind: "item",
          factRef: definitionRef,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:scene-observers",
          definition: { artifactId, name: "密封信", sceneRef: "wake" },
        }],
      }) as JsonRecord,
    );
    expect(acquired.kind, JSON.stringify(acquired)).toBe("committed");

    for (const [principal, characterId, suffix] of [
      [ALICE, ALICE_ID, "alice"],
      [BOB, BOB_ID, "bob"],
    ] as const) {
      const read = await act(
        room.authority,
        principal,
        `submission:stage4:letter-read:${suffix}`,
        "我亲自读完同一封信的会面时间与地点。",
        (rootActionId) => directConsequencesProposal(rootActionId, {
          goal: "读懂信中约定的会面信息",
          method: "在信件仍在现场时逐字阅读",
          privateBasisRefs: [],
          success: [{
            kind: "acquireKnowledge",
            knowledgeRef,
            definitionRef,
            value: "午夜在旧渡口会面",
          }],
        }) as JsonRecord,
      );
      expect(read.kind, JSON.stringify(read)).toBe("committed");
      expect(JSON.stringify(read.readModel)).toContain(knowledgeRef);
      expect(JSON.stringify(read.readModel)).toContain(characterId);
    }

    const destroyed = await act(
      room.authority,
      ALICE,
      "submission:stage4:letter-destroy",
      "我把已经读完的信投入火盆彻底烧毁。",
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "useArtifact",
        artifactRef: artifactId,
        artifactUse: "destroy",
      }, {
        goal: "烧毁作为实物的密封信",
        method: "把信投入火盆直到只剩灰烬",
      }) as JsonRecord,
    );
    expect(destroyed.kind, JSON.stringify(destroyed)).toBe("committed");

    const arrived = await act(
      room.authority,
      CAROL,
      "submission:stage4:carol-arrives-after-letter",
      "我从庭院来到灵堂，但信已经烧毁。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "在信件烧毁之后来到灵堂",
        method: "从庭院走入灵堂",
        duration: { unit: "minute", value: 1 },
        success: [{ kind: "moveEntity", entityRef: CAROL_ID, sceneRef: "wake" }],
      }) as JsonRecord,
    );
    expect(arrived.kind, JSON.stringify(arrived)).toBe("committed");

    const [aliceView, bobView, carolView] = await Promise.all([
      room.authority.observe(ALICE),
      room.authority.observe(BOB),
      room.authority.observe(CAROL),
    ]);
    expect(JSON.stringify(aliceView)).toContain(knowledgeRef);
    expect(JSON.stringify(bobView)).toContain(knowledgeRef);
    expect(JSON.stringify(carolView)).not.toContain(knowledgeRef);
    expect(JSON.stringify(carolView)).not.toContain("午夜在旧渡口会面");

    const events = await archiveEvents(room.authority, room.archiveCapability);
    const learned = events.filter((event) =>
      event.eventType === "KnowledgeAcquired"
      && record(event.payload, "knowledge payload").knowledgeRef === knowledgeRef);
    expect(learned.map((event) => record(event.payload, "knowledge payload").characterId).sort())
      .toEqual([ALICE_ID, BOB_ID].sort());
    const destroyedEvent = events.find((event) =>
      event.eventType === "ArtifactUsed"
      && record(event.payload, "destroy payload").artifactId === artifactId);
    expect(record(destroyedEvent!.payload, "destroyed artifact payload")).toMatchObject({
      beforeStatus: "held",
      afterStatus: "destroyed",
      remainingQuantity: 0,
    });
  });

  it("keeps a hidden hazard candidate set and selected parameters frozen after another player's HP changes", async () => {
    const room = await initialize("stage4-world-hazard-freeze-hp-v2", [
      character(ALICE_ID, "阿莱莎", "wake", 20),
      character(BOB_ID, "柏然", "yard", 20),
    ]);
    let checkpointFired = false;
    await runInDurableObject(room.authority as never, async (instance) => {
      (instance as unknown as {
        authorityRecoveryCheckpoint?: (checkpoint: string) => void;
      }).authorityRecoveryCheckpoint = (checkpoint) => {
        if (checkpoint === "afterRandomnessCandidateCommit" && !checkpointFired) {
          checkpointFired = true;
          throw new Error("stage4-hazard-freeze-response-loss");
        }
      };
    });

    const submissionId = "submission:stage4:hazard-freeze";
    const candidateSet = {
      candidateSetId: "hidden-set:stage4:sealed-vault-hazard",
      candidates: [
        {
          candidateId: "candidate:stage4:needle-trap",
          hiddenWeight: 1,
          kind: "hazard" as const,
          factRef: "hazard:stage4:needle-trap",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:hidden-until-evidence",
          definition: {
            name: "锁孔毒针",
            fixedSaveDc: 17,
            fixedDamageFormula: "8d6",
            trigger: "转动锁芯",
          },
        },
        {
          candidateId: "candidate:stage4:empty-lock",
          hiddenWeight: 1,
          kind: "fact" as const,
          factRef: "fact:stage4:empty-lock",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:hidden-until-evidence",
          definition: {
            name: "无机关锁芯",
            fixedSaveDc: null,
            fixedDamageFormula: null,
            trigger: "none",
          },
        },
      ],
    };
    let initialRootActionId = "";
    const interrupted = await handleRoomAction({
      principal: ALICE,
      authority: room.authority,
      kp: {
        async propose(value) {
          const request = record(value, "hazard proposal request");
          initialRootActionId = String(request.rootActionId);
          return directConsequencesProposal(initialRootActionId, {
            goal: "确认密封金库锁孔此前未定义的隐藏现实",
            method: "把探针伸入锁孔取得直接证据",
            dynamicMaterializations: [],
            hiddenRealityCandidateSet: structuredClone(candidateSet),
          });
        },
        async narrate() {
          return { body: "锁孔的既定现实已经显现。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId,
      text: "我用探针检查密封金库的锁孔。",
    });
    expect(interrupted).toMatchObject({ kind: "retryableFailure", code: "authorityTransient" });
    expect(checkpointFired).toBe(true);

    const hpChanged = await act(
      room.authority,
      BOB,
      "submission:stage4:bob-hp-change",
      "我在庭院被坠落瓦片砸伤。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "结算庭院中已经发生的坠瓦伤害",
        method: "按既定冲击扣除生命值",
        success: [{ kind: "changeHitPoints", targetRef: BOB_ID, amount: -9 }],
      }) as JsonRecord,
    );
    expect(hpChanged.kind, JSON.stringify(hpChanged)).toBe("committed");
    expect(JSON.stringify(hpChanged.readModel)).toContain('"current":11');

    let retryModelCalls = 0;
    const recovered = record(await handleRoomAction({
      principal: ALICE,
      authority: room.authority,
      kp: {
        async propose() {
          retryModelCalls += 1;
          throw new Error("a frozen hidden-reality proposal must not be regenerated");
        },
        async narrate() {
          return { body: "锁孔的既定现实已经显现。", agencyClaims: [] };
        },
      },
    }, {
      kind: "retry",
      submissionId,
      rootActionId: initialRootActionId,
    }), "hazard recovery outcome");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
    expect(retryModelCalls).toBe(0);

    const events = (await archiveEvents(room.authority, room.archiveCapability))
      .filter((event) => event.rootActionId === initialRootActionId);
    expect(events.filter((event) => event.eventType === "HiddenRealityCandidatesFrozen"))
      .toHaveLength(1);
    expect(events.filter((event) => event.eventType === "HiddenRealityMaterialized"))
      .toHaveLength(1);
    expect(events.filter((event) => event.eventType === "DiceRolled")).toHaveLength(1);

    const frozenPayload = record(
      events.find((event) => event.eventType === "HiddenRealityCandidatesFrozen")!.payload,
      "frozen candidate payload",
    );
    expect(frozenPayload.candidates).toEqual(candidateSet.candidates);
    const selectedPayload = record(
      events.find((event) => event.eventType === "HiddenRealityMaterialized")!.payload,
      "selected hidden reality payload",
    );
    const selectedCandidate = candidateSet.candidates.find((candidate) =>
      candidate.candidateId === selectedPayload.candidateId);
    expect(selectedCandidate).toBeDefined();
    const registered = events
      .filter((event) => event.eventType === "DefinitionRegistered")
      .map((event) => record(record(event.payload, "definition payload").definition, "definition"))
      .find((definition) => definition.definitionId === selectedCandidate!.factRef);
    expect(record(registered!.content, "selected frozen definition"))
      .toEqual(selectedCandidate!.definition);
  });
});
