import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { noncombatCheckProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:precedent:alice", sessionVersion: 1 }),
});
const SECRET_BASIS_REF = "knowledge:precedent:hidden-iron-brace";
const PUBLIC_RULE_BASIS = "SRD 5.1：力量（运动）检定可用于以蛮力突破障碍。";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

type Prepared = JsonRecord & {
  kind: "prepared";
  preparedActionId: string;
  rootActionId: string;
};

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

function prepared(value: unknown): Prepared {
  const result = record(value, "prepared action");
  expect(result).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return result as Prepared;
}

function authority(name: string): Authority {
  return env.ROOMS.getByName(name) as unknown as Authority;
}

function intent(submissionId: string, text: string) {
  return {
    kind: "intent",
    submissionId,
    characterId: "character:precedent:alice",
    text,
  };
}

function precedentProposal(
  action: Prepared,
  options: {
    dc: number;
    method: string;
    adjudicationPrecedent: JsonRecord;
  },
) {
  return {
    ...noncombatCheckProposal(action.rootActionId, {
      proposalAttemptId: `proposal:${action.rootActionId}:1`,
      goal: "打开祠堂里被铁件卡住的旧门",
      method: options.method,
      publicBasisRefs: [],
      privateBasisRefs: [SECRET_BASIS_REF],
      ability: "str",
      skill: "athletics",
      dc: options.dc,
      mode: "normal",
      duration: { unit: "minute", value: 1 },
      risk: {
        warning: `按当前做法需要通过 DC ${options.dc} 的力量（运动）检定。`,
        successConsequences: ["旧门被打开。"],
        failureConsequences: ["旧门仍然关闭，尝试耗费一分钟。"],
        retryGate: ["methodChanged", "materialAssistance"],
      },
      success: [],
      failure: [],
    }),
    adjudicationPrecedent: options.adjudicationPrecedent,
  };
}

function precedentsFromPrepared(value: unknown): JsonRecord[] {
  const kpProjection = record(record(value, "prepared action").kpProjection, "KP projection");
  return list(kpProjection.adjudicationPrecedents, "KP adjudication precedents")
    .map((entry) => record(entry, "KP adjudication precedent"));
}

function precedentsFromObservation(value: unknown): JsonRecord[] {
  const readModel = record(record(value, "Room observation").readModel, "player read model");
  return list(readModel.adjudicationPrecedents, "public adjudication precedents")
    .map((entry) => record(entry, "public adjudication precedent"));
}

