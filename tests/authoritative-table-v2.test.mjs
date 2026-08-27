import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

function exportedSection(server, name, nextName) {
  const start = server.indexOf(`export const ${name} =`);
  const end = server.indexOf(`export const ${nextName} =`, start + 1);
  assert.notEqual(start, -1, `${name} export is missing`);
  assert.notEqual(end, -1, `${nextName} boundary is missing`);
  return server.slice(start, end);
}

test("new rooms pin authoritative profiles without creating legacy active state", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const create = exportedSection(server, "createRoom", "joinRoom");

  assert.match(server, /import \{[^}]*AUTHORITATIVE_RULESET_VERSION[^}]*\} from "@\/lib\/rules\/ruleset"/s);
  assert.match(server, /import \{[^}]*AUTHORITATIVE_KP_MODEL[^}]*\} from "@\/lib\/kp\/models"/s);
  assert.match(create, /AUTHORITATIVE_RULESET_VERSION/);
  assert.match(create, /AUTHORITATIVE_KP_MODEL/);
  assert.doesNotMatch(create, /game_states/);
});

test("starting authoritative-v2 seeds the Room Authority from members and locked static cards only", async () => {
  const { buildAuthoritativeRoomSeeds } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const seeds = buildAuthoritativeRoomSeeds({
    members: [
      { userId: "principal:alice", nickname: "爱丽丝", isHost: true },
      { userId: "principal:bob", nickname: "鲍勃", isHost: false },
      { userId: "principal:observer", nickname: "旁观者", isHost: false },
    ],
    lockedCharacters: [
      {
        userId: "principal:alice",
        sheet: { name: "阿莱莎", hp: { current: 8, max: 8 }, privateNote: "static-only" },
      },
      {
        userId: "principal:bob",
        sheet: { name: "博林", hp: { current: 11, max: 11 } },
      },
    ],
    openingSceneId: "wake",
    characterIdFor: (userId) => `character:${userId}`,
  });

  assert.deepEqual(seeds.members, [
    { principalId: "principal:alice", role: "host" },
    { principalId: "principal:bob", role: "player" },
    { principalId: "principal:observer", role: "player" },
  ]);
  assert.deepEqual(seeds.characters, [
    {
      characterId: "character:principal:alice",
      controllerPrincipalId: "principal:alice",
      staticCard: {
        name: "阿莱莎",
        hp: { current: 8, max: 8 },
        privateNote: "static-only",
        sceneId: "wake",
      },
    },
    {
      characterId: "character:principal:bob",
      controllerPrincipalId: "principal:bob",
      staticCard: {
        name: "博林",
        hp: { current: 11, max: 11 },
        sceneId: "wake",
      },
    },
  ]);

  const server = await source("app/_runtime/lib/table/server.ts");
  const start = exportedSection(server, "startGame", "sendAction");
  const v2Start = start.indexOf("info.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
  const legacyStart = start.indexOf("info.ruleset_version === RULESET_VERSION", v2Start + 1);
  assert.notEqual(v2Start, -1, "authoritative start branch is missing");
  assert.notEqual(legacyStart, -1, "legacy start branch is missing");
  const v2Branch = start.slice(v2Start, legacyStart);
  assert.match(v2Branch, /initializeAuthoritativeRoom/);
  assert.match(v2Branch, /return\s*\{\s*ok: true as const/);
  assert.doesNotMatch(v2Branch, /messages|session_logs|game_states/);
});

test("authoritative table reads only the viewer projection and current delivery without a narration history", async () => {
  const { projectAuthoritativeTableObservation } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice", "principal:bob"],
    locationLabels: { shrine: "旧神龛", yard: "庭院" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "17",
        projectionHash: "sha256:alice-projection",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          subjectId: "character:principal:alice",
        },
        controlledCharacter: {
          characterId: "character:principal:alice",
          name: "阿莱莎",
          sceneId: "shrine",
          hitPoints: { current: 7, maximum: 11 },
          resources: { inspiration: 1, slot1: 2, hitDice: 1 },
          resourceMaximums: { inspiration: 1, slot1: 3, hitDice: 3 },
          classId: "wizard",
          level: 3,
          loadout: {
            armorClass: 15,
            speedFeet: 30,
            equipped: { armor: "leather", main: "dagger" },
            backpack: [
              { itemId: "torch", quantity: 1 },
              { itemId: "thieves-tools", quantity: 1 },
            ],
            privateAttunement: "omit-me",
          },
        },
        safetyPresentation: {
          status: "paused",
          presentationAdjustment: "reduceDetail",
          privateReason: "omit-me",
        },
        fictionTime: { branchId: "branch:main", nowMicros: "120000000" },
        visibleFacts: [{ id: "fact:open-door", secretImplementationFlag: "omit-me" }],
        knowledge: [{
          characterId: "character:principal:alice",
          knowledgeRef: "knowledge:chalk",
          objectKind: "sensoryEvidence",
          layer: "full",
          content: { title: "粉笔记号", text: "门框内侧有一道新鲜粉笔记号。", privateRaw: "omit-me" },
          visibility: "private",
        }],
        receipts: [{ receiptId: "receipt:17", rootActionId: "root:17", status: "committed" }],
        pendingInputs: [{
          pendingInputId: "pending:lever",
          kind: "clarification",
          rootActionId: "root:lever",
          question: "你要拉左侧警铃，还是右侧闸门？",
          internalCandidates: ["alarm", "gate"],
        }, {
          pendingInputId: "pending:lever-choice",
          kind: "playerChoice",
          rootActionId: "root:lever-choice",
          question: "你明确拉哪一根拉杆？",
          choices: [
            { choiceId: "alarm", label: "警铃", consequence: "警铃会通知守卫。", secret: "omit-me" },
            { choiceId: "gate", label: "闸门", consequence: "闸门会开始升起。", secret: "omit-me" },
          ],
          internalCandidates: ["hidden-third-option"],
        }, {
          pendingInputId: "pending:group-rest",
          kind: "groupRestConsent",
          rootActionId: "root:group-rest",
          question: "是否自愿加入短休？请自行选择恢复资源。",
          options: {
            initiatorCharacterId: "character:principal:bob",
            restKind: "short",
            intendedDurationMicros: "3600000000",
            offeredAtFictionMicros: "120000000",
            secretChoice: "omit-me",
          },
        }, {
          pendingInputId: "pending:party-move",
          kind: "partyMoveConsent",
          rootActionId: "root:party-move",
          question: "是否同意整队前往旧神龛？",
          hiddenDestinationTimeline: "omit-me",
        }, {
          pendingInputId: "pending:combat-target",
          kind: "combatChoice",
          rootActionId: "root:combat-target",
          question: "请选择本次攻击的目标或取消。",
          choiceKind: "target",
          candidateEntityIds: ["npc:warden", "enemy:ash-brute"],
          operation: { secretAbility: "omit-me" },
        }, {
          pendingInputId: "pending:combat-reaction",
          kind: "combatChoice",
          rootActionId: "root:combat-reaction",
          question: "是否使用这次反应？",
          choiceKind: "reaction",
          candidateAbilityRefs: ["action:opportunity-attack"],
          targetEntityId: "enemy:ash-brute",
          reactionQueue: ["secret:omit-me"],
        }, {
          pendingInputId: "pending:combat-initiative",
          kind: "combatChoice",
          rootActionId: "root:combat-initiative",
          question: "请决定同点玩家角色的先攻顺序。",
          choiceKind: "initiativeTieOrder",
          orderedEntityIds: ["character:principal:alice", "character:principal:bob"],
          secretNpcOrder: ["omit-me"],
        }, {
          pendingInputId: "pending:combat-conclusion",
          kind: "combatChoice",
          rootActionId: "root:combat-conclusion",
          question: "是否接受当前遭遇的收束方式？",
          choiceKind: "encounterConclusion",
          proposal: { secretReason: "omit-me" },
        }],
        activities: [{
          activityId: "activity:rest:alice",
          characterId: "character:principal:alice",
          restKind: "short",
          status: "active",
          startedAtFictionMicros: "120000000",
          intendedDurationMicros: "3600000000",
          recoveryChoice: { secretFaces: "omit-me" },
        }],
        encounters: [{
          encounterId: "encounter:yard",
          status: "active",
          participantEntityIds: ["character:principal:alice"],
          secretInitiative: "omit-me",
        }],
        entities: {
          "npc:warden": {
            id: "npc:warden",
            kind: "npc",
            name: "守夜人",
            sceneId: "shrine",
            intro: "他握着提灯守在门边。",
            privatePlan: "omit-me",
          },
          "npc:distant": {
            id: "npc:distant",
            kind: "npc",
            name: "远处密探",
            sceneId: "yard",
            intro: "不应可见",
          },
        },
        narrationHistory: ["omit-me"],
      },
      delivery: {
        kind: "current",
        frame: {
          deliveryId: "delivery:17:alice",
          text: "门轴轻响，门已打开。你要怎么做？",
          projectionHash: "sha256:alice-projection",
          prompt: "omit-me",
        },
      },
      internalRoomState: "omit-me",
    },
  });

  assert.deepEqual(projected.messages, [{
    id: "delivery:17:alice",
    user_id: null,
    kind: "narrate",
    name: "KP",
    body: "门轴轻响，门已打开。你要怎么做？",
    created_at: "",
    clues: [],
  }]);
  assert.deepEqual(projected.locationThreads, []);
  assert.deepEqual(projected.logs, []);
  assert.equal(projected.currentDeliveryId, "delivery:17:alice");
  assert.deepEqual(projected.fictionTime, {
    branchId: "branch:main",
    nowMicros: "120000000",
  });
  assert.deepEqual(projected.pendingInputs, [{
    pendingInputId: "pending:lever",
    kind: "clarification",
    rootActionId: "root:lever",
    question: "你要拉左侧警铃，还是右侧闸门？",
  }, {
    pendingInputId: "pending:lever-choice",
    kind: "playerChoice",
    rootActionId: "root:lever-choice",
    question: "你明确拉哪一根拉杆？",
    choices: [
      { choiceId: "alarm", label: "警铃", consequence: "警铃会通知守卫。" },
      { choiceId: "gate", label: "闸门", consequence: "闸门会开始升起。" },
    ],
  }, {
    pendingInputId: "pending:group-rest",
    kind: "groupRestConsent",
    rootActionId: "root:group-rest",
    question: "是否自愿加入短休？请自行选择恢复资源。",
    options: {
      initiatorCharacterId: "character:principal:bob",
      restKind: "short",
      intendedDurationMicros: "3600000000",
      offeredAtFictionMicros: "120000000",
    },
  }, {
    pendingInputId: "pending:party-move",
    kind: "partyMoveConsent",
    rootActionId: "root:party-move",
    question: "是否同意整队前往旧神龛？",
  }, {
    pendingInputId: "pending:combat-target",
    kind: "combatChoice",
    rootActionId: "root:combat-target",
    question: "请选择本次攻击的目标或取消。",
    choiceKind: "target",
    candidateEntityIds: ["npc:warden", "enemy:ash-brute"],
  }, {
    pendingInputId: "pending:combat-reaction",
    kind: "combatChoice",
    rootActionId: "root:combat-reaction",
    question: "是否使用这次反应？",
    choiceKind: "reaction",
    candidateAbilityRefs: ["action:opportunity-attack"],
    targetEntityId: "enemy:ash-brute",
  }, {
    pendingInputId: "pending:combat-initiative",
    kind: "combatChoice",
    rootActionId: "root:combat-initiative",
    question: "请决定同点玩家角色的先攻顺序。",
    choiceKind: "initiativeTieOrder",
    orderedEntityIds: ["character:principal:alice", "character:principal:bob"],
  }, {
    pendingInputId: "pending:combat-conclusion",
    kind: "combatChoice",
    rootActionId: "root:combat-conclusion",
    question: "是否接受当前遭遇的收束方式？",
    choiceKind: "encounterConclusion",
  }]);
  assert.deepEqual(projected.clues, [{
    id: "knowledge:chalk",
    name: "粉笔记号",
    text: "门框内侧有一道新鲜粉笔记号。",
    hint: "感官证据",
    layer: "full",
  }]);
  assert.deepEqual(projected.npcs, [{
    id: "npc:warden",
    name: "守夜人",
    intro: "他握着提灯守在门边。",
  }]);
  assert.deepEqual(projected.places, { "principal:alice": "shrine" });
  assert.deepEqual(projected.placeNames, { "principal:alice": "旧神龛" });
  assert.deepEqual(projected.controlledCharacter.hitPoints, { current: 7, maximum: 11 });
  assert.deepEqual(projected.controlledCharacter.loadout, {
    armorClass: 15,
    speedFeet: 30,
    equipped: { armor: "leather", main: "dagger" },
    backpack: [
      { itemId: "thieves-tools", quantity: 1 },
      { itemId: "torch", quantity: 1 },
    ],
  });
  assert.deepEqual(projected.controlledCharacter.resources, { inspiration: 1, slot1: 2, hitDice: 1 });
  assert.deepEqual(projected.controlledCharacter.resourceMaximums, { inspiration: 1, slot1: 3, hitDice: 3 });
  assert.equal(projected.controlledCharacter.classId, "wizard");
  assert.equal(projected.controlledCharacter.level, 3);
  assert.deepEqual(projected.safetyPresentation, {
    status: "paused",
    presentationAdjustment: "reduceDetail",
  });
  assert.equal(projected.inCombat, true);
  assert.deepEqual(projected.activities, [{
    activityId: "activity:rest:alice",
    characterId: "character:principal:alice",
    status: "active",
    startedAtFictionMicros: "120000000",
    intendedDurationMicros: "3600000000",
    restKind: "short",
  }]);
  assert.deepEqual(projected.receipts, [{
    receiptId: "receipt:17",
    rootActionId: "root:17",
    status: "committed",
  }]);
  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /omit-me|internalCandidates|narrationHistory|privatePlan|privateRaw/);
  const playTable = await source("app/_runtime/components/play-table.tsx");
  assert.match(playTable, /kind: "playerChoice"/);
  assert.match(playTable, /answer: \{ choiceId: choice\.choiceId \}/);
  assert.match(playTable, /choice\.consequence/);

  assert.throws(() => projectAuthoritativeTableObservation({
    userId: "principal:bob",
    members: ["principal:alice", "principal:bob"],
    locationLabels: {},
    observation: {
      ...structuredClone(projected),
      readModel: {
        kind: "projected",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          subjectId: "character:principal:alice",
        },
        controlledCharacter: { characterId: "character:principal:alice" },
      },
    },
  }), /projection/i);

  assert.doesNotThrow(() => projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: { shrine: "旧神龛" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "17",
        projectionHash: "sha256:alice-projection",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          characterId: "character:principal:alice",
        },
        controlledCharacter: {
          characterId: "character:principal:alice",
          sceneId: "shrine",
        },
        fictionTime: { branchId: "branch:main", nowMicros: "120000000" },
        knowledge: [],
        receipts: [],
        pendingInputs: [],
      },
      delivery: { kind: "none" },
    },
  }), "the current Room read-model adapter uses viewer.characterId");

  const server = await source("app/_runtime/lib/table/server.ts");
  const fetch = exportedSection(server, "fetchTable", "setRoomModel");
  const v2Start = fetch.indexOf("info.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
  const legacyMessages = fetch.indexOf("const messages =", v2Start + 1);
  assert.notEqual(v2Start, -1, "authoritative fetch branch is missing");
  assert.notEqual(legacyMessages, -1, "legacy message query boundary is missing");
  const v2Branch = fetch.slice(v2Start, legacyMessages);
  assert.match(v2Branch, /observeAuthoritativeRoom/);
  assert.match(v2Branch, /projectAuthoritativeTableObservation/);
  assert.match(v2Branch, /return/);
  assert.doesNotMatch(v2Branch, /from messages|session_logs|game_states/);
});

