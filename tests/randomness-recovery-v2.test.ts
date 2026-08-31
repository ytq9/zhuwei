import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { archiveSha256 } from "../app/_runtime/lib/room/archive";
import {
  directConsequencesProposal,
  noncombatCheckProposal,
  productionActionPlanProposal,
} from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:random-recovery:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:random-recovery:bob", sessionVersion: 1 }),
});

const CHECKPOINTS = [
  "beforeRandomnessRequestCommit",
  "afterRandomnessRequestCommit",
  "afterRandomnessCandidateCommit",
  "afterOutcomeCommitBeforeResponse",
] as const;

type RandomnessAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
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

function proposal(rootActionId: string) {
  return noncombatCheckProposal(rootActionId, {
    proposalAttemptId: `${rootActionId}:proposal:1`,
    goal: "撞开卡住的木门",
    method: "用肩膀撞开卡住的木门",
    risk: {
      warning: "门可能被撞开，失败会耗时并发出声响。",
      successConsequences: ["木门被撞开。"],
      failureConsequences: ["木门没有打开，撞击声传了出去。"],
      retryGate: ["methodChanged", "situationAdvanced"],
    },
    ability: "str",
    skill: "athletics",
    dc: 10,
    mode: "normal",
    duration: { unit: "second", value: 6 },
  });
}

function randomResult(outcome: RecordValue) {
  const projection = record(outcome.kpProjection, "KP projection");
  const mechanics = record(projection.mechanicalResult, "mechanical result");
  const randomness = list(mechanics.randomness, "randomness result");
  expect(randomness).toHaveLength(1);
  const result = record(randomness[0], "randomness draw");
  const faces = list(result.faces, "random faces");
  expect(faces).toHaveLength(1);
  expect(Number(faces[0])).toBeGreaterThanOrEqual(1);
  expect(Number(faces[0])).toBeLessThanOrEqual(20);
  return structuredClone(result);
}

