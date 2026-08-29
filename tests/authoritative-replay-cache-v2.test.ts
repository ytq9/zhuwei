import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

describe("authoritative replay cache", () => {
  it("reuses one verified head, returns isolated values, and misses after a commit", async () => {
    const roomId = "authoritative-replay-cache-v2";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
      members: [
        { principalId: "principal:replay-cache:host", role: "host" },
        { principalId: "principal:replay-cache:observer", role: "observer" },
      ],
      characters: [{
        characterId: "character:replay-cache:host",
        controllerPrincipalId: "principal:replay-cache:host",
        staticCard: { name: "缓存守望者", sceneId: "yard" },
      }],
    }), "room initialization");
    expect(initialized.created).toBe(true);
    const administration = record(
      record(initialized.serviceCapabilities, "service capabilities").roomAdministration,
      "room administration capability",
    );

    const evidence = await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authoritativeReplay(): JsonRecord;
        applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
        authorityStore: {
          events(): unknown[];
        };
      };
      const originalEvents = target.authorityStore.events.bind(target.authorityStore);
      let fullEventReads = 0;
      target.authorityStore.events = () => {
        fullEventReads += 1;
        return originalEvents();
      };

      const first = target.authoritativeReplay();
      const firstState = record(first.state, "first replay state");
      const originalBranchId = String(firstState.activeBranchId);
      firstState.activeBranchId = "branch:caller-mutation";
      const sameHead = target.authoritativeReplay();
      const sameHeadState = record(sameHead.state, "same-head replay state");
      const sameHeadSeq = String(record(sameHead.replay, "same-head replay result").head
        && record(record(sameHead.replay, "same-head replay result").head, "same-head replay head").eventSeq);

      const committed = record(await target.applyRoomAdministration(administration, {
        kind: "removeMember",
        commandId: "room-admin:replay-cache:remove-observer",
        principalId: "principal:replay-cache:observer",
        reason: "cacheInvalidationFixture",
      }), "room administration outcome");
      expect(committed.kind, JSON.stringify(committed)).toBe("committed");

      const changedHead = target.authoritativeReplay();
      const changedHeadSeq = String(record(changedHead.replay, "changed-head replay result").head
        && record(record(changedHead.replay, "changed-head replay result").head, "changed-head replay head").eventSeq);
      const changedHeadAgain = target.authoritativeReplay();

      return {
        fullEventReads,
        originalBranchId,
        sameHeadBranchId: sameHeadState.activeBranchId,
        sameHeadSeq,
        changedHeadSeq,
        changedHeadAgainSeq: record(
          record(changedHeadAgain.replay, "changed-head cached replay result").head,
          "changed-head cached replay head",
        ).eventSeq,
      };
    });

    expect(evidence).toEqual({
      fullEventReads: 2,
      originalBranchId: "branch:main",
      sameHeadBranchId: "branch:main",
      sameHeadSeq: "0",
      changedHeadSeq: "2",
      changedHeadAgainSeq: "2",
    });
  });
});
