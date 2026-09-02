import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createAuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative";
import {
  NARRATION_TOOL_NAME,
  AUTHORITATIVE_KP_PROFILES,
} from "../app/_runtime/lib/kp/authoritative-policy";
import { createModelProfileRegistry } from "../app/_runtime/lib/kp/model-registry";
import {
  kpFormIdForToolName,
  kpFormToolName,
} from "../app/_runtime/lib/kp/form-catalog";
import { createV3ProductionContextPreparer } from "../app/_runtime/lib/kp/v3-production-context";
import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";
import {
  handleRoomAction,
  handleViewerNarrationRecovery,
} from "../app/_runtime/lib/room/action";
import { project, replay } from "../app/_runtime/lib/rules";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset";
import {
  buildAuthoritativeActionInput,
  buildAuthoritativeTableState,
  projectAuthoritativeTableObservation,
} from "../app/_runtime/lib/table/authoritative";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  beginDeliveryAudiencePublication(query: unknown): Promise<unknown>;
  failDeliveryAudiencePublication(capability: unknown, failure: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  beginViewerNarrationRecovery(context: unknown, capability: string): Promise<unknown>;
  publishViewerNarrationRecovery(
    context: unknown,
    capability: string,
    publication: unknown,
  ): Promise<unknown>;
  failViewerNarrationRecovery(
    context: unknown,
    capability: string,
    failure: unknown,
  ): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ROOM_ID = "kp-v3-long-track-production-seams";
const ALICE_ID = "character:kp-v3-long-track:alice";
const BOB_ID = "character:kp-v3-long-track:bob";
const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:kp-v3-long-track:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:kp-v3-long-track:bob", sessionVersion: 1 }),
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

function character(characterId: string, controllerPrincipalId: string, name: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level: 3,
      scores: { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["athletics", "investigation"],
      expertise: ["investigation"],
      proficientSaves: ["con", "str"],
      hp: { current: 30, max: 30, temp: 0 },
      ac: 15,
      speed: 30,
      equipped: { armor: "leather", main: "shortsword" },
      backpack: [],
    },
  };
}

function observeDraft(index: number, text: string): JsonRecord {
  return {
    goal: `确认第 ${index} 次行动在当前院落留下的可观察结果`,
    method: text,
    focus: `院落现场第 ${index} 个即时变化`,
    desiredInformation: `只确认与第 ${index} 次自然语言想法直接相关的当前事实`,
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  };
}