test("authoritative table adapter preserves the viewer tactical projection", async () => {
  const { projectAuthoritativeTableObservation } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const tacticalProjection = {
    schema: "zhuwei.tactical-projection/v1",
    scene: {
      id: "scene:bell-yard",
      name: "钟楼庭院",
      boundary: {
        kind: "polygon",
        points: [
          { x: "0", y: "0" },
          { x: "1200", y: "0" },
          { x: "1200", y: "900" },
          { x: "0", y: "900" },
        ],
      },
      gridInches: 60,
    },
    self: {
      id: "character:principal:alice",
      name: "阿莱莎",
      kind: "player",
      position: { x: "120", y: "180", elevation: "60" },
      footprint: { width: "60", depth: "60", height: "66" },
      relation: "self",
      publicStates: ["half-cover"],
    },
    visibleEntities: [{
      id: "npc:warden",
      name: "守夜人",
      kind: "npc",
      position: { x: "600", y: "180", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "72" },
      relation: "enemy",
      publicStates: [],
    }],
    knownFeatures: [{
      id: "portal:yard-gate",
      kind: "portal",
      label: "庭院铁门",
      state: "closed",
      polygon: [
        { x: "480", y: "0" },
        { x: "540", y: "0" },
        { x: "540", y: "360" },
        { x: "480", y: "360" },
      ],
      elevation: "0",
      height: "120",
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
      terrain: "normal",
    }],
    knownZones: [],
    encounter: {
      id: "encounter:bell-yard",
      status: "starting",
      round: 2,
      activeEntityId: "character:principal:alice",
      participantEntityIds: [
        "character:principal:alice",
        "npc:warden",
      ],
    },
    preview: null,
    textualReadout: {
      sceneId: "scene:bell-yard",
      summary: "你在高台上；守夜人位于东侧，关闭的铁门阻断移动和视线。",
      entities: ["守夜人在东侧。"],
      features: ["关闭的庭院铁门阻断移动和视线并提供全掩护。"],
    },
    spatialRevision:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: { "scene:bell-yard": "钟楼庭院" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "17",
        projectionHash: "sha256:alice-tactical",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          subjectId: "character:principal:alice",
        },
        controlledCharacter: {
          characterId: "character:principal:alice",
          name: "阿莱莎",
          sceneId: "scene:bell-yard",
        },
        tacticalProjection,
        encounters: [],
        knowledge: [],
        pendingInputs: [],
        receipts: [],
      },
      delivery: { kind: "none" },
    },
  });

  assert.deepEqual(
    projected.tacticalProjection,
    tacticalProjection,
    "the table adapter must preserve the Room's already viewer-filtered geometry, positions, encounter, and textual readout",
  );
});

