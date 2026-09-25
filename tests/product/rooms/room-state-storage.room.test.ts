import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

// SPEC 0011 §7: the persisted world state and each provisional state are
// stored as ordered chunk rows. A room's state size is bounded by the room,
// not by one SQLite value, and every reader receives the whole document.
type Store = {
  room(): { room_id: string; state_json: string } | undefined;
  createRoom(input: unknown): void;
  updateState(state: unknown): { chars: number; chunks: number };
  saveProvisionalMechanics(input: unknown): void;
  provisionalMechanics(id: string): { base_state_json: string; state_json: string } | undefined;
  clearProvisionalMechanics(id: string): void;
  clearAllRowsForDeletion(): void;
  isAuthorityEmpty(): boolean;
};
const stateOf = (pad: string) => ({ seats: {}, principals: {}, pad });
// Three-byte CJK text and four-byte emoji: both must survive the chunk boundaries.
const bigPad = () => "烛帷".repeat(200_000) + "😀".repeat(3_000) + "end";

it("persists multi-chunk room and provisional states and reads them back whole", async () => {
  const stub = env.ROOMS.getByName("room-state-storage:chunks");
  await runInDurableObject(stub, (instance, state) => {
    const store = (instance as unknown as { authorityStore: Store }).authorityStore;
    store.createRoom({ roomId: "room:storage", moduleId: "black-oak-will", profiles: {}, genesis: { runtimeEpochId: "epoch:storage" },
      state: stateOf("small"), members: [], characters: [] });
    expect(JSON.parse(store.room()!.state_json)).toEqual(stateOf("small"));

    const large = stateOf(bigPad());
    const persisted = store.updateState(large);
    expect(persisted.chars).toBe(JSON.stringify(large).length);
    expect(persisted.chunks).toBeGreaterThan(1);
    expect(JSON.parse(store.room()!.state_json)).toEqual(large);
    const chunks = state.storage.sql.exec<{ chunk: string }>(
      "SELECT chunk FROM authority_json_blobs WHERE blob_key = 'room-state' ORDER BY chunk_index").toArray();
    expect(chunks).toHaveLength(persisted.chunks);
    for (const { chunk } of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff, "a chunk must not end inside a surrogate pair").toBe(false);
    }
    expect(state.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM authority_rooms").one().state_json).toBe("");

    const provisional = stateOf("provisional " + bigPad());
    store.saveProvisionalMechanics({ preparedActionId: "prepared:storage", rootActionId: "root:storage", baseState: large, state: provisional, events: [] });
    const staged = store.provisionalMechanics("prepared:storage")!;
    expect(JSON.parse(staged.base_state_json)).toEqual(large);
    expect(JSON.parse(staged.state_json)).toEqual(provisional);
    store.saveProvisionalMechanics({ preparedActionId: "prepared:storage", rootActionId: "root:storage", baseState: stateOf("ignored"), state: stateOf("second"), events: [] });
    const updated = store.provisionalMechanics("prepared:storage")!;
    expect(JSON.parse(updated.base_state_json)).toEqual(large);
    expect(JSON.parse(updated.state_json)).toEqual(stateOf("second"));
    store.clearProvisionalMechanics("prepared:storage");
    expect(store.provisionalMechanics("prepared:storage")).toBeUndefined();
    expect(state.storage.sql.exec<{ total: number }>(
      "SELECT COUNT(*) AS total FROM authority_json_blobs WHERE blob_key LIKE 'provisional:%'").one().total).toBe(0);

    store.clearAllRowsForDeletion();
    expect(store.isAuthorityEmpty()).toBe(true);
    expect(state.storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM authority_json_blobs").one().total).toBe(0);
  });
});
