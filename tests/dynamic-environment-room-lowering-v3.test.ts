import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { replay } from "../app/_runtime/lib/rules";
import {
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/manifests";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:dynamic-environment:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:dynamic-environment:bob", sessionVersion: 1 }),
});
const ROOM_ID = "dynamic-environment-room-lowering-v3";
const ALICE_ID = "character:dynamic-environment:alice";
const BOB_ID = "character:dynamic-environment:bob";
const CUSTOM_LABEL = "回声陶片风琴墙";
const HIDDEN_PASSAGE_ID = "feature:yard:hidden-passage";

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

function character(
  characterId: string,
  controllerPrincipalId: string,
  name: string,
  level = 1,
  mainWeapon = "shortsword",
) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level,
      scores: { str: 12, dex: 12, con: 12, int: 14, wis: 10, cha: 10 },
      proficiency: level >= 17 ? 6 : 2,
      skills: ["investigation"],
      expertise: ["investigation"],
      proficientSaves: ["con", "str"],
      hp: { current: 12, max: 12, temp: 0 },
      ac: 14,
      speed: 30,
      equipped: { armor: "leather", main: mainWeapon },
      backpack: ["shortbow", "longbow"].includes(mainWeapon)
        ? [{ itemId: "arrow", quantity: 20 }]
        : [],
    },
  };
}