describe("SPEC 0004 adjudication precedents", () => {
  it("records and supersedes an important ruling through Room, projects only its public explanation, and replays it stably", async () => {
    const source = authority("adjudication-precedent-v2-source");
    const initialized = record(await source.initializeAuthoritative({
      roomId: "adjudication-precedent-v2-source",
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "player" }],
      characters: [{
        characterId: "character:precedent:alice",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "Alice",
          sceneId: "shrine",
          abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["athletics"],
        },
      }],
      fixtureFacts: [{
        knowledgeRef: SECRET_BASIS_REF,
        holderEntityId: "npc:precedent:keeper",
        holderName: "守祠人",
        sceneId: "shrine",
        content: "门轴内侧另有一条只有守祠人知道的铁撑。",
      }],
    }), "authoritative initialization");
    expect(initialized).toMatchObject({ created: true });
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const original = prepared(await source.prepare(
      ALICE,
      intent("submission:precedent:record", "我徒手推开这扇被铁件卡住的旧门。"),
    ));
    const originalCommit = record(await source.commit(
      ALICE,
      original.preparedActionId,
      precedentProposal(original, {
        dc: 15,
        method: "徒手抵住门板后持续发力",
        adjudicationPrecedent: {
          kind: "record",
          publicRuleBasis: [PUBLIC_RULE_BASIS],
          applicabilityScope: { kind: "scene", ref: "shrine" },
        },
      }),
    ), "original precedent commit");
    expect(originalCommit.kind).toBe("committed");

    const publicOriginal = precedentsFromObservation(await source.observe(ALICE));
    expect(publicOriginal).toHaveLength(1);
    expect(Object.keys(publicOriginal[0]).sort()).toEqual([
      "applicabilityScope",
      "precedentId",
      "publicExplanation",
      "publicRuleBasis",
      "status",
    ]);
    expect(publicOriginal[0]).toMatchObject({
      status: "active",
      publicExplanation: "按当前做法需要通过 DC 15 的力量（运动）检定。",
      publicRuleBasis: [PUBLIC_RULE_BASIS],
      applicabilityScope: { kind: "scene", ref: "shrine" },
    });
    expect(JSON.stringify(publicOriginal)).not.toContain(SECRET_BASIS_REF);

    const followUp = prepared(await source.prepare(
      ALICE,
      intent("submission:precedent:follow-up", "我先回想刚才的裁定，再决定怎样处理门。"),
    ));
    const fullOriginal = precedentsFromPrepared(followUp);
    expect(fullOriginal).toHaveLength(1);
    expect(fullOriginal[0]).toMatchObject({
      status: "active",
      canonicalContextFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      publicExplanation: "按当前做法需要通过 DC 15 的力量（运动）检定。",
      publicRuleBasis: [PUBLIC_RULE_BASIS],
      publicBasisRefs: [],
      privateBasisRefs: [SECRET_BASIS_REF],
      mechanics: {
        operation: "resolveNoncombatCheck",
        ability: "str",
        skill: "athletics",
        dc: 15,
        duration: { unit: "minute", value: 1 },
        outcomeRange: {
          success: ["旧门被打开。"],
          failure: ["旧门仍然关闭，尝试耗费一分钟。"],
        },
      },
      applicabilityScope: { kind: "scene", ref: "shrine" },
      rulesetProfile: { profileId: "dnd5e-2014-srd5.1-authoritative-v2" },
      runtimeManifestProfile: { profileId: "runtime-srd51-2014-authoritative-v2" },
    });
    const originalPrecedentId = String(fullOriginal[0].precedentId);

    const superseding = prepared(await source.prepare(
      ALICE,
      intent("submission:precedent:supersede", "我改用撬棍撬动门轴，再推开旧门。"),
    ));
    const supersedingCommit = record(await source.commit(
      ALICE,
      superseding.preparedActionId,
      precedentProposal(superseding, {
        dc: 10,
        method: "把撬棍插入门轴缝隙形成杠杆后推门",
        adjudicationPrecedent: {
          kind: "supersede",
          supersededPrecedentId: originalPrecedentId,
          materialDifferences: ["新增撬棍作为实质帮助，做法改变且 DC 从 15 降为 10。"],
          publicRuleBasis: [PUBLIC_RULE_BASIS],
          applicabilityScope: { kind: "scene", ref: "shrine" },
        },
      }),
    ), "superseding precedent commit");
    expect(supersedingCommit.kind).toBe("committed");

    const afterSupersede = prepared(await source.prepare(
      ALICE,
      intent("submission:precedent:after-supersede", "我核对当前仍适用的裁定。"),
    ));
    const sourceReplayValue = precedentsFromPrepared(afterSupersede);
    expect(sourceReplayValue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        precedentId: originalPrecedentId,
        status: "superseded",
        supersededByPrecedentId: expect.any(String),
      }),
      expect.objectContaining({
        status: "active",
        supersededPrecedentId: originalPrecedentId,
        materialDifferences: ["新增撬棍作为实质帮助，做法改变且 DC 从 15 降为 10。"],
        mechanics: expect.objectContaining({ dc: 10 }),
      }),
    ]));
    const current = sourceReplayValue.find((entry) => entry.status === "active");
    expect(current?.canonicalContextFingerprint).not.toBe(fullOriginal[0].canonicalContextFingerprint);

    const publicAfterSupersede = precedentsFromObservation(await source.observe(ALICE));
    expect(JSON.stringify(publicAfterSupersede)).not.toContain(SECRET_BASIS_REF);
    expect(publicAfterSupersede).toEqual(expect.arrayContaining([
      expect.objectContaining({ precedentId: originalPrecedentId, status: "superseded" }),
      expect.objectContaining({
        status: "active",
        supersededPrecedentId: originalPrecedentId,
        materialDifferences: ["新增撬棍作为实质帮助，做法改变且 DC 从 15 降为 10。"],
      }),
    ]));

    const exported = record(await source.exportAuthoritativeArchive(
      capabilities.archiveExport,
    ), "archive export");
    const archive = record(exported.archive, "authoritative archive");
    const precedentEvents = list(archive.events, "archive events")
      .map((event) => record(event, "archive event"))
      .filter((event) => String(event.eventType).startsWith("AdjudicationPrecedent"));
    expect(precedentEvents.map((event) => event.eventType)).toEqual([
      "AdjudicationPrecedentRecorded",
      "AdjudicationPrecedentSuperseded",
    ]);
    expect(record(precedentEvents[0].payload, "recorded precedent payload"))
      .toMatchObject({ precedentId: originalPrecedentId, privateBasisRefs: [SECRET_BASIS_REF] });

    const restored = authority("adjudication-precedent-v2-restored");
    await expect(restored.restoreAuthoritativeArchive(
      capabilities.disasterRecovery,
      structuredClone(archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    const restoredFollowUp = prepared(await restored.prepare(
      ALICE,
      intent("submission:precedent:restored", "恢复后我再次核对当前裁定。"),
    ));
    expect(precedentsFromPrepared(restoredFollowUp)).toEqual(sourceReplayValue);
  });
});
