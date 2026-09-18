import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:bob", sessionVersion: 1 }),
});
const MALLORY = Object.freeze({
  principal: Object.freeze({ id: "principal:mallory", sessionVersion: 1 }),
});

type AuthorityStub = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(authenticatedContext: unknown, actionInput: unknown): Promise<unknown>;
  commit(
    authenticatedContext: unknown,
    preparedActionId: string,
    mechanicalProposal: unknown,
  ): Promise<unknown>;
  observe(authenticatedContext: unknown): Promise<unknown>;
  acknowledge(authenticatedContext: unknown, deliveryId: string): Promise<unknown>;
  commitCorrection(correctionCapability: unknown, request: unknown): Promise<unknown>;
};

function roomStub(name: string): AuthorityStub {
  return env.ROOMS.getByName(name) as unknown as AuthorityStub;
}

function character(
  characterId: string,
  controllerPrincipalId: string,
  sceneId: "shrine" | "yard" = "shrine",
) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
    },
  };
}

async function authoritativeRoom(
  name: string,
  characters = [character("character:alice", ALICE.principal.id)],
) {
  const stub = roomStub(name);
  const principalIds = [...new Set([
    ...characters.map((entry) => entry.controllerPrincipalId),
    MALLORY.principal.id,
  ])];
  const initialized = await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: principalIds.map((principalId) => ({ principalId, role: "player" })),
    characters,
  });
  expect(initialized).toMatchObject({ created: true });
  return stub;
}

function intent(
  submissionId: string,
  characterId: string,
  text = "我稳步向前，花一点时间确认周围没有新的危险。",
) {
  return { kind: "intent", submissionId, characterId, text } as const;
}

describe("Room Authority authoritative-v2 public contract", () => {

  it("rejects a cross-principal prepare race before returning the winner's private projection", async () => {
    const stub = await authoritativeRoom("authority-v2-cross-principal-prepare-race", [
      character("character:alice", ALICE.principal.id, "shrine"),
      character("character:bob", BOB.principal.id, "yard"),
    ]);
    const action = {
      kind: "intent",
      submissionId: "submission:cross-principal-race",
      text: "我先确认自己所在地点周围有没有新的危险。",
    } as const;
    const raced = await runInDurableObject(stub as never, async (instance) => {
      const target = instance as unknown as {
        pinnedAuthorityModule(replay: unknown): Promise<unknown>;
        prepare(context: unknown, input: unknown): Promise<unknown>;
      };
      const originalPinnedModule = target.pinnedAuthorityModule.bind(target);
      let pinnedCalls = 0;
      let releaseSlow!: () => void;
      let signalSlowPaused!: () => void;
      const slowGate = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      const slowPaused = new Promise<void>((resolve) => {
        signalSlowPaused = resolve;
      });
      target.pinnedAuthorityModule = async (replay: unknown) => {
        pinnedCalls += 1;
        if (pinnedCalls === 1) {
          signalSlowPaused();
          await slowGate;
        }
        return originalPinnedModule(replay);
      };

      const slowAlice = target.prepare(ALICE, structuredClone(action));
      await slowPaused;
      const winningBob = await target.prepare(BOB, structuredClone(action));
      releaseSlow();
      const losingAlice = await slowAlice;
      const repeatedBob = await target.prepare(BOB, structuredClone(action));
      return { winningBob, losingAlice, repeatedBob };
    });

    expect(raced.losingAlice).toMatchObject({
      kind: "rejected",
      code: "submissionUnauthorized",
    });
    expect(raced.winningBob).toMatchObject({
      kind: "prepared",
      preparedActionId: "prepared-action:submission:cross-principal-race",
    });
    expect(raced.repeatedBob).toEqual(raced.winningBob);
  });

});
