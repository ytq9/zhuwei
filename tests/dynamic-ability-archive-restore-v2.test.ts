import { env } from "cloudflare:workers";
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
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:dynamic-ability:alice", sessionVersion: 1 }),
});
const ALICE_ID = "character:dynamic-ability:alice";
const ABILITY_ID = "ability:archive:focus-step";
const EXPECTED_DEFINITION_HASH =
  "sha256:3745e869a9042a8d20273a634dee05227783d7eb3c1cbfae0ab3cdc023e19e4f";

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

async function initialize(roomId: string) {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: ALICE_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        scores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
        proficiency: 2,
        hp: { current: 20, max: 20, temp: 0 },
        resources: { focus: 2 },
        equipped: {},
        backpack: [],
      },
    }],
  }), `${roomId} initialization`);
  expect(initialized.created).toBe(true);
  return {
    authority,
    capabilities: record(initialized.serviceCapabilities, "service capabilities"),
  };
}

async function act(
  authority: Authority,
  submissionId: string,
  text: string,
  proposal: (rootActionId: string) => JsonRecord,
) {
  return record(await handleRoomAction({
    principal: ALICE,
    authority,
    kp: {
      async propose(value) {
        return proposal(String(record(value, "proposal request").rootActionId));
      },
      async narrate() {
        return { body: "已提交的动态能力结果进入当前世界。", agencyClaims: [] };
      },
    },
  }, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} outcome`);
}

async function exportArchive(authority: Authority, capability: unknown) {
  const exported = record(
    await authority.exportAuthoritativeArchive(capability),
    "archive export",
  );
  expect(exported.kind).toBe("exported");
  return record(exported.archive, "authoritative archive");
}

function archiveEvents(archive: JsonRecord) {
  return list(archive.events, "archive events").map((event) => record(event, "archive event"));
}

function readModel(outcome: unknown) {
  return record(record(outcome, "room outcome").readModel, "room read model");
}

function combatFocus(outcome: unknown) {
  const controlled = record(readModel(outcome).controlledCharacter, "controlled character");
  const combat = record(controlled.combat, "controlled combat projection");
  const resources = record(combat.resources, "combat resources");
  return record(resources.focus, "focus pool");
}

function invocationEvents(archive: JsonRecord, outcome: JsonRecord) {
  const rootActionId = String(record(outcome.receipt, "public receipt").rootActionId);
  return archiveEvents(archive)
    .filter((event) => event.rootActionId === rootActionId)
    .filter((event) => ["ResourceSpent", "AbilityInvoked"].includes(String(event.eventType)))
    .map((event) => ({ eventType: event.eventType, payload: event.payload }));
}

describe("dynamic AbilityDefinition archive recovery", () => {
  it("restores the compiled definition into a fresh Room and invokes it through the same public action seam", async () => {
    const source = await initialize("dynamic-ability-archive-source-v2");
    const definition = {
      activation: { kind: "free" },
      costs: [{ amount: 1, kind: "resource", resourceId: "focus" }],
      definitionId: ABILITY_ID,
      definitionKind: "ability",
      publicDescription: "消耗一点专注，完成一次稳定的动态能力调用。",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      visibilityPolicy: "public",
    };

    const registered = await act(
      source.authority,
      "submission:dynamic-ability:register",
      "我将刚刚掌握的聚神步固化为可调用能力。",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        goal: "固化并登记聚神步的机械定义",
        method: "按已确认的消耗与时点登记能力",
        dynamicMaterializations: [{
          kind: "ability",
          factRef: ABILITY_ID,
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:public",
          definition,
        }],
      }) as JsonRecord,
    );
    expect(registered.kind, JSON.stringify(registered)).toBe("committed");

    const sourceArchiveBeforeInvocation = await exportArchive(
      source.authority,
      source.capabilities.archiveExport,
    );
    const definitionEvents = archiveEvents(sourceArchiveBeforeInvocation)
      .filter((event) => event.eventType === "DefinitionRegistered")
      .filter((event) => record(event.payload, "definition payload").definitionHash === EXPECTED_DEFINITION_HASH);
    expect(definitionEvents).toHaveLength(1);
    const frozenPayload = record(definitionEvents[0].payload, "compiled definition payload");
    expect(frozenPayload).toMatchObject({
      definitionHash: EXPECTED_DEFINITION_HASH,
      compiledHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(record(readModel(registered).abilityDefinitions, "visible ability definitions")[ABILITY_ID])
      .toMatchObject({
        definitionId: ABILITY_ID,
        definitionHash: EXPECTED_DEFINITION_HASH,
        compiledHash: frozenPayload.compiledHash,
      });

    const restoredAuthority = env.ROOMS.getByName(
      "dynamic-ability-archive-restored-v2",
    ) as unknown as Authority;
    await expect(restoredAuthority.restoreAuthoritativeArchive(
      source.capabilities.disasterRecovery,
      structuredClone(sourceArchiveBeforeInvocation),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    const restoredObservation = record(
      await restoredAuthority.observe(ALICE),
      "restored observation",
    );
    expect(record(restoredObservation.readModel, "restored read model").abilityDefinitions)
      .toEqual(readModel(registered).abilityDefinitions);

    const invoke = (authority: Authority) => act(
      authority,
      "submission:dynamic-ability:invoke",
      "我调用聚神步并支付一点专注。",
      (rootActionId) => productionActionPlanProposal(rootActionId, {
        operation: "invokeCombatAction",
        abilityRef: ABILITY_ID,
      }, {
        kind: "highRiskFeasible",
        goal: "调用已经固化的聚神步",
        method: "支付一点专注并执行其冻结机械",
      }) as JsonRecord,
    );
    const [sourceInvocation, restoredInvocation] = await Promise.all([
      invoke(source.authority),
      invoke(restoredAuthority),
    ]);
    expect(sourceInvocation.kind, JSON.stringify(sourceInvocation)).toBe("committed");
    expect(restoredInvocation.kind, JSON.stringify(restoredInvocation)).toBe("committed");
    expect(combatFocus(sourceInvocation)).toEqual({ current: "1", maximum: "2" });
    expect(combatFocus(restoredInvocation)).toEqual({ current: "1", maximum: "2" });
    expect(readModel(restoredInvocation)).toEqual(readModel(sourceInvocation));

    const [sourceArchiveAfter, restoredArchiveAfter] = await Promise.all([
      exportArchive(source.authority, source.capabilities.archiveExport),
      exportArchive(restoredAuthority, source.capabilities.archiveExport),
    ]);
    expect(restoredArchiveAfter.head).toEqual(sourceArchiveAfter.head);
    expect(invocationEvents(restoredArchiveAfter, restoredInvocation)).toEqual(
      invocationEvents(sourceArchiveAfter, sourceInvocation),
    );
    expect(invocationEvents(restoredArchiveAfter, restoredInvocation).map(({ eventType }) => eventType))
      .toEqual(["ResourceSpent", "AbilityInvoked"]);
    expect(archiveEvents(restoredArchiveAfter)
      .filter((event) => event.eventType === "DefinitionRegistered")
      .filter((event) => record(event.payload, "restored definition payload").definitionHash === EXPECTED_DEFINITION_HASH))
      .toHaveLength(1);
  });
});
