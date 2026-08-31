import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  handleRoomAction,
  handleRoomCorrection,
} from "../app/_runtime/lib/room/action";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";
import { privateFormProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type RoomAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({
    id: "principal:death-successor-correction:alice",
    sessionVersion: 1,
  }),
});

const PREDECESSOR_ID = "character:death-successor-correction:predecessor";
const SUCCESSOR_ID = "character:death-successor-correction:successor";
const PREDECESSOR_PRIVATE_KNOWLEDGE = "前任独自知道：银叶暗号对应旧王室密道";
const PREDECESSOR_PRIVATE_KNOWLEDGE_REF = "knowledge:death-successor:predecessor-private";
const SUCCESSOR_KNOWLEDGE = "继任者在错误分支看到：钟架背面刻着一道新划痕";
const SUCCESSOR_KNOWLEDGE_REF = "knowledge:death-successor:successor-choice";
const SUCCESSOR_FACT_REF = "fact:death-successor:successor-bell-mark";
const FATAL_DELIVERY = "错误死亡已经结算";
const SUCCESSOR_DELIVERY = "继任者已经作出后继选择";
const CORRECTION_DELIVERY = "死亡记录已更正，旧继任分支仅保留供审计";

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

function authority(name: string): RoomAuthority {
  return env.ROOMS.getByName(name) as unknown as RoomAuthority;
}

function readModel(value: unknown, label: string): JsonRecord {
  return record(record(value, label).readModel, `${label} read model`);
}

function publicReceipt(value: JsonRecord, label: string): JsonRecord {
  return record(value.receipt, `${label} Receipt`);
}

function predecessorSeed() {
  return {
    characterId: PREDECESSOR_ID,
    controllerPrincipalId: ALICE.principal.id,
    staticCard: {
      name: "守钥人阿岚",
      sceneId: "wake",
      classId: "fighter",
      raceId: "human",
      subclassId: "champion",
      level: 3,
      scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      proficiency: 2,
      skills: ["athletics"],
      hp: { current: 1, max: 18, temp: 0 },
      ac: 17,
      speed: 30,
      resources: { resolve: 2 },
      equipped: { armor: "chain" },
      backpack: [{ itemId: "explorer-pack", qty: 2 }],
    },
  };
}

function successorSeed() {
  return {
    characterId: SUCCESSOR_ID,
    controllerPrincipalId: ALICE.principal.id,
    staticCard: {
      name: "继任者苍岚",
      sceneId: "wake",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      level: 3,
      scores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["investigation"],
      hp: { current: 18, max: 18, temp: 0 },
      ac: 12,
      speed: 30,
      resources: { resolve: 2 },
      equipped: {},
      backpack: [],
    },
  };
}

