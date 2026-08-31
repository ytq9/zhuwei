import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} is missing`);
  assert.notEqual(end, -1, `${endMarker} boundary is missing`);
  return text.slice(start, end);
}

test("authoritative room deletion marks D1 first, restores on failure, and finalizes only after removal", async () => {
  const table = await source("app/_runtime/lib/table/server.ts");
  const deletion = section(table, "export const deleteRoom =", "export const getCatalog =");

  assert.match(deletion, /previousStatus/);
  assert.match(deletion, /ruleset_version/);
  assert.match(deletion, /runtime_epoch_id/);
  assert.match(deletion, /update rooms\s+set status = \$\{"deleting"\}/);
  assert.match(deletion, /where id = \$\{room\.id\} and host_user_id = \$\{context\.userId\}/);
  assert.match(deletion, /prepareAuthoritativeRoomDeletion/);
  assert.match(deletion, /finalizeAuthoritativeRoomDeletion/);
  assert.match(deletion, /cancelAuthoritativeRoomDeletion/);
  assert.match(deletion, /set status = \$\{previousStatus\}/);
  assert.match(deletion, /authorityCleanup/);
  assert.match(deletion, /"finalized"/);
  assert.match(deletion, /"scheduled"/);
  assert.match(deletion, /"notApplicable"/);

  const marked = deletion.indexOf('set status = ${"deleting"}');
  const prepared = deletion.indexOf("prepareAuthoritativeRoomDeletion");
  const removed = deletion.indexOf("delete from rooms", prepared);
  const finalized = deletion.indexOf("const authorityCleanup = await finalizeAuthorityCleanup()", removed);
  assert.ok(marked < prepared, "D1 must be marked before the DO is sealed");
  assert.ok(prepared < removed, "the DO must be sealed before the D1 row is removed");
  assert.ok(removed < finalized, "the DO may finalize only after the D1 delete attempt");

  const roomServer = await source("app/_runtime/lib/room/server.ts");
  for (const helper of [
    "prepareAuthoritativeRoomDeletion",
    "cancelAuthoritativeRoomDeletion",
    "finalizeAuthoritativeRoomDeletion",
  ]) {
    assert.match(roomServer, new RegExp(`export (?:async )?function ${helper}`));
  }
  assert.match(roomServer, /roomServiceCapabilities\(\)\.roomDeletion/);
  assert.match(roomServer, /trustedRoomPrincipal\(input\.userId\)/);
});

test("terminal deletion explicitly covers every current Room DO application table without deleteAll", async () => {
  const durable = await source("app/_runtime/lib/room/durable-object.ts");
  const store = await source("app/_runtime/lib/room/authority-store.ts");
  const deletion = section(
    durable,
    "private clearAllRoomRowsForDeletion()",
    "private async armDeletionReconciliation()",
  ) + section(store, "clearAllRowsForDeletion()", "\n  }\n}");

  const expectedTables = [
    "authority_rooms",
    "authority_members",
    "authority_characters",
    "authority_events",
    "authority_submissions",
    "authority_proposal_recovery",
    "authority_randomness_authorizations",
    "authority_randomness_batches",
    "authority_action_stages",
    "authority_scope_versions",
    "authority_receipts",
    "authority_pending_inputs",
    "authority_delivery_plans",
    "authority_delivery_audiences",
    "authority_delivery_slots",
    "authority_experienced_messages",
    "authority_delivery_watermarks",
    "authority_delivery_tombstones",
    "authority_delivery_plan_tombstones",
    "authority_delivery_acknowledgements",
    "authority_corrections",
    "authority_room_administration",
    "authority_archive_progress",
    "authority_room_deletion",
  ];
  for (const table of expectedTables) {
    assert.match(deletion, new RegExp(`DELETE FROM ${table}\\b`), `${table} is not erased`);
  }
  assert.doesNotMatch(durable + store, /storage\.deleteAll|\.deleteAll\s*\(/);
});
