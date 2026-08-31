import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomCorrection } from "../app/_runtime/lib/room/action";
import {
  directConsequencesProposal,
  noncombatCheckProposal,
  productionActionPlanProposal,
} from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:archive:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:archive:bob", sessionVersion: 1 }),
});

const RAW_INTENT_SENTINEL = "RAW_INTENT_MUST_NOT_ENTER_ARCHIVE";
const PLAYER_TRANSCRIPT_SENTINEL = "PLAYER_TRANSCRIPT_MUST_NOT_ENTER_ARCHIVE";
const DELIVERY_BODY_SENTINEL = "DELIVERY_BODY_MUST_NOT_ENTER_ARCHIVE";
const MODEL_PROMPT_SENTINEL = "MODEL_PROMPT_MUST_NOT_ENTER_ARCHIVE";
const KP_TRANSCRIPT_SENTINEL = "KP_TRANSCRIPT_MUST_NOT_ENTER_ARCHIVE";
const PRIVATE_KNOWLEDGE_SENTINEL = "错分支上的私人暗号是白槲树";

type ServiceCapabilities = {
  archiveExport: unknown;
  disasterRecovery: unknown;
  correction: unknown;
};

type ArchiveAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(
    context: unknown,
    preparedActionId: string,
    proposal: unknown,
  ): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string, acknowledgementId?: string): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(archiveExportCapability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(
    disasterRecoveryCapability: unknown,
    archive: unknown,
  ): Promise<unknown>;
  commitCorrection(correctionCapability: unknown, request: unknown): Promise<unknown>;
};

type PreparedAction = RecordValue & {
  kind: "prepared";
  preparedActionId: string;
  rootActionId: string;
};

type InitializedRoom = {
  stub: ArchiveAuthority;
  capabilities: ServiceCapabilities;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function array(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function prepared(value: unknown): PreparedAction {
  const outcome = record(value, "prepare outcome");
  expect(outcome).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return outcome as PreparedAction;
}

function authority(name: string): ArchiveAuthority {
  return env.ROOMS.getByName(name) as unknown as ArchiveAuthority;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      resources: { resolve: 1 },
    },
  };
}

async function initializeRoom(name: string): Promise<InitializedRoom> {
  const stub = authority(name);
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [
      { principalId: ALICE.principal.id, role: "player" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [
      character("character:archive:alice", ALICE.principal.id, "archive"),
      character("character:archive:bob", BOB.principal.id, "yard"),
    ],
  }), "authoritative initialization");
  expect(initialized).toMatchObject({ created: true });

  const capabilities = record(
    initialized.serviceCapabilities,
    "trusted service capabilities",
  );
  for (const name of ["archiveExport", "disasterRecovery", "correction"] as const) {
    expect(capabilities[name], `${name} capability`).toBeDefined();
    expect(capabilities[name], `${name} capability`).not.toBeNull();
  }
  return { stub, capabilities: capabilities as ServiceCapabilities };
}

async function prepareIntent(
  stub: ArchiveAuthority,
  submissionId: string,
  text: string,
): Promise<PreparedAction> {
  return prepared(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId: "character:archive:alice",
    text,
  }));
}

function directSuccess(action: PreparedAction, proposalAttemptId: string, _publicResult: string) {
  void _publicResult;
  return directConsequencesProposal(action.rootActionId, {
    proposalAttemptId,
    goal: "检查现场并继续行动",
    method: "谨慎检查后继续前进",
    duration: { unit: "second", value: 1 },
  });
}

