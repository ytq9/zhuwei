import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AuthoritativeRoomStore } from "../../../app/_runtime/lib/room/authority-store";

/**
 * A KP delivery waits in its slot until the viewer's next submission flushes it
 * into the transcript, so it is appended after the player line that followed it
 * and carries a lower source_event_seq than that line. Read by insertion order,
 * the answer to one question appears below the question asked after it. What a
 * viewer reads is ordered by where each message happened; `ordinal` stays
 * insertion order because the story-history cursor requires it to be monotonic.
 */
const VIEWER = "principal:ownercharacter:owner";

async function withStore(name: string, run: (store: AuthoritativeRoomStore) => void) {
  const stub = env.VNEXT_ROOMS.getByName(`transcript-order:${name}`);
  await runInDurableObject(stub as never, async (_instance, state) => {
    const store = new AuthoritativeRoomStore(state.storage);
    store.ensureSchema();
    run(store);
  });
}

const player = (seq: string, body: string) => ({
  viewerKey: VIEWER, messageId: `action:${seq}`, sceneIds: ["scene:hall"], kind: "player" as const,
  speakerCharacterId: "character:owner", speakerName: "行动者", body, sourceEventSeq: seq,
  receiptId: `receipt:${seq}`,
});
const kp = (seq: string, body: string) => ({
  viewerKey: VIEWER, messageId: `delivery:${seq}`, sceneIds: ["scene:hall"], kind: "kp" as const,
  speakerCharacterId: null, speakerName: "KP", body, sourceEventSeq: seq, receiptId: `receipt:${seq}`,
});

describe("transcript order", () => {
  it("reads an answer before the question asked after it, however late it arrived", async () => {
    await withStore("late-delivery", (store) => {
      // The order the rows arrive: each answer is flushed by the next submission.
      store.appendExperiencedMessage(player("1", "我去检查尸体"));
      store.appendExperiencedMessage(kp("0", "开场白。"));
      store.appendExperiencedMessage(player("11", "把烛灰擦擦"));
      store.appendExperiencedMessage(kp("10", "你走到长桌旁。"));
      store.appendExperiencedMessage(player("22", "拿起叶子去问她"));
      store.appendExperiencedMessage(kp("21", "你伸出指尖碰叶子背面。"));

      expect(store.experiencedMessages(VIEWER).map((message) => message.sourceEventSeq))
        .toEqual(["0", "1", "10", "11", "21", "22"]);
      expect(store.experiencedMessagesForScene(VIEWER, "scene:hall").map((message) => message.sourceEventSeq))
        .toEqual(["0", "1", "10", "11", "21", "22"]);
    });
  });

  it("orders the sequence as a number, not as text", async () => {
    await withStore("numeric-sequence", (store) => {
      for (const seq of ["9", "10", "100", "2"]) store.appendExperiencedMessage(kp(seq, `第 ${seq} 号`));
      expect(store.experiencedMessages(VIEWER).map((message) => message.sourceEventSeq))
        .toEqual(["2", "9", "10", "100"]);
    });
  });

  it("keeps the newest messages when the window is smaller than the transcript", async () => {
    await withStore("window", (store) => {
      store.appendExperiencedMessage(player("3", "第三"));
      store.appendExperiencedMessage(kp("2", "第二"));
      store.appendExperiencedMessage(player("1", "第一"));
      expect(store.experiencedMessages(VIEWER, 2).map((message) => message.sourceEventSeq)).toEqual(["2", "3"]);
      expect(store.experiencedMessagesForScene(VIEWER, "scene:hall", 2).map((message) => message.sourceEventSeq))
        .toEqual(["2", "3"]);
    });
  });

  it("leaves the history page on its insertion cursor, which must stay monotonic", async () => {
    await withStore("history-cursor", (store) => {
      store.appendExperiencedMessage(player("11", "先到的问题"));
      store.appendExperiencedMessage(kp("10", "后到的答案"));
      const upper = store.experiencedMessagesUpperOrdinal(VIEWER);
      const page = store.experiencedMessagesPage(VIEWER, { afterOrdinal: 0, throughOrdinal: upper, limit: 10 });
      // The story-history session rejects a page whose ordinals are not strictly
      // ascending, so this reader is not the one that reorders.
      expect(page.map((message) => message.ordinal))
        .toEqual([...page.map((message) => message.ordinal)].sort((a, b) => a - b));
      expect(page.map((message) => message.sourceEventSeq)).toEqual(["11", "10"]);
    });
  });
});