test("authoritative table adapter rejects an unknown field or non-canonical tactical shape as a whole", async () => {
  const { projectAuthoritativeTableObservation } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const tacticalProjection = {
    schema: "zhuwei.tactical-projection/v1",
    scene: {
      id: "scene:bell-yard",
      name: "钟楼庭院",
      boundary: {
        kind: "polygon",
        points: [
          { x: "0", y: "0" },
          { x: "600", y: "0" },
          { x: "600", y: "600" },
          { x: "0", y: "600" },
        ],
      },
      gridInches: 60,
    },
    self: {
      id: "character:principal:alice",
      name: "阿莱莎",
      kind: "player",
      position: { x: "60", y: "60", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "66" },
      relation: "self",
      publicStates: [],
    },
    visibleEntities: [],
    knownFeatures: [],
    knownZones: [],
    encounter: null,
    preview: null,
    textualReadout: {
      sceneId: "scene:bell-yard",
      summary: "你站在庭院中央。",
      entities: [],
      features: [],
    },
    spatialRevision:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const observe = (candidate) => projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: { "scene:bell-yard": "钟楼庭院" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "17",
        projectionHash: "sha256:alice-tactical",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          subjectId: "character:principal:alice",
        },
        controlledCharacter: {
          characterId: "character:principal:alice",
          name: "阿莱莎",
          sceneId: "scene:bell-yard",
        },
        tacticalProjection: candidate,
        encounters: [],
        knowledge: [],
        pendingInputs: [],
        receipts: [],
      },
      delivery: { kind: "none" },
    },
  });

  const withUnknownField = structuredClone(tacticalProjection);
  withUnknownField.gmOnly = "secret-tunnel";
  let unknownFieldError;
  assert.throws(
    () => observe(withUnknownField),
    (error) => {
      unknownFieldError = error;
      return error instanceof TypeError && /tactical projection/i.test(error.message);
    },
    "an unknown field must reject the whole projection instead of leaking or partially forwarding it",
  );
  assert.doesNotMatch(String(unknownFieldError), /secret-tunnel/);

  const withNonCanonicalCoordinate = structuredClone(tacticalProjection);
  withNonCanonicalCoordinate.self.position.x = "060";
  assert.throws(
    () => observe(withNonCanonicalCoordinate),
    /tactical projection/i,
    "authoritative integer-string coordinates must not be parsed, rounded, or repaired by the table adapter",
  );
});