function consequentialCheck(action: PreparedAction) {
  const factRef = "fact:archive:vault-location";
  return noncombatCheckProposal(action.rootActionId, {
    proposalAttemptId: "proposal:archive:consequential-check:1",
    goal: "撞开内门并进入密室检查刻痕",
    method: "用肩膀撞开内门，进入密室后检查墙上刻痕",
    risk: {
      warning: "内门可能被撞开；进入后会花费决心并取得只属于行动者的感官证据。",
      successConsequences: ["进入密室、花费一点决心并取得私人感官证据。"],
      failureConsequences: ["内门没有打开，撞击声传了出去。"],
      retryGate: ["methodChanged", "situationAdvanced"],
    },
    ability: "str",
    skill: "athletics",
    dc: 1,
    mode: "normal",
    duration: { unit: "second", value: 1 },
    dynamicMaterializations: [{
      kind: "location",
      factRef,
      causalBasisRefs: [],
      visibilityPolicyRef: "visibility:room-authority-only",
      definition: { sceneId: "vault", name: "密室" },
    }],
    success: [
      { kind: "moveEntity", sceneRef: "vault" },
      { kind: "changeResource", resourceRef: "resolve", amount: -1 },
      {
        kind: "acquireKnowledge",
        knowledgeRef: "knowledge:archive:wrong-branch-code",
        value: PRIVATE_KNOWLEDGE_SENTINEL,
        definitionRef: factRef,
      },
    ],
    failure: [],
  });
}

async function commitDirect(
  stub: ArchiveAuthority,
  submissionId: string,
  publicResult: string,
  intentText = "我谨慎查看现场并继续前进。",
) {
  const action = await prepareIntent(stub, submissionId, intentText);
  const outcome = record(await stub.commit(
    ALICE,
    action.preparedActionId,
    directSuccess(action, `${submissionId}:proposal`, publicResult),
  ), "direct commit outcome");
  expect(outcome.kind).toBe("committed");
  return outcome;
}

function receipt(value: RecordValue): RecordValue {
  return record(value.receipt, "public receipt");
}

function deliveryPlan(value: RecordValue): RecordValue {
  const plan = record(value.deliveryPlan, "frozen delivery plan");
  expect(plan.publishCapability).toBeDefined();
  expect(plan.audiences).toEqual(expect.any(Array));
  return plan;
}

async function publishSensitiveDelivery(stub: ArchiveAuthority, committed: RecordValue) {
  const plan = deliveryPlan(committed);
  const frames = array(plan.audiences, "frozen audiences").map((candidate) => {
    const audience = record(candidate, "frozen audience");
    return {
      audienceId: audience.audienceId,
      narration: {
        text: [
          DELIVERY_BODY_SENTINEL,
          MODEL_PROMPT_SENTINEL,
          KP_TRANSCRIPT_SENTINEL,
          String(audience.characterId),
        ].join(" "),
        agencyClaims: [],
      },
    };
  });
  await expect(stub.publishDelivery(
    { publishCapability: plan.publishCapability },
    { frames },
  )).resolves.toMatchObject({ kind: "published" });
}

async function exportArchive(room: InitializedRoom): Promise<RecordValue> {
  const exported = record(await room.stub.exportAuthoritativeArchive(
    room.capabilities.archiveExport,
  ), "archive export outcome");
  expect(exported.kind).toBe("exported");
  return record(exported.archive, "authoritative archive");
}

function archiveEvents(archive: RecordValue): RecordValue[] {
  return array(archive.events, "archive events").map((entry) => record(entry, "archive event"));
}

function receiptRefs(archive: RecordValue): RecordValue[] {
  return array(archive.receiptRefs, "archive receipt references")
    .map((entry) => record(entry, "archive receipt reference"));
}

function eventType(event: RecordValue): string {
  return String(event.eventType);
}

function eventById(events: RecordValue[], eventId: unknown): RecordValue {
  const found = events.find((entry) => entry.eventId === eventId);
  expect(found, `event ${String(eventId)} must remain in the archive`).toBeDefined();
  return found!;
}

function receiptRefById(refs: RecordValue[], receiptId: unknown): RecordValue {
  const found = refs.find((entry) => entry.receiptId === receiptId);
  expect(found, `receipt ${String(receiptId)} must remain in the archive`).toBeDefined();
  return found!;
}