function openBlankDraft(): JsonRecord {
  return {
    goal: "让墙内的风压骤然释放，掀翻门边的追兵",
    method: "按玩家想到的顺序敲击墙上七块陶片，引发墙腔共振",
    featureDescription: CUSTOM_LABEL,
    intendedOutcome: "共振风压从墙腔喷出，随后陶片碎落并封住通道",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["yard"],
    effectMode: "area-hazard",
    activation: "check",
    checkAbility: "int",
    checkSkill: "investigation",
    checkDc: 30,
    checkMode: "normal",
    checkSuccessConsequence: "角色找对音序并释放墙腔风压。",
    checkFailureConsequence: "音序错误；陶片仍保持调谐，暂未释放风压。",
    material: "带空腔的烧制陶片、铜簧与灰浆",
    centerXInches: 120,
    centerYInches: 120,
    elevationInches: 0,
    widthInches: 120,
    depthInches: 24,
    heightInches: 96,
    objectAc: 15,
    objectHitPoints: 14,
    damageThreshold: 3,
    initialPhase: "tuned",
    phaseNames: ["tuned", "venting", "shattered"],
    phaseOpaque: [true, false, false],
    phaseImpassable: [true, false, true],
    phaseCover: ["threeQuarters", "half", "half"],
    phaseEffectPropagation: ["blocks", "passes", "passes"],
    phaseTerrain: ["normal", "normal", "rubble"],
    damageFromPhases: ["tuned"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: ["venting"],
    stuntFromPhases: ["tuned"],
    stuntToPhases: ["venting"],
    hazardFromPhases: ["venting"],
    hazardToPhases: ["shattered"],
    hazardTriggerPhase: "venting",
    hazardResolvedPhase: "shattered",
    trigger: "正确的七音敲击令铜簧共振并打开墙腔泄压缝",
    areaOriginElevationInches: 36,
    areaRadiusInches: 180,
    propagation: "straight",
    saveAbility: "str",
    saveDc: 13,
    halfOnSuccess: false,
    damage: "2d6",
    damageType: "thunder",
    condition: "prone",
    debrisOutcome: "破碎陶片堆积成半身高的困难地形与掩体",
  };
}

function successfulOpenBlankDraft(): JsonRecord {
  return {
    ...openBlankDraft(),
    checkDc: 13,
    centerXInches: 0,
    centerYInches: 0,
    areaRadiusInches: 1200,
  };
}

function stateOnlyOpenBlankDraft(): JsonRecord {
  return {
    goal: "把折叠木格展开封住窄道",
    method: "翻转墙边木格，让铰接格片沿石质地槽依次展开",
    featureDescription: "沿地槽展开的折叠木格",
    intendedOutcome: "木格展开形成阻断与半掩护，不产生区域伤害",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["yard"],
    effectMode: "state-only",
    activation: "direct",
    material: "榆木格片、铁铰与石质地槽",
    centerXInches: 60,
    centerYInches: 0,
    elevationInches: 0,
    widthInches: 120,
    depthInches: 12,
    heightInches: 72,
    objectAc: 12,
    objectHitPoints: 10,
    damageThreshold: 2,
    immuneDamageTypes: ["poison", "psychic"],
    initialPhase: "folded",
    phaseNames: ["folded", "broken", "unfolded"],
    phaseOpaque: [false, false, true],
    phaseImpassable: [false, false, true],
    phaseCover: ["none", "none", "half"],
    phaseEffectPropagation: ["passes", "passes", "blocks"],
    phaseTerrain: ["normal", "rubble", "normal"],
    damageFromPhases: ["folded"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: ["broken"],
    stuntFromPhases: ["folded"],
    stuntToPhases: ["unfolded"],
    trigger: "翻转首片木格后，铰链沿地槽依次展开",
  };
}

function secondStateOnlyOpenBlankDraft(): JsonRecord {
  return {
    ...stateOnlyOpenBlankDraft(),
    goal: "把墙角的绳结网拉起，隔开另一侧窄道",
    method: "依次抽紧三根墙钉上的麻绳，让收拢的绳结网沿导环升起",
    featureDescription: "沿墙钉升起的绳结阻拦网",
    intendedOutcome: "绳网升起形成另一处阻断与半掩护，不产生区域伤害",
    material: "粗麻绳、墙钉与铁质导环",
    centerXInches: 240,
    trigger: "抽紧末端绳索后，收拢的绳结网沿墙面导环升起",
  };
}

function reuseDraft(featureId: string): JsonRecord {
  return {
    goal: "再次尝试释放陶片墙内的风压",
    method: "换一套音序敲击刚才确认存在的陶片风琴墙",
    featureDescription: CUSTOM_LABEL,
    intendedOutcome: "让既有陶片墙进入泄压阶段",
    featureDisposition: "reuse-existing",
    activation: "check",
    checkAbility: "int",
    checkSkill: "investigation",
    checkDc: 30,
    checkMode: "normal",
    checkSuccessConsequence: "角色找对音序并释放墙腔风压。",
    checkFailureConsequence: "第二套音序仍不正确，既有陶片墙保持原状。",
    basisRefs: [featureId],
  };
}

function attackReuseDraft(featureId: string, abilityRef?: string): JsonRecord {
  return {
    goal: "破坏已经成立的陶片风琴墙",
    method: "玩家可以随意改写做法；KP 必须另外提交精确能力引用",
    featureDescription: CUSTOM_LABEL,
    intendedOutcome: "以一次合法攻击损伤既有环境对象",
    featureDisposition: "reuse-existing",
    activation: "attack",
    attackApproach: "any",
    basisRefs: [featureId],
    ...(abilityRef === undefined ? {} : { abilityRef }),
  };
}

function absentDraft(): JsonRecord {
  return {
    goal: "扯下院子上方并不存在的船帆罩住守卫",
    method: "抓住想象中的帆索向下猛拽",
    featureDescription: "横跨院子的整面船帆",
    intendedOutcome: "用船帆遮住守卫视线",
    featureDisposition: "explicitly-absent",
  };
}

function privateEnvironmentProposal(rootActionId: string, draft: JsonRecord) {
  const causalActionProgram = compileKpFormDraft("environmental-stunt.v1", draft);
  return {
    kind: "privateFormProposal",
    formId: "environmental-stunt.v1",
    draft: structuredClone(draft),
    causalActionProgram,
    loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
    semanticFreezeHash: causalActionProgram.semanticHash,
    repairUsed: false,
    proposalAttemptId: `${rootActionId}:proposal:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

async function prepareIntent(
  authority: Authority,
  principal: typeof ALICE | typeof BOB,
  submissionId: string,
  text: string,
) {
  const prepared = record(await authority.prepare(principal, {
    kind: "intent",
    submissionId,
    text,
  }), `${submissionId} prepare`);
  expect(prepared.kind, JSON.stringify(prepared)).toBe("prepared");
  return {
    preparedActionId: String(prepared.preparedActionId),
    rootActionId: String(prepared.rootActionId),
  };
}

async function recoveryRulesInput(authority: Authority, preparedActionId: string) {
  return runInDurableObject(authority as never, async (_instance, state) => {
    const row = state.storage.sql.exec<{ recovery_json: string }>(`
      SELECT recovery_json
      FROM authority_proposal_recovery
      WHERE prepared_action_id = ?
    `, preparedActionId).toArray()[0];
    expect(row, `proposal recovery for ${preparedActionId}`).toBeDefined();
    const recovery = record(JSON.parse(row!.recovery_json), "proposal recovery");
    return record(recovery.rulesInput, "recovered Rules input");
  });
}

function knownFeature(observation: unknown, featureId: string) {
  const readModel = record(record(observation, "observation").readModel, "read model");
  const tactical = record(readModel.tacticalProjection, "tactical projection");
  const feature = list(tactical.knownFeatures, "known features")
    .map((entry) => record(entry, "known feature"))
    .find((entry) => entry.id === featureId);
  expect(feature, `known feature ${featureId}`).toBeDefined();
  return feature!;
}

describe("V3 Room dynamic environment production lowering", () => {
  it("freezes an arbitrary KP-defined feature, reuses its stable id, and survives eviction without client authority fields or rerolls", async () => {
    const authority = env.ROOMS.getByName(ROOM_ID) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId: ROOM_ID,
      moduleId: "black-oak-will",
      moduleVersion: "tactical-map-v1",
      runtimeProfiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林", 1, "shortbow"),
      ],
    }), "V3 environment Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);

    const unavailableBasisPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:unavailable-open-basis",
      "我想按自己设想的机关让一面新墙突然升起。",
    );
    const unavailableBasisDraft = openBlankDraft();
    unavailableBasisDraft.basisRefs = ["fact:not-visible-to-actor"];
    await expect(authority.commit(
      ALICE,
      unavailableBasisPrepared.preparedActionId,
      privateEnvironmentProposal(unavailableBasisPrepared.rootActionId, unavailableBasisDraft),
    )).resolves.toMatchObject({
      kind: "rejected",
      code: "privateOrUnknownReference",
    });

    const openPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:open-blank",
      "我想按顺序敲击墙上的陶片，让墙腔里的风压喷出来。",
    );
    const openProposal = privateEnvironmentProposal(openPrepared.rootActionId, openBlankDraft());
    expect(JSON.stringify(openProposal)).not.toMatch(/abilityRef|target(?:Entity)?Ids?/u);

    let firstRollCount = 0;
    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        expect(sides).toBe(20);
        firstRollCount += 1;
        return 1;
      };
      target.authorityRecoveryCheckpoint = (name) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:dynamic-environment-after-candidate");
        }
      };
      try {
        return await target.commit(
          ALICE,
          openPrepared.preparedActionId,
          structuredClone(openProposal),
        );
      } finally {
        target.authorityRoll = originalRoll;
      }
    })).rejects.toThrow("simulated-crash:dynamic-environment-after-candidate");
    expect(firstRollCount).toBe(1);

    const openRulesInput = await recoveryRulesInput(authority, openPrepared.preparedActionId);
    expect(openRulesInput).toMatchObject({
      kind: "invokeEnvironmentalStunt",
      actorCharacterId: ALICE_ID,
      controllerPrincipalId: ALICE.principal.id,
      activation: {
        kind: "check",
        ability: "int",
        skill: "investigation",
        dc: "30",
        mode: "normal",
      },
      materialization: {
        featureDefinition: {
          label: CUSTOM_LABEL,
          sceneId: "yard",
          initialState: "tuned",
        },
      },
    });
    expect(openRulesInput).not.toHaveProperty("abilityRef");
    expect(JSON.stringify(openRulesInput)).not.toMatch(/target(?:Entity)?Ids?/u);
    const featureId = String(openRulesInput.featureId);
    expect(featureId).toMatch(/^feature:v3:[0-9a-f]{32}$/u);

    await evictDurableObject(authority as never);
    const recovered = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = () => {
        throw new Error("recovered environment check must reuse the persisted face");
      };
      try {
        return await target.commit(
          ALICE,
          openPrepared.preparedActionId,
          structuredClone(openProposal),
        );
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "recovered open-blank commit");
    expect(recovered).toMatchObject({
      kind: "committed",
      receipt: {
        status: "committed",
        randomnessCommitments: [expect.any(Object)],
      },
    });
    expect(knownFeature(await authority.observe(ALICE), featureId)).toMatchObject({
      id: featureId,
      label: CUSTOM_LABEL,
      state: "tuned",
    });

    const responseLostRetry = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = () => {
        throw new Error("idempotent environment retry must not roll");
      };
      try {
        return await target.commit(
          ALICE,
          openPrepared.preparedActionId,
          structuredClone(openProposal),
        );
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "response-lost open-blank retry");
    expect(responseLostRetry).toEqual(recovered);

    const labelOnlyPrepared = await prepareIntent(
      authority,
      BOB,
      "submission:dynamic-environment:label-only-reuse",
      "我继续利用刚才那面陶片墙。",
    );
    const labelOnlyDraft = reuseDraft(featureId);
    delete labelOnlyDraft.basisRefs;
    const labelOnlyRejected = record(await authority.commit(
      BOB,
      labelOnlyPrepared.preparedActionId,
      privateEnvironmentProposal(labelOnlyPrepared.rootActionId, labelOnlyDraft),
    ), "label-only feature reuse rejection");
    expect(labelOnlyRejected).toMatchObject({
      kind: "rejected",
      code: "privateOrUnknownReference",
    });

    const reusePrepared = await prepareIntent(
      authority,
      BOB,
      "submission:dynamic-environment:reuse",
      "我接着敲刚才那面陶片墙，但改用另一套音序。",
    );
    const reuseProposal = privateEnvironmentProposal(
      reusePrepared.rootActionId,
      reuseDraft(featureId),
    );
    expect(JSON.stringify(reuseProposal)).not.toMatch(/abilityRef|target(?:Entity)?Ids?/u);
    let reuseRollCount = 0;
    const reused = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        expect(sides).toBe(20);
        reuseRollCount += 1;
        return 1;
      };
      try {
        return await target.commit(
          BOB,
          reusePrepared.preparedActionId,
          structuredClone(reuseProposal),
        );
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "stable feature reuse commit");
    expect(reused.kind, JSON.stringify(reused)).toBe("committed");
    expect(reuseRollCount).toBe(1);
    const reuseRulesInput = await recoveryRulesInput(authority, reusePrepared.preparedActionId);
    expect(reuseRulesInput).toMatchObject({
      kind: "invokeEnvironmentalStunt",
      actorCharacterId: BOB_ID,
      featureId,
      activation: { kind: "check" },
    });
    expect(reuseRulesInput).not.toHaveProperty("materialization");
    expect(reuseRulesInput).not.toHaveProperty("abilityRef");
    expect(JSON.stringify(reuseRulesInput)).not.toMatch(/target(?:Entity)?Ids?/u);

    const controlled = record(
      record(record(await authority.observe(BOB), "Bob attack observation").readModel, "Bob attack read model")
        .controlledCharacter,
      "Bob controlled character",
    );
    const combat = record(controlled.combat, "Bob controlled combat");
    const definitions = record(combat.definitions, "Bob ability definitions");
    const legalEnvironmentAbilities = list(combat.abilityRefs, "Bob ability refs")
      .filter((abilityRef): abilityRef is string => typeof abilityRef === "string")
      .filter((abilityRef) => {
        const definition = record(definitions[abilityRef], `ability ${abilityRef}`);
        return record(definition.target, `ability target ${abilityRef}`).kind
          === "creatureOrEnvironmentFeature"
          && list(definition.damage, `ability damage ${abilityRef}`).length === 1;
      });
    expect(legalEnvironmentAbilities.length).toBeGreaterThanOrEqual(1);
    const rangedAbilityRef = legalEnvironmentAbilities.find((abilityRef) => {
      const target = record(record(definitions[abilityRef], "ranged ability").target, "ranged target");
      return typeof target.rangeInches === "string" || typeof target.rangeNormalInches === "string";
    });
    expect(rangedAbilityRef).toBeDefined();

    const rewrittenWithoutReference = attackReuseDraft(featureId);
    rewrittenWithoutReference.method = legalEnvironmentAbilities.join(" 与 ");
    expect(() => privateEnvironmentProposal(
      "root:dynamic-environment:text-cannot-select-ability",
      rewrittenWithoutReference,
    )).toThrow(/abilityRef:attack-required/u);

    const unownedPrepared = await prepareIntent(
      authority,
      BOB,
      "submission:dynamic-environment:unowned-attack",
      "我攻击这面陶片墙。",
    );
    const unownedRejected = record(await authority.commit(
      BOB,
      unownedPrepared.preparedActionId,
      privateEnvironmentProposal(
        unownedPrepared.rootActionId,
        attackReuseDraft(featureId, "ability:invented:not-owned"),
      ),
    ), "unowned environment attack rejection");
    expect(unownedRejected).toMatchObject({
      kind: "rejected",
      code: "privateOrUnknownReference",
    });

    const attackPrepared = await prepareIntent(
      authority,
      BOB,
      "submission:dynamic-environment:owned-attack",
      "我用自己当前拥有的远程攻击破坏这面陶片墙。",
    );
    let attackRollCount = 0;
    const attacked = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        attackRollCount += 1;
        return Math.max(1, Math.min(2, sides));
      };
      try {
        return await target.commit(
          BOB,
          attackPrepared.preparedActionId,
          privateEnvironmentProposal(
            attackPrepared.rootActionId,
            attackReuseDraft(featureId, rangedAbilityRef),
          ),
        );
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "owned environment attack commit");
    expect(attacked).toMatchObject({
      kind: "committed",
      receipt: { status: "committed" },
    });
    expect(attackRollCount).toBe(2);

    const absentPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:explicit-absence",
      "我扯下院子上方的整面船帆罩住守卫。",
    );
    const absentProposal = privateEnvironmentProposal(
      absentPrepared.rootActionId,
      absentDraft(),
    );
    const refused = record(await authority.commit(
      ALICE,
      absentPrepared.preparedActionId,
      absentProposal,
    ), "explicitly absent environment resolution");
    expect(refused).toMatchObject({
      kind: "committed",
      receipt: {
        status: "committed",
        resolutionDisposition: "inWorldRefusal",
        randomnessCommitments: [],
      },
    });

    const exported = record(await authority.exportAuthoritativeArchive(
      record(initialized.serviceCapabilities, "service capabilities").archiveExport,
    ), "dynamic environment archive export");
    const archive = record(exported.archive, "dynamic environment archive");
    const events = list(archive.events, "dynamic environment archive events")
      .map((event) => record(event, "dynamic environment event"));
    const materializations = events.filter((event) =>
      event.eventType === "EnvironmentFeatureMaterialized"
      && record(event.payload, "environment materialization payload").featureId === featureId);
    expect(materializations).toHaveLength(1);
    const causalMarkers = events.filter((event) =>
      event.rootActionId === openPrepared.rootActionId
      && event.eventType === "ImprovisedActionResolved"
      && record(record(event.payload, "environment causal marker payload").fact, "environment causal marker")
        .kind === "causalActionProgram");
    expect(causalMarkers).toHaveLength(1);
    const markerFact = record(
      record(causalMarkers[0].payload, "environment marker payload").fact,
      "environment marker fact",
    );
    const markerValue = record(markerFact.value, "environment marker value");
    expect(record(materializations[0].payload, "linked materialization payload")).toMatchObject({
      causalProgramFactRef: markerFact.id,
      causalProgramHash: markerValue.programHash,
    });
    expect(events.filter((event) =>
      event.eventType === "RandomnessRequested"
      && [openPrepared.rootActionId, reusePrepared.rootActionId]
        .includes(String(event.rootActionId)))).toHaveLength(2);
    const stuntChecks = events.filter((event) => event.eventType === "AbilityInvoked")
      .map((event) => record(event.payload, "environment ability payload"))
      .map((payload) => record(payload.mechanicalResult, "environment check result"))
      .filter((result) => result.kind === "environmentalStuntCheckResolved");
    expect(stuntChecks).toEqual([
      expect.objectContaining({
        featureId,
        rolls: [1],
        modifier: 6,
        succeeded: false,
        outcome: "checkFailed",
      }),
      expect.objectContaining({
        featureId,
        rolls: [1],
        modifier: 6,
        succeeded: false,
        outcome: "checkFailed",
      }),
    ]);

    const replayed = record(replay(
      archive.signedGenesis as never,
      archive.events as never,
    ), "dynamic environment replay");
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    const replayedState = record(replayed.state, "replayed environment state");
    const combatRuntime = record(replayedState.combatRuntime, "replayed combat runtime");
    const scenes = record(combatRuntime.scenes, "replayed combat scenes");
    const yard = record(scenes.yard, "replayed yard");
    const geometry = record(yard.geometry, "replayed yard geometry");
    const replayedFeature = list(geometry.obstacles, "replayed yard obstacles")
      .map((feature) => record(feature, "replayed environment feature"))
      .find((feature) => feature.featureId === featureId);
    expect(replayedFeature).toMatchObject({
      featureId,
      label: CUSTOM_LABEL,
      state: "tuned",
    });
  }, 15_000);

  it("lets KP freeze an arbitrary state-only feature without fabricating a hazard", async () => {
    const roomId = `${ROOM_ID}:state-only-folding-lattice`;
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "tactical-map-v1",
      runtimeProfiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎")],
    }), "state-only environment Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);

    const prepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:state-only-folding-lattice",
      "我翻转墙边的折叠木格，让它顺着地槽展开并封住窄道。",
    );
    const draft = stateOnlyOpenBlankDraft();
    expect(Object.hasOwn(draft, "saveDc")).toBe(false);
    expect(Object.hasOwn(draft, "damage")).toBe(false);
    expect(Object.hasOwn(draft, "areaRadiusInches")).toBe(false);
    const proposal = privateEnvironmentProposal(prepared.rootActionId, draft);

    let rollCount = 0;
    const committed = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        rollCount += 1;
        return Math.max(1, Math.min(2, sides));
      };
      try {
        return await target.commit(ALICE, prepared.preparedActionId, proposal);
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "state-only environment commit");
    expect(committed.kind, JSON.stringify(committed)).toBe("committed");
    expect(rollCount).toBe(0);

    const secondPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:state-only-rope-net",
      "我再抽紧墙角的三根麻绳，让另一张绳结网沿导环升起。",
    );
    const secondCommitted = record(await authority.commit(
      ALICE,
      secondPrepared.preparedActionId,
      privateEnvironmentProposal(secondPrepared.rootActionId, secondStateOnlyOpenBlankDraft()),
    ), "second state-only environment commit");
    expect(secondCommitted.kind, JSON.stringify(secondCommitted)).toBe("committed");

    const exported = record(await authority.exportAuthoritativeArchive(
      record(initialized.serviceCapabilities, "state-only service capabilities").archiveExport,
    ), "state-only archive export");
    const archive = record(exported.archive, "state-only archive");
    const allEvents = list(archive.events, "state-only events")
      .map((event) => record(event, "state-only event"));
    const rootEvents = allEvents.filter((event) => event.rootActionId === prepared.rootActionId);
    const secondRootEvents = allEvents.filter((event) =>
      event.rootActionId === secondPrepared.rootActionId);
    const materialized = rootEvents.find((event) => event.eventType === "EnvironmentFeatureMaterialized");
    const materialization = record(materialized?.payload, "state-only materialization");
    const definition = record(materialization.featureDefinition, "state-only definition");
    expect(definition).toMatchObject({
      schema: "zhuwei.environment-feature/v2",
      effectMode: "state-only",
      initialState: "folded",
      hazard: null,
      areaEffect: null,
    });
    const featureId = String(materialization.featureId);
    expect(knownFeature(await authority.observe(ALICE), featureId)).toMatchObject({
      id: featureId,
      label: "沿地槽展开的折叠木格",
      state: "unfolded",
      opaque: true,
      impassable: true,
      cover: "half",
      propagation: "blocks",
      terrain: "normal",
    });
    const secondMaterialized = secondRootEvents.find((event) =>
      event.eventType === "EnvironmentFeatureMaterialized");
    const secondFeatureId = String(record(
      secondMaterialized?.payload,
      "second state-only materialization",
    ).featureId);
    expect(secondFeatureId).not.toBe(featureId);
    expect(knownFeature(await authority.observe(ALICE), secondFeatureId)).toMatchObject({
      id: secondFeatureId,
      label: "沿墙钉升起的绳结阻拦网",
      state: "unfolded",
    });
    expect(secondRootEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "EnvironmentFeatureMaterialized",
      "AbilityInvoked",
      "EnvironmentFeatureStateChanged",
    ]));

    expect(rootEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "EnvironmentFeatureMaterialized",
      "AbilityInvoked",
      "EnvironmentFeatureStateChanged",
    ]));
    expect(rootEvents.map((event) => event.eventType)).not.toEqual(expect.arrayContaining([
      "RandomnessRequested",
      "EnvironmentHazardTriggered",
      "EnvironmentAreaTargetResolved",
      "DamagePacketResolved",
    ]));
    const stateChange = rootEvents.find((event) => event.eventType === "EnvironmentFeatureStateChanged");
    expect(record(stateChange?.payload, "state-only transition")).toMatchObject({
      intent: "applyStunt",
      fromState: "folded",
      toState: "unfolded",
    });

    const replayed = record(replay(archive.signedGenesis as never, archive.events as never), "state-only replay");
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    const replayedState = record(replayed.state, "state-only replay state");
    const replayedCombat = record(replayedState.combatRuntime, "state-only combat runtime");
    const replayedActor = record(
      record(replayedCombat.entities, "state-only combat entities")[ALICE_ID],
      "state-only replay actor",
    );
    expect(replayedActor).not.toHaveProperty("turn");
    const scenes = record(replayedCombat.scenes, "state-only scenes");
    const geometry = record(record(scenes.yard, "state-only yard").geometry, "state-only geometry");
    expect(list(geometry.obstacles, "state-only replay obstacles")
      .map((entry) => record(entry, "state-only replay obstacle"))
      .find((entry) => entry.featureId === featureId)).toMatchObject({
        state: "unfolded",
        impassable: true,
        cover: "half",
      });
    expect(list(geometry.obstacles, "state-only replay obstacles")
      .map((entry) => record(entry, "state-only replay obstacle"))
      .find((entry) => entry.featureId === secondFeatureId)).toMatchObject({
        state: "unfolded",
        impassable: true,
        cover: "half",
      });
  });

  it("keeps the exact environment-v3 noncombat action-grant replay semantics", async () => {
    const roomId = `${ROOM_ID}:historical-v3-action-grant`;
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "tactical-map-v1",
      runtimeProfiles: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎")],
    }), "historical environment-v3 Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);

    const firstPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:historical-v3-first",
      "我翻转墙边的折叠木格，让它顺着地槽展开。",
    );
    await expect(authority.commit(
      ALICE,
      firstPrepared.preparedActionId,
      privateEnvironmentProposal(firstPrepared.rootActionId, stateOnlyOpenBlankDraft()),
    )).resolves.toMatchObject({ kind: "committed" });

    const secondPrepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:historical-v3-second",
      "我再抽紧墙角的绳索，让另一张绳结网升起。",
    );
    await expect(authority.commit(
      ALICE,
      secondPrepared.preparedActionId,
      privateEnvironmentProposal(secondPrepared.rootActionId, secondStateOnlyOpenBlankDraft()),
    )).resolves.toMatchObject({
      kind: "needsKp",
      diagnostics: [expect.objectContaining({
        code: "invalidRulesInput",
        rulesMessage: "The environmental stunt action grant is unavailable.",
      })],
    });

    const exported = record(await authority.exportAuthoritativeArchive(
      record(initialized.serviceCapabilities, "historical v3 capabilities").archiveExport,
    ), "historical v3 archive export");
    const archive = record(exported.archive, "historical v3 archive");
    const replayed = record(replay(
      archive.signedGenesis as never,
      archive.events as never,
    ), "historical v3 replay");
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    const replayedState = record(replayed.state, "historical v3 state");
    const replayedCombat = record(replayedState.combatRuntime, "historical v3 combat");
    expect(record(
      record(replayedCombat.entities, "historical v3 entities")[ALICE_ID],
      "historical v3 actor",
    )).toMatchObject({ turn: { action: "0" } });
  });

  it("resolves a successful custom hazard through authoritative geometry, saves, damage, debris, replay, and eviction", async () => {
    const roomId = `${ROOM_ID}:successful-hazard`;
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "tactical-map-v1",
      runtimeProfiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    }), "successful V3 environment Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);

    const before = record(await authority.observe(ALICE), "pre-hazard observation");
    const beforeTactical = record(
      record(before.readModel, "pre-hazard read model").tacticalProjection,
      "pre-hazard tactical projection",
    );
    expect(list(beforeTactical.knownFeatures, "pre-hazard known features")
      .map((entry) => String(record(entry, "pre-hazard feature").id)))
      .not.toContain(HIDDEN_PASSAGE_ID);

    const prepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:successful-hazard",
      "我按自己想到的七音次序敲响陶片，让墙腔风压扫过整个后院。",
    );
    const draft = successfulOpenBlankDraft();
    const proposal = privateEnvironmentProposal(prepared.rootActionId, draft);
    expect(JSON.stringify(proposal)).not.toMatch(/abilityRef|target(?:Entity)?Ids?/u);

    const scriptedFaces = [
      { sides: 20, face: 20, purpose: "custom check" },
      { sides: 6, face: 6, purpose: "hazard damage die one" },
      { sides: 6, face: 6, purpose: "hazard damage die two" },
      { sides: 20, face: 20, purpose: "Alice save" },
      { sides: 20, face: 1, purpose: "Bob save" },
    ];
    let rollCursor = 0;
    const committed = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        const scripted = scriptedFaces[rollCursor];
        expect(scripted, `unexpected authority roll ${rollCursor + 1}`).toBeDefined();
        expect(sides, scripted!.purpose).toBe(scripted!.sides);
        rollCursor += 1;
        return scripted!.face;
      };
      try {
        return await target.commit(ALICE, prepared.preparedActionId, structuredClone(proposal));
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "successful custom environment commit");
    expect(committed).toMatchObject({
      kind: "committed",
      receipt: {
        status: "committed",
        randomnessCommitments: expect.any(Array),
      },
    });
    expect(rollCursor).toBe(scriptedFaces.length);

    const rulesInput = await recoveryRulesInput(authority, prepared.preparedActionId);
    expect(rulesInput).toMatchObject({
      kind: "invokeEnvironmentalStunt",
      actorCharacterId: ALICE_ID,
      activation: { kind: "check", dc: "13" },
      materialization: {
        featureDefinition: {
          label: CUSTOM_LABEL,
          sceneId: "yard",
          initialState: "tuned",
          destructible: {
            armorClass: "15",
            maximumDurability: "14",
            damageThreshold: "3",
          },
          areaEffect: {
            save: { ability: "str", dc: "13", halfOnSuccess: false },
            damage: { formula: "2d6", type: "thunder" },
          },
        },
      },
    });
    expect(JSON.stringify(rulesInput)).not.toMatch(/target(?:Entity)?Ids?/u);
    const featureId = String(rulesInput.featureId);

    const aliceAfter = record(await authority.observe(ALICE), "Alice post-hazard observation");
    const aliceReadModel = record(aliceAfter.readModel, "Alice post-hazard read model");
    const aliceTactical = record(
      aliceReadModel.tacticalProjection,
      "Alice post-hazard tactical projection",
    );
    expect(list(aliceTactical.knownFeatures, "Alice post-hazard known features")
      .map((entry) => String(record(entry, "Alice post-hazard feature").id)))
      .not.toContain(HIDDEN_PASSAGE_ID);
    expect(knownFeature(aliceAfter, featureId)).toMatchObject({
      id: featureId,
      label: CUSTOM_LABEL,
      state: "shattered",
      impassable: true,
      cover: "half",
      propagation: "passes",
      terrain: "rubble",
    });
    const bobAfter = record(await authority.observe(BOB), "Bob post-hazard observation");
    const bobReadModel = record(bobAfter.readModel, "Bob post-hazard read model");
    expect(record(
      record(bobReadModel.tacticalProjection, "Bob tactical projection").self,
      "Bob tactical self",
    ).publicStates).toEqual(expect.arrayContaining([
      "condition:prone",
      "condition:unconscious",
      "life:unconscious",
    ]));

    const exported = record(await authority.exportAuthoritativeArchive(
      record(initialized.serviceCapabilities, "successful hazard service capabilities")
        .archiveExport,
    ), "successful hazard archive export");
    const archive = record(exported.archive, "successful hazard archive");
    const events = list(archive.events, "successful hazard archive events")
      .map((event) => record(event, "successful hazard event"));
    const rootEvents = events.filter((event) => event.rootActionId === prepared.rootActionId);
    const eventTypes = rootEvents.map((event) => String(event.eventType));
    expect(eventTypes.indexOf("EnvironmentFeatureMaterialized")).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf("EnvironmentFeatureMaterialized"))
      .toBeLessThan(eventTypes.indexOf("RandomnessRequested"));

    const check = rootEvents
      .filter((event) => event.eventType === "AbilityInvoked")
      .map((event) => record(event.payload, "successful ability payload"))
      .map((payload) => record(payload.mechanicalResult, "successful check result"))
      .find((result) => result.kind === "environmentalStuntCheckResolved");
    expect(check).toMatchObject({
      featureId,
      rolls: [20],
      succeeded: true,
      outcome: "triggered",
    });

    const hazard = rootEvents.find((event) => event.eventType === "EnvironmentHazardTriggered");
    expect(hazard, "environment hazard event").toBeDefined();
    const hazardPayload = record(hazard!.payload, "environment hazard payload");
    expect(hazardPayload.entityTargetIds).toEqual([ALICE_ID, BOB_ID]);
    expect(list(hazardPayload.featureTargetIds, "hazard feature targets"))
      .toContain(HIDDEN_PASSAGE_ID);

    const targetResolutions = rootEvents
      .filter((event) => event.eventType === "EnvironmentAreaTargetResolved")
      .map((event) => record(event.payload, "environment target resolution"));
    expect(targetResolutions).toHaveLength(2);
    expect(targetResolutions.find((payload) => payload.targetEntityId === ALICE_ID)).toMatchObject({
      saveRolls: [20],
      saveSucceeded: true,
      appliedDamage: "0",
      statusApplied: "none",
    });
    expect(targetResolutions.find((payload) => payload.targetEntityId === BOB_ID)).toMatchObject({
      saveRolls: [1],
      saveSucceeded: false,
      rolledDamage: "12",
      appliedDamage: "12",
      statusApplied: "prone",
      targetPatch: {
        hitPoints: { current: "0", maximum: "12", temporary: "0" },
        lifeState: "unconscious",
        conditions: expect.objectContaining({ prone: true, unconscious: true }),
      },
    });
    expect(rootEvents.find((event) =>
      event.eventType === "EnvironmentAreaFeatureDamaged"
      && record(event.payload, "hidden feature damage payload").targetFeatureId
        === HIDDEN_PASSAGE_ID)?.payload).toMatchObject({
      targetFeatureId: HIDDEN_PASSAGE_ID,
      appliedDamage: "12",
      durabilityBefore: "4",
      durabilityAfter: "0",
      fromState: "closed",
      toState: "destroyed",
    });
    expect(rootEvents.filter((event) => event.eventType === "EnvironmentFeatureStateChanged")
      .map((event) => record(event.payload, "environment state transition payload")))
      .toEqual([
        expect.objectContaining({
          featureId,
          intent: "triggerHazard",
          fromState: "tuned",
          toState: "venting",
        }),
        expect.objectContaining({
          featureId,
          intent: "resolveHazard",
          fromState: "venting",
          toState: "shattered",
        }),
      ]);

    const replayed = record(replay(
      archive.signedGenesis as never,
      archive.events as never,
    ), "successful environment replay");
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    const replayedState = record(replayed.state, "successful replay state");
    const replayedCombat = record(replayedState.combatRuntime, "successful replay combat runtime");
    const replayedEntities = record(replayedCombat.entities, "successful replay entities");
    expect(record(replayedEntities[BOB_ID], "replayed Bob")).toMatchObject({
      hitPoints: { current: "0", maximum: "12", temporary: "0" },
      lifeState: "unconscious",
      conditions: expect.objectContaining({ prone: true, unconscious: true }),
    });
    const replayedYard = record(
      record(replayedCombat.scenes, "successful replay scenes").yard,
      "successful replay yard",
    );
    const replayedObstacles = list(
      record(replayedYard.geometry, "successful replay geometry").obstacles,
      "successful replay obstacles",
    ).map((feature) => record(feature, "successful replay feature"));
    expect(replayedObstacles.find((feature) => feature.featureId === featureId)).toMatchObject({
      state: "shattered",
      terrain: "rubble",
    });
    expect(replayedObstacles.find((feature) => feature.featureId === HIDDEN_PASSAGE_ID)).toMatchObject({
      state: "destroyed",
      durability: { current: "0", maximum: "4" },
    });

    await evictDurableObject(authority as never);
    const responseLostRetry = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = () => {
        throw new Error("successful environment retry after eviction must not reroll");
      };
      try {
        return await target.commit(ALICE, prepared.preparedActionId, structuredClone(proposal));
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "successful environment retry after eviction");
    expect(responseLostRetry).toEqual(committed);
  }, 15_000);

  it("does not scale KP-frozen environment AC, durability, save DC, or damage by actor level", async () => {
    async function frozenDefinitionAtLevel(level: 1 | 20) {
      const roomId = `${ROOM_ID}:level-${level}`;
      const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
      const initialized = record(await authority.initializeAuthoritative({
        roomId,
        moduleId: "black-oak-will",
        moduleVersion: "tactical-map-v1",
        runtimeProfiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
        members: [{ principalId: ALICE.principal.id, role: "host" }],
        characters: [character(ALICE_ID, ALICE.principal.id, `阿莱莎-${level}`, level)],
      }), `level ${level} environment Room initialization`);
      expect(initialized.created, JSON.stringify(initialized)).toBe(true);
      const prepared = await prepareIntent(
        authority,
        ALICE,
        `submission:dynamic-environment:level-${level}`,
        "我按自己想到的七音次序敲响这面陶片墙。",
      );
      const proposal = privateEnvironmentProposal(prepared.rootActionId, openBlankDraft());
      let rollCount = 0;
      const outcome = record(await runInDurableObject(authority as never, async (instance) => {
        const target = instance as unknown as {
          authorityRoll(sides: number): number;
          commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
        };
        const originalRoll = target.authorityRoll;
        target.authorityRoll = (sides) => {
          expect(sides).toBe(20);
          rollCount += 1;
          return 1;
        };
        try {
          return await target.commit(ALICE, prepared.preparedActionId, proposal);
        } finally {
          target.authorityRoll = originalRoll;
        }
      }), `level ${level} environment commit`);
      expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
      expect(rollCount).toBe(1);
      const rulesInput = await recoveryRulesInput(authority, prepared.preparedActionId);
      return record(
        record(rulesInput.materialization, `level ${level} materialization`).featureDefinition,
        `level ${level} frozen feature definition`,
      );
    }

    const levelOne = await frozenDefinitionAtLevel(1);
    const levelTwenty = await frozenDefinitionAtLevel(20);
    const mechanics = (definition: JsonRecord) => {
      const destructible = record(definition.destructible, "frozen destructible definition");
      const areaEffect = record(definition.areaEffect, "frozen area-effect definition");
      return {
        armorClass: destructible.armorClass,
        maximumDurability: destructible.maximumDurability,
        damageThreshold: destructible.damageThreshold,
        saveDc: record(areaEffect.save, "frozen environment save").dc,
        damageFormula: record(areaEffect.damage, "frozen environment damage").formula,
      };
    };
    expect(mechanics(levelOne)).toEqual({
      armorClass: "15",
      maximumDurability: "14",
      damageThreshold: "3",
      saveDc: "13",
      damageFormula: "2d6",
    });
    expect(mechanics(levelTwenty)).toEqual(mechanics(levelOne));
  });

  it("rejects an incomplete KP FSM instead of inventing an object-damage transition", async () => {
    const roomId = `${ROOM_ID}:implicit-durability-transition`;
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "tactical-map-v1",
      runtimeProfiles: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎")],
    }), "implicit durability-transition Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);

    const prepared = await prepareIntent(
      authority,
      ALICE,
      "submission:dynamic-environment:implicit-durability-transition",
      "我试着依次敲击这些陶片，让墙腔里的风压喷出来。",
    );
    const draft = openBlankDraft();
    delete draft.damageFromPhases;
    delete draft.damageRemainingAtOrBelow;
    delete draft.damageToPhases;
    expect(() => privateEnvironmentProposal(prepared.rootActionId, draft)).toThrow(
      /damageFromPhases:environment-required/u,
    );

    const exported = record(await authority.exportAuthoritativeArchive(
      record(initialized.serviceCapabilities, "implicit transition service capabilities")
        .archiveExport,
    ), "implicit durability-transition archive export");
    const archive = record(exported.archive, "implicit durability-transition archive");
    const materializations = list(archive.events, "implicit transition archive events")
      .map((event) => record(event, "implicit transition event"))
      .filter((event) => event.eventType === "EnvironmentFeatureMaterialized");
    expect(materializations).toHaveLength(0);
  });
});