async function initializedRoom(
  checkpoint: string,
  options: { includeOtherSceneCharacter?: boolean } = {},
) {
  const name = `randomness-recovery-v2-${checkpoint}`;
  const stub = env.ROOMS.getByName(name) as unknown as RandomnessAuthority;
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      ...(options.includeOtherSceneCharacter
        ? [{ principalId: BOB.principal.id, role: "player" }]
        : []),
    ],
    characters: [
      {
        characterId: "character:random-recovery:alice",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "yard",
          abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["athletics"],
        },
      },
      ...(options.includeOtherSceneCharacter ? [{
        characterId: "character:random-recovery:cellar",
        controllerPrincipalId: BOB.principal.id,
        staticCard: {
          name: "柏然",
          sceneId: "cellar",
          abilityScores: { str: 10, dex: 12, con: 12, int: 14, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: [],
        },
      }] : []),
    ],
  }), "randomness recovery initialization");
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${checkpoint}`,
    characterId: "character:random-recovery:alice",
    text: "我用肩膀撞开卡住的木门。",
  }), "prepared random action");
  expect(prepared).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return {
    stub,
    archiveExport: capabilities.archiveExport,
    preparedActionId: String(prepared.preparedActionId),
    proposal: proposal(String(prepared.rootActionId)),
  };
}

async function preparedDirectAction(
  stub: RandomnessAuthority,
  suffix: string,
  characterId = "character:random-recovery:alice",
  context: unknown = ALICE,
) {
  const prepared = record(await stub.prepare(context, {
    kind: "intent",
    submissionId: `submission:random-recovery:${suffix}`,
    characterId,
    text: "我稳住呼吸，观察四周。",
  }), `${suffix} direct prepare`);
  return {
    preparedActionId: String(prepared.preparedActionId),
    rootActionId: String(prepared.rootActionId),
    proposal: directConsequencesProposal(String(prepared.rootActionId), {
      goal: "稳住呼吸并观察四周",
      method: "在当前地点短暂观察，不改变另一地点的局势",
    }),
  };
}

async function initializedRestCapableRoom(suffix: string) {
  const name = `randomness-recovery-v2-${suffix}`;
  const stub = env.ROOMS.getByName(name) as unknown as RandomnessAuthority;
  const initialized = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: "character:random-recovery:alice",
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "yard",
        classId: "fighter",
        raceId: "human",
        subclassId: "champion",
        level: 3,
        scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        proficiency: 2,
        skills: ["athletics"],
        cantrips: [],
        prepared: [],
        features: [],
        hp: { current: 4, max: 20, temp: 0 },
        ac: 14,
        speed: 30,
        resources: {
          hitDice: { max: 3, used: 1 },
          surge: { max: 1, used: 1 },
          resolve: 1,
        },
      },
    }],
  }), "rest-capable randomness recovery initialization");
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  return { stub, archiveExport: capabilities.archiveExport };
}

async function commitSemanticIntent(
  stub: RandomnessAuthority,
  submissionId: string,
  text: string,
  mechanicalProposal: Parameters<typeof productionActionPlanProposal>[1],
) {
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId: "character:random-recovery:alice",
    text,
  }), `${submissionId} prepare`);
  expect(prepared.kind, JSON.stringify(prepared)).toBe("prepared");
  const rootActionId = String(prepared.rootActionId);
  return stub.commit(
    ALICE,
    String(prepared.preparedActionId),
    productionActionPlanProposal(rootActionId, mechanicalProposal, {
      goal: text,
      method: text,
      proposalAttemptId: `${rootActionId}:proposal:1`,
    }),
  );
}

describe("Room DO authoritative randomness crash recovery", () => {
  for (const checkpoint of CHECKPOINTS) {
    it(`recovers ${checkpoint} with one request, one face set, and one Receipt`, async () => {
      const room = await initializedRoom(checkpoint);
      const stubForHarness = room.stub as never;

      await expect(runInDurableObject(stubForHarness, async (instance) => {
        const target = instance as unknown as {
          authorityRecoveryCheckpoint?: (name: string) => void;
          commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
        };
        target.authorityRecoveryCheckpoint = (name: string) => {
          if (name === checkpoint) throw new Error(`simulated-crash:${checkpoint}`);
        };
        return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
      })).rejects.toThrow(`simulated-crash:${checkpoint}`);

      await evictDurableObject(stubForHarness);
      const recovered = record(await room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ), "recovered commit");
      expect(recovered.kind).toBe("committed");
      const recoveredReceipt = record(recovered.receipt, "recovered receipt");
      const recoveredRandomness = randomResult(recovered);
      expect(list(recoveredReceipt.randomnessCommitments, "randomness commitments"))
        .toEqual([
          expect.objectContaining({
            randomnessId: recoveredRandomness.randomnessId,
            requestHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            frozenParametersHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          }),
        ]);

      const responseLostRetry = record(await room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ), "response-lost retry");
      expect(responseLostRetry.receipt).toEqual(recoveredReceipt);
      expect(randomResult(responseLostRetry)).toEqual(recoveredRandomness);

      const exported = record(await room.stub.exportAuthoritativeArchive(
        room.archiveExport,
      ), "archive export");
      const archive = record(exported.archive, "archive");
      const events = list(archive.events, "archive events").map((entry) => record(entry, "event"));
      expect(events.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(1);
      expect(events.filter((event) => event.eventType === "ImprovisedCheckResolved")).toHaveLength(1);
      const refs = list(archive.receiptRefs, "receipt refs").map((entry) => record(entry, "receipt ref"));
      expect(refs.filter((entry) => entry.receiptId === recoveredReceipt.receiptId)).toHaveLength(1);
    });
  }

  it("gives concurrent duplicate commits the same persisted candidate and Receipt", async () => {
    const room = await initializedRoom("concurrent-duplicate-candidate");
    const [leftValue, rightValue] = await Promise.all([
      room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ),
      room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      ),
    ]);
    const left = record(leftValue, "left concurrent commit");
    const right = record(rightValue, "right concurrent commit");
    expect(left.kind, JSON.stringify(left)).toBe("committed");
    expect(right.kind, JSON.stringify(right)).toBe("committed");
    expect(right.receipt).toEqual(left.receipt);
    expect(randomResult(right)).toEqual(randomResult(left));

    const receipt = record(left.receipt, "concurrent receipt");
    const exported = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "concurrent archive export");
    const archive = record(exported.archive, "concurrent archive");
    const events = list(archive.events, "concurrent archive events")
      .map((entry) => record(entry, "concurrent event"));
    expect(events.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "ImprovisedCheckResolved")).toHaveLength(1);
    const refs = list(archive.receiptRefs, "concurrent receipt refs")
      .map((entry) => record(entry, "concurrent receipt ref"));
    expect(refs.filter((entry) => entry.receiptId === receipt.receiptId)).toHaveLength(1);
  });

  for (const tamperCase of [
    {
      name: "rewritten request-event prefix",
      mutate(events: RecordValue[]) {
        return [{ ...events[0], eventId: `${String(events[0].eventId)}:tampered` }, ...events.slice(1)];
      },
    },
    {
      name: "events-only request-event suffix",
      mutate(events: RecordValue[]) {
        const last = events[events.length - 1];
        return [...events, {
          ...last,
          eventId: `${String(last.eventId)}:forged-suffix`,
          eventSeq: (BigInt(String(last.eventSeq)) + 1_000n).toString(),
        }];
      },
    },
  ] as const) {
    it(`rejects a ${tamperCase.name} that is absent from durable authority events`, async () => {
      const room = await initializedRoom(`tampered-${tamperCase.name.replaceAll(" ", "-")}`);
      const harnessStub = room.stub as never;
      await expect(runInDurableObject(harnessStub, async (instance) => {
        const target = instance as unknown as {
          authorityRecoveryCheckpoint?: (name: string) => void;
          commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
        };
        target.authorityRecoveryCheckpoint = (name: string) => {
          if (name === "afterRandomnessCandidateCommit") {
            throw new Error(`simulated-crash:${tamperCase.name}`);
          }
        };
        return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
      })).rejects.toThrow(`simulated-crash:${tamperCase.name}`);

      await runInDurableObject(harnessStub, async (_instance, state) => {
        const row = state.storage.sql.exec<{ request_events_json: string }>(`
          SELECT request_events_json FROM authority_randomness_batches
          WHERE prepared_action_id = ?
        `, room.preparedActionId).toArray()[0];
        const requestEvents = list(JSON.parse(row!.request_events_json), "tampered request events")
          .map((event) => record(event, "tampered request event"));
        state.storage.sql.exec(
          `UPDATE authority_randomness_batches SET request_events_json = ?
           WHERE prepared_action_id = ?`,
          JSON.stringify(tamperCase.mutate(requestEvents)),
          room.preparedActionId,
        );
      });
      await evictDurableObject(harnessStub);

      await expect(room.stub.commit(
        ALICE,
        room.preparedActionId,
        structuredClone(room.proposal),
      )).resolves.toEqual({
        kind: "retryableFailure",
        code: "randomnessJournalIntegrityMismatch",
      });
    });
  }

  it("rejects another persisted activity-due root slice substituted into this submission journal", async () => {
    const room = await initializedRestCapableRoom("tampered-cross-root-activity-due-slice");
    await expect(commitSemanticIntent(
      room.stub,
      "submission:tampered-cross-root:rest-start",
      "我短休一小时并花一枚生命骰。",
      {
        operation: "resolveRest",
        restKind: "short",
        hitDiceToSpend: 1,
        arcaneRecoverySlotLevels: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(commitSemanticIntent(
      room.stub,
      "submission:tampered-cross-root:time-passage",
      "我保持休息，直到一小时过去。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "hour", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(commitSemanticIntent(
      room.stub,
      "submission:tampered-cross-root:settle-rest",
      "一小时已过，我先结算休整。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });

    const prepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:tampered-cross-root:current-check",
      characterId: "character:random-recovery:alice",
      text: "我撞开另一扇卡住的木门。",
    }), "cross-root current check prepare");
    const preparedActionId = String(prepared.preparedActionId);
    const currentProposal = proposal(String(prepared.rootActionId));
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:tampered-cross-root-activity-due-slice");
        }
      };
      return target.commit(ALICE, preparedActionId, structuredClone(currentProposal));
    })).rejects.toThrow("simulated-crash:tampered-cross-root-activity-due-slice");

    await runInDurableObject(harnessStub, async (_instance, state) => {
      const rows = state.storage.sql.exec<{ root_action_id: string; event_json: string }>(`
        SELECT root_action_id, event_json
        FROM authority_events
        WHERE root_action_id LIKE 'activity-due:%'
        ORDER BY length(event_seq), event_seq
      `).toArray();
      const activityDueRoot = rows[0]?.root_action_id;
      expect(activityDueRoot).toMatch(/^activity-due:/);
      const genuineSlice = rows
        .filter((row) => row.root_action_id === activityDueRoot)
        .map((row) => JSON.parse(row.event_json));
      expect(genuineSlice.some((event) => record(event, "activity-due event").eventType
        === "RandomnessRequested")).toBe(true);
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          `UPDATE authority_randomness_batches SET request_events_json = ?
           WHERE prepared_action_id = ?`,
          JSON.stringify(genuineSlice),
          preparedActionId,
        );
      });
    });
    await evictDurableObject(harnessStub);

    await expect(room.stub.commit(
      ALICE,
      preparedActionId,
      structuredClone(currentProposal),
    )).resolves.toEqual({
      kind: "retryableFailure",
      code: "randomnessJournalIntegrityMismatch",
    });
  });

  it("fails closed for an activity-due journal whose recovery predates root binding", async () => {
    const room = await initializedRestCapableRoom("legacy-unbound-activity-due");
    await expect(commitSemanticIntent(
      room.stub,
      "submission:legacy-unbound-activity-due:rest-start",
      "我短休一小时并花一枚生命骰。",
      {
        operation: "resolveRest",
        restKind: "short",
        hitDiceToSpend: 1,
        arcaneRecoverySlotLevels: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(commitSemanticIntent(
      room.stub,
      "submission:legacy-unbound-activity-due:time-passage",
      "我保持休息，直到一小时过去。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "hour", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    )).resolves.toMatchObject({ kind: "committed" });

    const prepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:legacy-unbound-activity-due:trigger",
      characterId: "character:random-recovery:alice",
      text: "一小时已过，我先结算休整。",
    }), "legacy unbound activity-due prepare");
    const preparedActionId = String(prepared.preparedActionId);
    const triggerProposal = directConsequencesProposal(String(prepared.rootActionId));
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:legacy-unbound-activity-due");
        }
      };
      return target.commit(ALICE, preparedActionId, structuredClone(triggerProposal));
    })).rejects.toThrow("simulated-crash:legacy-unbound-activity-due");

    await runInDurableObject(harnessStub, async (_instance, state) => {
      const row = state.storage.sql.exec<{
        proposal_hash: string;
        recovery_json: string;
      }>(`
        SELECT proposal_hash, recovery_json FROM authority_proposal_recovery
        WHERE prepared_action_id = ?
      `, preparedActionId).toArray()[0];
      const recovery = record(JSON.parse(row!.recovery_json), "bound recovery");
      expect(recovery.initialRandomnessRootActionId).toMatch(/^activity-due:/);
      const legacyRecovery = { ...recovery };
      delete legacyRecovery.initialRandomnessRootActionId;
      const legacyRecoveryHash = await archiveSha256({
        proposalHash: row!.proposal_hash,
        recovery: legacyRecovery,
      });
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          `UPDATE authority_proposal_recovery
           SET recovery_hash = ?, recovery_json = ?
           WHERE prepared_action_id = ?`,
          legacyRecoveryHash,
          JSON.stringify(legacyRecovery),
          preparedActionId,
        );
      });
    });
    await evictDurableObject(harnessStub);

    await expect(room.stub.commit(
      ALICE,
      preparedActionId,
      structuredClone(triggerProposal),
    )).resolves.toEqual({
      kind: "retryableFailure",
      code: "randomnessJournalIntegrityMismatch",
    });
  });

  it("rejects a genuine same-root slice without a RandomnessRequested event", async () => {
    const room = await initializedRoom("tampered-same-root-non-request-slice");
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:tampered-same-root-non-request-slice");
        }
      };
      return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
    })).rejects.toThrow("simulated-crash:tampered-same-root-non-request-slice");

    await runInDurableObject(harnessStub, async (_instance, state) => {
      const batch = state.storage.sql.exec<{ request_events_json: string }>(`
        SELECT request_events_json FROM authority_randomness_batches
        WHERE prepared_action_id = ?
      `, room.preparedActionId).toArray()[0];
      const requestEvents = list(JSON.parse(batch!.request_events_json), "same-root source events")
        .map((event) => record(event, "same-root source event"));
      const genuineNonRequest = requestEvents.find((event) => event.eventType !== "RandomnessRequested");
      expect(genuineNonRequest).toBeDefined();
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          `UPDATE authority_randomness_batches SET request_events_json = ?
           WHERE prepared_action_id = ?`,
          JSON.stringify([genuineNonRequest]),
          room.preparedActionId,
        );
      });
    });
    await evictDurableObject(harnessStub);

    await expect(room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    )).resolves.toEqual({
      kind: "retryableFailure",
      code: "randomnessJournalIntegrityMismatch",
    });
  });

  it("rejects journal requests that differ from the persisted RandomnessRequested payload", async () => {
    const room = await initializedRoom("tampered-event-request-mismatch");
    await expect(room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    )).resolves.toMatchObject({ kind: "committed" });

    const prepared = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:tampered-event-request-mismatch:current",
      characterId: "character:random-recovery:alice",
      text: "我再撞开另一扇卡住的木门。",
    }), "event-request mismatch current prepare");
    const preparedActionId = String(prepared.preparedActionId);
    const currentProposal = proposal(String(prepared.rootActionId));
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:tampered-event-request-mismatch");
        }
      };
      return target.commit(ALICE, preparedActionId, structuredClone(currentProposal));
    })).rejects.toThrow("simulated-crash:tampered-event-request-mismatch");

    await runInDurableObject(harnessStub, async (_instance, state) => {
      const oldBatch = state.storage.sql.exec<{ requests_json: string }>(`
        SELECT requests_json FROM authority_randomness_batches
        WHERE prepared_action_id = ?
      `, room.preparedActionId).toArray()[0];
      const currentBatch = state.storage.sql.exec<{ candidates_json: string | null }>(`
        SELECT candidates_json FROM authority_randomness_batches
        WHERE prepared_action_id = ?
      `, preparedActionId).toArray()[0];
      const oldRequest = record(
        list(JSON.parse(oldBatch!.requests_json), "old journal requests")[0],
        "old journal request",
      );
      const currentCandidate = record(
        list(JSON.parse(currentBatch!.candidates_json!), "current candidates")[0],
        "current candidate",
      );
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          `UPDATE authority_randomness_batches
           SET requests_json = ?, candidates_json = ?
           WHERE prepared_action_id = ?`,
          oldBatch!.requests_json,
          JSON.stringify([{
            randomnessId: oldRequest.randomnessId,
            faces: currentCandidate.faces,
          }]),
          preparedActionId,
        );
      });
    });
    await evictDurableObject(harnessStub);

    await expect(room.stub.commit(
      ALICE,
      preparedActionId,
      structuredClone(currentProposal),
    )).resolves.toEqual({
      kind: "retryableFailure",
      code: "randomnessJournalIntegrityMismatch",
    });
  });

  it("holds a durable per-scene settlement lock until the crashed random action completes", async () => {
    const room = await initializedRoom("same-scene-settlement-lock");
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:same-scene-settlement-lock");
        }
      };
      return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
    })).rejects.toThrow("simulated-crash:same-scene-settlement-lock");

    await evictDurableObject(harnessStub);
    const blockedAction = await preparedDirectAction(room.stub, "blocked-same-scene");
    const blocked = record(await room.stub.commit(
      ALICE,
      blockedAction.preparedActionId,
      structuredClone(blockedAction.proposal),
    ), "blocked same-scene commit");
    expect(blocked).toEqual({
      kind: "retryableFailure",
      code: "sceneRandomnessSettlementInProgress",
    });

    const beforeRecovery = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "pre-recovery archive export");
    const beforeRecoveryEvents = list(
      record(beforeRecovery.archive, "pre-recovery archive").events,
      "pre-recovery events",
    ).map((entry) => record(entry, "pre-recovery event"));
    expect(beforeRecoveryEvents.filter((event) =>
      event.rootActionId === blockedAction.rootActionId)).toHaveLength(0);

    const recovered = record(await room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    ), "settlement owner recovery");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");

    const afterRelease = await preparedDirectAction(room.stub, "released-same-scene");
    await expect(room.stub.commit(
      ALICE,
      afterRelease.preparedActionId,
      structuredClone(afterRelease.proposal),
    )).resolves.toMatchObject({ kind: "committed" });
  });

  it("allows only one of two prepared random actions to journal requests in a scene", async () => {
    const room = await initializedRoom("same-scene-random-request-lock");
    const contender = record(await room.stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:random-recovery:request-lock-contender",
      characterId: "character:random-recovery:alice",
      text: "我试着推开另一扇卡住的木门。",
    }), "random request contender prepare");
    const contenderRootActionId = String(contender.rootActionId);
    const contenderProposal = proposal(contenderRootActionId);

    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessRequestCommit") {
          throw new Error("simulated-crash:same-scene-random-request-lock");
        }
      };
      return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
    })).rejects.toThrow("simulated-crash:same-scene-random-request-lock");

    await evictDurableObject(harnessStub);
    await expect(room.stub.commit(
      ALICE,
      String(contender.preparedActionId),
      structuredClone(contenderProposal),
    )).resolves.toEqual({
      kind: "retryableFailure",
      code: "sceneRandomnessSettlementInProgress",
    });

    const exported = record(await room.stub.exportAuthoritativeArchive(
      room.archiveExport,
    ), "request-lock archive export");
    const events = list(record(exported.archive, "request-lock archive").events, "request-lock events")
      .map((entry) => record(entry, "request-lock event"));
    expect(events.filter((event) => event.rootActionId === contenderRootActionId)).toHaveLength(0);

    await expect(room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    )).resolves.toMatchObject({ kind: "committed" });
  });

  it("does not extend a crashed random settlement lock to another scene", async () => {
    const room = await initializedRoom("different-scene-settlement-lock", {
      includeOtherSceneCharacter: true,
    });
    const harnessStub = room.stub as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "afterRandomnessRequestCommit") {
          throw new Error("simulated-crash:different-scene-settlement-lock");
        }
      };
      return target.commit(ALICE, room.preparedActionId, structuredClone(room.proposal));
    })).rejects.toThrow("simulated-crash:different-scene-settlement-lock");

    await evictDurableObject(harnessStub);
    const otherSceneAction = await preparedDirectAction(
      room.stub,
      "allowed-other-scene",
      "character:random-recovery:cellar",
      BOB,
    );
    await expect(room.stub.commit(
      BOB,
      otherSceneAction.preparedActionId,
      structuredClone(otherSceneAction.proposal),
    )).resolves.toMatchObject({ kind: "committed" });

    const recovered = record(await room.stub.commit(
      ALICE,
      room.preparedActionId,
      structuredClone(room.proposal),
    ), "cross-scene settlement recovery");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
  });
});
