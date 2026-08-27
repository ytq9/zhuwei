import assert from "node:assert/strict";
import test from "node:test";

import { CURRENT_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  evaluateRuntimeProfileReferenceGate,
  runtimeProfileReferenceRowsFromD1,
} from "../app/_runtime/lib/rules/profiles/deployment-gate.ts";

const CURRENT = structuredClone(CURRENT_RUNTIME_PROFILE_MANIFEST);
const PRIOR = structuredClone(CURRENT_RUNTIME_PROFILE_MANIFEST);
PRIOR.manifest = {
  profileId: "runtime-srd51-2014-authoritative-v1",
  profileHash: `sha256:${"1".repeat(64)}`,
};

function genesis(roomId, runtimeEpochId, profiles) {
  return JSON.stringify({
    kind: "roomGenesis",
    roomId,
    runtimeEpochId,
    profiles,
  });
}

test("P06 deployment gate rejects removal of an Adapter referenced by an active room or recoverable archive", () => {
  const rows = [
    {
      source: "activeRoom",
      roomId: "room:active-prior",
      rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
      runtimeEpochId: "epoch:active-prior",
      genesisJson: genesis("room:active-prior", "epoch:active-prior", PRIOR),
    },
    {
      source: "recoverableArchive",
      roomId: "room:archived-prior",
      rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
      runtimeEpochId: "epoch:archived-prior",
      genesisJson: genesis("room:archived-prior", "epoch:archived-prior", PRIOR),
    },
  ];
  const before = structuredClone(rows);

  const blocked = evaluateRuntimeProfileReferenceGate(rows, [CURRENT]);

  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "referencedAdapterMissing");
  assert.deepEqual(blocked.missingManifestRefs, [PRIOR.manifest]);
  assert.deepEqual(blocked.roomIds, ["room:active-prior", "room:archived-prior"]);
  assert.deepEqual(rows, before, "the deployment gate must never rewrite a referenced genesis");

  const retained = evaluateRuntimeProfileReferenceGate(rows, [PRIOR, CURRENT]);
  assert.deepEqual(retained, {
    ok: true,
    referencedManifestRefs: [PRIOR.manifest],
    roomCount: 2,
  });
});

test("P06 deployment gate fails closed when an active authoritative room has no recoverable genesis reference", () => {
  const result = evaluateRuntimeProfileReferenceGate([
    {
      source: "activeRoom",
      roomId: "room:missing-genesis",
      rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
      runtimeEpochId: "epoch:missing-genesis",
      genesisJson: null,
    },
  ], [CURRENT]);

  assert.deepEqual(result, {
    ok: false,
    code: "activeRoomProfileReferenceMissing",
    roomIds: ["room:missing-genesis"],
  });
});

test("P06 deployment gate rejects malformed or mismatched D1 reference rows", () => {
  const malformed = evaluateRuntimeProfileReferenceGate([
    {
      source: "recoverableArchive",
      roomId: "room:mismatch",
      rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
      runtimeEpochId: "epoch:mismatch",
      genesisJson: genesis("room:other", "epoch:mismatch", CURRENT),
    },
  ], [CURRENT]);

  assert.deepEqual(malformed, {
    ok: false,
    code: "invalidProfileReference",
    roomIds: ["room:mismatch"],
  });
});

test("P06 deployment gate consumes Wrangler D1 JSON rows with no latest/default inference", () => {
  const genesisJson = genesis("room:d1", "epoch:d1", CURRENT);
  const rows = runtimeProfileReferenceRowsFromD1([{
    success: true,
    results: [{
      source: "activeRoom",
      room_id: "room:d1",
      ruleset_version: "dnd5e-2014-srd5.1-authoritative-v2",
      runtime_epoch_id: "epoch:d1",
      genesis_json: genesisJson,
    }],
  }]);

  assert.deepEqual(rows, [{
    source: "activeRoom",
    roomId: "room:d1",
    rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
    runtimeEpochId: "epoch:d1",
    genesisJson,
  }]);
  assert.equal(evaluateRuntimeProfileReferenceGate(rows, [CURRENT]).ok, true);
  assert.throws(
    () => runtimeProfileReferenceRowsFromD1([{ results: [{ source: "activeRoom" }] }]),
    /malformed closed shape/i,
  );
  assert.throws(
    () => runtimeProfileReferenceRowsFromD1({}),
    /unknown envelope/i,
  );
});
