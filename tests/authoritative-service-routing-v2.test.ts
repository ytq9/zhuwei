import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { roomServiceCapabilities } from "../app/_runtime/lib/room/archive";
import { observationProposal } from "./helpers/authoritative-proposal";

function roomId(label: string) {
  return `room:service-routing:${label}:${crypto.randomUUID()}`;
}

async function seedRoom(id: string) {
  const authority = env.ROOMS.getByName(id);
  const initialized = await authority.initializeAuthoritative({
    roomId: id,
    moduleId: "black-oak-will",
    members: [
      { principalId: "principal:alice", role: "host" },
      { principalId: "principal:bob", role: "player" },
    ],
    characters: [
      {
        characterId: characterId("principal:alice"),
        controllerPrincipalId: "principal:alice",
        staticCard: { name: "阿莱莎", sceneId: "wake" },
      },
      {
        characterId: characterId("principal:bob"),
        controllerPrincipalId: "principal:bob",
        staticCard: { name: "博林", sceneId: "wake" },
      },
    ],
  });
  expect(initialized).toMatchObject({ created: true });
  return authority;
}

function characterId(principalId: string) {
  return `character:${principalId}`;
}

function principal(id: string) {
  return { principal: { id, sessionVersion: 1 } };
}

async function administer(
  authority: ReturnType<typeof env.ROOMS.getByName>,
  command: Record<string, unknown>,
) {
  return authority.applyRoomAdministration(
    roomServiceCapabilities().roomAdministration,
    command,
  );
}

describe("authoritative-v2 production Room service routing", () => {
  it("rejoins, removes, and transfers the host through Room administration before directory work", async () => {
    const id = roomId("membership");
    const authority = await seedRoom(id);

    expect(await administer(authority, {
      commandId: "membership:bob:depart:1",
      kind: "departMember",
      principalId: "principal:bob",
      reason: "player left the table",
    })).toMatchObject({ kind: "committed" });
    expect(await authority.observe(principal("principal:bob"))).toMatchObject({
      kind: "rejected",
    });

    expect(await administer(authority, {
      commandId: "membership:bob:rejoin:2:seat",
      kind: "grantSeat",
      principal: { id: "principal:bob", sessionVersion: 1 },
      role: "player",
    })).toMatchObject({ kind: "committed" });
    expect(await administer(authority, {
      commandId: "membership:bob:rejoin:2:control",
      kind: "grantControl",
      characterId: characterId("principal:bob"),
      seatId: "seat:principal:bob",
    })).toMatchObject({ kind: "committed" });
    expect(await authority.observe(principal("principal:bob"))).toMatchObject({
      readModel: {
        kind: "projected",
        controlledCharacter: {
          characterId: characterId("principal:bob"),
        },
      },
    });

    expect(await administer(authority, {
      commandId: "membership:alice:leave:3",
      kind: "transferHostAndDepart",
      fromPrincipalId: "principal:alice",
      toPrincipalId: "principal:bob",
      reason: "host left the table",
    })).toMatchObject({ kind: "committed" });
    expect(await authority.observe(principal("principal:alice"))).toMatchObject({
      kind: "rejected",
    });
    const bob = await authority.observe(principal("principal:bob")) as {
      readModel?: { roomMembers?: Array<{ principalId: string; role: string }> };
    };
    expect(bob.readModel?.roomMembers).toContainEqual(expect.objectContaining({
      principalId: "principal:bob",
      role: "host",
      seatStatus: "active",
    }));
  });

  it("runs party invitations and answers through the same Room Action transaction", async () => {
    const id = roomId("party");
    const authority = await seedRoom(id);

    expect(await handleRoomAction({
      principal: principal("principal:alice"),
      authority,
      kp: {
        propose: async () => ({
          kind: "authenticatedPartyAction",
          action: "inviteMember",
          targetCharacterId: characterId("principal:bob"),
        }),
        narrate: async () => ({ body: "同行邀请已经提交。" }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:party:invite:1",
      characterId: characterId("principal:alice"),
      text: "我邀请博林同行。",
    })).toMatchObject({ kind: "awaitingInput" });

    const pending = await authority.observe(principal("principal:bob")) as {
      readModel?: { pendingInputs?: Array<{ pendingInputId: string; kind: string }> };
    };
    const pendingInputId = pending.readModel?.pendingInputs?.find(
      (entry) => entry.kind === "partyInvitation",
    )?.pendingInputId;
    expect(pendingInputId).toBeTypeOf("string");

    expect(await handleRoomAction({
      principal: principal("principal:bob"),
      authority,
      kp: {
        propose: async () => {
          throw new Error("authenticated party answer must not call KP");
        },
        narrate: async () => ({ body: "你接受了同行邀请。" }),
      },
    }, {
      kind: "answer",
      submissionId: "submission:party:answer:2",
      pendingInputId: pendingInputId!,
      answer: { accept: true },
    })).toMatchObject({ kind: "committed" });

    const bob = await authority.observe(principal("principal:bob")) as {
      readModel?: {
        partyGroups?: Array<{
          leaderCharacterId: string;
          memberCharacterIds: string[];
        }>;
      };
    };
    expect(bob.readModel?.partyGroups).toEqual([{
      groupId: "party:root-action:submission:party:invite:1",
      leaderCharacterId: characterId("principal:alice"),
      memberCharacterIds: [
        characterId("principal:alice"),
        characterId("principal:bob"),
      ],
    }]);
  });

  it("rebuilds API-shaped intents and discards forged authority, state, event, dice, and profile fields", async () => {
    const id = roomId("forged-input");
    const authority = await seedRoom(id);
    let proposedInput: unknown;
    const forbiddenMarker = "FORGED_PRIVATE_CANDIDATE";

    const outcome = await handleRoomAction({
      principal: principal("principal:alice"),
      authority,
      kp: {
        propose: async (request: Record<string, unknown>) => {
          proposedInput = request.input;
          return observationProposal(String(request.rootActionId), {
            goal: "检查门框上的旧划痕",
            method: "仔细观察门框",
            duration: { unit: "second", value: 1 },
          });
        },
        narrate: async () => ({ body: "行动已经按房间权威提交。" }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:forged-input:1",
      text: "我检查门框上的旧划痕。",
      actor: "character:mallory",
      actorId: "character:mallory",
      principal: "principal:mallory",
      principalId: "principal:mallory",
      events: [{ eventType: "WishGranted", value: forbiddenMarker }],
      state: { hitPoints: 999, privateCandidate: forbiddenMarker },
      faces: [20],
      profile: "forged-profile",
    } as never);

    expect(outcome).toMatchObject({ kind: "committed" });
    expect(proposedInput).toEqual({
      kind: "intent",
      submissionId: "submission:forged-input:1",
      text: "我检查门框上的旧划痕。",
    });
    expect(JSON.stringify(outcome)).not.toContain(forbiddenMarker);
    expect(await authority.observe(principal("principal:mallory"))).toMatchObject({
      kind: "rejected",
    });
  });
});
