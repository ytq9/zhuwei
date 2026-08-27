import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function exportedSection(server, name, nextName) {
  const start = server.indexOf(`export const ${name} =`);
  const end = server.indexOf(`export const ${nextName} =`, start + 1);
  assert.notEqual(start, -1, `${name} export is missing`);
  assert.notEqual(end, -1, `${nextName} boundary is missing`);
  return server.slice(start, end);
}

function authoritativeBranch(section, marker = "AUTHORITATIVE_RULESET_VERSION") {
  const start = section.indexOf(marker);
  const legacy = section.indexOf("RULESET_VERSION", start + marker.length);
  assert.notEqual(start, -1, "authoritative branch is missing");
  assert.notEqual(legacy, -1, "explicit Legacy boundary is missing");
  return section.slice(start, legacy);
}

test("authoritative membership and character changes commit Room authority before D1 directory writes", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const join = authoritativeBranch(exportedSection(server, "joinRoom", "fetchTable"));
  const lock = authoritativeBranch(exportedSection(server, "lockCharacter", "setGear"));
  const gear = authoritativeBranch(exportedSection(server, "setGear", "startGame"));
  const kick = authoritativeBranch(exportedSection(server, "kickMember", "leaveTable"));
  const leave = authoritativeBranch(exportedSection(server, "leaveTable", "inviteSquad"));

  assert.match(join, /activateAuthoritativeMember/);
  assert.doesNotMatch(join, /reseatPlayer|game_states|messages|writeFlags/);
  assert.ok(join.indexOf("activateAuthoritativeMember") < join.indexOf("insert into room_members"));

  assert.match(lock, /materializeAuthoritativeCharacter/);
  assert.ok(lock.indexOf("materializeAuthoritativeCharacter") < lock.indexOf("insert into characters"));
  assert.ok(lock.indexOf("materializeAuthoritativeCharacter") < lock.indexOf("update characters"));

  assert.match(gear, /submitAuthoritativeTableAction/);
  assert.match(gear, /kind:\s*"gear"/);
  assert.doesNotMatch(gear, /synchronizeAuthoritativeCharacterCard|update characters|select sheet|ensureGear|wearItem|stowSlot|acFromGear/);
  const gearSection = exportedSection(server, "setGear", "startGame");
  assert.ok(
    gearSection.indexOf("activeRules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION")
      < gearSection.indexOf("select sheet from characters"),
  );
  const client = await source("app/_runtime/lib/table/client.ts");
  assert.match(
    client,
    /export const setGear[^]*callWithStableTableSubmission\("setGear"/,
    "gear transport must preserve one submission id across retries",
  );
  const table = await source("app/_runtime/components/play-table.tsx");
  const gearHookStart = table.indexOf("function useGearAct");
  const gearHookEnd = table.indexOf("function GearSlots", gearHookStart);
  assert.notEqual(gearHookStart, -1, "gear UI hook is missing");
  assert.notEqual(gearHookEnd, -1, "gear UI hook boundary is missing");
  assert.match(
    table.slice(gearHookStart, gearHookEnd),
    /invalidateQueries\(\{ queryKey: \["table", code\] \}\)/,
    "successful gear commits must refresh the DO-backed table projection",
  );

  assert.match(kick, /removeAuthoritativeMember/);
  assert.doesNotMatch(kick, /detachSeated|game_states|messages|writeFlags/);
  assert.match(leave, /departAuthoritativeMember|transferAndDepartAuthoritativeHost/);
  assert.doesNotMatch(leave, /game_states|messages|writeFlags/);
});