function fatalAreaHazardDraft(): JsonRecord {
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

async function runAction(
  stub: RoomAuthority,
  submissionId: string,
  text: string,
  narration: string,
  proposal: (rootActionId: string) => JsonRecord,
): Promise<JsonRecord> {
  return record(await handleRoomAction({
    principal: ALICE,
    authority: stub,
    kp: {
      async propose(request) {
        return proposal(String(record(request, `${submissionId} proposal request`).rootActionId));
      },
      async narrate() {
        return { body: narration };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} outcome`);
}

async function exportArchive(stub: RoomAuthority, capability: unknown): Promise<JsonRecord> {
  const exported = record(
    await stub.exportAuthoritativeArchive(capability),
    "authoritative archive export",
  );
  expect(exported.kind).toBe("exported");
  return record(exported.archive, "authoritative archive");
}

function archiveEvents(archive: JsonRecord): JsonRecord[] {
  return list(archive.events, "archive events")
    .map((event) => record(event, "archive event"));
}

function archiveReceipt(archive: JsonRecord, receiptId: unknown): JsonRecord {
  const found = list(archive.receiptRefs, "archive Receipt references")
    .map((entry) => record(entry, "archive Receipt reference"))
    .find((entry) => entry.receiptId === receiptId);
  expect(found, `Receipt ${String(receiptId)} must remain in the archive`).toBeDefined();
  return found!;
}

function knowledge(read: JsonRecord): JsonRecord[] {
  return list(read.knowledge, "projected knowledge")
    .map((entry) => record(entry, "projected knowledge entry"));
}

describe("SPEC 0008 acceptance 6 at the Room responsibility interface", () => {
  it("branches an erroneous fatal action after a clean successor acts, preserving audit without transferring character state", async () => {
    const roomId = "death-successor-correction-room-v2";
    const stub = authority(roomId);
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [predecessorSeed()],
      fixtureFacts: [{
        knowledgeRef: PREDECESSOR_PRIVATE_KNOWLEDGE_REF,
        holderEntityId: PREDECESSOR_ID,
        content: PREDECESSOR_PRIVATE_KNOWLEDGE,
      }],
    }), "authoritative initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const initialRead = readModel(await stub.observe(ALICE), "initial predecessor observation");
    expect(record(initialRead.controlledCharacter, "initial predecessor")).toMatchObject({
      characterId: PREDECESSOR_ID,
      tenureStatus: "active",
      hitPoints: { current: 1, maximum: 18 },
      loadout: {
        armorClass: 17,
        speedFeet: 30,
        equipped: { armor: expect.stringContaining(":chain:") },
        backpack: [
          { itemId: expect.stringContaining(":explorer-pack:"), quantity: 1 },
          { itemId: expect.stringContaining(":explorer-pack:"), quantity: 1 },
        ],
      },
    });
    expect(knowledge(initialRead)).toEqual([
      expect.objectContaining({
        knowledgeRef: PREDECESSOR_PRIVATE_KNOWLEDGE_REF,
        content: PREDECESSOR_PRIVATE_KNOWLEDGE,
        visibility: "private",
      }),
    ]);

    const fatal = await runAction(
      stub,
      "submission:death-successor:fatal",
      "坍落石梁击中我；这项已冻结机械后果被错误地记成致命。",
      FATAL_DELIVERY,
      (rootActionId) => privateFormProposal(
        rootActionId,
        "environmental-stunt.v1",
        fatalAreaHazardDraft(),
        "proposal:death-successor:fatal:1",
      ) as JsonRecord,
    );
    expect(fatal.kind, JSON.stringify(fatal)).toBe("committed");
    const fatalReceipt = publicReceipt(fatal, "fatal action");
    expect(record(fatal.readModel, "fatal public read model")).toMatchObject({
      controlledCharacter: null,
      lifecycle: {
        kind: "successorRequired",
        defaultPredecessorCharacterId: PREDECESSOR_ID,
        eligiblePredecessors: [expect.objectContaining({
          characterId: PREDECESSOR_ID,
          tenureStatus: "dead",
        })],
      },
    });
    const fatalArchive = await exportArchive(stub, capabilities.archiveExport);
    expect(archiveEvents(fatalArchive)
      .filter((event) => event.rootActionId === fatalReceipt.rootActionId)
      .map((event) => event.eventType))
      .toEqual(expect.arrayContaining([
        "EnvironmentHazardTriggered",
        "EnvironmentAreaTargetResolved",
        "DamagePacketResolved",
        "CreatureDied",
      ]));
    await expect(stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:death-successor:dead-predecessor-cannot-act",
      text: "我继续以已经死亡的前任行动。",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });
    await expect(stub.observe(ALICE)).resolves.toMatchObject({
      readModel: {
        controlledCharacter: null,
        lifecycle: {
          kind: "successorRequired",
          defaultPredecessorCharacterId: PREDECESSOR_ID,
        },
      },
    });

    const introduced = record(await stub.applyRoomAdministration(
      capabilities.roomAdministration,
      {
        commandId: "room-admin:death-successor:introduce",
        kind: "introduceSuccessor",
        principalId: ALICE.principal.id,
        predecessorCharacterId: PREDECESSOR_ID,
        character: successorSeed(),
        worldEntry: "在确认前任死亡后，以独立人物身份来到苏醒室。",
      },
    ), "successor introduction");
    expect(introduced.kind, JSON.stringify(introduced)).toBe("committed");
    const introducedReceipt = publicReceipt(introduced, "successor introduction");

    const cleanSuccessorRead = readModel(await stub.observe(ALICE), "clean successor observation");
    expect(record(cleanSuccessorRead.controlledCharacter, "clean successor")).toMatchObject({
      characterId: SUCCESSOR_ID,
      tenureStatus: "active",
      loadout: {
        armorClass: 13,
        speedFeet: 30,
        equipped: {},
        backpack: [],
      },
    });
    expect(knowledge(cleanSuccessorRead)).toEqual([]);
    expect(JSON.stringify(cleanSuccessorRead)).not.toContain(PREDECESSOR_PRIVATE_KNOWLEDGE);
    expect(JSON.stringify(cleanSuccessorRead)).not.toContain("chain");
    expect(JSON.stringify(cleanSuccessorRead)).not.toContain("explorer-pack");

    const successorAction = await runAction(
      stub,
      "submission:death-successor:successor-acts",
      "我花费一点决心，检查钟架背面并记住新划痕。",
      SUCCESSOR_DELIVERY,
      (rootActionId) => privateFormProposal(rootActionId, "materialization.v1", {
        goal: "检查钟架背面并记住新划痕",
        method: "commitWorldConsequences",
        proposedFact: JSON.stringify({
          schema: "zhuwei.world-consequence-draft/v1",
          factRef: SUCCESSOR_FACT_REF,
          summary: "钟架背面有一道新划痕",
          consequences: [
            { kind: "spendResource", resourceRef: "resolve", amount: 1 },
            {
              kind: "acquireKnowledge",
              knowledgeRef: SUCCESSOR_KNOWLEDGE_REF,
              content: SUCCESSOR_KNOWLEDGE,
            },
          ],
        }),
        basisRefs: ["wake"],
        resolution: "direct",
        durationUnit: "second",
        durationValue: 1,
      }, "proposal:death-successor:successor-acts:1") as JsonRecord,
    );
    expect(successorAction.kind, JSON.stringify(successorAction)).toBe("committed");
    const successorActionReceipt = publicReceipt(successorAction, "successor action");
    const actedSuccessorRead = readModel(await stub.observe(ALICE), "acted successor observation");
    expect(record(actedSuccessorRead.controlledCharacter, "acted successor")).toMatchObject({
      characterId: SUCCESSOR_ID,
      resources: { resolve: 1 },
      loadout: { equipped: {}, backpack: [] },
    });
    expect(knowledge(actedSuccessorRead)).toEqual([
      expect.objectContaining({
        knowledgeRef: SUCCESSOR_KNOWLEDGE_REF,
        content: SUCCESSOR_KNOWLEDGE,
      }),
    ]);
    expect(JSON.stringify(actedSuccessorRead)).not.toContain(PREDECESSOR_PRIVATE_KNOWLEDGE);
    expect(JSON.stringify(record(
      record(await stub.observe(ALICE), "successor Delivery observation").delivery,
      "successor Delivery",
    ))).toContain(SUCCESSOR_DELIVERY);

    const beforeCorrection = await exportArchive(stub, capabilities.archiveExport);
    const beforeCorrectionEvents = archiveEvents(beforeCorrection);
    const correctionRequest = {
      correctionId: "correction:death-successor:erroneous-death",
      receiptId: fatalReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "石梁伤害被错误地判定为死亡；继任者已经行动，因此旧结果进入审计分支。",
    };
    await expect(stub.commitCorrection(ALICE, structuredClone(correctionRequest)))
      .resolves.toMatchObject({ kind: "rejected", code: "correctionUnauthorized" });

    let correctionNarrations = 0;
    const correctionContext = {
      authority: stub,
      kp: {
        async narrate() {
          correctionNarrations += 1;
          return { body: CORRECTION_DELIVERY };
        },
      },
    };
    const corrected = record(await handleRoomCorrection(
      correctionContext,
      capabilities.correction,
      correctionRequest,
    ), "death correction");
    expect(corrected, "a death correction with an existing successor choice must branch").toMatchObject({
      kind: "committed",
      correctionId: correctionRequest.correctionId,
      strategy: "causalBranch",
      activeBranchId: expect.stringMatching(/^branch:correction:/),
      supersededRootActionIds: expect.arrayContaining([
        fatalReceipt.rootActionId,
        introducedReceipt.rootActionId,
        successorActionReceipt.rootActionId,
      ]),
      receipt: { status: "committed" },
    });
    expect(corrected).not.toHaveProperty("deliveryPending");
    const correctionReceipt = publicReceipt(corrected, "correction");

    const afterFirstCorrection = await exportArchive(stub, capabilities.archiveExport);
    const narrationsAfterFirstCorrection = correctionNarrations;
    const retried = record(await handleRoomCorrection(
      correctionContext,
      capabilities.correction,
      structuredClone(correctionRequest),
    ), "idempotent correction retry");
    expect(retried).toEqual(corrected);
    expect(correctionNarrations).toBe(narrationsAfterFirstCorrection);
    expect(archiveEvents(await exportArchive(stub, capabilities.archiveExport)))
      .toEqual(archiveEvents(afterFirstCorrection));
    await expect(stub.commitCorrection(capabilities.correction, {
      ...correctionRequest,
      explanation: "同一个 correctionId 不得替换为另一份载荷。",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "idempotencyPayloadMismatch",
    });

    const correctedObservation = record(await stub.observe(ALICE), "corrected predecessor observation");
    const correctedRead = readModel(correctedObservation, "corrected predecessor observation");
    expect(correctedRead.activeBranchId).toBe(corrected.activeBranchId);
    expect(record(correctedRead.controlledCharacter, "restored predecessor")).toMatchObject({
      characterId: PREDECESSOR_ID,
      tenureStatus: "active",
      hitPoints: { current: 1, maximum: 18 },
      resources: { resolve: 2 },
      loadout: {
        armorClass: 17,
        speedFeet: 30,
        equipped: { armor: expect.stringContaining(":chain:") },
        backpack: [
          { itemId: expect.stringContaining(":explorer-pack:"), quantity: 1 },
          { itemId: expect.stringContaining(":explorer-pack:"), quantity: 1 },
        ],
      },
    });
    expect(knowledge(correctedRead)).toEqual([
      expect.objectContaining({
        knowledgeRef: PREDECESSOR_PRIVATE_KNOWLEDGE_REF,
        content: PREDECESSOR_PRIVATE_KNOWLEDGE,
      }),
    ]);
    expect(JSON.stringify(correctedRead)).not.toContain(SUCCESSOR_ID);
    expect(JSON.stringify(correctedRead)).not.toContain(SUCCESSOR_KNOWLEDGE);
    expect(list(correctedRead.visibleFacts, "corrected visible facts")
      .map((entry) => record(entry, "corrected visible fact").id))
      .not.toContain(SUCCESSOR_FACT_REF);
    const replacementFrame = record(
      record(correctedObservation.delivery, "replacement Delivery").frame,
      "replacement Delivery frame",
    );
    expect(replacementFrame).toMatchObject({
      receiptId: correctionReceipt.receiptId,
      activeBranchId: corrected.activeBranchId,
      text: CORRECTION_DELIVERY,
    });
    expect(JSON.stringify(replacementFrame)).not.toContain(FATAL_DELIVERY);
    expect(JSON.stringify(replacementFrame)).not.toContain(SUCCESSOR_DELIVERY);
    expect(JSON.stringify(replacementFrame)).not.toContain(PREDECESSOR_PRIVATE_KNOWLEDGE);
    expect(JSON.stringify(replacementFrame)).not.toContain(SUCCESSOR_KNOWLEDGE);

    const correctedArchive = await exportArchive(stub, capabilities.archiveExport);
    const correctedEvents = archiveEvents(correctedArchive);
    expect(
      correctedEvents.slice(0, beforeCorrectionEvents.length),
      "correction must append a branch without deleting or rewriting old history",
    ).toEqual(beforeCorrectionEvents);
    expect(correctedEvents.slice(beforeCorrectionEvents.length).map((event) => event.eventType))
      .toEqual(["CorrectionBranchOpened", "BranchActivated"]);
    for (const originalReceipt of [fatalReceipt, introducedReceipt, successorActionReceipt]) {
      const beforeReference = archiveReceipt(beforeCorrection, originalReceipt.receiptId);
      expect(archiveReceipt(correctedArchive, originalReceipt.receiptId)).toMatchObject({
        receiptId: originalReceipt.receiptId,
        rootActionId: originalReceipt.rootActionId,
        eventRange: beforeReference.eventRange,
        status: "superseded",
      });
    }
    expect(archiveReceipt(correctedArchive, correctionReceipt.receiptId)).toMatchObject({
      receiptId: correctionReceipt.receiptId,
      correctionId: correctionRequest.correctionId,
      status: "committed",
    });
    expect(JSON.stringify(correctedArchive)).not.toContain(CORRECTION_DELIVERY);

    const restored = authority("death-successor-correction-room-v2-restored");
    await expect(restored.restoreAuthoritativeArchive(
      capabilities.disasterRecovery,
      structuredClone(correctedArchive),
    )).resolves.toMatchObject({
      kind: "restored",
      deliverySlotsRestored: 0,
      projectionIntegrity: "verified",
    });
    const restoredObservation = record(await restored.observe(ALICE), "restored observation");
    expect(restoredObservation.delivery).toEqual({ kind: "none" });
    expect(restoredObservation.readModel).toEqual(correctedRead);
    const restoredArchive = await exportArchive(restored, capabilities.archiveExport);
    expect(restoredArchive.events).toEqual(correctedArchive.events);
    expect(restoredArchive.receiptRefs).toEqual(correctedArchive.receiptRefs);
    expect(restoredArchive.head).toEqual(correctedArchive.head);
  }, 15_000);
});