function stateOnlyEnvironmentDraft(): JsonRecord {
  return {
    goal: "把墙边的折叠竹骨声屏展开，封住狭窄侧道",
    method: "提起玩家刚想到的底部拉环，让竹骨沿弧形铜槽逐节展开",
    featureDescription: "沿弧形铜槽展开的折叠竹骨声屏",
    intendedOutcome: "声屏形成阻断、半掩护和隔声面，不产生区域伤害",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["yard"],
    effectMode: "state-only",
    activation: "direct",
    material: "油浸竹骨、粗麻吸音层、铜铰与石质地槽",
    centerXInches: -360,
    centerYInches: -300,
    elevationInches: 0,
    widthInches: 120,
    depthInches: 12,
    heightInches: 72,
    objectAc: 12,
    objectHitPoints: 10,
    damageThreshold: 2,
    immuneDamageTypes: ["poison", "psychic"],
    initialPhase: "folded",
    phaseNames: ["folded", "broken", "unfurled"],
    phaseOpaque: [false, false, true],
    phaseImpassable: [false, false, true],
    phaseCover: ["none", "none", "half"],
    phaseEffectPropagation: ["passes", "passes", "blocks"],
    phaseTerrain: ["normal", "rubble", "normal"],
    damageFromPhases: ["folded"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: ["broken"],
    stuntFromPhases: ["folded"],
    stuntToPhases: ["unfurled"],
    trigger: "拉环越过止动点后，竹骨由铜铰带动并沿弧形地槽连续展开",
  };
}

function areaHazardEnvironmentDraft(): JsonRecord {
  return {
    goal: "松开庭院排雾囊的压扣，让积存蒸汽扫过空地",
    method: "按玩家提出的办法用木楔顶开压扣，再拉动侧面的泄压绳",
    featureDescription: "藤编护壳包裹的蓄压草药雾囊",
    intendedOutcome: "雾囊泄压后塌成湿藤残堆，并使范围内角色尝试避开冲击",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["yard"],
    effectMode: "area-hazard",
    activation: "check",
    checkAbility: "int",
    checkSkill: "investigation",
    checkDc: 1,
    checkMode: "normal",
    checkSuccessConsequence: "压扣与泄压绳被按正确次序松开，雾囊开始泄压。",
    checkFailureConsequence: "木楔滑脱，压扣仍保持闭合，雾囊没有泄压。",
    material: "浸蜡藤编护壳、铜制压扣、厚皮囊与草药蒸汽",
    centerXInches: 0,
    centerYInches: 0,
    elevationInches: 0,
    widthInches: 120,
    depthInches: 24,
    heightInches: 96,
    objectAc: 15,
    objectHitPoints: 14,
    damageThreshold: 3,
    immuneDamageTypes: ["poison", "psychic"],
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
    trigger: "压扣与泄压绳同时松开，囊内蒸汽沿编织缝隙向外喷出",
    areaOriginElevationInches: 36,
    areaRadiusInches: 1200,
    propagation: "straight",
    saveAbility: "str",
    saveDc: 1,
    halfOnSuccess: false,
    damage: "2d6",
    damageType: "thunder",
    condition: "prone",
    debrisOutcome: "湿藤护壳塌成提供半掩护的残堆",
  };
}

function toolResponse(
  toolName: string,
  value: JsonRecord,
  sequence: number,
) {
  return {
    id: `model-response:kp-v3-long-track:${sequence}`,
    object: "chat.completion",
    created: 1_788_000_000 + sequence,
    model: AUTHORITATIVE_KP_PROFILES[0].modelId,
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `call:kp-v3-long-track:${sequence}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(value) },
        }],
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 24, total_tokens: 124 },
  };
}

class LongTrackModelBinding {
  proposalCalls = 0;
  narrationCalls = 0;
  recoveryNarrationCalls = 0;
  bobFailureCount = 0;
  contextPackCalls = 0;
  readonly rootsBySubmission = new Map<string, string>();
  private bobFailureRootActionId: string | undefined;
  private readonly narrationCallsByRoot = new Map<string, number>();
  private responseSequence = 0;

  async run(_model: string, value: unknown) {
    const request = record(value, "model request");
    const tools = list(request.tools, "strict model tools");
    const toolNames = tools.map((candidate) => String(record(
      record(candidate, "strict model tool").function,
      "tool definition",
    ).name));
    const messages = list(request.messages, "bounded model messages");
    const payload = JSON.parse(String(record(messages[1], "model user message").content)) as JsonRecord;
    this.responseSequence += 1;

    if (toolNames.length === 1 && toolNames[0] === NARRATION_TOOL_NAME) {
      this.narrationCalls += 1;
      expect(Object.keys(payload).sort()).toEqual([
        "actorAction",
        "opportunities",
        "pressure",
        "receipt",
        "recentDialogue",
        "renderableClaims",
      ]);
      expect(JSON.stringify(payload)).not.toMatch(/storyBible|npcViewers|worldState|rawEvents/iu);
      const rootActionId = String(record(payload.receipt, "body-only receipt").rootActionId);
      const callsForRoot = (this.narrationCallsByRoot.get(rootActionId) ?? 0) + 1;
      this.narrationCallsByRoot.set(rootActionId, callsForRoot);
      if (rootActionId === this.bobFailureRootActionId && callsForRoot === 2) {
        this.bobFailureCount += 1;
        throw Object.assign(new Error("scripted Bob-only narration timeout"), {
          name: "TimeoutError",
        });
      }
      if (rootActionId === this.bobFailureRootActionId && callsForRoot > 2) {
        this.recoveryNarrationCalls += 1;
        return toolResponse(
          NARRATION_TOOL_NAME,
          { body: "Bob 仅依据原 Receipt 与冻结投影恢复了自己的第 2 次回复。" },
          this.responseSequence,
        );
      }
      return toolResponse(
        NARRATION_TOOL_NAME,
        { body: "这次行动的可见结果已经按当前冻结投影呈现。" },
        this.responseSequence,
      );
    }

    expect(toolNames.length).toBeGreaterThanOrEqual(3);
    expect(toolNames.length).toBeLessThanOrEqual(6);
    expect(toolNames.every((name) => kpFormIdForToolName(name) !== undefined)).toBe(true);
    this.proposalCalls += 1;
    const contextPack = record(payload.contextPack, "production three-layer Context Pack");
    const required = record(contextPack.required, "RequiredContext");
    const intent = record(required.intent, "authority-derived intent");
    const retrieved = record(contextPack.retrieved, "RetrievedContext");
    const optional = record(contextPack.optional, "OptionalContext");
    expect(list(retrieved.chunks, "retrieved authority chunks").length).toBeGreaterThan(0);
    expect(Array.isArray(optional.items)).toBe(true);
    this.contextPackCalls += 1;
    const submissionId = String(intent.submissionRef);
    expect(submissionId).toMatch(/^submission:kp-v3-long-track:\d{2}$/u);
    const index = Number(submissionId.slice(-2));
    const rootActionId = String(payload.rootActionRef);
    this.rootsBySubmission.set(submissionId, rootActionId);
    if (index === 2) this.bobFailureRootActionId = rootActionId;
    if (index === 10) {
      expect(toolNames).toContain(kpFormToolName("environmental-stunt.v1"));
      return toolResponse(
        kpFormToolName("environmental-stunt.v1"),
        stateOnlyEnvironmentDraft(),
        this.responseSequence,
      );
    }
    if (index === 2) {
      expect(toolNames).toContain(kpFormToolName("environmental-stunt.v1"));
      return toolResponse(
        kpFormToolName("environmental-stunt.v1"),
        areaHazardEnvironmentDraft(),
        this.responseSequence,
      );
    }
    expect(toolNames).toContain(kpFormToolName("observe.v1"));
    return toolResponse(
      kpFormToolName("observe.v1"),
      observeDraft(index, String(intent.text)),
      this.responseSequence,
    );
  }
}

function tableState(authority: Authority, principal: typeof ALICE | typeof BOB) {
  return authority.observe(principal).then((observation) => {
    const projected = projectAuthoritativeTableObservation({
      userId: principal.principal.id,
      members: [ALICE.principal.id, BOB.principal.id],
      locationLabels: { yard: "庭院" },
      observation,
    });
    return {
      projected,
      state: buildAuthoritativeTableState({
        rulesetVersion: AUTHORITATIVE_RULESET_VERSION,
        projected,
      }),
      observation: record(observation, "Room observation for Table"),
    };
  });
}

describe("V3 31-interaction production-seam long track", () => {
  it("keeps arbitrary KP environment definitions and Bob-local narration recovery on one authoritative track", async () => {
    const authority = env.ROOMS.getByName(ROOM_ID) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId: ROOM_ID,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    }), "V3 long-track Room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);
    const serviceCapabilities = record(
      initialized.serviceCapabilities,
      "V3 long-track service capabilities",
    );
    const archiveExport = serviceCapabilities.archiveExport;
    const model = new LongTrackModelBinding();
    const kpProfile = AUTHORITATIVE_KP_PROFILES[0];
    const registry = createModelProfileRegistry([{
      profileRef: kpProfile.modelProfileVersion,
      provider: kpProfile.provider,
      modelId: kpProfile.modelId,
      modelRevision: kpProfile.modelRevision,
      supportedRoles: ["primary-kp", "narration"],
      validationSuiteVersion: "authoritative-kp-v3-role-validation-v1",
      validationStatus: "passed",
      structuredOutputMode: "tool",
      contextWindowTokens: 64_000,
      latencyTier: "standard",
      costTier: "standard",
    }]);
    const productionContext = createV3ProductionContextPreparer({
      moduleProfile: await authoritativeModuleProfile("black-oak-will"),
      registry,
      pinnedPrimaryKpProfileRef: kpProfile.modelProfileVersion,
      allowKpOnly: true,
    });
    const kp = createAuthoritativeKpAdapter({
      ai: model,
      profile: kpProfile,
      prepareV3Context: (request, allowedForms) =>
        productionContext.prepare(request, allowedForms),
    });
    const outcomes: JsonRecord[] = [];
    let completedInteractions = 0;
    let bobRecoveryStateVersion: string | undefined;
    let bobRecoveryEventCount: number | undefined;

    for (let index = 1; index <= 15; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const principal = index === 2
        ? ALICE
        : index === 10
        ? BOB
        : index % 2 === 0 ? BOB : ALICE;
      const text = index === 10
        ? "我提起墙边竹骨声屏的拉环，让它沿弧形铜槽展开并封住侧道。"
        : index === 2
          ? "我用木楔顶开藤编雾囊的压扣，再拉泄压绳释放里面的蒸汽。"
          : `我按自己的第 ${index} 个想法观察并确认庭院眼下的变化。`;
      const input = buildAuthoritativeActionInput({
        submissionId: `submission:kp-v3-long-track:${suffix}`,
        text,
      });
      const outcome = record(await handleRoomAction({
        principal,
        authority,
        kp,
      }, input), `V3 long-track interaction ${suffix}`);
      completedInteractions += 1;
      outcomes.push(outcome);
      expect(
        outcome,
        `interaction ${suffix}: ${JSON.stringify(outcome)}`,
      ).toMatchObject({
        kind: "committed",
        action: "committed",
        narration: "published",
        receipt: { rootActionId: expect.any(String) },
      });

      if (index === 2) {
        const audienceNarrations = list(
          outcome.audienceNarrations,
          "independent audience narration results",
        ).map((entry) => record(entry, "audience narration result"));
        expect(audienceNarrations.map((entry) => entry.state).sort()).toEqual([
          "published",
          "retryableFailure",
        ]);
        expect(audienceNarrations.find((entry) => entry.state === "retryableFailure"))
          .toMatchObject({ errorCode: "NARRATION_PROVIDER_TIMEOUT" });

        const aliceTable = await tableState(authority, ALICE);
        const bobTable = await tableState(authority, BOB);
        expect(aliceTable.state).not.toHaveProperty("narrationRecovery");
        const recovery = record(
          record(bobTable.state, "Bob Table state").narrationRecovery,
          "Bob Table narration recovery",
        );
        expect(recovery).toEqual({
          kind: "available",
          capability: expect.stringMatching(/^publish-capability:/u),
          state: "retryableFailure",
        });
        expect(JSON.stringify(recovery)).not.toMatch(/audience|projection|receipt|generation|alice/iu);
        bobRecoveryStateVersion = String(
          record(bobTable.observation.readModel, "Bob pre-recovery read model").stateVersion,
        );
        const beforeRecoveryArchive = record(await authority.exportAuthoritativeArchive(
          archiveExport,
        ), "pre-recovery archive export");
        bobRecoveryEventCount = list(
          record(beforeRecoveryArchive.archive, "pre-recovery archive").events,
          "pre-recovery events",
        ).length;
        const proposalCallsBeforeRecovery = model.proposalCalls;

        const recovered = record(await handleViewerNarrationRecovery({
          principal: BOB,
          authority,
          kp,
        }, String(recovery.capability)), "Bob viewer-local recovery outcome");
        completedInteractions += 1;
        expect(recovered).toMatchObject({
          kind: "committed",
          action: "committed",
          narration: "published",
        });
        expect(model.proposalCalls).toBe(proposalCallsBeforeRecovery);
        expect(model.recoveryNarrationCalls).toBe(1);

        const bobRecoveredTable = await tableState(authority, BOB);
        expect(bobRecoveredTable.state).not.toHaveProperty("narrationRecovery");
        expect(record(
          bobRecoveredTable.observation.readModel,
          "Bob recovered read model",
        ).stateVersion).toBe(bobRecoveryStateVersion);
        expect(bobRecoveredTable.projected.messages).toEqual([
          expect.objectContaining({
            kind: "narrate",
            body: "Bob 仅依据原 Receipt 与冻结投影恢复了自己的第 2 次回复。",
          }),
        ]);
        const afterRecoveryArchive = record(await authority.exportAuthoritativeArchive(
          archiveExport,
        ), "post-recovery archive export");
        expect(list(
          record(afterRecoveryArchive.archive, "post-recovery archive").events,
          "post-recovery events",
        )).toHaveLength(bobRecoveryEventCount);
      }

      const delivery = record(outcome.delivery, `interaction ${suffix} actor delivery`);
      expect(delivery.kind).toBe("current");
      const deliveryId = String(record(delivery.frame, `interaction ${suffix} delivery frame`).deliveryId);
      const acknowledged = record(await handleRoomAction({
        principal,
        authority,
        kp,
      }, { kind: "acknowledge", deliveryId }), `interaction ${suffix} acknowledgement`);
      completedInteractions += 1;
      expect(acknowledged).toMatchObject({
        kind: "acknowledged",
        deliveryId,
        action: "notCommitted",
        narration: "notApplicable",
      });
    }

    expect(completedInteractions).toBe(31);
    expect(outcomes).toHaveLength(15);
    expect(model.proposalCalls).toBe(15);
    expect(model.contextPackCalls).toBe(15);
    expect(model.rootsBySubmission.size).toBe(15);
    expect(model.bobFailureCount).toBe(1);
    expect(model.recoveryNarrationCalls).toBe(1);
    expect(new Set(outcomes.map((outcome) =>
      String(record(outcome.receipt, "long-track receipt").rootActionId)))).toHaveLength(15);

    const exported = record(await authority.exportAuthoritativeArchive(
      archiveExport,
    ), "V3 long-track archive export");
    const archive = record(exported.archive, "V3 long-track archive");
    const events = list(archive.events, "V3 long-track events")
      .map((event) => record(event, "V3 long-track event"));
    const stateOnlyRoot = model.rootsBySubmission.get("submission:kp-v3-long-track:10")!;
    const hazardRoot = model.rootsBySubmission.get("submission:kp-v3-long-track:02")!;
    const stateOnlyEvents = events.filter((event) => event.rootActionId === stateOnlyRoot);
    const hazardEvents = events.filter((event) => event.rootActionId === hazardRoot);

    const stateOnlyMaterialization = stateOnlyEvents.find((event) =>
      event.eventType === "EnvironmentFeatureMaterialized");
    expect(record(
      record(stateOnlyMaterialization?.payload, "state-only materialization payload")
        .featureDefinition,
      "state-only environment definition",
    )).toMatchObject({
      schema: "zhuwei.environment-feature/v2",
      effectMode: "state-only",
      label: "沿弧形铜槽展开的折叠竹骨声屏",
      initialState: "folded",
      hazard: null,
      areaEffect: null,
    });
    expect(stateOnlyEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "EnvironmentFeatureMaterialized",
      "AbilityInvoked",
      "EnvironmentFeatureStateChanged",
    ]));
    expect(stateOnlyEvents.find((event) =>
      event.eventType === "EnvironmentFeatureStateChanged")?.payload).toMatchObject({
      intent: "applyStunt",
      fromState: "folded",
      toState: "unfurled",
    });
    expect(stateOnlyEvents.map((event) => event.eventType)).not.toEqual(expect.arrayContaining([
      "RandomnessRequested",
      "EnvironmentHazardTriggered",
      "EnvironmentAreaTargetResolved",
      "DamagePacketResolved",
    ]));

    const hazardMaterialization = hazardEvents.find((event) =>
      event.eventType === "EnvironmentFeatureMaterialized");
    expect(record(
      record(hazardMaterialization?.payload, "area-hazard materialization payload")
        .featureDefinition,
      "area-hazard environment definition",
    )).toMatchObject({
      schema: "zhuwei.environment-feature/v2",
      effectMode: "area-hazard",
      label: "藤编护壳包裹的蓄压草药雾囊",
      initialState: "tuned",
      hazard: expect.any(Object),
      areaEffect: expect.any(Object),
    });
    expect(hazardEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "EnvironmentFeatureMaterialized",
      "EnvironmentHazardTriggered",
      "EnvironmentAreaTargetResolved",
      "EnvironmentFeatureStateChanged",
      "RandomnessRequested",
    ]));
    const hazardTargets = hazardEvents
      .filter((event) => event.eventType === "EnvironmentAreaTargetResolved")
      .map((event) => record(event.payload, "area-hazard target resolution"));
    expect(hazardTargets.map((target) => target.targetEntityId).sort()).toEqual([
      ALICE_ID,
      BOB_ID,
    ]);
    expect(hazardTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ saveSucceeded: true, appliedDamage: "0", statusApplied: "none" }),
      expect.objectContaining({ saveSucceeded: true, appliedDamage: "0", statusApplied: "none" }),
    ]));
    expect(hazardEvents.filter((event) => event.eventType === "EnvironmentFeatureStateChanged")
      .map((event) => record(event.payload, "area-hazard state transition")))
      .toEqual([
        expect.objectContaining({
          intent: "triggerHazard",
          fromState: "tuned",
          toState: "venting",
        }),
        expect.objectContaining({
          intent: "resolveHazard",
          fromState: "venting",
          toState: "shattered",
        }),
      ]);

    const replayed = record(replay(
      archive.signedGenesis as never,
      archive.events as never,
    ), "V3 long-track replay");
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    expect(record(replayed.head, "V3 long-track replay head").eventSeq)
      .toBe(String(events.at(-1)?.eventSeq));
    expect(record(replayed.head, "V3 long-track replay head").stateHash)
      .toBe(record(archive.head, "V3 long-track archive head").stateHash);

    const finalTables = new Map<string, Awaited<ReturnType<typeof tableState>>>();
    for (const principal of [ALICE, BOB]) {
      const finalTable = await tableState(authority, principal);
      finalTables.set(principal.principal.id, finalTable);
      expect(finalTable.state).not.toBeNull();
      expect(finalTable.state).not.toHaveProperty("narrationRecovery");
      expect(record(finalTable.state, "final Table state").controlledCharacter)
        .toEqual(expect.objectContaining({ characterId: expect.any(String) }));
    }

    const restoredAuthority = env.ROOMS.getByName(`${ROOM_ID}:restored`) as unknown as Authority;
    await expect(restoredAuthority.restoreAuthoritativeArchive(
      serviceCapabilities.disasterRecovery,
      structuredClone(archive),
    )).resolves.toMatchObject({
      kind: "restored",
      projectionIntegrity: "verified",
    });
    const restoredExport = record(await restoredAuthority.exportAuthoritativeArchive(
      archiveExport,
    ), "restored V3 long-track archive export");
    const restoredArchive = record(restoredExport.archive, "restored V3 long-track archive");
    const restoredReplay = record(replay(
      restoredArchive.signedGenesis as never,
      restoredArchive.events as never,
    ), "restored V3 long-track replay");
    expect(restoredReplay.kind).toBe("replayed");
    expect(record(restoredReplay.head, "restored replay head")).toEqual(
      record(replayed.head, "source replay head"),
    );
    expect(restoredReplay.state).toEqual(replayed.state);

    for (const principal of [ALICE, BOB]) {
      const sourceTable = finalTables.get(principal.principal.id)!;
      const sourceReadModel = record(sourceTable.observation.readModel, "source final read model");
      const viewer = record(sourceReadModel.viewer, "source final frozen viewer");
      const sourceProjection = record(project(
        ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
        replayed.state,
        viewer,
      ), "source replay viewer projection");
      const restoredProjection = record(project(
        ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
        restoredReplay.state,
        viewer,
      ), "restored replay viewer projection");
      expect(restoredProjection.projectionHash).toBe(sourceProjection.projectionHash);
      const restoredTable = await tableState(restoredAuthority, principal);
      expect(record(restoredTable.observation.readModel, "restored Room read model").stateVersion)
        .toBe(sourceReadModel.stateVersion);
    }
  }, 300_000);
});
