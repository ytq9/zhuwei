import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  dynamicPassageMoveProposal,
  privateFormProposal,
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

function tacticalGeometry(featureId: string): JsonRecord {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "0", y: "0" },
        { x: "1200", y: "0" },
        { x: "1200", y: "1200" },
        { x: "0", y: "1200" },
      ],
    },
    spawnPoints: [{ x: "120", y: "120", elevation: "0" }],
    obstacles: [{
      featureId,
      kind: "barrier",
      label: "密档室北侧石墙",
      state: "intact",
      polygon: [
        { x: "0", y: "1140" },
        { x: "1200", y: "1140" },
        { x: "1200", y: "1200" },
        { x: "0", y: "1200" },
      ],
      elevation: "0",
      height: "120",
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
      visibilityPolicyId: "visibility:scene-observers",
    }],
    clearanceZones: [],
  };
}

async function initialize(
  roomId: string,
  characters = [character(ALICE_ID, "阿莱莎", "wake")],
  fixtureFacts: unknown[] = [],
) {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const members = characters.map((entry, index) => ({
    principalId: entry.controllerPrincipalId,
    role: index === 0 ? "host" : "player",
  }));
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members,
    characters,
    ...(fixtureFacts.length === 0 ? {} : { fixtureFacts }),
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

function currentItemMaterializationProposal(
  rootActionId: string,
  input: Readonly<{
    action: "materializeInScene" | "materializeAndAcquire";
    entryRef: string;
    definitionRef: string;
    name: string;
    description: string;
    sceneRef: string;
    causalBasisRefs: string[];
    goal: string;
  }>,
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: input.goal,
    method: "materializeNarrativeItem",
    proposedFact: JSON.stringify({
      schema: "zhuwei.narrative-item-draft/v1",
      action: input.action,
      entryRef: input.entryRef,
      definitionRef: input.definitionRef,
      name: input.name,
      description: input.description,
      causalBasisRefs: input.causalBasisRefs,
    }),
    basisRefs: [input.sceneRef, ...input.causalBasisRefs],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  });
}

function sceneItemAcquisitionProposal(
  rootActionId: string,
  input: Readonly<{ goal: string; sceneRef: string; itemRef: string }>,
) {
  return privateFormProposal(rootActionId, "materialization.v1", {
    goal: input.goal,
    method: "acquireSceneItem",
    proposedFact: JSON.stringify({
      schema: "zhuwei.scene-item-acquisition-draft/v1",
      itemRef: input.itemRef,
    }),
    basisRefs: [input.sceneRef, input.itemRef],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  });
}

function itemInformationObservationProposal(
  rootActionId: string,
  input: Readonly<{
    goal: string;
    sceneRef: string;
    itemRef: string;
    sourceRef: string;
    information: JsonRecord;
  }>,
) {
  return privateFormProposal(rootActionId, "observe.v1", {
    goal: input.goal,
    method: "observeItemInformation",
    focus: input.itemRef,
    desiredInformation: JSON.stringify({
      schema: "zhuwei.item-information-observation-draft/v1",
      itemRef: input.itemRef,
      sourceRef: input.sourceRef,
      information: structuredClone(input.information),
    }),
    basisRefs: [input.sceneRef, input.itemRef],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  });
}