function assertArchiveShape(archive: RecordValue) {
  expect(Object.keys(archive).sort()).toEqual([
    "archiveHash",
    "events",
    "format",
    "head",
    "projectionAudits",
    "receiptRefs",
    "roomId",
    "signedGenesis",
  ]);
  expect(archive.format).toBe("zhuwei.authoritative-room-archive/v2");
  expect(record(archive.signedGenesis, "signed genesis")).toMatchObject({
    kind: "roomGenesis",
    genesisHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    profiles: expect.any(Object),
    initialStateHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
  });
  expect(archive.archiveHash).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
  expect(record(archive.head, "archive head")).toMatchObject({
    eventSeq: expect.anything(),
    eventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    stateHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    activeBranchId: expect.any(String),
  });
  expect(array(archive.projectionAudits, "projection audits").length).toBeGreaterThan(0);
}

function assertContinuousEvents(events: RecordValue[]) {
  expect(events.length).toBeGreaterThanOrEqual(2);
  for (const [index, event] of events.entries()) {
    expect(event).toMatchObject({
      eventId: expect.any(String),
      eventSeq: expect.anything(),
      roomId: expect.any(String),
      branchId: expect.any(String),
      eventType: expect.any(String),
      eventTypeVersion: expect.any(String),
      profiles: expect.any(Object),
      payloadHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      previousEventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      stateHashAfter: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      eventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    if (index > 0) {
      expect(Number(event.eventSeq)).toBe(Number(events[index - 1].eventSeq) + 1);
      expect(event.previousEventHash).toBe(events[index - 1].eventHash);
    }
  }
}

const FORBIDDEN_ARCHIVE_KEYS = new Set([
  "deliveryFrame",
  "deliveryBody",
  "currentDelivery",
  "narration",
  "narrationText",
  "prompt",
  "rawPrompt",
  "modelPrompt",
  "intentText",
  "rawIntent",
  "voiceTranscript",
  "transcriptBody",
  "audioBody",
  "audioUrl",
  "ssml",
  "messages",
  "messageHistory",
]);

function assertNoPresentationOrInputArchive(value: unknown, path = "archive") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPresentationOrInputArchive(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as RecordValue)) {
    expect(FORBIDDEN_ARCHIVE_KEYS.has(key), `${path}.${key} must not be archived`).toBe(false);
    assertNoPresentationOrInputArchive(entry, `${path}.${key}`);
  }
}

function cloneArchive(archive: RecordValue): RecordValue {
  return structuredClone(archive);
}

function observationReadModel(observation: unknown): RecordValue {
  return record(record(observation, "observation").readModel, "viewer read model");
}

