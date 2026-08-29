import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { authoritativeModuleMigration } from "../app/_runtime/lib/module/authoritative";
import { replay, step } from "../app/_runtime/lib/rules";

type JsonRecord = Record<string, unknown>;

type ModuleRef = {
  profileId: string;
  profileHash: string;
};

type ModuleMigrationRequest = {
  fromModuleRef: ModuleRef;
  toModuleRef: ModuleRef;
  migrationRef: ModuleRef;
};

type RoomAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

type InitializedRoom = {
  authority: RoomAuthority;
  archiveExportCapability: unknown;
};

type PreparedAction = JsonRecord & {
  preparedActionId: string;
  rootActionId: string;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:chapter-module:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:chapter-module:bob", sessionVersion: 1 }),
});

const MODULE_V1_REF = Object.freeze({
  profileId: "module:black-oak-will:legacy-anchor-v1",
  profileHash: "sha256:198ad1c122a84abffc881cfb4b0c5f6bcb32cd2411acb07aceb33163694b37f9",
});

const MODULE_V2_REF = Object.freeze({
  profileId: "module:black-oak-will:legacy-anchor-v2",
  profileHash: "sha256:283e0b6dfd7bab0a27895e741b9b56a2c536ba02ef922d4a35ebe43227ce0a03",
});

const MIGRATION_V1_TO_V2_REF = Object.freeze({
  profileId: "module-migration:black-oak-will:legacy-anchor-v1-to-legacy-anchor-v2",
  profileHash: "sha256:447f943f76ccb536cd8e1cee7f08cf058ddead6c5fa2b3eed7af4d1596a47c4d",
});

const PINNED_V1_TO_V2_MIGRATION = Object.freeze({
  moduleId: "black-oak-will",
  fromModuleRef: MODULE_V1_REF,
  toModuleRef: MODULE_V2_REF,
  compatibleRulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
  migrationRef: MIGRATION_V1_TO_V2_REF,
  chapterBoundaryOnly: true,
  mappingPolicy: "preserveAuthoritativeRoomState",
  preservedState: Object.freeze([
    "activities",
    "artifacts",
    "canonicalFacts",
    "corrections",
    "debts",
    "dynamicDefinitions",
    "factionPlans",
    "knowledge",
    "npcPlans",
    "promises",
    "relationships",
    "threats",
  ]),
});

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

function prepared(value: unknown): PreparedAction {
  const outcome = record(value, "prepared chapter transition");
  expect(outcome).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return outcome as PreparedAction;
}

function readModel(value: unknown): JsonRecord {
  return record(record(value, "Room observation").readModel, "Room read model");
}

function chapter(read: JsonRecord, chapterId: string): JsonRecord {
  const found = list(read.chapters, "chapter projection")
    .map((entry) => record(entry, "chapter"))
    .find((entry) => entry.chapterId === chapterId);
  expect(found, `chapter ${chapterId}`).toBeDefined();
  return found!;
}

async function initializeRoom(
  roomName: string,
  options: { includeBob?: boolean } = {},
): Promise<InitializedRoom> {
  const authority = env.ROOMS.getByName(roomName) as unknown as RoomAuthority;
  const initialized = record(await authority.initializeAuthoritative({
    roomId: roomName,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      ...(options.includeBob
        ? [{ principalId: BOB.principal.id, role: "player" }]
        : []),
    ],
    characters: [
      {
        characterId: `character:${roomName}:alice`,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          abilityScores: { str: 10, dex: 14, con: 12, int: 14, wis: 12, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["investigation"],
        },
      },
      ...(options.includeBob
        ? [{
            characterId: `character:${roomName}:bob`,
            controllerPrincipalId: BOB.principal.id,
            staticCard: {
              name: "柏舟",
              sceneId: "yard",
              abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
              proficiencyBonus: 2,
              proficientSkills: ["athletics"],
            },
          }]
        : []),
    ],
  }), "authoritative initialization");
  expect(initialized).toMatchObject({ created: true });
  const capabilities = record(initialized.serviceCapabilities, "service capabilities");
  expect(capabilities.archiveExport).toBeDefined();
  return {
    authority,
    archiveExportCapability: capabilities.archiveExport,
  };
}

