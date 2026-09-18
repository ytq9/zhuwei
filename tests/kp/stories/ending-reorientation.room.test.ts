import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";


type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({
    id: "principal:ending-reorientation:alice",
    sessionVersion: 1,
  }),
});
const ALICE_ID = "character:ending-reorientation:alice";
const CURRENT_SCENE_REF = "wake";
const MATERIALIZATION_BASIS_REF = "fact:ending:shared-wake-context";

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function authority(roomId: string) {
  return env.ROOMS.getByName(roomId) as unknown as Authority;
}

async function acknowledgeCurrentDelivery(
  room: Authority,
  value: unknown,
  label: string,
) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const delivery = (value as JsonRecord).delivery;
  if (typeof delivery !== "object" || delivery === null || Array.isArray(delivery)) return;
  const current = delivery as JsonRecord;
  if (current.kind !== "current") return;
  const frame = record(current.frame, `${label} delivery frame`);
  const deliveryId = String(frame.deliveryId);
  await expect(room.acknowledge(ALICE, deliveryId)).resolves.toMatchObject({
    kind: "acknowledged",
    deliveryId,
  });
}

async function initialize(roomId: string, hitPointsCurrent = 20) {
  const room = authority(roomId);
  const initialized = record(await room.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: ALICE_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        scores: { str: 12, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
        proficiency: 2,
        skills: ["investigation"],
        hp: { current: hitPointsCurrent, max: 20, temp: 0 },
        ac: 12,
        speed: 30,
        resources: {},
        equipped: {},
        backpack: [],
      },
    }],
    fixtureFacts: [
      {
        knowledgeRef: "knowledge:ending:lian-witnesses-shared-context",
        holderEntityId: "npc:black-oak-will:lian",
        holderName: "莉安·黑橡",
        sceneId: CURRENT_SCENE_REF,
        content: "莉安与阿莱莎正在同一个公开现场中。",
      },
      {
        factRef: MATERIALIZATION_BASIS_REF,
        kind: "establishedCommunicationChannel",
        participants: [ALICE_ID, "npc:black-oak-will:lian"],
      },
    ],
  }), `${roomId} initialization`);
  expect(initialized.created).toBe(true);
  await acknowledgeCurrentDelivery(
    room,
    await room.observe(ALICE),
    `${roomId} opening`,
  );
  return {
    authority: room,
    capabilities: record(initialized.serviceCapabilities, "service capabilities"),
  };
}

async function exportArchive(room: Authority, capability: unknown, complete = false) {
  const exported = record(
    await room.exportAuthoritativeArchive(capability),
    "authoritative archive export",
  );
  expect(exported.kind).toBe("exported");
  return record(complete ? exported.storyArchive : exported.archive, "authoritative archive");
}

function archiveEvents(archive: JsonRecord) {
  return list(archive.events, "archive events")
    .map((entry) => record(entry, "archive event"));
}

async function readModel(room: Authority) {
  return record(
    record(await room.observe(ALICE), "Room observation").readModel,
    "viewer read model",
  );
}

function story(read: JsonRecord, storyRef: string) {
  return list(read.stories, "projected stories")
    .map((entry) => record(entry, "projected story"))
    .find((entry) => entry.storyId === storyRef);
}

describe("SPEC 0009 ending and reorientation through the real Room interface", () => {

  it("advances neither fiction time nor punishment during real-world wait and DO eviction alone", async () => {
    const roomId = "ending-room-real-wait-eviction-v2";
    const room = await initialize(roomId);
    const beforeRead = await readModel(room.authority);
    const beforeArchive = await exportArchive(
      room.authority,
      room.capabilities.archiveExport,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await evictDurableObject(room.authority as never);

    const rebuilt = authority(roomId);
    const afterRead = await readModel(rebuilt);
    const afterArchive = await exportArchive(
      rebuilt,
      room.capabilities.archiveExport,
    );
    const afterEvents = archiveEvents(afterArchive);
    const punishmentTypes = new Set([
      "DamagePacketResolved",
      "FactionPlanAdvanced",
      "FictionTimeAdvanced",
      "HitPointsChanged",
      "MeaningfulFailureCommitted",
    ]);

    expect({
      fictionTime: afterRead.fictionTime,
      eventHead: afterArchive.head,
      events: afterEvents,
      punishmentEvents: afterEvents.filter((event) =>
        punishmentTypes.has(String(event.eventType))),
    }).toEqual({
      fictionTime: beforeRead.fictionTime,
      eventHead: beforeArchive.head,
      events: archiveEvents(beforeArchive),
      punishmentEvents: [],
    });
  });
});