describe("authoritative archive recovery and correction", () => {
  it("exports only integrity-bound genesis, continuous structured events, and minimal Receipt references", async () => {
    const room = await initializeRoom("archive-v2-export-sanitized");
    const first = await commitDirect(
      room.stub,
      "submission:archive:sensitive-intent",
      "第一项结构化结果已经提交。",
      `${RAW_INTENT_SENTINEL} ${PLAYER_TRANSCRIPT_SENTINEL}`,
    );
    await commitDirect(
      room.stub,
      "submission:archive:second-event",
      "第二项结构化结果已经提交。",
    );
    await publishSensitiveDelivery(room.stub, first);

    const beforeExport = record(await room.stub.observe(ALICE), "pre-export observation");
    expect(JSON.stringify(beforeExport.delivery)).toContain(DELIVERY_BODY_SENTINEL);

    const archive = await exportArchive(room);
    assertArchiveShape(archive);
    assertContinuousEvents(archiveEvents(archive));
    expect(receiptRefs(archive)).toEqual(expect.arrayContaining([
      expect.objectContaining({ receiptId: receipt(first).receiptId }),
    ]));
    for (const ref of receiptRefs(archive)) {
      expect(ref).not.toHaveProperty("readModel");
      expect(ref).not.toHaveProperty("kpProjection");
      expect(ref).not.toHaveProperty("mechanicalResult");
      expect(ref).not.toHaveProperty("events");
    }

    const encoded = JSON.stringify(archive);
    for (const sentinel of [
      RAW_INTENT_SENTINEL,
      PLAYER_TRANSCRIPT_SENTINEL,
      DELIVERY_BODY_SENTINEL,
      MODEL_PROMPT_SENTINEL,
      KP_TRANSCRIPT_SENTINEL,
    ]) {
      expect(encoded).not.toContain(sentinel);
    }
    assertNoPresentationOrInputArchive(archive);
    for (const capability of Object.values(room.capabilities)) {
      if (typeof capability === "string") expect(encoded).not.toContain(capability);
    }
  });

  it("restores an empty DO to an equivalent structured projection, no Delivery, and a writable authority head", async () => {
    const source = await initializeRoom("archive-v2-disaster-source");
    const committed = await commitDirect(
      source.stub,
      "submission:archive:before-disaster",
      "灾难前的结构化结果。",
    );
    await publishSensitiveDelivery(source.stub, committed);
    const sourceProjection = observationReadModel(await source.stub.observe(ALICE));
    const archive = await exportArchive(source);

    const target = authority("archive-v2-disaster-empty-target");
    await expect(target.restoreAuthoritativeArchive(ALICE, cloneArchive(archive)))
      .resolves.toMatchObject({ kind: "rejected", code: "recoveryUnauthorized" });
    await expect(target.observe(ALICE)).resolves.toMatchObject({
      kind: "rejected",
      code: "roomUninitialized",
    });

    const restored = record(await target.restoreAuthoritativeArchive(
      source.capabilities.disasterRecovery,
      cloneArchive(archive),
    ), "disaster restore outcome");
    expect(restored).toMatchObject({
      kind: "restored",
      roomId: archive.roomId,
      deliverySlotsRestored: 0,
      projectionIntegrity: "verified",
    });

    const recoveredObservation = record(await target.observe(ALICE), "recovered observation");
    expect(recoveredObservation.delivery).toEqual({ kind: "none" });
    expect(recoveredObservation.readModel).toEqual(sourceProjection);
    expect(JSON.stringify(recoveredObservation)).not.toContain(DELIVERY_BODY_SENTINEL);

    const continued = await commitDirect(
      target,
      "submission:archive:after-disaster",
      "恢复后的新行动成功提交。",
    );
    expect(receipt(continued)).toMatchObject({
      receiptId: expect.any(String),
      status: "committed",
    });
    const afterContinue = observationReadModel(await target.observe(ALICE));
    expect(JSON.stringify(afterContinue)).toContain(String(receipt(continued).receiptId));
  });

  it("rejects missing, reordered, rehashed, or wrong-Profile archives without exposing partial state", async () => {
    const source = await initializeRoom("archive-v2-integrity-source");
    await commitDirect(source.stub, "submission:archive:integrity:1", "完整性事件一。");
    await commitDirect(source.stub, "submission:archive:integrity:2", "完整性事件二。");
    const archive = await exportArchive(source);
    const originalEvents = archiveEvents(archive);
    expect(originalEvents.length).toBeGreaterThanOrEqual(2);

    const missing = cloneArchive(archive);
    (missing.events as unknown[]).splice(1, 1);

    const reordered = cloneArchive(archive);
    (reordered.events as unknown[]).reverse();

    const wrongHash = cloneArchive(archive);
    const hashEvent = record((wrongHash.events as unknown[])[0], "event to alter");
    hashEvent.payload = { alteredWithoutRehashing: true };

    const wrongProfile = cloneArchive(archive);
    const profileEvent = record((wrongProfile.events as unknown[])[0], "event Profile to alter");
    const manifest = record(profileEvent.profiles, "event Profile manifest");
    const ruleset = record(manifest.ruleset, "event Ruleset Profile");
    ruleset.profileHash = `sha256:${"0".repeat(64)}`;

    const cases = [
      { label: "missing", archive: missing, code: "archiveEventGap" },
      { label: "reordered", archive: reordered, code: "archiveEventOrder" },
      { label: "wrong-hash", archive: wrongHash, code: "archiveIntegrityMismatch" },
      { label: "wrong-profile", archive: wrongProfile, code: "profileIntegrityMismatch" },
    ];

    for (const candidate of cases) {
      const target = authority(`archive-v2-integrity-target-${candidate.label}`);
      const rejected = record(await target.restoreAuthoritativeArchive(
        source.capabilities.disasterRecovery,
        candidate.archive,
      ), `${candidate.label} restore rejection`);
      expect(rejected).toMatchObject({ kind: "rejected", code: candidate.code });
      expect(rejected).not.toHaveProperty("state");
      expect(rejected).not.toHaveProperty("readModel");
      expect(rejected).not.toHaveProperty("events");
      expect(JSON.stringify(rejected)).not.toContain("完整性事件");
      await expect(target.observe(ALICE)).resolves.toMatchObject({
        kind: "rejected",
        code: "roomUninitialized",
      });
    }
  });

  it("requires the opaque correction capability and makes a production ActionPlan correction idempotent by correctionId", async () => {
    const room = await initializeRoom("archive-v2-forward-correction");
    const committed = await commitDirect(
      room.stub,
      "submission:archive:forward-source",
      "一次错误地多推进了一秒的行动。",
    );
    const originalReceipt = receipt(committed);
    const request = {
      correctionId: "correction:archive:forward:1",
      receiptId: originalReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "这次行动不应推进虚构时间；尚无后继选择依赖它。",
    };

    await expect(room.stub.commitCorrection(ALICE, structuredClone(request)))
      .resolves.toMatchObject({ kind: "rejected", code: "correctionUnauthorized" });

    const corrected = record(await room.stub.commitCorrection(
      room.capabilities.correction,
      structuredClone(request),
    ), "forward correction outcome");
    expect(corrected).toMatchObject({
      kind: "committed",
      correctionId: request.correctionId,
      strategy: "causalBranch",
      receipt: { receiptId: expect.any(String), status: "committed" },
    });

    await expect(room.stub.commitCorrection(
      room.capabilities.correction,
      structuredClone(request),
    )).resolves.toEqual(corrected);
    await expect(room.stub.commitCorrection(room.capabilities.correction, {
      ...request,
      explanation: "同一个 correctionId 被换成了另一份载荷。",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "idempotencyPayloadMismatch",
    });

    const archive = await exportArchive(room);
    const refs = receiptRefs(archive);
    expect(receiptRefById(refs, originalReceipt.receiptId)).toMatchObject({
      receiptId: originalReceipt.receiptId,
    });
    expect(receiptRefById(refs, record(corrected.receipt, "correction receipt").receiptId))
      .toMatchObject({ correctionId: request.correctionId });
    expect(archiveEvents(archive).map(eventType)).toEqual(expect.arrayContaining([
      "CorrectionBranchOpened",
      "BranchActivated",
    ]));
  });

  it("forward-compensates public acquired knowledge with no downstream Root and restores that result", async () => {
    const room = await initializeRoom("archive-v2-public-knowledge-forward-correction");
    const factRef = "fact:archive:public-bell-schedule";
    const wrongPublicContent = "门厅告示牌写着钟声会在午夜响起";

    const factAction = await prepareIntent(
      room.stub,
      "submission:archive:public-fact",
      "我确认门厅确实立着一块所有在场者都能看到的告示牌。",
    );
    const factCommitted = record(await room.stub.commit(
      ALICE,
      factAction.preparedActionId,
      directConsequencesProposal(factAction.rootActionId, {
        proposalAttemptId: "proposal:archive:public-fact",
        goal: "确认门厅公开告示牌存在",
        method: "在门厅所有在场者面前指出告示牌",
        dynamicMaterializations: [{
          kind: "fact",
          factRef,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:public",
          definition: { kind: "postedSchedule", location: "archive" },
        }],
        duration: { unit: "second", value: 1 },
      }),
    ), "public fact commit");
    expect(factCommitted.kind, JSON.stringify(factCommitted)).toBe("committed");

    const acquisition = await prepareIntent(
      room.stub,
      "submission:archive:public-knowledge-wrong",
      "我当众读出告示牌上的钟声时间。",
    );
    const acquired = record(await room.stub.commit(
      ALICE,
      acquisition.preparedActionId,
      productionActionPlanProposal(acquisition.rootActionId, {
        operation: "changeKnowledge",
        knowledgeRef: factRef,
      }, {
        proposalAttemptId: "proposal:archive:public-knowledge-wrong",
        goal: wrongPublicContent,
        method: "在门厅公开读出告示牌内容",
        publicBasisRefs: [factRef],
      }),
    ), "public knowledge acquisition");
    expect(acquired.kind, JSON.stringify(acquired)).toBe("committed");
    const originalReceipt = receipt(acquired);
    const before = observationReadModel(await room.stub.observe(ALICE));
    const beforeKnowledge = array(before.knowledge, "public knowledge before correction")
      .map((entry) => record(entry, "knowledge entry"))
      .find((entry) => entry.knowledgeRef === factRef);
    expect(beforeKnowledge).toMatchObject({
      knowledgeRef: factRef,
      content: wrongPublicContent,
      visibility: "publiclyObservable",
    });

    const correctionRequest = {
      correctionId: "correction:archive:public-knowledge:1",
      receiptId: String(originalReceipt.receiptId),
      errorKind: "projectionIntegrity",
      explanation: "该公开告示的读取结果来自错误转写；尚无后继行动或选择依赖它。",
    };
    const corrected = record(await handleRoomCorrection({
      authority: room.stub,
      kp: {
        async narrate(request) {
          return {
            body: `已更正公开读取结果:${String((request as RecordValue).audienceId)}`,
            agencyClaims: [],
          };
        },
      },
    }, room.capabilities.correction, correctionRequest), "public knowledge correction");
    expect(corrected).toMatchObject({
      kind: "committed",
      correctionId: correctionRequest.correctionId,
      strategy: "forwardCompensation",
      activeBranchId: originalReceipt.activeBranchId,
    });
    expect(corrected).not.toHaveProperty("deliveryPending");

    const after = record(await room.stub.observe(ALICE), "Alice after public correction");
    expect(JSON.stringify(after.readModel)).not.toContain(wrongPublicContent);
    expect(array(record(after.readModel, "corrected read model").knowledge, "corrected knowledge")
      .map((entry) => record(entry, "corrected knowledge entry").knowledgeRef))
      .not.toContain(factRef);
    const correctionFrame = record(
      record(record(after.delivery, "correction delivery").frame, "correction frame"),
      "correction frame body",
    );
    expect(JSON.stringify(correctionFrame)).toContain("已更正公开读取结果");
    expect(JSON.stringify(correctionFrame)).not.toContain(wrongPublicContent);

    const archive = await exportArchive(room);
    expect(archiveEvents(archive).map(eventType)).toContain("CorrectionApplied");
    expect(archiveEvents(archive).map(eventType)).not.toContain("CorrectionBranchOpened");
    expect(JSON.stringify(archive)).not.toContain("已更正公开读取结果");

    const restored = authority("archive-v2-public-knowledge-forward-restored");
    await expect(restored.restoreAuthoritativeArchive(
      room.capabilities.disasterRecovery,
      cloneArchive(archive),
    )).resolves.toMatchObject({
      kind: "restored",
      deliverySlotsRestored: 0,
      projectionIntegrity: "verified",
    });
    const restoredView = record(await restored.observe(ALICE), "restored public correction view");
    expect(restoredView.delivery).toEqual({ kind: "none" });
    expect(restoredView.readModel).toEqual(after.readModel);
    expect(JSON.stringify(restoredView)).not.toContain(wrongPublicContent);
  });

  it("opens a causal branch while preserving audit and viewer-scoped experienced narration", async () => {
    const room = await initializeRoom("archive-v2-causal-correction");
    const action = await prepareIntent(
      room.stub,
      "submission:archive:causal-source",
      "我撞开内门，花费决心进入密室并检查墙上刻痕。",
    );
    const committed = record(await room.stub.commit(
      ALICE,
      action.preparedActionId,
      consequentialCheck(action),
    ), "consequential commit outcome");
    expect(committed.kind, JSON.stringify(committed)).toBe("committed");
    const originalReceipt = receipt(committed);
    const kpProjection = record(committed.kpProjection, "KP projection");
    expect(record(kpProjection.mechanicalResult, "mechanical result")).toMatchObject({
      randomness: [{ randomnessId: expect.any(String), faces: [expect.any(Number)] }],
    });
    await publishSensitiveDelivery(room.stub, committed);
    expect(JSON.stringify(await room.stub.observe(ALICE))).toContain(DELIVERY_BODY_SENTINEL);

    const before = await exportArchive(room);
    const beforeEvents = archiveEvents(before);
    const randomEvent = beforeEvents.find((event) =>
      /random|dice/i.test(eventType(event))
      && /"(?:face|faces)":/.test(JSON.stringify(event)));
    expect(randomEvent, "the committed DO-owned die face must be an auditable event").toBeDefined();
    const beforeReceiptRef = receiptRefById(receiptRefs(before), originalReceipt.receiptId);
    expect(beforeReceiptRef).toMatchObject({
      eventRange: expect.any(Object),
      randomnessCommitmentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });

    const correctionRequest = {
      correctionId: "correction:archive:causal:1",
      receiptId: originalReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "该检定使用了错误的规则依据；它已经改变位置、资源与私人知识。",
    };
    const corrected = record(await room.stub.commitCorrection(
      room.capabilities.correction,
      correctionRequest,
    ), "causal correction outcome");
    expect(corrected).toMatchObject({
      kind: "committed",
      correctionId: correctionRequest.correctionId,
      strategy: "causalBranch",
      activeBranchId: expect.any(String),
      receipt: { receiptId: expect.any(String), status: "committed" },
    });
    expect(corrected.activeBranchId).not.toBe(originalReceipt.activeBranchId);

    const after = await exportArchive(room);
    const afterEvents = archiveEvents(after);
    expect(eventById(afterEvents, randomEvent!.eventId)).toEqual(randomEvent);
    expect(afterEvents.map(eventType)).toEqual(expect.arrayContaining([
      "CorrectionBranchOpened",
      "BranchActivated",
    ]));
    const afterReceiptRef = receiptRefById(receiptRefs(after), originalReceipt.receiptId);
    expect(afterReceiptRef).toMatchObject({
      receiptId: beforeReceiptRef.receiptId,
      eventRange: beforeReceiptRef.eventRange,
      status: "superseded",
    });
    expect(afterReceiptRef.randomnessCommitmentHash)
      .toBe(beforeReceiptRef.randomnessCommitmentHash);

    const alice = record(await room.stub.observe(ALICE), "Alice active-branch observation");
    const bob = record(await room.stub.observe(BOB), "Bob active-branch observation");
    expect(record(alice.readModel, "Alice read model").activeBranchId)
      .toBe(corrected.activeBranchId);
    expect(record(bob.readModel, "Bob read model").activeBranchId)
      .toBe(corrected.activeBranchId);
    expect(JSON.stringify(alice)).not.toContain(PRIVATE_KNOWLEDGE_SENTINEL);
    expect(JSON.stringify(bob)).not.toContain(PRIVATE_KNOWLEDGE_SENTINEL);
    expect(alice.delivery).toEqual({ kind: "none" });
    expect(bob.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(alice.transcript)).toContain(DELIVERY_BODY_SENTINEL);
    expect(JSON.stringify(bob.transcript)).not.toContain(DELIVERY_BODY_SENTINEL);
    expect(JSON.stringify(after)).not.toContain(DELIVERY_BODY_SENTINEL);
  });
});