function consumeHeldItemProposal(rootActionId: string, itemEntryId: string) {
  const goal = "烧毁作为实物的密封信";
  return privateFormProposal(rootActionId, "compound.v1", {
    goal,
    method: "把信投入火盆直到只剩灰烬",
    stages: [{
      goal,
      method: "把已经读完的信投入火盆",
      intendedOutcome: "密封信成为灰烬，无法再次阅读或使用",
      resolution: "direct",
      basisRefs: [itemEntryId],
    }],
    intendedOutcome: "密封信成为灰烬，无法再次阅读或使用",
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
    itemRef: itemEntryId,
    itemCount: 1,
  });
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
    const geometry = tacticalGeometry("feature:stage4:sealed-archive:north-wall");

    const outcome = await act(
      room.authority,
      ALICE,
      "submission:stage4:dynamic-passage",
      "我沿着刚发现的旋梯进入此前无人登记的密档室。",
      (rootActionId) => dynamicPassageMoveProposal(rootActionId, {
        sourceSceneRef: "wake",
        locationRef,
        destinationSceneRef: destinationSceneId,
        destinationName: "封存档案室",
        passageRef,
        traversal: "石墙后的旋梯",
        geometry,
        durationUnit: "minute",
        durationValue: 1,
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
    const locationDefinition = record(record(
      events.find((event) => event.eventType === "DefinitionRegistered"
        && record(record(event.payload, "definition payload").definition, "definition").definitionId
          === locationRef)!.payload,
      "location definition payload",
    ).definition, "location definition");
    expect(record(locationDefinition.content, "location content").geometry).toEqual(geometry);
    expect(record(
      record(events.find((event) => event.eventType === "CharacterMoved")!.payload, "movement payload"),
      "movement payload",
    ).destinationSceneId).toBe(destinationSceneId);
    expect(JSON.stringify(outcome.readModel)).toContain(destinationSceneId);
  });

  it("rejects a dynamic movement destination that has no canonical tactical spawn", async () => {
    const room = await initialize("stage4-world-dynamic-passage-no-spawn-v2");
    const geometry = tacticalGeometry("feature:stage4:no-spawn:north-wall");
    geometry.spawnPoints = [];

    const outcome = await act(
      room.authority,
      ALICE,
      "submission:stage4:dynamic-passage-no-spawn",
      "我沿新发现的通道进入另一间密室。",
      (rootActionId) => dynamicPassageMoveProposal(rootActionId, {
        sourceSceneRef: "wake",
        locationRef: "location:stage4:no-spawn",
        destinationSceneRef: "scene:stage4:no-spawn",
        destinationName: "无入口密室",
        passageRef: "passage:stage4:wake-to-no-spawn",
        traversal: "狭窄石道",
        geometry,
        durationUnit: "minute",
        durationValue: 1,
      }) as JsonRecord,
    );

    expect(outcome.kind, JSON.stringify(outcome)).toBe("needsKp");
    const events = rootEvents(await archiveEvents(room.authority, room.archiveCapability), outcome);
    expect(events.some((event) => [
      "DefinitionRegistered",
      "CanonicalFactDeclared",
      "CharacterMoved",
    ].includes(String(event.eventType)))).toBe(false);
  });

  it("commits a legitimate empty-room result without forcing combat, clues, or rewards", async () => {
    const searchBasisRef = "fact:stage4:empty-side-room-search-coordination";
    const room = await initialize(
      "stage4-world-empty-room-v2",
      [character(ALICE_ID, "阿莱莎", "wake")],
      [{
        factRef: searchBasisRef,
        kind: "establishedCommunicationChannel",
        participants: [ALICE_ID, "npc:black-oak-will:lian"],
      }],
    );
    const outcome = await act(
      room.authority,
      ALICE,
      "submission:stage4:empty-room",
      "我仔细查看这间闲置耳房。",
      (rootActionId) => privateFormProposal(rootActionId, "materialization.v1", {
        goal: "确认耳房内是否有值得处理的事物",
        method: "依次检查地面、墙角和唯一一只空柜",
        proposedFact: "房间确实空置，没有敌人、线索、宝物或可领取奖励。",
        basisRefs: [searchBasisRef],
        resolution: "direct",
        durationUnit: "minute",
        durationValue: 10,
      }) as JsonRecord,
    );

    expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
    const events = rootEvents(await archiveEvents(room.authority, room.archiveCapability), outcome);
    const eventTypes = events.map((event) => String(event.eventType));
    expect(eventTypes).toEqual(expect.arrayContaining([
      "DefinitionRegistered",
      "ImprovisedActionResolved",
      "FictionTimeAdvanced",
    ]));
    const materializedFact = events
      .filter((event) => event.eventType === "ImprovisedActionResolved")
      .map((event) => record(event.payload, "empty-room resolution payload").fact)
      .find((fact) => fact !== null && fact !== undefined
        && record(fact, "empty-room fact candidate").kind === "dynamicOpenFact");
    expect(record(record(materializedFact, "empty-room fact").value, "empty-room fact value"))
      .toEqual({ description: "房间确实空置，没有敌人、线索、宝物或可领取奖励。" });
    const knowledgeEvents = events.filter((event) => event.eventType === "KnowledgeAcquired");
    expect(knowledgeEvents).toHaveLength(1);
    const rootActionId = String(record(outcome.receipt, "empty-room receipt").rootActionId);
    const knowledgePayload = record(knowledgeEvents[0]!.payload, "empty-room knowledge payload");
    const causeFactId = String(knowledgePayload.causeFactId);
    const causeFactPrefix = `fact:v3-causal-program:${rootActionId}:`;
    expect(causeFactId.startsWith(causeFactPrefix)).toBe(true);
    const programHashSuffix = causeFactId.slice(causeFactPrefix.length);
    expect(knowledgePayload).toEqual({
      characterId: ALICE_ID,
      knowledgeRef: `evidence:v3:${rootActionId}:${programHashSuffix}:n01:success`,
      objectKind: "sensoryEvidence",
      layer: "full",
      content: "房间确实空置，没有敌人、线索、宝物或可领取奖励。",
      causeFactId,
      acquisition: {
        sense: "causalResolution",
        sceneId: "wake",
        method: "依次检查地面、墙角和唯一一只空柜",
      },
      visibility: "private",
    });
    expect(knowledgeEvents[0]).toMatchObject({
      visibilityPolicyId: `visibility:knowledge-holder:${ALICE_ID}`,
      secrecy: "private",
    });
    const forbiddenEventTypes = [
      "ItemDefinitionRegistered",
      "ItemMaterialized",
      "ItemAcquired",
      "EncounterStarted",
      "InitiativeEstablished",
      "MilestoneGranted",
      "ExperienceAwarded",
      "ResourceReserved",
      "ResourceSpent",
      "ResourceUsed",
      "ResourceChanged",
    ];
    expect(eventTypes.filter((eventType) => forbiddenEventTypes.includes(eventType))).toEqual([]);
  });

  it("lets exactly one of two concurrent requests acquire one unique item entry", async () => {
    const room = await initialize("stage4-world-unique-item-race-v2", [
      character(ALICE_ID, "阿莱莎", "wake"),
      character(BOB_ID, "柏然", "wake"),
    ]);
    const itemEntryId = "item-entry:stage4:single-brass-key";
    const itemDefinitionRef = "item-definition:stage4:single-brass-key:1";
    const materialized = await act(
      room.authority,
      ALICE,
      "submission:stage4:materialize-key",
      "我看见石台上只有一把黄铜钥匙。",
      (rootActionId) => currentItemMaterializationProposal(rootActionId, {
        action: "materializeInScene",
        entryRef: itemEntryId,
        definitionRef: itemDefinitionRef,
        name: "唯一黄铜钥匙",
        description: "石台上仅有的一把黄铜钥匙。",
        sceneRef: "wake",
        causalBasisRefs: [],
        goal: "确认石台上的唯一黄铜钥匙",
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
            return sceneItemAcquisitionProposal(String(request.rootActionId), {
              goal: "拿起石台上的唯一黄铜钥匙",
              sceneRef: "wake",
              itemRef: itemEntryId,
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
    ])).map((outcome) => record(outcome, "item race outcome"));
    expect(outcomes.filter((outcome) => outcome.kind === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind !== "committed")).toHaveLength(1);

    const events = await archiveEvents(room.authority, room.archiveCapability);
    const acquisitions = events.filter((event) =>
      event.eventType === "ItemAcquired"
      && record(event.payload, "item acquisition payload").entryId === itemEntryId);
    expect(acquisitions).toHaveLength(1);
    expect([ALICE_ID, BOB_ID]).toContain(
      record(acquisitions[0].payload, "winning acquisition payload").characterId,
    );
  });

  it("uses the same item-information seam for sensory evidence on a non-document object", async () => {
    const room = await initialize("stage4-world-item-sensory-evidence-v2", [
      character(ALICE_ID, "阿莱莎", "wake"),
    ]);
    const itemEntryId = "item-entry:stage4:engraved-compass";
    const sourceRef = "fact:item-information:stage4:engraved-compass-bearing";
    const materialized = await act(
      room.authority,
      ALICE,
      "submission:stage4:engraved-compass-materialize",
      "我检查石台上的雕纹罗盘。",
      (rootActionId) => currentItemMaterializationProposal(rootActionId, {
        action: "materializeInScene",
        entryRef: itemEntryId,
        definitionRef: "item-definition:stage4:engraved-compass:1",
        name: "雕纹罗盘",
        description: "一只没有已登记机械效果的铜制罗盘。",
        sceneRef: "wake",
        causalBasisRefs: [],
        goal: "确认石台上的雕纹罗盘",
      }) as JsonRecord,
    );
    expect(materialized.kind, JSON.stringify(materialized)).toBe("committed");

    for (const [suffix, invalidSourceRef] of [
      ["foreign-namespace", "fact:hidden-world-state:engraved-compass"],
      ["empty-stable-tail", "fact:item-information:"],
    ] as const) {
      const prepared = record(await room.authority.prepare(ALICE, {
        kind: "intent",
        submissionId: `submission:stage4:engraved-compass-invalid-source:${suffix}`,
        text: "我观察罗盘，但这个来源引用不符合物件信息协议。",
      }), "invalid item-information source prepare");
      const rejected = record(await room.authority.commit(
        ALICE,
        String(prepared.preparedActionId),
        itemInformationObservationProposal(String(prepared.rootActionId), {
          goal: "观察罗盘呈现的方向证据",
          sceneRef: "wake",
          itemRef: itemEntryId,
          sourceRef: invalidSourceRef,
          information: {
            kind: "sensoryEvidence",
            sense: "visual",
            content: "指针在无风的室内持续指向北侧封墙",
          },
        }),
      ), "invalid item-information source outcome");
      expect(rejected.kind).toBe("needsKp");
      expect(JSON.stringify(rejected)).not.toContain(invalidSourceRef);
    }

    const privateDetail = "北侧封墙后的暗格刻有王室密记";
    const observed = await act(
      room.authority,
      ALICE,
      "submission:stage4:engraved-compass-observe",
      "我观察罗盘指针与封墙之间的方向关系。",
      (rootActionId) => itemInformationObservationProposal(rootActionId, {
        goal: `观察罗盘直接呈现的方向证据：${privateDetail}`,
        sceneRef: "wake",
        itemRef: itemEntryId,
        sourceRef,
        information: {
          kind: "sensoryEvidence",
          sense: "visual",
          content: "指针在无风的室内持续指向北侧封墙",
        },
      }) as JsonRecord,
    );
    expect(observed.kind, JSON.stringify(observed)).toBe("committed");
    expect(JSON.stringify(observed.readModel)).toContain(sourceRef);
    expect(JSON.stringify(observed.readModel)).toContain("北侧封墙");

    const events = rootEvents(
      await archiveEvents(room.authority, room.archiveCapability),
      observed,
    );
    const sourceFacts = events.filter((event) =>
      event.eventType === "ImprovisedActionResolved"
      && record(event.payload, "item source payload").outcomeCode
        === "item-information-source-frozen");
    expect(sourceFacts).toHaveLength(1);
    expect(record(sourceFacts[0].payload, "item source payload").fact).toMatchObject({
      id: sourceRef,
      kind: "itemInformationSource",
      subjectRefs: [itemEntryId],
    });
    expect(events.filter((event) =>
      event.eventType === "SensoryEvidenceAcquired"
      && record(event.payload, "item evidence payload").factId === sourceRef)).toHaveLength(1);
    const publicEvents = events.filter((event) => event.secrecy === "public");
    expect(JSON.stringify(publicEvents)).not.toContain(privateDetail);
    expect(publicEvents.find((event) => event.eventType === "FictionTimeAdvanced")?.payload)
      .toMatchObject({ reason: "观察物件" });
  });

  it("keeps two readers' knowledge after the letter is destroyed and never backfills an unread later arrival", async () => {
    const room = await initialize("stage4-world-destroyed-letter-knowledge-v2", [
      character(ALICE_ID, "阿莱莎", "wake"),
      character(BOB_ID, "柏然", "wake"),
      character(CAROL_ID, "卡萝", "yard"),
    ]);
    const itemEntryId = "item-entry:stage4:sealed-letter";
    const definitionRef = "item-definition:stage4:sealed-letter:1";
    const knowledgeRef = "fact:item-information:stage4:letter-rendezvous";

    const materialized = await act(
      room.authority,
      ALICE,
      "submission:stage4:letter-materialize",
      "我查看桌上仅有的密封信。",
      (rootActionId) => currentItemMaterializationProposal(rootActionId, {
        action: "materializeInScene",
        entryRef: itemEntryId,
        definitionRef,
        name: "密封信",
        description: "桌上仅有的一封密封信，封口完整。",
        sceneRef: "wake",
        causalBasisRefs: [],
        goal: "确认桌上唯一的密封信",
      }) as JsonRecord,
    );
    expect(materialized.kind, JSON.stringify(materialized)).toBe("committed");

    for (const [principal, characterId, suffix] of [
      [ALICE, ALICE_ID, "alice"],
      [BOB, BOB_ID, "bob"],
    ] as const) {
      if (suffix === "bob") {
        const driftPrepared = record(await room.authority.prepare(BOB, {
          kind: "intent",
          submissionId: "submission:stage4:letter-read-drift",
          text: "我读取同一封信，但不能改变它已经固化的正文。",
        }), "Bob source-drift prepare");
        const drift = record(await room.authority.commit(
          BOB,
          String(driftPrepared.preparedActionId),
          itemInformationObservationProposal(String(driftPrepared.rootActionId), {
            goal: "读取同一个已经固化的物件来源",
            sceneRef: "wake",
            itemRef: itemEntryId,
            sourceRef: knowledgeRef,
            information: {
              kind: "sourceClaim",
              semanticContent: "正午在王宫会面",
              sourceBasis: "密封信正文",
              motive: null,
              formedAtFictionMicros: null,
            },
          }),
        ), "Bob source-drift outcome");
        expect(drift.kind).toBe("needsKp");
        expect(JSON.stringify(drift)).not.toContain("午夜在旧渡口会面");
        expect(JSON.stringify(drift)).not.toContain(knowledgeRef);
      }
      const read = await act(
        room.authority,
        principal,
        `submission:stage4:letter-read:${suffix}`,
        "我亲自读完同一封信的会面时间与地点。",
        (rootActionId) => itemInformationObservationProposal(rootActionId, {
          goal: "读懂信中约定的会面信息",
          sceneRef: "wake",
          itemRef: itemEntryId,
          sourceRef: knowledgeRef,
          information: {
            kind: "sourceClaim",
            semanticContent: "午夜在旧渡口会面",
            sourceBasis: "密封信正文",
            motive: null,
            formedAtFictionMicros: null,
          },
        }) as JsonRecord,
      );
      expect(read.kind, JSON.stringify(read)).toBe("committed");
      expect(JSON.stringify(read.readModel)).toContain(knowledgeRef);
      expect(JSON.stringify(read.readModel)).toContain(characterId);
    }

    const held = await act(
      room.authority,
      ALICE,
      "submission:stage4:letter-acquire-after-reading",
      "我拿起已经读完的密封信。",
      (rootActionId) => sceneItemAcquisitionProposal(rootActionId, {
        goal: "拿起已经读完的密封信",
        sceneRef: "wake",
        itemRef: itemEntryId,
      }) as JsonRecord,
    );
    expect(held.kind, JSON.stringify(held)).toBe("committed");

    const destroyed = await act(
      room.authority,
      ALICE,
      "submission:stage4:letter-destroy",
      "我把已经读完的信投入火盆彻底烧毁。",
      (rootActionId) => consumeHeldItemProposal(rootActionId, itemEntryId) as JsonRecord,
    );
    expect(destroyed.kind, JSON.stringify(destroyed)).toBe("committed");

    const arrived = await act(
      room.authority,
      CAROL,
      "submission:stage4:carol-arrives-after-letter",
      "我从庭院来到灵堂，但信已经烧毁。",
      (rootActionId) => ({
        kind: "authenticatedPartyAction",
        action: "moveIndividually",
        destinationSceneId: "wake",
        fictionTimeCostMicros: "60000000",
        rootActionId,
      }),
    );
    expect(arrived.kind, JSON.stringify(arrived)).toBe("committed");
    const arrivalEvents = rootEvents(
      await archiveEvents(room.authority, room.archiveCapability),
      arrived,
    );
    expect(arrivalEvents.filter((event) => event.eventType === "CharacterMoved"))
      .toEqual([expect.objectContaining({
        payload: expect.objectContaining({
          characterId: CAROL_ID,
          destinationSceneId: "wake",
        }),
      })]);

    const unreadPrepared = record(await room.authority.prepare(CAROL, {
      kind: "intent",
      submissionId: "submission:stage4:carol-read-destroyed-letter",
      text: "我尝试阅读那封已经烧毁的信。",
    }), "Carol destroyed-letter prepare");
    const unread = record(await room.authority.commit(
      CAROL,
      String(unreadPrepared.preparedActionId),
      itemInformationObservationProposal(String(unreadPrepared.rootActionId), {
        goal: "读取已经烧毁的物件来源",
        sceneRef: "wake",
        itemRef: itemEntryId,
        sourceRef: knowledgeRef,
        information: {
          kind: "sourceClaim",
          semanticContent: "午夜在旧渡口会面",
          sourceBasis: "密封信正文",
          motive: null,
          formedAtFictionMicros: null,
        },
      }),
    ), "Carol destroyed-letter outcome");
    expect(unread.kind).toBe("needsKp");

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
      event.eventType === "ItemUsed"
      && record(event.payload, "destroy payload").entryId === itemEntryId);
    expect(record(destroyedEvent!.payload, "destroyed item payload")).toMatchObject({
      purpose: "密封信成为灰烬，无法再次阅读或使用",
      quantityBefore: 1,
      quantityAfter: 0,
    });
  }, 10_000);

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
          return privateFormProposal(initialRootActionId, "materialization.v1", {
            goal: "确认密封金库锁孔此前未定义的隐藏现实",
            method: "materializeHiddenReality",
            proposedFact: JSON.stringify({
              schema: "zhuwei.hidden-reality-candidate-set-draft/v1",
              ...candidateSet,
            }),
            basisRefs: ["wake"],
            resolution: "direct",
            durationUnit: "second",
            durationValue: 1,
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

    const bobBeforeHazard = record(await room.authority.observe(BOB), "Bob before yard hazard");
    const bobReadModel = record(bobBeforeHazard.readModel, "Bob pre-hazard read model");
    const bobTactical = record(bobReadModel.tacticalProjection, "Bob pre-hazard tactical projection");
    const bobSelf = record(bobTactical.self, "Bob pre-hazard tactical self");
    const bobPosition = record(bobSelf.position, "Bob pre-hazard position");
    const centerXInches = Number(bobPosition.x);
    const centerYInches = Number(bobPosition.y);
    const elevationInches = Number(bobPosition.elevation);
    expect(Number.isSafeInteger(centerXInches)).toBe(true);
    expect(Number.isSafeInteger(centerYInches)).toBe(true);
    expect(Number.isSafeInteger(elevationInches)).toBe(true);

    const yardHazardDraft = {
      goal: "让已经松脱的单片瓦沿垂直落点结算",
      method: "坠瓦已经松脱并落入柏然脚下的小范围",
      featureDescription: "庭院檐口上一片已经松脱的瓦",
      intendedOutcome: "瓦片落下，只影响落点范围内未避开的角色，随后碎裂",
      featureDisposition: "reasonable-open-blank",
      basisRefs: ["yard"],
      effectMode: "area-hazard",
      activation: "direct",
      material: "松脱瓦片与碎石",
      centerXInches,
      centerYInches,
      elevationInches,
      widthInches: 24,
      depthInches: 24,
      heightInches: 24,
      objectAc: 10,
      objectHitPoints: 1,
      damageThreshold: 0,
      immuneDamageTypes: ["poison", "psychic"],
      initialPhase: "hanging",
      phaseNames: ["hanging", "falling", "shattered"],
      phaseOpaque: [false, false, false],
      phaseImpassable: [false, false, false],
      phaseCover: ["none", "none", "none"],
      phaseEffectPropagation: ["passes", "passes", "passes"],
      phaseTerrain: ["normal", "normal", "rubble"],
      damageFromPhases: ["hanging"],
      damageRemainingAtOrBelow: [0],
      damageToPhases: ["falling"],
      stuntFromPhases: ["hanging"],
      stuntToPhases: ["falling"],
      hazardFromPhases: ["falling"],
      hazardToPhases: ["shattered"],
      hazardTriggerPhase: "falling",
      hazardResolvedPhase: "shattered",
      trigger: "松脱瓦片垂直坠落",
      areaOriginElevationInches: elevationInches + 36,
      areaRadiusInches: 60,
      propagation: "straight",
      saveAbility: "dex",
      saveDc: 30,
      halfOnSuccess: false,
      damage: "1d4+5",
      damageType: "bludgeoning",
      condition: "none",
      debrisOutcome: "瓦片碎成不阻碍通行的小片",
    };
    const hpChanged = record(await runInDurableObject(room.authority as never, async (instance) => {
      const target = instance as unknown as Authority & {
        authorityRoll(sides: number): number;
      };
      const originalRoll = target.authorityRoll;
      const rolls: number[] = [];
      target.authorityRoll = (sides) => {
        rolls.push(sides);
        if (sides === 4) return 4;
        if (sides === 20) return 1;
        throw new Error(`yard hazard requested unexpected d${sides}`);
      };
      try {
        const outcome = await act(
          target,
          BOB,
          "submission:stage4:bob-hp-change",
          "我在庭院被坠落瓦片砸伤。",
          (rootActionId) => privateFormProposal(
            rootActionId,
            "environmental-stunt.v1",
            yardHazardDraft,
          ) as JsonRecord,
        );
        expect(rolls).toEqual([4, 20]);
        return outcome;
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "yard hazard outcome");
    expect(hpChanged.kind, JSON.stringify(hpChanged)).toBe("committed");
    const hpChangedReadModel = record(hpChanged.readModel, "Bob post-hazard read model");
    expect(record(
      hpChangedReadModel.controlledCharacter,
      "Bob post-hazard controlled character",
    ).hitPoints).toEqual({ current: 11, maximum: 20 });
    const hpChangedEntities = record(hpChangedReadModel.entities, "Bob post-hazard entities");
    expect(record(hpChangedEntities[BOB_ID], "Bob post-hazard entity").hitPoints)
      .toEqual({ current: "11", maximum: "20", temporary: "0" });
    const aliceAfterHazard = record(await room.authority.observe(ALICE), "Alice after yard hazard");
    const aliceReadModel = record(aliceAfterHazard.readModel, "Alice post-hazard read model");
    expect(record(
      aliceReadModel.controlledCharacter,
      "Alice post-hazard character",
    ).hitPoints).toEqual({ current: 20, maximum: 20 });
    const aliceEntities = record(aliceReadModel.entities, "Alice post-hazard entities");
    expect(record(aliceEntities[ALICE_ID], "Alice post-hazard entity").hitPoints)
      .toEqual({ current: "20", maximum: "20", temporary: "0" });

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

    const allEvents = await archiveEvents(room.authority, room.archiveCapability);
    const hazardEvents = rootEvents(allEvents, hpChanged);
    const targetResolutions = hazardEvents
      .filter((event) => event.eventType === "EnvironmentAreaTargetResolved")
      .map((event) => record(event.payload, "yard hazard target resolution"));
    expect(targetResolutions).toEqual([expect.objectContaining({
      targetEntityId: BOB_ID,
      saveRolls: [1],
      saveSucceeded: false,
      rolledDamage: "9",
      appliedDamage: "9",
      statusApplied: "none",
      targetPatch: expect.objectContaining({
        hitPoints: { current: "11", maximum: "20", temporary: "0" },
      }),
    })]);
    expect(hazardEvents
      .filter((event) => event.eventType === "DamagePacketResolved")
      .map((event) => record(event.payload, "yard hazard damage packet").targetEntityId))
      .toEqual([BOB_ID]);

    const events = allEvents
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