test("authoritative party APIs use stable Room Action submissions and never legacy squad flags", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const boundaries = [
    ["inviteSquad", "cancelSquadInvite"],
    ["cancelSquadInvite", "answerSquad"],
    ["answerSquad", "leaveSquadNow"],
    ["leaveSquadNow", "passCaptain"],
    ["passCaptain", "approveSquadQueue"],
  ];
  for (const [name, next] of boundaries) {
    const section = exportedSection(server, name, next);
    const branch = authoritativeBranch(section);
    assert.match(section, /submissionId\?: string/, `${name} transport identity is missing`);
    if (name !== "cancelSquadInvite") {
      assert.match(
        branch,
        /submitAuthoritativePartyTableAction|个人合法行动不再进入队长审批队列/,
      );
    }
    assert.doesNotMatch(branch, /flagsOf|writeFlags|game_states|messages|runKpTurn|commitRulesV2Direct/);
  }

  const client = await source("app/_runtime/lib/table/client.ts");
  for (const name of [
    "inviteSquad",
    "cancelSquadInvite",
    "answerSquad",
    "leaveSquadNow",
    "passCaptain",
  ]) {
    assert.match(
      client,
      new RegExp(`export const ${name}[^]*callWithStableTableSubmission\\("${name}"`),
      `${name} does not preserve its submission id across transport retries`,
    );
  }
});

test("authoritative initialization persists both runtime epoch and genesis metadata", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const startGame = exportedSection(server, "startGame", "sendAction");
  const authoritativeStart = startGame.indexOf(
    "if (info.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {",
  );
  assert.notEqual(authoritativeStart, -1, "authoritative initialization branch is missing");
  const start = startGame.slice(authoritativeStart);
  assert.match(start, /runtimeEpochId/);
  assert.match(start, /genesisHash/);
  assert.match(start, /runtime_epoch_id\s*=\s*\$\{runtimeEpochId\}/);
  assert.match(start, /genesis_hash\s*=\s*\$\{genesisHash\}/);
  assert.doesNotMatch(start, /coalesce\(\$\{runtimeEpochId\}/);
});

test("the table maps only viewer-projected PartyGroups and party invitation controls", async () => {
  const { projectAuthoritativeTableObservation } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:bob",
    members: ["principal:alice", "principal:bob", "principal:mallory"],
    locationLabels: { wake: "守灵厅" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "12",
        projectionHash: "sha256:bob",
        viewer: {
          kind: "player",
          principalId: "principal:bob",
          subjectId: "character:principal:bob",
        },
        controlledCharacter: {
          characterId: "character:principal:bob",
          name: "博林",
          sceneId: "wake",
        },
        pendingInputs: [{
          pendingInputId: "pending:party:1",
          rootActionId: "root:party:1",
          kind: "partyInvitation",
          question: "是否接受同行邀请？",
          access: "controller",
          inviterCharacterId: "character:principal:alice",
          invitedCharacterId: "character:principal:bob",
        }],
        roomMembers: [
          { principalId: "principal:alice", role: "host", seatStatus: "active" },
          { principalId: "principal:bob", role: "player", seatStatus: "active" },
          { principalId: "principal:mallory", role: "player", seatStatus: "active" },
        ],
        partyGroups: [{
          groupId: "party:1",
          leaderCharacterId: "character:principal:alice",
          memberCharacterIds: [
            "character:principal:alice",
            "character:principal:bob",
            "character:principal:unknown",
          ],
        }],
        entities: {
          "character:principal:alice": {
            id: "character:principal:alice",
            kind: "player",
            name: "阿莱莎",
            sceneId: "wake",
          },
        },
        knowledge: [],
        receipts: [],
      },
      delivery: { kind: "none" },
    },
  });

  assert.deepEqual(projected.pendingInputs, []);
  assert.deepEqual(projected.squads, [{
    id: "party:1",
    ids: ["principal:alice", "principal:bob"],
    captain: "principal:alice",
  }]);
  assert.deepEqual(projected.squadInvite, {
    from: "principal:alice",
    to: "principal:bob",
    fromName: "阿莱莎",
  });
  assert.doesNotMatch(JSON.stringify(projected), /principal:unknown/);
});