function transitionProposal(
  action: PreparedAction,
  chapterRef: string,
  moduleMigration?: ModuleMigrationRequest,
) {
  return {
    kind: "directSuccess",
    goal: `结束当前章节并进入 ${chapterRef}`,
    method: "保留既有正史，在明确章节边界进入下一章。",
    publicBasisRefs: [],
    privateBasisRefs: [],
    adjudicationPrecedent: null,
    risk: null,
    pendingInput: null,
    dynamicMaterializations: [],
    hiddenRealityCandidateSet: null,
    npcActions: [],
    mechanicalProposal: {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "transitionChapter",
      chapterRef,
      activityTransitions: [],
      ...(moduleMigration === undefined
        ? {}
        : { moduleMigration: structuredClone(moduleMigration) }),
    },
    scene: {
      question: `${chapterRef} 将如何承接既有后果？`,
      pressure: "既有事实继续生效。",
      opportunities: ["依据既有事实继续行动"],
      conclusionCandidate: null,
    },
    rootActionId: action.rootActionId,
    proposalAttemptId: `proposal:${chapterRef}:1`,
  };
}

async function commitTransition(
  authority: RoomAuthority,
  submissionId: string,
  chapterRef: string,
  moduleMigration?: ModuleMigrationRequest,
) {
  const action = prepared(await authority.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId: "forged-character-id-is-ignored",
    text: `我确认当前章结论，并进入 ${chapterRef}。`,
  }));
  const outcome = record(await authority.commit(
    ALICE,
    action.preparedActionId,
    transitionProposal(action, chapterRef, moduleMigration),
  ), "chapter transition outcome");
  return { action, outcome };
}

async function archiveEvents(room: InitializedRoom): Promise<JsonRecord[]> {
  const exported = record(await room.authority.exportAuthoritativeArchive(
    room.archiveExportCapability,
  ), "archive export");
  expect(exported.kind).toBe("exported");
  const archive = record(exported.archive, "authoritative archive");
  return list(archive.events, "archive events").map((event) => record(event, "archive event"));
}

function migrationRequest(value: Awaited<ReturnType<typeof authoritativeModuleMigration>>): ModuleMigrationRequest {
  return {
    fromModuleRef: structuredClone(value.fromModuleRef),
    toModuleRef: structuredClone(value.toModuleRef),
    migrationRef: structuredClone(value.migrationRef),
  };
}