test("fetchTable authoritative state carries only the exact-ruleset tactical projection", async () => {
  const {
    buildAuthoritativeTableState,
    projectAuthoritativeTableObservation,
  } = await import("../app/_runtime/lib/table/authoritative.ts");
  assert.equal(
    typeof buildAuthoritativeTableState,
    "function",
    "the real fetchTable branch needs one behavioral state adapter instead of rebuilding the projection inline",
  );
  const tacticalProjection = {
    schema: "zhuwei.tactical-projection/v1",
    scene: {
      id: "scene:bell-yard",
      name: "钟楼庭院",
      boundary: {
        kind: "polygon",
        points: [
          { x: "0", y: "0" },
          { x: "600", y: "0" },
          { x: "600", y: "600" },
        ],
      },
      gridInches: 60,
    },
    self: {
      id: "character:principal:alice",
      name: "阿莱莎",
      kind: "player",
      position: { x: "60", y: "60", elevation: "0" },
      footprint: { width: "60", depth: "60", height: "66" },
      relation: "self",
      publicStates: [],
    },
    visibleEntities: [],
    knownFeatures: [],
    knownZones: [],
    encounter: null,
    preview: null,
    textualReadout: {
      sceneId: "scene:bell-yard",
      summary: "你站在庭院中央。",
      entities: [],
      features: [],
    },
    spatialRevision:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: { "scene:bell-yard": "钟楼庭院" },
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "17",
        projectionHash: "sha256:alice-tactical",
        viewer: {
          kind: "player",
          principalId: "principal:alice",
          subjectId: "character:principal:alice",
        },
        controlledCharacter: {
          characterId: "character:principal:alice",
          name: "阿莱莎",
          sceneId: "scene:bell-yard",
        },
        tacticalProjection,
        encounters: [],
        knowledge: [],
        pendingInputs: [],
        receipts: [],
      },
      delivery: { kind: "none" },
    },
  });

  const authoritativeState = buildAuthoritativeTableState({
    rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
    projected,
  });
  assert.deepEqual(authoritativeState.tacticalProjection, tacticalProjection);
  assert.equal(
    buildAuthoritativeTableState({
      rulesetVersion: "dnd5e-2014-srd5.1-v1",
      projected,
    }),
    null,
    "the Legacy Adapter must not receive authoritative tactical space",
  );
  assert.equal(
    buildAuthoritativeTableState({ rulesetVersion: "unknown-ruleset", projected }),
    null,
    "an unknown ruleset must not receive authoritative tactical space",
  );

  const server = await source("app/_runtime/lib/table/server.ts");
  const fetch = exportedSection(server, "fetchTable", "setRoomModel");
  const authoritativeStart = fetch.indexOf(
    "info.ruleset_version === AUTHORITATIVE_RULESET_VERSION",
  );
  const legacyStart = fetch.indexOf("if (info.ruleset_version !== RULESET_VERSION)");
  const authoritativeBranch = fetch.slice(authoritativeStart, legacyStart);
  assert.match(
    authoritativeBranch,
    /buildAuthoritativeTableState/,
    "the behaviorally tested state adapter must be the one used by fetchTable",
  );
});

test("table reads fail closed before Legacy storage unless the ruleset version is exact", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const fetch = exportedSection(server, "fetchTable", "setRoomModel");
  const authoritativeEnd = fetch.indexOf("const messages =");
  assert.notEqual(authoritativeEnd, -1, "Legacy table reads are missing from the audit boundary");

  const beforeLegacyReads = fetch.slice(0, authoritativeEnd);
  assert.match(
    beforeLegacyReads,
    /info\.ruleset_version\s*!==\s*RULESET_VERSION[^]*return\s*\{\s*ok:\s*false as const/,
    "an unknown ruleset can fall through to messages/session_logs/game_states",
  );
});

