import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AuthoritativeRoomStore } from "../app/_runtime/lib/room/authority-store";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import type { DueActivityDescriptor } from "../app/_runtime/lib/rules/v2/model";

function activity(id: string, completionFictionMicros: string, timelineId = "timeline:one"): DueActivityDescriptor {
  const activityId = `activity:${id}`;
  return {
    activityId,
    ownerEntityId: `character:${id}`,
    timelineId,
    completionFictionMicros,
    childRootActionId: `activity-due:${activityId}:${completionFictionMicros}`,
    activityHash: canonicalSha256({ activityId, completionFictionMicros }),
    sceneIds: [`scene:${id}`],
  };
}

const cause = { causeRootActionId: "root:time-advance", causeEventId: "event:time-advanced" };

async function withStore(name: string, run: (store: AuthoritativeRoomStore, storage: DurableObjectStorage) => void) {
  const stub = env.VNEXT_ROOMS.getByName(`due-store:${name}`);
  await runInDurableObject(stub as never, async (_instance, state) => {
    const store = new AuthoritativeRoomStore(state.storage);
    store.ensureSchema();
    run(store, state.storage);
  });
}

describe("persisted ordinary Activity due work", () => {
  it("evolves the existing principal constraint atomically, preserving all submission states and unique identities", async () => {
    await withStore("nullable-npc-principal", (store, storage) => {
      storage.sql.exec(`DROP TABLE authority_submissions;
        CREATE TABLE authority_submissions (
          submission_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
          input_kind TEXT NOT NULL, root_action_id TEXT NOT NULL, prepared_action_id TEXT NOT NULL UNIQUE,
          character_id TEXT NOT NULL, scene_scope TEXT NOT NULL, prepared_scope_version INTEGER NOT NULL,
          status TEXT NOT NULL, proposal_hash TEXT, prepared_json TEXT NOT NULL, continuation_json TEXT, result_json TEXT
        );
        CREATE INDEX authority_submissions_root_idx ON authority_submissions(root_action_id);`);
      const input = (suffix: string, principalId: string | null = "principal:original", inputKind = "intent") => ({
        submissionId: `submission:${suffix}`, principalId, payloadHash: "original-payload-hash", inputKind,
        rootActionId: `root:${suffix}`, preparedActionId: `prepared:${suffix}`, characterId: "character:original",
        sceneScope: "scene:original", preparedScopeVersion: 7,
        prepared: { originalFrozenMaterial: [1, "二"] }, continuation: { originalRequest: "unchanged" },
      });
      for (const status of ["prepared", "awaitingRandomness", "committed"]) {
        store.insertSubmission(input(status));
        storage.sql.exec("UPDATE authority_submissions SET status = ?, proposal_hash = ?, result_json = ? WHERE submission_id = ?",
          status, status === "prepared" ? null : "original-proposal-hash",
          status === "committed" ? '{"kind":"committed","original":true}' : null, `submission:${status}`);
      }
      const prior = storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id").toArray();
      store.ensureSchema();
      expect(storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id").toArray()).toEqual(prior);
      expect(() => store.insertSubmission(input("missing-player", null))).toThrow();
      store.insertSubmission(input("npc", null, "dueActivity"));
      expect(store.submissionByPrepared("prepared:npc")?.principal_id).toBeNull();
      expect(() => store.insertSubmission({ ...input("different-id"), preparedActionId: "prepared:npc" })).toThrow();
      expect(store.submissionByPrepared("prepared:awaitingRandomness")?.continuation_json).toBe('{"originalRequest":"unchanged"}');
      const beforeReopen = storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id").toArray();
      new AuthoritativeRoomStore(storage).ensureSchema();
      expect(storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id").toArray()).toEqual(beforeReopen);
      expect(storage.sql.exec("PRAGMA index_list(authority_submissions)").toArray()
        .some(row => row.name === "authority_submissions_root_idx")).toBe(true);
    });
  });

  it("retains several child histories and duplicate enqueue cannot replace their cause, descriptor or status", async () => {
    await withStore("history", (store, storage) => {
      const children = [activity("a", "10"), activity("b", "20"), activity("c", "30"), activity("d", "40")];
      storage.transactionSync(() => {
        for (const child of children) store.enqueueDueWork({ ...cause, activity: child });
      });
      expect(store.pendingDueWork().map(row => row.child_root_action_id)).toEqual(children.map(child => child.childRootActionId));
      store.finishDueWork(children[0].childRootActionId, "committed");
      store.finishDueWork(children[1].childRootActionId, "cancelled");
      store.deferDueWork(children[2].childRootActionId, null);
      const original = children.map(child => store.dueWorkByRoot(child.childRootActionId));
      for (const child of children) {
        store.enqueueDueWork({
          causeRootActionId: "root:later-unrelated-input", causeEventId: "event:later-unrelated-input",
          activity: { ...child, ownerEntityId: "character:replacement", timelineId: "timeline:replacement",
            activityHash: canonicalSha256({ replacement: true }), sceneIds: ["scene:replacement"] },
        });
      }
      const reopened = new AuthoritativeRoomStore(storage);
      reopened.ensureSchema();
      expect(children.map(child => reopened.dueWorkByRoot(child.childRootActionId))).toEqual(original);
      expect(reopened.pendingDueWork().map(row => row.child_root_action_id)).toEqual(children.slice(2).map(child => child.childRootActionId));
      for (const [index, child] of children.entries()) {
        const row = reopened.dueWorkByRoot(child.childRootActionId)!;
        expect(JSON.parse(row.descriptor_json)).toEqual(child);
        expect(row.cause_root_action_id).toBe(cause.causeRootActionId);
        expect(row.cause_event_id).toBe(cause.causeEventId);
        expect(row.status).toBe(index === 0 ? "committed" : index === 1 ? "cancelled" : "pending");
      }
      reopened.finishDueWork(children[0].childRootActionId, "cancelled");
      reopened.deferDueWork(children[1].childRootActionId, 100);
      expect(reopened.dueWorkByRoot(children[0].childRootActionId)).toEqual(original[0]);
      expect(reopened.dueWorkByRoot(children[1].childRootActionId)).toEqual(original[1]);
    });
  });

  it("sorts canonical decimal fiction instants without float precision loss, then by activity id", async () => {
    await withStore("decimal-order", store => {
      const expected = [
        activity("a", "2"), activity("z", "2"), activity("ten", "10"),
        activity("lower-safe-boundary", "9007199254740992"), activity("higher-safe-boundary", "9007199254740993"),
        activity("twenty-digits", "99999999999999999999"), activity("twenty-one-digits", "100000000000000000000"),
      ];
      for (const child of [...expected].reverse()) store.enqueueDueWork({ ...cause, activity: child });
      expect(store.pendingDueWork().map(row => [row.completion_fiction_micros, row.activity_id]))
        .toEqual(expected.map(child => [child.completionFictionMicros, child.activityId]));
    });
  });

  it("checks only requested timelines, optionally excluding the child being resumed", async () => {
    await withStore("timeline-membership", store => {
      const one = activity("one", "10");
      const two = activity("two", "10", "timeline:two");
      store.enqueueDueWork({ ...cause, activity: one });
      store.enqueueDueWork({ ...cause, activity: two });
      store.deferDueWork(one.childRootActionId, null);
      expect(store.hasPendingDueWorkInTimelines([])).toBe(false);
      expect(store.hasPendingDueWorkInTimelines(["timeline:unrelated"])).toBe(false);
      expect(store.hasPendingDueWorkInTimelines(["timeline:one", "timeline:one"])).toBe(true);
      expect(store.hasPendingDueWorkInTimelines(["timeline:one"], one.childRootActionId)).toBe(false);
      expect(store.hasPendingDueWorkInTimelines(["timeline:one", "timeline:two"], one.childRootActionId)).toBe(true);
      store.finishDueWork(two.childRootActionId, "committed");
      expect(store.hasPendingDueWorkInTimelines(["timeline:two"])).toBe(false);
      expect(store.hasPendingDueWorkInTimelines(["timeline:one"])).toBe(true);
      store.finishDueWork(one.childRootActionId, "cancelled");
      expect(store.hasPendingDueWorkInTimelines(["timeline:one", "timeline:two"])).toBe(false);
    });
  });

  it("a waiting timeline head blocks its later children while other timelines retain their alarm", async () => {
    await withStore("waiting-head", store => {
      const first = activity("first", "10");
      const second = activity("second", "20");
      const otherFirst = activity("other-first", "5", "timeline:two");
      const otherSecond = activity("other-second", "30", "timeline:two");
      for (const child of [second, otherSecond, first, otherFirst]) store.enqueueDueWork({ ...cause, activity: child });
      store.deferDueWork(first.childRootActionId, null);
      store.deferDueWork(otherFirst.childRootActionId, 250);
      expect(store.dueWorkAlarmAt()).toBe(250);
      expect(store.pendingDueWork()).toHaveLength(4);
      store.deferDueWork(otherFirst.childRootActionId, null);
      expect(store.dueWorkAlarmAt()).toBeNull();
      store.deferDueWork(first.childRootActionId, 1_000);
      expect(store.dueWorkAlarmAt()).toBe(1_000);
      store.deferDueWork(otherFirst.childRootActionId, 400);
      expect(store.dueWorkAlarmAt()).toBe(400);
      store.finishDueWork(otherFirst.childRootActionId, "committed");
      expect(store.dueWorkAlarmAt()).toBe(0);
      store.finishDueWork(otherSecond.childRootActionId, "cancelled");
      expect(store.dueWorkAlarmAt()).toBe(1_000);
      store.finishDueWork(first.childRootActionId, "committed");
      expect(store.dueWorkAlarmAt()).toBe(0);
      store.finishDueWork(second.childRootActionId, "committed");
      expect(store.dueWorkAlarmAt()).toBeNull();
    });
  });

  it("pending and finished due history count as authority until explicit deletion clears it", async () => {
    await withStore("deletion", (store, storage) => {
      expect(store.isAuthorityEmpty()).toBe(true);
      const pending = activity("pending", "10");
      const committed = activity("committed", "20");
      const cancelled = activity("cancelled", "30");
      for (const child of [pending, committed, cancelled]) store.enqueueDueWork({ ...cause, activity: child });
      store.finishDueWork(committed.childRootActionId, "committed");
      store.finishDueWork(cancelled.childRootActionId, "cancelled");
      expect(store.isAuthorityEmpty()).toBe(false);
      store.finishDueWork(pending.childRootActionId, "committed");
      expect(store.pendingDueWork()).toEqual([]);
      expect(store.isAuthorityEmpty()).toBe(false);
      storage.transactionSync(() => store.clearAllRowsForDeletion());
      const reopened = new AuthoritativeRoomStore(storage);
      reopened.ensureSchema();
      expect(reopened.isAuthorityEmpty()).toBe(true);
      expect(reopened.pendingDueWork()).toEqual([]);
      expect(reopened.dueWorkAlarmAt()).toBeNull();
      for (const child of [pending, committed, cancelled]) expect(reopened.dueWorkByRoot(child.childRootActionId)).toBeUndefined();
      reopened.enqueueDueWork({ ...cause, activity: pending });
      expect(reopened.pendingDueWork()).toHaveLength(1);
    });
  });
});