describe("chapter-bound authoritative ModuleRef migration", () => {
  it("rejects forged internal migration descriptors through the public Rules step", async () => {
    const roomName = "chapter-module-v2-rules-rejects-forged-descriptor";
    const room = await initializeRoom(roomName);
    const exported = record(await room.authority.exportAuthoritativeArchive(
      room.archiveExportCapability,
    ), "archive export");
    const archive = record(exported.archive, "authoritative archive");
    const replayed = replay(archive.signedGenesis, archive.events);
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    if (replayed.kind !== "replayed") return;

    const forgeries = [
      {
        label: "arbitrary target",
        value: {
          ...PINNED_V1_TO_V2_MIGRATION,
          toModuleRef: {
            profileId: "module:black-oak-will:attacker-v99",
            profileHash: `sha256:${"9".repeat(64)}`,
          },
        },
      },
      {
        label: "arbitrary migration ref",
        value: {
          ...PINNED_V1_TO_V2_MIGRATION,
          migrationRef: {
            profileId: "module-migration:black-oak-will:attacker-selected",
            profileHash: `sha256:${"8".repeat(64)}`,
          },
        },
      },
      {
        label: "arbitrary module id",
        value: { ...PINNED_V1_TO_V2_MIGRATION, moduleId: "attacker-module" },
      },
      {
        label: "tampered pinned hash",
        value: {
          ...PINNED_V1_TO_V2_MIGRATION,
          toModuleRef: { ...MODULE_V2_REF, profileHash: `sha256:${"7".repeat(64)}` },
        },
      },
    ];

    for (const forgery of forgeries) {
      const outcome = step(replayed.profiles, replayed.state, {
        kind: "resolveCompoundActionPlan",
        actionPlanVersion: "authoritative-kp-action-plan-v1",
        feasibilityKind: "directSuccess",
        rootActionId: `root:chapter-module:forged:${forgery.label.replaceAll(" ", "-")}`,
        actorCharacterId: `character:${roomName}:alice`,
        goal: "伪造内部模块迁移证明",
        method: "绕过 Room Registry 直接调用 Rules step",
        publicBasisRefs: [],
        privateBasisRefs: [],
        adjudicationPrecedent: null,
        risk: null,
        dynamicMaterializations: [],
        npcActions: [],
        scene: {
          question: "Rules 会否接受伪造迁移？",
          pressure: "外部调用者控制整个 JSON。",
          opportunities: [],
          conclusionCandidate: null,
        },
        mechanicalProposal: {
          operation: "advanceCampaignLifecycle",
          lifecycleAction: "transitionChapter",
          chapterRef: `chapter:forged:${forgery.label.replaceAll(" ", "-")}`,
          activityTransitions: [],
          verifiedModuleMigration: structuredClone(forgery.value),
        },
      });
      expect(outcome.kind, `${forgery.label}: ${JSON.stringify(outcome)}`).toBe("rejected");
      expect(outcome.events, forgery.label).toEqual([]);
    }
  });

  it("rejects a migration whose global chapter head changes while Registry verification yields", async () => {
    const roomName = "chapter-module-v2-registry-concurrency";
    const room = await initializeRoom(roomName, { includeBob: true });
    const registered = await authoritativeModuleMigration(
      "black-oak-will",
      "legacy-anchor-v1",
      "legacy-anchor-v2",
    );
    const migrating = prepared(await room.authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:chapter-module:stale-migration",
      characterId: "caller-character-is-not-authority",
      text: "在章节边界迁移到 v2。",
    }));
    const competing = prepared(await room.authority.prepare(BOB, {
      kind: "intent",
      submissionId: "submission:chapter-module:competing-transition",
      characterId: "caller-character-is-not-authority",
      text: "先结束当前章并进入另一章。",
    }));
    const migrationProposal = transitionProposal(
      migrating,
      "chapter:stale-migration-must-not-win",
      migrationRequest(registered),
    );
    const competingProposal = transitionProposal(
      competing,
      "chapter:competing-transition-wins",
    );

    const concurrent = await runInDurableObject(room.authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityMechanicalInput(
          submission: unknown,
          proposal: unknown,
          profiles: unknown,
          state: unknown,
          authenticated: unknown,
        ): Promise<unknown>;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalMechanicalInput = target.authorityMechanicalInput.bind(target);
      let releaseMigration!: () => void;
      let signalMigrationPaused!: () => void;
      const migrationGate = new Promise<void>((resolve) => {
        releaseMigration = resolve;
      });
      const migrationPaused = new Promise<void>((resolve) => {
        signalMigrationPaused = resolve;
      });
      let paused = false;
      target.authorityMechanicalInput = async (
        submission,
        proposal,
        profiles,
        state,
        authenticated,
      ) => {
        const mechanical = record(record(proposal, "proposal at Registry boundary").mechanicalProposal,
          "mechanical proposal at Registry boundary");
        if (!paused && mechanical.moduleMigration !== undefined) {
          paused = true;
          signalMigrationPaused();
          await migrationGate;
        }
        return originalMechanicalInput(submission, proposal, profiles, state, authenticated);
      };

      const stalePromise = target.commit(
        ALICE,
        migrating.preparedActionId,
        structuredClone(migrationProposal),
      );
      await migrationPaused;
      const competingOutcome = await target.commit(
        BOB,
        competing.preparedActionId,
        structuredClone(competingProposal),
      );
      releaseMigration();
      return {
        competingOutcome,
        staleOutcome: await stalePromise,
      };
    });

    const competingOutcome = record(concurrent.competingOutcome, "competing transition outcome");
    expect(competingOutcome.kind, JSON.stringify(competingOutcome)).toBe("committed");
    const staleOutcome = record(concurrent.staleOutcome, "stale migration outcome");
    expect(staleOutcome).toMatchObject({ kind: "rejected", code: "scopeConflict" });

    const events = await archiveEvents(room);
    expect(events.some((event) => event.rootActionId === migrating.rootActionId)).toBe(false);
    const read = readModel(await room.authority.observe(BOB));
    expect(record(read.campaign, "campaign after concurrent transition").moduleRef)
      .toEqual(MODULE_V1_REF);
    expect(chapter(read, "chapter:competing-transition-wins")).toMatchObject({
      status: "active",
      moduleRef: MODULE_V1_REF,
    });
  });

  it("pins the genesis and same-version ChapterStarted records to the inherited module id/version/hash", async () => {
    const room = await initializeRoom("chapter-module-v2-inherits-same-version");
    const initialRead = readModel(await room.authority.observe(ALICE));
    expect(record(initialRead.campaign, "campaign").moduleRef).toEqual(MODULE_V1_REF);
    expect(chapter(initialRead, "chapter:opening").moduleRef).toEqual(MODULE_V1_REF);

    const transitioned = await commitTransition(
      room.authority,
      "submission:chapter-module:same-version",
      "chapter:same-version:second",
    );
    expect(transitioned.outcome.kind, JSON.stringify(transitioned.outcome)).toBe("committed");

    const events = (await archiveEvents(room))
      .filter((event) => event.rootActionId === transitioned.action.rootActionId);
    expect(events
      .filter((event) => String(event.eventType).startsWith("Chapter")
        || event.eventType === "ModuleVersionMigrated")
      .map((event) => event.eventType))
      .toEqual(["ChapterConcluded", "ChapterContinuityRecorded", "ChapterStarted"]);
    expect(record(
      events.find((event) => event.eventType === "ChapterStarted")?.payload,
      "same-version ChapterStarted payload",
    ).moduleRef).toEqual(MODULE_V1_REF);

    const continuedRead = readModel(await room.authority.observe(ALICE));
    expect(chapter(continuedRead, "chapter:opening").moduleRef).toEqual(MODULE_V1_REF);
    expect(chapter(continuedRead, "chapter:same-version:second").moduleRef).toEqual(MODULE_V1_REF);
  });

  it("uses the one registered mapping to emit ModuleVersionMigrated at the chapter boundary without rewriting the old chapter", async () => {
    const room = await initializeRoom("chapter-module-v2-approved-migration");
    const registered = await authoritativeModuleMigration(
      "black-oak-will",
      "legacy-anchor-v1",
      "legacy-anchor-v2",
    );
    expect(registered).toMatchObject({
      fromModuleRef: MODULE_V1_REF,
      toModuleRef: MODULE_V2_REF,
      migrationRef: MIGRATION_V1_TO_V2_REF,
    });

    const migrated = await commitTransition(
      room.authority,
      "submission:chapter-module:approved-v1-to-v2",
      "chapter:migrated:v2",
      migrationRequest(registered),
    );
    expect(migrated.outcome.kind, JSON.stringify(migrated.outcome)).toBe("committed");

    const events = (await archiveEvents(room))
      .filter((event) => event.rootActionId === migrated.action.rootActionId);
    expect(events
      .filter((event) => String(event.eventType).startsWith("Chapter")
        || event.eventType === "ModuleVersionMigrated")
      .map((event) => event.eventType))
      .toEqual([
        "ChapterConcluded",
        "ChapterContinuityRecorded",
        "ModuleVersionMigrated",
        "ChapterStarted",
      ]);
    expect(record(
      events.find((event) => event.eventType === "ModuleVersionMigrated")?.payload,
      "ModuleVersionMigrated payload",
    )).toMatchObject({
      fromModuleRef: MODULE_V1_REF,
      toModuleRef: MODULE_V2_REF,
      migrationRef: MIGRATION_V1_TO_V2_REF,
    });
    expect(record(
      events.find((event) => event.eventType === "ChapterStarted")?.payload,
      "migrated ChapterStarted payload",
    ).moduleRef).toEqual(MODULE_V2_REF);

    const migratedRead = readModel(await room.authority.observe(ALICE));
    expect(record(migratedRead.campaign, "migrated campaign").moduleRef).toEqual(MODULE_V2_REF);
    expect(chapter(migratedRead, "chapter:opening").moduleRef).toEqual(MODULE_V1_REF);
    expect(chapter(migratedRead, "chapter:migrated:v2").moduleRef).toEqual(MODULE_V2_REF);

    const beforeReverse = await archiveEvents(room);
    const reverse = await commitTransition(
      room.authority,
      "submission:chapter-module:reject-reverse-v2-to-v1",
      "chapter:reverse-is-unapproved",
      {
        fromModuleRef: structuredClone(MODULE_V2_REF),
        toModuleRef: structuredClone(MODULE_V1_REF),
        migrationRef: structuredClone(MIGRATION_V1_TO_V2_REF),
      },
    );
    expect(reverse.outcome.kind, JSON.stringify(reverse.outcome)).toBe("rejected");
    expect(await archiveEvents(room)).toEqual(beforeReverse);
    const afterReverse = readModel(await room.authority.observe(ALICE));
    expect(chapter(afterReverse, "chapter:migrated:v2")).toMatchObject({
      status: "active",
      moduleRef: MODULE_V2_REF,
    });
  });

  it.each([
    {
      label: "an arbitrary unregistered mapping",
      migration: {
        fromModuleRef: MODULE_V1_REF,
        toModuleRef: {
          profileId: "module:black-oak-will:unregistered-v3",
          profileHash: `sha256:${"3".repeat(64)}`,
        },
        migrationRef: {
          profileId: "module-migration:black-oak-will:legacy-anchor-v1-to-unregistered-v3",
          profileHash: `sha256:${"4".repeat(64)}`,
        },
      },
    },
    {
      label: "a hash-tampered registered mapping",
      migration: {
        fromModuleRef: MODULE_V1_REF,
        toModuleRef: MODULE_V2_REF,
        migrationRef: {
          ...MIGRATION_V1_TO_V2_REF,
          profileHash: `sha256:${"f".repeat(64)}`,
        },
      },
    },
  ])("rejects $label without appending any event", async ({ label, migration }) => {
    const roomName = label.includes("arbitrary")
      ? "chapter-module-v2-reject-arbitrary"
      : "chapter-module-v2-reject-tampered-hash";
    const room = await initializeRoom(roomName);
    const before = await archiveEvents(room);
    const rejected = await commitTransition(
      room.authority,
      `submission:${roomName}`,
      `chapter:${roomName}:next`,
      structuredClone(migration),
    );
    expect(rejected.outcome.kind, JSON.stringify(rejected.outcome)).toBe("rejected");
    expect(await archiveEvents(room)).toEqual(before);
    expect(chapter(readModel(await room.authority.observe(ALICE)), "chapter:opening")).toMatchObject({
      status: "active",
      moduleRef: MODULE_V1_REF,
    });
  });
});