test("unknown rulesets cannot reach unversioned Table mechanics or active-state writes", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const cases = [
    ["setRoomModel", "lockCharacter", "current.ruleset_version !== RULESET_VERSION", "update rooms set kp_model"],
    ["startGame", "sendAction", "info.ruleset_version !== RULESET_VERSION", "const where:"],
    ["sendAction", "acknowledgeDelivery", "info.ruleset_version !== RULESET_VERSION", "let sheet = ensureGear"],
    ["resolveRoll", "joinCombat", "roomInfo?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["joinCombat", "extraAttack", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["extraAttack", "endTurn", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["endTurn", "leaveFight", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["leaveFight", "resolveReact", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["resolveReact", "restNow", "rules?.ruleset_version !== RULESET_VERSION", "const st = ("],
    ["restNow", "cancelRest", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["cancelRest", "castSpell", "rules?.ruleset_version !== RULESET_VERSION", "const pc = ("],
    ["castSpell", "useFeature", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useFeature", "useHitDie", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
    ["useHitDie", "kickMember", "rules?.ruleset_version !== RULESET_VERSION", "const row = ("],
  ];

  for (const [name, nextName, gateText, legacyFallbackText] of cases) {
    const section = exportedSection(server, name, nextName);
    const authoritative = section.indexOf("AUTHORITATIVE_RULESET_VERSION");
    const gate = section.indexOf(gateText, authoritative);
    const legacyFallback = section.indexOf(legacyFallbackText, authoritative);
    assert.notEqual(authoritative, -1, `${name} authoritative branch is missing`);
    assert.notEqual(legacyFallback, -1, `${name} unversioned Legacy boundary is missing`);
    assert.ok(
      gate > authoritative && gate < legacyFallback,
      `${name} can reach unversioned Legacy mechanics without an exact ruleset gate`,
    );
    assert.match(
      section.slice(gate, legacyFallback),
      /return\s*\{\s*ok:\s*false as const/,
      `${name} does not fail closed for an unknown ruleset`,
    );
  }
});

test("authoritative actions derive the character from the trusted viewer and preserve submission identity", async () => {
  const { buildAuthoritativeActionInput } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const intent = buildAuthoritativeActionInput({
    submissionId: "submission:stable",
    text: "我检查神龛背面的划痕。",
    characterId: "character:forged",
    actorId: "character:forged",
    actor: "principal:forged",
    principalId: "principal:forged",
    principal: "principal:forged",
    dice: [20],
    faces: [20],
    events: [{ type: "WishGranted" }],
    state: { hitPoints: 999 },
    profile: "forged",
    profileId: "forged",
  });
  assert.deepEqual(intent, {
    kind: "intent",
    submissionId: "submission:stable",
    text: "我检查神龛背面的划痕。",
  });

  const answer = buildAuthoritativeActionInput({
    submissionId: "submission:answer",
    pendingInputId: "pending:lever",
    text: "拉右侧闸门。",
    characterId: "character:forged",
  });
  assert.deepEqual(answer, {
    kind: "answer",
    submissionId: "submission:answer",
    pendingInputId: "pending:lever",
    answer: { text: "拉右侧闸门。" },
  });

  const structuredAnswer = buildAuthoritativeActionInput({
    submissionId: "submission:advancement",
    pendingInputId: "pending:advancement",
    text: "确认晋升。",
    answer: {
      classId: "rogue",
      newLevel: 4,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:ability-score-improvement"],
      abilityScoreIncreases: { dex: 2 },
    },
    actorCharacterId: "character:forged",
  });
  assert.deepEqual(structuredAnswer, {
    kind: "answer",
    submissionId: "submission:advancement",
    pendingInputId: "pending:advancement",
    answer: {
      classId: "rogue",
      newLevel: 4,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:ability-score-improvement"],
      abilityScoreIncreases: { dex: 2 },
    },
  });

  const server = await source("app/_runtime/lib/table/server.ts");
  const send = exportedSection(server, "sendAction", "resolveRoll");
  const v2Start = send.indexOf("info.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
  const legacyStart = send.indexOf("info.ruleset_version === RULESET_VERSION", v2Start + 1);
  assert.notEqual(v2Start, -1, "authoritative send branch is missing");
  assert.notEqual(legacyStart, -1, "legacy send boundary is missing");
  const v2Branch = send.slice(v2Start, legacyStart);
  assert.match(v2Branch, /runAuthoritativeRoomAction/);
  assert.doesNotMatch(v2Branch, /characterId\s*:/);
  assert.match(v2Branch, /submissionId/);
  assert.match(v2Branch, /return/);
  assert.doesNotMatch(
    v2Branch,
    /rollDie|game_states|messages|session_logs|ensureGear|writeFlags|applyCast|applyFeature|runKpTurn/,
  );
});

test("the browser owns transport choices only and the API restores trusted identity", async () => {
  const browserPaths = [
    "app/table/[code]/table-client.tsx",
    "app/_runtime/components/play-table.tsx",
    "app/_runtime/lib/table/client.ts",
    "app/_runtime/lib/table/authoritative-client.ts",
  ];
  const mechanicalRandomness = /Math\.random\s*\(|crypto\.getRandomValues\s*\(|\broll(?:Die|Dice|D20|DiceExpr)\s*\(/;
  for (const path of browserPaths) {
    assert.doesNotMatch(
      await source(path),
      mechanicalRandomness,
      `${path} must not own authoritative dice or mechanical randomness`,
    );
  }

  const client = await source("app/_runtime/lib/table/client.ts");
  assert.match(client, /body:\s*JSON\.stringify\(\{ command, data \}\)/);
  assert.doesNotMatch(client, /userId:\s*(?:data|payload)|principalId:\s*(?:data|payload)/);

  const route = await source("app/api/game/route.ts");
  assert.match(route, /const user = await requireApiUser\(\)/);
  assert.match(
    route,
    /await command\(\{ data: payload\.data as never, userId: user\.userId \}\)/,
  );
  assert.doesNotMatch(route, /userId:\s*payload|principal(?:Id)?:\s*payload/);

  const worker = await source("worker/index.ts");
  assert.match(worker, /return handler\.fetch\(request, env, ctx\)/);
  assert.doesNotMatch(worker, mechanicalRandomness);
});

test("the table client acknowledges only the current delivery after rendering it", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const ack = exportedSection(server, "acknowledgeDelivery", "resolveRoll");
  assert.match(ack, /memberOf\(room\.id, context\.userId\)/);
  assert.match(ack, /AUTHORITATIVE_RULESET_VERSION/);
  assert.match(ack, /acknowledgeAuthoritativeDelivery/);
  assert.doesNotMatch(ack, /messages|session_logs|game_states|delete|update|insert/);

  const client = await source("app/_runtime/lib/table/client.ts");
  assert.match(client, /export const acknowledgeDelivery[^]*call<Result>\("acknowledgeDelivery", data\)/);

  const ui = await source("app/_runtime/components/play-table.tsx");
  assert.match(ui, /acknowledgeDelivery/);
  assert.match(ui, /currentDeliveryId/);
  assert.match(ui, /ackedDeliveryRef/);
  assert.match(ui, /requestAnimationFrame/);
  assert.match(ui, /submissionId/);
  assert.match(ui, /function CombatChoicePanel/);
  assert.match(ui, /selectTarget/);
  assert.match(ui, /useReaction/);
  assert.match(ui, /acceptEncounterConclusion/);
  assert.match(ui, /rejectEncounterConclusion/);
  assert.match(ui, /orderedEntityIds: initiativeOrder/);
  assert.match(ui, /answer: \{ accept: true \}/);
  assert.match(ui, /answer: \{ accept: false \}/);
  assert.match(ui, /invalidateQueries\(\{ queryKey: \["table", code\] \}\)/);
  assert.doesNotMatch(ui, /narrationHistory/);
});

test("safety pause is a direct authenticated Table action with a closed private recovery UI", async () => {
  const { projectAuthoritativeTableObservation } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const lifecycle = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice", "principal:bob"],
    locationLabels: {},
    observation: {
      readModel: {
        kind: "projected",
        stateVersion: "23",
        projectionHash: "sha256:alice-lifecycle",
        viewer: { kind: "player", principalId: "principal:alice" },
        controlledCharacter: null,
        safetyPresentation: {
          status: "paused",
          presentationAdjustment: null,
          requesterPrincipalId: "must-not-cross-the-adapter",
        },
        lifecycle: {
          kind: "successorRequired",
          defaultPredecessorCharacterId: "character:alice:former",
          eligiblePredecessors: [{
            characterId: "character:alice:former",
            name: "阿莱莎",
            tenureStatus: "retired",
          }],
        },
      },
      delivery: { kind: "none" },
    },
  });
  assert.deepEqual(lifecycle.safetyPresentation, {
    status: "paused",
    presentationAdjustment: null,
  });
  assert.doesNotMatch(JSON.stringify(lifecycle), /requesterPrincipalId/);

  const server = await source("app/_runtime/lib/table/server.ts");
  const pause = exportedSection(server, "requestSafetyPause", "adjustSafetyPresentation");
  const adjust = exportedSection(server, "adjustSafetyPresentation", "acknowledgeDelivery");
  for (const section of [pause, adjust]) {
    assert.match(section, /AUTHORITATIVE_RULESET_VERSION/);
    assert.match(section, /submitAuthoritativeTableAction/);
    assert.doesNotMatch(section, /runKpTurn|narrateDecision|messages|session_logs|game_states/);
  }
  assert.match(pause, /kind:\s*"safetyPause"/);
  assert.match(adjust, /kind:\s*"safetyAdjust"/);
  assert.match(adjust, /fadeToBlack[^]*reduceDetail[^]*skipSensitiveContent/);

  const client = await source("app/_runtime/lib/table/client.ts");
  assert.match(
    client,
    /export const requestSafetyPause[^]*callWithStableTableSubmission\("requestSafetyPause"/,
  );
  assert.match(
    client,
    /export const adjustSafetyPresentation[^]*callWithStableTableSubmission\("adjustSafetyPresentation"/,
  );

  const route = await source("app/api/game/route.ts");
  assert.match(route, /requestSafetyPause/);
  assert.match(route, /adjustSafetyPresentation/);

  const ui = await source("app/_runtime/components/play-table.tsx");
  assert.match(ui, /立即安全暂停/);
  assert.match(ui, /淡出当前内容/);
  assert.match(ui, /降低呈现细节/);
  assert.match(ui, /跳过敏感内容/);
  assert.match(ui, /safetyPresentation\?\.status === "paused"/);
  assert.doesNotMatch(
    ui,
    /requestSafetyPause\(\{\s*data:\s*\{[^}]*\b(?:reason|text)\b/s,
  );
});

test("authoritative table buttons become trusted semantic actions without client mechanics", async () => {
  const { buildAuthoritativeButtonAction } = await import(
    "../app/_runtime/lib/table/authoritative.ts"
  );
  const base = {
    submissionId: "submission:button",
  };
  const cases = [
    [{ kind: "joinCombat" }, "我明确加入当前遭遇；先攻及其他随机结果由房间权威生成。"],
    [{ kind: "extraAttack", targetId: "npc:warden" }, "我使用战争祭司的附赠攻击，目标为 npc:warden。"],
    [{ kind: "endTurn" }, "我明确结束自己当前的战斗回合。"],
    [{ kind: "leaveFight", leaveKind: "surrender" }, "我明确放下抵抗并投降。"],
    [{
      kind: "restNow",
      restKind: "short",
      mode: "personal",
      hitDice: 2,
      arcaneRecoverySlotLevels: [2, 1, 1],
    }, "我进行个人短休，并选择在合法结算时花费 2 枚生命骰、以奥术恢复取回 1 环、1 环、2 环法术位。"],
    [{ kind: "cancelRest" }, "我中断自己的休整；若当前是休整表决，则我明确拒绝。"],
    [{
      kind: "castSpell",
      spellId: "bless",
      slot: 2,
      targetIds: ["character:bob", "character:alice"],
      choice: "allies",
      originFeet: 30,
      ritual: false,
    }, "我施放法术 bless，使用 2 环法术位；明确目标为 character:bob、character:alice；选择为 allies；区域中心为 30 尺；不是仪式施法。"],
    [{ kind: "useFeature", featureId: "secondWind" }, "我使用特性 secondWind。"],
    [{ kind: "useHitDie" }, "我在当前合法的短休结算中选择花费一枚生命骰。"],
  ];
  for (const [command, text] of cases) {
    assert.deepEqual(buildAuthoritativeButtonAction({
      ...base,
      command,
      actor: "principal:forged",
      actorId: "character:forged",
      principal: "principal:forged",
      principalId: "principal:forged",
      dice: [20],
      faces: [20],
      events: [{ type: "forged" }],
      state: { hitPoints: 999 },
      profile: "forged",
    }), {
      kind: "intent",
      submissionId: "submission:button",
      text,
    });
  }

  assert.deepEqual(buildAuthoritativeButtonAction({
    ...base,
    submissionId: "submission:reaction",
    pendingInputId: "pending:shield",
    command: { kind: "resolveReact", reactionId: "reaction:shield", use: false },
    actor: "principal:forged",
    rolls: [20],
  }), {
    kind: "answer",
    submissionId: "submission:reaction",
    pendingInputId: "pending:shield",
    answer: {
      kind: "resolveReact",
      reactionId: "reaction:shield",
      use: false,
    },
  });
});

test("Arcane Recovery exposes every legal 1-5 slot deficit and freezes a bounded multi-slot choice", async () => {
  const {
    arcaneRecoveryAvailability,
    changeArcaneRecoverySelection,
    buildAuthoritativeButtonAction,
  } = await import("../app/_runtime/lib/table/authoritative.ts");
  const wizard = {
    restRecoveryOptions: {
      shortRest: {
        hitDiceMaximumSpend: 9,
        hitDieSides: 6,
        arcaneRecovery: {
          eligible: true,
          spellLevelBudget: 5,
          maximumSlotsByLevel: { 1: 3, 2: 2, 3: 1, 4: 2, 5: 1 },
        },
      },
    },
  };
  assert.deepEqual(arcaneRecoveryAvailability(wizard), {
    eligible: true,
    budget: 5,
    missingByLevel: { 1: 3, 2: 2, 3: 1, 4: 2, 5: 1 },
  });

  let selected = [];
  selected = changeArcaneRecoverySelection(wizard, selected, 1, 1);
  selected = changeArcaneRecoverySelection(wizard, selected, 1, 1);
  selected = changeArcaneRecoverySelection(wizard, selected, 3, 1);
  assert.deepEqual(selected, [1, 1, 3]);
  assert.deepEqual(
    changeArcaneRecoverySelection(wizard, selected, 1, 1),
    selected,
    "the total recovered spell levels cannot exceed ceil(wizard level / 2)",
  );
  assert.deepEqual(
    changeArcaneRecoverySelection(wizard, selected, 4, 1),
    selected,
    "a higher-level slot cannot replace the player's frozen selection",
  );
  assert.deepEqual(
    changeArcaneRecoverySelection(wizard, selected, 1, -1),
    [1, 3],
  );

  assert.deepEqual(arcaneRecoveryAvailability({
    ...wizard,
    restRecoveryOptions: {
      shortRest: {
        ...wizard.restRecoveryOptions.shortRest,
        arcaneRecovery: {
          ...wizard.restRecoveryOptions.shortRest.arcaneRecovery,
          eligible: false,
        },
      },
    },
  }), {
    eligible: false,
    budget: 5,
    missingByLevel: { 1: 3, 2: 2, 3: 1, 4: 2, 5: 1 },
  });

  const answer = buildAuthoritativeButtonAction({
    submissionId: "submission:arcane-recovery",
    pendingInputId: "pending:group-rest",
    command: {
      kind: "restNow",
      restKind: "short",
      mode: "group",
      hitDice: 0,
      arcaneRecoverySlotLevels: [3, 1, 1],
    },
  });
  assert.deepEqual(answer.answer, {
    kind: "restNow",
    restKind: "short",
    mode: "group",
    hitDice: 0,
    arcaneRecoverySlotLevels: [1, 1, 3],
  });
  assert.throws(() => buildAuthoritativeButtonAction({
    submissionId: "submission:invalid-arcane-recovery",
    command: {
      kind: "restNow",
      restKind: "short",
      arcaneRecoverySlotLevels: [0, 6, 1.5],
    },
  }), /Arcane Recovery/i);

  const server = await source("app/_runtime/lib/table/server.ts");
  const restSection = exportedSection(server, "restNow", "cancelRest");
  const authoritativeStart = restSection.indexOf("rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
  const legacyStart = restSection.indexOf("rules?.ruleset_version === RULESET_VERSION", authoritativeStart + 1);
  const authoritativeBranch = restSection.slice(authoritativeStart, legacyStart);
  assert.match(authoritativeBranch, /arcaneRecoverySlotLevels:\s*data\.arcaneRecoverySlotLevels/);
  assert.doesNotMatch(authoritativeBranch, /arcane:\s*data\.arcane/);

  const client = await source("app/_runtime/lib/table/client.ts");
  assert.match(client, /export type RestNowData[^]*arcaneRecoverySlotLevels\?: number\[\]/);
  assert.match(client, /Legacy Adapter only[^]*arcane\?: 0 \| 1 \| 2/);

  const ui = await source("app/_runtime/components/play-table.tsx");
  assert.match(ui, /\(\[1, 2, 3, 4, 5\] as const\)/);
  assert.match(ui, /changeArcaneRecoverySelection/);
  assert.match(ui, /restRecoveryOptions\?\.shortRest/);
  assert.match(ui, /可恢复环数预算/);
  assert.match(ui, /这里只冻结你的选择，完成短休后由规则结算/);
  assert.match(ui, /arcaneRecoverySlotLevels/);

  const authoritativeAdapter = await source("app/_runtime/lib/table/authoritative.ts");
  assert.doesNotMatch(authoritativeAdapter, /Math\.ceil\([^)]*level/);
  assert.match(authoritativeAdapter, /projected\?\.maximumSlotsByLevel/);
});

test("every authoritative table button returns before legacy state, dice, and mechanics", async () => {
  const server = await source("app/_runtime/lib/table/server.ts");
  const boundaries = [
    ["joinCombat", "extraAttack"],
    ["extraAttack", "endTurn"],
    ["endTurn", "leaveFight"],
    ["leaveFight", "resolveReact"],
    ["resolveReact", "restNow"],
    ["restNow", "cancelRest"],
    ["cancelRest", "castSpell"],
    ["castSpell", "useFeature"],
    ["useFeature", "useHitDie"],
    ["useHitDie", "kickMember"],
  ];
  for (const [name, nextName] of boundaries) {
    const section = exportedSection(server, name, nextName);
    assert.match(section, /submissionId\?: string/, `${name} must accept a transport submission id`);
    const v2Start = section.indexOf("rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
    const legacyStart = section.indexOf("rules?.ruleset_version === RULESET_VERSION", v2Start + 1);
    assert.notEqual(v2Start, -1, `${name} authoritative branch is missing`);
    assert.notEqual(legacyStart, -1, `${name} legacy boundary is missing`);
    const forbiddenPattern = /game_states|messages|session_logs|rollDie|roomProjection|commitRulesV2Direct|ensureGear|applyCast|applyFeature|spendHitDie|spendCost|runKpTurn|narrateDecision/;
    const forbidden = forbiddenPattern.exec(section.slice(v2Start));
    assert.ok(forbidden, `${name} legacy implementation evidence is missing`);
    const beforeLegacyAuthority = section.slice(v2Start, v2Start + forbidden.index);
    const v2Branch = section.slice(v2Start, legacyStart);
    assert.match(v2Branch, /submitAuthoritativeTableAction/, `${name} must use the Room Action seam`);
    assert.match(v2Branch, /buildAuthoritativeButtonAction/, `${name} must rebuild an allowlisted semantic action`);
    assert.match(beforeLegacyAuthority, /return submitAuthoritativeTableAction/);
    assert.doesNotMatch(beforeLegacyAuthority, forbiddenPattern);
  }

  const resolve = exportedSection(server, "resolveRoll", "joinCombat");
  assert.match(resolve, /submissionId\?: string/);
  const resolveV2 = resolve.indexOf("roomInfo?.ruleset_version === AUTHORITATIVE_RULESET_VERSION");
  const resolveLegacy = resolve.indexOf("roomInfo?.ruleset_version === RULESET_VERSION", resolveV2 + 1);
  assert.notEqual(resolveV2, -1, "resolveRoll authoritative rejection is missing");
  assert.notEqual(resolveLegacy, -1, "resolveRoll legacy boundary is missing");
  const resolveBranch = resolve.slice(resolveV2, resolveLegacy);
  assert.match(resolveBranch, /客户端不能提供骰面/);
  assert.doesNotMatch(resolveBranch, /rollDie|runAuthoritativeRoomAction|game_states/);

  const model = exportedSection(server, "setRoomModel", "lockCharacter");
  const modelV2 = model.indexOf("AUTHORITATIVE_RULESET_VERSION");
  const modelWrite = model.indexOf("update rooms");
  assert.notEqual(modelV2, -1, "authoritative model pin is missing");
  assert.ok(modelV2 < modelWrite, "authoritative model must be checked before a D1 write");
  assert.match(model, /data\.model !== AUTHORITATIVE_KP_MODEL/);
});

test("authoritative button submission ids survive transport retries and clear only on terminal outcomes", async () => {
  const { callWithStableSubmission } = await import(
    "../app/_runtime/lib/table/authoritative-client.ts"
  );
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  let sequence = 0;
  const ids = [];
  const base = {
    command: "castSpell",
    data: { code: "ROOM42", spellId: "bless", targetIds: ["character:bob"] },
    storage,
    createSubmissionId: () => `submission:${++sequence}`,
  };

  await assert.rejects(() => callWithStableSubmission({
    ...base,
    invoke: async (payload) => {
      ids.push(payload.submissionId);
      throw new Error("network lost");
    },
  }), /network lost/);
  const retryable = await callWithStableSubmission({
    ...base,
    invoke: async (payload) => {
      ids.push(payload.submissionId);
      return { ok: false, retryable: true };
    },
  });
  assert.equal(retryable.retryable, true);
  const committed = await callWithStableSubmission({
    ...base,
    invoke: async (payload) => {
      ids.push(payload.submissionId);
      return { ok: true };
    },
  });
  assert.equal(committed.ok, true);
  await callWithStableSubmission({
    ...base,
    invoke: async (payload) => {
      ids.push(payload.submissionId);
      return { ok: false, retryable: false };
    },
  });
  assert.deepEqual(ids, [
    "submission:1",
    "submission:1",
    "submission:1",
    "submission:2",
  ]);

  const client = await source("app/_runtime/lib/table/client.ts");
  for (const command of [
    "resolveRoll",
    "joinCombat",
    "extraAttack",
    "endTurn",
    "leaveFight",
    "resolveReact",
    "restNow",
    "cancelRest",
    "castSpell",
    "useFeature",
    "useHitDie",
  ]) {
    assert.match(
      client,
      new RegExp(`export const ${command}[^]*callWithStableTableSubmission\\("${command}"`),
      `${command} does not use stable session transport identity`,
    );
  }
  assert.doesNotMatch(client, /new Map\s*</, "submission retries cannot rely on module-global memory");
});

test("delivery ACK waits for the current voice request to acquire audio or hit a bounded timeout", async () => {
  const { acknowledgeAfterPresentation } = await import(
    "../app/_runtime/lib/table/authoritative-client.ts"
  );
  let releaseAudio;
  const audioReady = new Promise((resolve) => {
    releaseAudio = resolve;
  });
  let acknowledgements = 0;
  const waiting = acknowledgeAfterPresentation({
    presentation: audioReady,
    timeoutMs: 100,
    acknowledge: async () => {
      acknowledgements += 1;
      return "acknowledged";
    },
  });
  await Promise.resolve();
  assert.equal(acknowledgements, 0, "ACK raced ahead of the voice response");
  releaseAudio();
  assert.equal(await waiting, "acknowledged");
  assert.equal(acknowledgements, 1);

  await acknowledgeAfterPresentation({
    presentation: new Promise(() => {}),
    timeoutMs: 5,
    acknowledge: async () => {
      acknowledgements += 1;
      return "timed-out-ack";
    },
  });
  assert.equal(acknowledgements, 2, "a stalled voice request blocked delivery forever");

  await acknowledgeAfterPresentation({
    timeoutMs: 100,
    acknowledge: async () => {
      acknowledgements += 1;
      return "no-voice-ack";
    },
  });
  assert.equal(acknowledgements, 3, "an explicit no-voice delivery was not acknowledged");

  const ui = await source("app/_runtime/components/play-table.tsx");
  assert.match(ui, /deliveryPresentationRef/);
  assert.match(ui, /acknowledgeAfterPresentation/);
  assert.match(ui, /presentation:\s*deliveryPresentationRef\.current\.get\(deliveryId\)/);
  assert.doesNotMatch(ui, /localStorage/);
});
