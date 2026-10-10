/// <reference path="../../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { runInDurableObject } from "cloudflare:test";
import { afterEach, expect, inject, it, vi } from "vitest";
import type { AuthoritativeModelBinding } from "../../../app/_runtime/lib/kp/authoritative-types";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";
import { AuthoritativeRoomStore } from "../../../app/_runtime/lib/room/authority-store";
import type { StoryCreationStore } from "../../../app/_runtime/lib/room/story-creation-store";
import type { StoryLibraryStore } from "../../../app/_runtime/lib/room/story-library-store";
import type { AuthoritativeWorldState, RuntimeGenesis } from "../../../app/_runtime/lib/rules";
import { historyHttpAccount, historyHttpDb, historyHttpPost, historyHttpSource, historyHttpRestoredContainerSource, httpRecord } from "../../support/fixtures/story-history-http";
import { selectStoryProbeCase } from "../../support/fixtures/story-live-room-cases.mjs";
import { acceptDailyGameplay, dailyClericDraft, dailyRogueDraft } from "../../support/fixtures/daily-gameplay";
import { CURRENT_AUTHORITATIVE_MODULE_VERSION } from "../../../app/_runtime/lib/module/authoritative";
import { prepareCarriedReferenceHistory, prepareContainerLiveHistory, type CarriedScenario } from "../../support/fixtures/dynamic-object-live";

declare module "vitest" {
  export interface ProvidedContext {
    storyRoomProbe: { bridgeUrl: string; token: string; caseId: string; actionText: string; mode: "live" | "preflight"; dice: number[] };
  }
}

// Only the provider dependency seam is replaced. The production server still
// chooses strict versus JSON transport, and its normal Room journal, author,
// review, Proposal, Rules and narration consumers see actual model responses.
vi.mock("../../../app/_runtime/lib/kp/deepseek", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../app/_runtime/lib/kp/deepseek")>();
  const { inject: readProvided } = await import("vitest");
  const config = readProvided("storyRoomProbe");
  let injectedInput: unknown;
  async function capture(name: string, value: unknown) {
    const response = await fetch(`${config.bridgeUrl}/evidence`, { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ name, value }) });
    if (!response.ok) throw new Error("PROBE_EVIDENCE_FAILED");
  }
  function binding(transportKind: "strict" | "ordinary-json"): AuthoritativeModelBinding {
    return { async run(model, input, options) {
      if (transportKind === "strict") actual.assertDeepSeekStrictToolModelInput(input);
      const tool = (input.tools as { function?: { name?: string } }[] | undefined)?.[0]?.function?.name;
      if (config.caseId === "narration-recovery" && tool === "submit_frozen_narration") {
        if (injectedInput === undefined) {
          injectedInput = structuredClone(input);
          await capture("injected-generation", { syntheticFailure: true, realProviderCalls: 0, model, input });
          // Deliberate fault injection, not a real response or success sample.
          // Reproduce the original empty/truncated shape without paying again.
          return { choices: [{ message: { content: "" }, finish_reason: "length" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
        }
        if (JSON.stringify(input) !== JSON.stringify(injectedInput)) throw new Error("PROBE_RECOVERY_INPUT_CHANGED");
        await capture("recovery-generation", { sameFrozenRequest: true, model, input });
      }
      const response = await fetch(`${config.bridgeUrl}/invoke`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ transportKind, model, input }), signal: options?.signal });
      const result: unknown = await response.json();
      if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error("PROBE_BRIDGE_RESPONSE_INVALID");
      const value = result as Record<string, unknown>;
      if (!response.ok) throw Object.assign(new Error("PROBE_TRANSPORT_STOPPED"), {
        code: value.code, probeCode: value.probeCode,
        status: typeof value.status === "number" ? value.status : response.status,
        name: typeof value.name === "string" ? value.name : "Error",
        ...(typeof value.retryAfter === "number" ? { retryAfter: value.retryAfter } : {}),
      });
      if (!Object.hasOwn(value, "response")) throw new Error("PROBE_BRIDGE_RESPONSE_INVALID");
      return value.response;
    } };
  }
  return { ...actual, createDeepSeekStrictToolBinding: () => binding("strict"),
    createDeepSeekAuthoritativeBinding: () => binding("ordinary-json") };
});

const migrations = import.meta.glob<string>("/drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
const config = inject("storyRoomProbe");
async function bridge(path: string, value?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.bridgeUrl}${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${config.token}`, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const body = httpRecord(await response.json());
  if (!response.ok) throw new Error(typeof body.probeCode === "string" ? body.probeCode : "PROBE_BRIDGE_STOPPED");
  return body;
}
const evidence = (name: string, value: unknown) => bridge("/evidence", { name, value });
/** Work the step scheduled, such as an NPC carrying out a promise, is first
 * attempted on the Room alarm after the HTTP reply (round127). That attempt
 * finishes work that needs no model and parks model work until a player
 * request brings a transport (ACTOR_PLAN_DECISION_TRANSPORT_REQUIRED leaves it
 * unscheduled, round132). Wait until no due work is scheduled, so the
 * same-submission retry is compared against a room at rest. */
async function settleRoom(source: Awaited<ReturnType<typeof historyHttpSource>>, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = await runInDurableObject(source.stub, (_instance, ctx) =>
      new AuthoritativeRoomStore(ctx.storage).dueWorkAlarmAt() !== null);
    if (!busy) return;
    if (Date.now() > deadline) throw new Error("PROBE_ROOM_NOT_SETTLED");
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}
type Internals = { storyStore: StoryCreationStore; storyLibraryStore: StoryLibraryStore };
/** How many of the preset faces the Room drew; null when the instance that
 * held them was replaced and the remaining ones are unknown. */
async function presetDiceUse(source: Awaited<ReturnType<typeof historyHttpSource>>, faces: readonly number[]) {
  const remaining = await runInDurableObject(source.stub, instance => (instance as unknown as { probePresetDice?: number[] }).probePresetDice?.length);
  return { faces, used: remaining === undefined ? null : faces.length - remaining };
}

async function authoritySnapshot(source: Awaited<ReturnType<typeof historyHttpSource>>) {
  return runInDurableObject(source.stub, (instance, ctx) => {
    const authority = new AuthoritativeRoomStore(ctx.storage), row = authority.room();
    if (!row) throw new Error("PROBE_ROOM_AUTHORITY_MISSING");
    const state = JSON.parse(row.state_json) as AuthoritativeWorldState;
    const target = instance as unknown as Internals;
    return { genesis: JSON.parse(row.genesis_json) as RuntimeGenesis, state, events: authority.events(),
      jobs: target.storyStore.listCreationJobs(), library: target.storyLibraryStore.listEntries(),
      storyArchive: target.storyStore.archiveSnapshot({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId }),
      privateHost: authority.storyArchiveHostSnapshot(),
      privateReceipts: ctx.storage.sql.exec("SELECT * FROM authority_receipts ORDER BY receipt_id").toArray(),
      privateSubmissions: ctx.storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id, principal_id").toArray(),
      randomness: ctx.storage.sql.exec("SELECT * FROM authority_randomness_batches ORDER BY prepared_action_id").toArray(),
      deliveryPlans: ctx.storage.sql.exec("SELECT * FROM authority_delivery_plans ORDER BY publish_capability").toArray(),
      deliveryAudiences: ctx.storage.sql.exec("SELECT * FROM authority_delivery_audiences ORDER BY publish_capability, audience_id").toArray(),
      deliverySlots: ctx.storage.sql.exec("SELECT * FROM authority_delivery_slots ORDER BY viewer_key").toArray(),
      experiencedMessages: ctx.storage.sql.exec("SELECT * FROM authority_experienced_messages ORDER BY ordinal").toArray(),
    };
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** How the opponent enters the opening fight: its hit points, current and
 * maximum, and whether it makes death saves at 0 HP (SPEC 0012 §12.2). */
type OpeningOpponent = { hitPointsMaximum?: number; hitPoints?: number; deathSaves?: boolean };

/** Starts a fight between the probe actor and `opponentRef` through Rules,
 * after an optional real map walk next to the opponent. The opponent's first
 * combat statistics are what the KP would fix (ADR 0102), with one melee
 * attack: round 174's openings gave Naes none, so his turns could only move,
 * dodge or end (ADR 0113). */
async function openInCombat(source: Awaited<ReturnType<typeof historyHttpSource>>, owner: Awaited<ReturnType<typeof historyHttpAccount>>,
  opponentRef: string, besideOpponent: boolean, opponent: OpeningOpponent = {},
  history: { spared?: boolean; stillFightingRef?: string } = {}) {
  const actor = source.characters[0].characterId;
  if (besideOpponent) {
    const table = await historyHttpPost("fetchTable", source.code, owner);
    const spatialRevision = httpRecord(httpRecord(httpRecord(table.body.state).authoritative).tacticalProjection).spatialRevision;
    const walked = await historyHttpPost("moveOnMap", { code: source.code, submissionId: crypto.randomUUID(), spatialRevision,
      destination: { kind: "nextTo", ref: history.stillFightingRef ?? opponentRef } }, owner);
    expect(walked.body.action, JSON.stringify(walked.body)).toBe("committed");
  }
  await runInDurableObject(source.stub, async instance => {
    type Data = Record<string, any>;
    const target = instance as unknown as Data, replay = target.authoritativeReplay();
    const foeRefs = [opponentRef, ...(history.stillFightingRef ? [history.stillFightingRef] : [])];
    const dynamicEntities = foeRefs.map((ref, index) => {
      const body = replay.state.combatRuntime.entities[ref], entity = replay.state.entities[ref];
      const social = entity.socialMechanics ?? {};
      const scores = entity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
      const initial = index === 0 ? opponent : { hitPointsMaximum: 12, hitPoints: 1, deathSaves: true };
      const suffix = index === 0 ? "opponent" : `opponent-${index + 1}`;
      return { entityId: ref, name: entity.name, placement: { position: structuredClone(body.position) },
        ...(initial.hitPoints === undefined ? {} : { initialState: { hitPointsCurrent: String(initial.hitPoints) } }),
        mechanics: { kind: "bespokeDefinition", definition: {
          definitionId: `npc-template:probe-combat:${suffix}`, revision: "1", definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014", causalBasisRefs: [entity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
          content: { schema: "zhuwei.npc-mechanical-template/v1", label: entity.name, footprint: structuredClone(body.footprint),
            stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
            proficiencyBonus: String(entity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
            armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
            hitPointsMaximum: String(initial.hitPointsMaximum ?? 9), speedInches: { walk: "360" }, resourceMaximums: {},
            deathPolicy: initial.deathSaves === true ? "deathSaves" : "deadAtZero",
            intrinsicAbilities: [{ definitionId: `ability:probe-combat:${suffix}:mace`, revision: "1", rulesBasis: "srd5.1-2014",
              mechanicalKey: "钉头锤", activation: { kind: "attack", actionGrant: "attack" },
              target: { kind: "creature", count: "1", reachInches: "60" }, attack: { ability: "str", proficiency: true },
              damage: [{ type: "bludgeoning", formula: "1d6" }] }],
            itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } };
    });
    let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:probe-combat-opening",
      proposalAttemptId: "proposal:probe-combat-opening", encounterId: "encounter:probe-combat", sceneId: replay.state.entities[actor].sceneId,
      participantEntityIds: [actor], dynamicEntities, battlefieldFactIds: [],
      initiativeGroups: [actor, ...foeRefs].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
      hostilities: [{ fromEntityIds: [actor], toEntityIds: [...foeRefs] }, { fromEntityIds: [...foeRefs], toEntityIds: [actor] }] });
    const events: unknown[] = [...result.events];
    const apply = (input: Data) => {
      result = target.rulesRuntime.step(replay.profiles, result.state, input);
      expect(["committed", "awaitingRandomness", "awaitingInput"], JSON.stringify(result).slice(0, 1500)).toContain(result.kind);
      events.push(...result.events);
    };
    let draw = 0;
    const roll = (initiative: boolean) => {
      while (result.kind === "awaitingRandomness") {
        const waiting = result;
        apply({ kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
          responseId: `authority:probe-combat:${++draw}`, continuationCapability: waiting.continuationCapability,
          randomnessResults: waiting.randomnessRequests.map((request: Data, index: number) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
            draws: request.dice.map((term: Data) => ({ sides: Number(term.sides),
              faces: Array(Number(term.count)).fill(initiative && index === 0 ? 20 : 1) })) })) });
      }
      expect(result.kind, JSON.stringify(result).slice(0, 1500)).toBe("committed");
    };
    roll(true);
    // Handoff §§5.2–5.3: disclosed opening history, not a provider sample.
    // All events and memories use Rules; no state is patched into place.
    if (history.spared || history.stillFightingRef) {
      const encounter = () => result.state.combatRuntime.encounters["encounter:probe-combat"];
      let turn = 0;
      const passUntil = (who: string) => {
        while (encounter().activeEntityId !== who) {
          expect(++turn, "opening history must reach the requested turn").toBeLessThan(10);
          apply({ kind: "endTurn", rootActionId: `root:probe-opening-pass:${turn}`, encounterId: encounter().encounterId,
            sourceEntityId: encounter().activeEntityId });
          expect(result.kind).toBe("committed");
        }
      };
      if (history.spared) {
        const abilityRef = result.state.combatRuntime.entities[actor].abilityRefs.find((ref: string) => ref.includes("unarmed-strike"));
        expect(abilityRef).toBeDefined();
        apply({ kind: "invokeAbility", rootActionId: "root:probe-opening-strike", sourceEntityId: actor, abilityRef,
          parameters: { targetEntityId: opponentRef } });
        roll(false);
      }
      passUntil(opponentRef);
      const fight = encounter();
      apply({ kind: "takeNpcCombatTurn", proposalId: `npc-turn:${fight.encounterId}:${fight.round}:${fight.turnCursor}:${opponentRef}:0`,
        encounterId: fight.encounterId, sourceEntityId: opponentRef,
        steps: [{ kind: "speak", words: "别打了，我投降！" }, { kind: "yield", fromRefs: [actor] }, { kind: "endTurn" }] });
      if (history.spared) {
        expect(result.kind).toBe("awaitingInput");
        apply({ kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId, responseId: "response:probe-opening-spared",
          answer: { kind: "acceptEncounterConclusion" } });
        expect(encounter().status).toBe("concluded");
        expect(Object.keys(result.state.knowledge[opponentRef]).some(ref => ref.startsWith("fact:encounter-memory:"))).toBe(true);
      } else {
        expect(result.kind, "one foe still fights: no conclusion may be asked").toBe("committed");
        passUntil(actor);
        expect(Object.keys(result.state.combatRuntime.pendingInputs)).toEqual([]);
      }
    }
    const rebuilt = target.rulesRuntime.replay(replay.genesis, [...target.authorityStore.events(), ...events]);
    expect(rebuilt.kind).toBe("replayed"); expect(rebuilt.state).toEqual(result.state);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(result.state); target.authorityStore.syncAuthorityIndex(result.state);
  });
  const table = (await historyHttpPost("fetchTable", source.code, owner)).body;
  return { initial: await authoritySnapshot(source), table };
}

afterEach(() => { vi.restoreAllMocks(); });

it("one real HTTP action: admission, narration, optional fault recovery and exact retry", async () => {
  const selected = selectStoryProbeCase(config.caseId, config.actionText);
  if (!selected?.implemented || typeof selected.text !== "string") throw new Error("PROBE_CASE_NOT_IMPLEMENTED");
  const originalFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== config.bridgeUrl) throw new Error("PROBE_WORKER_DIRECT_NETWORK_FORBIDDEN");
    return originalFetch(input, init);
  });
  let phase = "setup";
  try {
    for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
      for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
        await historyHttpDb.prepare(statement).run();
      }
    }
    const freshOwner = selected.resumeFromEvidence ? undefined : await historyHttpAccount("真实功能链路验收");
    const peer = ["multiplayer", "help", "containerContinuity", "containerPutBack", "carriedReference"].includes(String(selected.dailyGroup)) ? await historyHttpAccount("真实同桌验收") : undefined;
    // A probe plays the module version a new room gets (ADR 0087 opening places).
    const resumed = selected.resumeFromEvidence ? await bridge("/resume-evidence") : undefined;
    const source = resumed ? await historyHttpRestoredContainerSource(resumed, selected.resumeCapturedStep ?? 1)
      : await historyHttpSource(freshOwner!, peer, { moduleVersion: CURRENT_AUTHORITATIVE_MODULE_VERSION,
      ...(["containerContinuity", "containerPutBack"].includes(String(selected.dailyGroup)) ? { containerProbe: true }
        : selected.dailyGroup === "carriedReference" ? { carriedProbe: true } : selected.dailyGroup === "items" ? { injured: true, groundHealingPotion: true } : selected.dailyGroup === "spell"
        ? { injured: true, draft: dailyClericDraft } : selected.caseId === "pick-cellar-lock" ? { draft: dailyRogueDraft } : {}) });
    const owner = source.owner;
    if (["containerContinuity", "containerPutBack"].includes(String(selected.dailyGroup))) await prepareContainerLiveHistory(source, selected.withdrawBeforeSample === true);
    if (selected.dailyGroup === "carriedReference") await prepareCarriedReferenceHistory(source, selected.scenario as CarriedScenario);
    const initialTable = await historyHttpPost("fetchTable", source.code, owner);
    const initial = await authoritySnapshot(source);
    await evidence("initial", { roomId: source.roomId, characterId: source.characters[0].characterId,
      table: initialTable.body, authority: initial });
    expect(initialTable.response.status).toBe(200); expect(initialTable.body.ok).toBe(true);
    expect(initial.jobs).toHaveLength(0); expect(initial.library).toHaveLength(0);
    expect((await bridge("/status")).realProviderCalls).toBe(0);
    const actor = source.characters[0].characterId;
    if (["items", "spell"].includes(selected.dailyGroup)) expect(initial.state.entities[actor].hitPoints.current).toBe(1);
    if (selected.dailyGroup === "items") expect(initial.state.campaignRuntime.itemSystem.entries["item-entry:daily:healing-potion"])
      .toMatchObject({ quantity: 1, disposition: "scene", sceneRef: "wake", holderRef: null });
    if (selected.dailyGroup === "spell") {
      expect(initial.state.entities[actor].resources?.slot1).toBe(4);
      expect(initial.state.entities[actor].preparedSpellIds).toContain("cure");
    }
    if (selected.dailyGroup === "multiplayer") expect(source.characters).toHaveLength(2);
    // --dice: the Room's authoritative dice return these faces in order, then
    // roll at random again. They are drawn only after the KP's proposal is
    // frozen, so the model sees nothing of them.
    if (config.dice.length > 0) {
      await runInDurableObject(source.stub, instance => {
        const target = instance as unknown as { authorityRoll(sides: number): number; probePresetDice?: number[] };
        const random = target.authorityRoll.bind(target);
        target.probePresetDice = [...config.dice];
        target.authorityRoll = sides => {
          const face = target.probePresetDice!.shift();
          if (face === undefined) return random(sides);
          if (face > sides) throw new Error("PROBE_DICE_EXCEED_SIDES");
          return face;
        };
      });
    }
    // Zero-call preflight constructs and replays the selected opening too.
    // Its provider bridge refuses any accidental model request.
    const combat = isRecord(selected.startsInCombat) ? selected.startsInCombat : undefined;
    const opening = combat ? await openInCombat(source, owner, String(combat.opponentRef), combat.besideOpponent === true,
      isRecord(combat.opponent) ? combat.opponent as OpeningOpponent : {},
      { spared: combat.spared === true, ...(typeof combat.stillFightingRef === "string" ? { stillFightingRef: combat.stillFightingRef } : {}) }) : undefined;
    if (opening) await evidence("combat-opening", opening);
    if (config.mode === "preflight") {
      if (selected.verificationOnly) {
        const results = resumed!.results as Record<string, any>[];
        expect(results).toHaveLength(1);
        const result = results[0];
        expect(result.command).toBe("sendAction");
        const usage = await bridge("/status");
        await bridge("/seal-retry", {});
        const retried = await historyHttpPost(result.command, result.data, owner);
        await evidence("retry-action", { httpStatus: retried.response.status, body: retried.body });
        const repeated = await authoritySnapshot(source);
        await evidence("retry-authority", repeated);
        // SPEC 0011 §6: archive recovery omits Delivery Frames and the cached
        // complete commit DTO that embeds them. This audits a safe refusal;
        // it does not claim the old published HTTP reply has been recovered.
        expect(retried.response.status).toBe(200);
        expect(retried.body).toMatchObject({ action: "notCommitted", narration: "notApplicable",
          retryable: true, outcomeKind: "retryableFailure" });
        expect(repeated).toEqual(initial);
        expect((await bridge("/status")).calls).toEqual(usage.calls);
        const inventory = httpRecord(httpRecord(httpRecord(initialTable.body.state).authoritative).controlledCharacter).inventory as Record<string, any>;
        expect(inventory.containerMemories).toContainEqual(initial.state.vNextItemAuthority!.containerMemories![actor]["item-entry:live-object:box"]);
      }
      await evidence("acceptance", { status: "passed", mode: "preflight", caseId: selected.caseId,
        phases: ["real registration and session", "real Room initialization", "authenticated fetchTable", "full private authority snapshot"],
        providerCalls: 0, stateSha: canonicalHash(opening?.initial.state ?? initial.state),
        ...(selected.verificationOnly ? { restoredRealResult: true, savedReopeningVerified: true,
          archivedRetryReplyUnavailable: true, retryWorldUntouched: true, retryNewProviderCalls: 0, inventoryViewVerified: true } : {}),
        ...(opening ? { combatOpeningVerified: true, initialFixture: selected.initialFixture } : {}),
        notCovered: selected.verificationOnly ? ["new Provider sample", "new story creation", "new action admission"]
          : ["Provider request or output", "story creation", "action admission", "narration", "retry"] });
      return;
    }

    if (selected.dailyGroup) {
      phase = selected.caseId;
      await acceptDailyGameplay({ selected, source, initial: opening?.initial ?? initial,
        initialTable: opening?.table ?? initialTable.body, snapshot: () => authoritySnapshot(source), settle: () => settleRoom(source), bridge, evidence,
        assertReplay: async saved => {
          const replayed = await runInDurableObject(source.stub, instance => {
            const target = instance as unknown as { rulesRuntime: { replay: (genesis: RuntimeGenesis, events: typeof saved.events) => unknown } };
            return target.rulesRuntime.replay(saved.genesis, saved.events);
          });
          expect(httpRecord(replayed).kind).toBe("replayed");
          expect(httpRecord(replayed).state).toEqual(saved.state);
        } });
      if (config.dice.length > 0) await evidence("preset-dice", await presetDiceUse(source, config.dice));
      return;
    }

    phase = "first-action";
    const action = { code: source.code, submissionId: crypto.randomUUID(), text: config.actionText };
    const first = await historyHttpPost("sendAction", action, owner);
    await evidence("first-action", { request: action, httpStatus: first.response.status, body: first.body });
    let firstTable = await historyHttpPost("fetchTable", source.code, owner);
    await evidence("first-table", { httpStatus: firstTable.response.status, body: firstTable.body });
    await settleRoom(source);
    let after = await authoritySnapshot(source);
    await evidence("first-authority", after);
    let completed = first;
    let recoveryCallCount: number | null = null;
    if (selected.caseId === "narration-recovery") {
      phase = "recover-injected-generation-failure";
      // ADR 0026 (SPEC 0016 §8.3): the reply is prepared before the result
      // commits, so the injected generation failure leaves the world untouched
      // with the reply pending behind a private recovery capability.
      expect(first.body.action, JSON.stringify(first.body)).toBe("notCommitted");
      expect(first.body.outcomeKind, JSON.stringify(first.body)).toBe("retryableFailure");
      expect(first.body.narration).toBe("retryableFailure");
      const failed = after;
      expect(failed.events).toEqual(initial.events);
      expect(failed.privateReceipts).toEqual(initial.privateReceipts);
      expect(failed.jobs).toEqual(initial.jobs);
      expect(failed.library).toEqual(initial.library);
      const recovery = httpRecord(httpRecord(httpRecord(firstTable.body.state).authoritative).narrationRecovery);
      expect(typeof recovery.capability).toBe("string");
      const beforeRecoveryUsage = await bridge("/status");
      completed = await historyHttpPost("retryNarration", { code: source.code, capability: recovery.capability }, owner);
      await evidence("recovery-action", { httpStatus: completed.response.status, body: completed.body });
      firstTable = await historyHttpPost("fetchTable", source.code, owner);
      await evidence("recovery-table", { httpStatus: firstTable.response.status, body: firstTable.body });
      await settleRoom(source);
      after = await authoritySnapshot(source);
      await evidence("recovery-authority", after);
      // SPEC 0015 §8.2、SPEC 0016 §8.3: recovery regenerates the same frozen
      // reply and commits the frozen result once. It makes no new Proposal,
      // roll, resource or story work: every recovery call is narration
      // generation or review.
      expect(completed.body.action, JSON.stringify(completed.body)).toBe("committed");
      expect(completed.body.narration, JSON.stringify(completed.body)).toBe("published");
      expect(after.events.length).toBeGreaterThan(failed.events.length);
      expect(after.privateReceipts.length).toBeGreaterThan(failed.privateReceipts.length);
      expect(after.jobs).toEqual(failed.jobs);
      expect(after.library).toEqual(failed.library);
      const recoveryCalls = ((await bridge("/status")).calls as Record<string, unknown>[])
        .slice((beforeRecoveryUsage.calls as Record<string, unknown>[]).length);
      recoveryCallCount = recoveryCalls.length;
      expect(recoveryCallCount).toBeGreaterThanOrEqual(2);
      for (const call of recoveryCalls) expect(["submit_frozen_narration", "review_frozen_narration"]).toContain(call.tool);
    }
    // The admitted response is the one that committed: the recovery for the
    // fault case, the first response otherwise.
    const admitted = selected.caseId === "narration-recovery" ? completed : first;
    const firstUsage = await bridge("/status");
    expect(admitted.response.status).toBe(200); expect(admitted.body.action, JSON.stringify(admitted.body)).toBe("committed");
    expect(completed.response.status).toBe(200);
    expect(completed.body.narration, JSON.stringify(completed.body)).toBe("published");
    expect(firstTable.response.status).toBe(200); expect(firstTable.body.ok).toBe(true);
    expect(firstUsage.stopCode).toBeNull(); expect(firstUsage.usageComplete).toBe(true);
    expect(firstUsage.realProviderCalls).toBeGreaterThan(0);
    expect(after.events.length).toBeGreaterThan(initial.events.length);
    expect(after.storyArchive.kind).toBe("available");
    if (after.storyArchive.kind !== "available") throw new Error("PROBE_STORY_ARCHIVE_UNAVAILABLE");
    expect(after.privateReceipts.length).toBeGreaterThan(initial.privateReceipts.length);
    expect(after.deliverySlots.length).toBeGreaterThan(0);
    expect(after.experiencedMessages.some(row => row.kind === "kp" && typeof row.body === "string" && row.body.trim().length > 0)).toBe(true);
    // Ground the assertion in actual existing NPC identities, not a fabricated
    // holder. Review the private snapshots to judge the specific knowledge.
    const changedNpcKnowledge = Object.entries(initial.state.entities).filter(([, entity]) => entity.kind === "npc")
      .filter(([id]) => canonicalHash(initial.state.knowledge[id] ?? null) !== canonicalHash(after.state.knowledge[id] ?? null))
      .map(([id]) => id);
    const storyDisposition = after.jobs.length === 0 ? "ordinary-response"
      : after.jobs.length === 1 && after.jobs[0].checkpoint?.status === "noStory" ? "no-story" : "story-created";
    if (storyDisposition === "story-created") {
      expect(after.jobs).toHaveLength(1); expect(after.jobs[0].checkpoint?.status).toBe("ready");
      expect(after.jobs[0].request.scale).toBe(selected.expectedScale);
      expect(after.jobs[0].request.connection).toBe(selected.expectedConnection);
      expect(after.library).toHaveLength(1); expect(after.storyArchive.snapshot.admissions.length).toBeGreaterThan(0);
      expect(changedNpcKnowledge.length, "No existing NPC acquired an admitted story fact").toBeGreaterThan(0);
    } else {
      // A legitimate ordinary response or noStory is not a failed story sample.
      // Preserve its evidence and leave the creative judgement to the reviewer.
      expect(after.library).toHaveLength(0); expect(after.storyArchive.snapshot.admissions).toHaveLength(0);
    }

    phase = "same-submission-retry";
    // The bridge refuses any attempted model call in this phase and marks the
    // batch failed. Zero actual calls alone would otherwise mask a bad retry.
    await bridge("/seal-retry", {});
    const retry = await historyHttpPost("sendAction", action, owner);
    await evidence("retry-action", { httpStatus: retry.response.status, body: retry.body });
    const retryTable = await historyHttpPost("fetchTable", source.code, owner);
    await evidence("retry-table", { httpStatus: retryTable.response.status, body: retryTable.body });
    const repeated = await authoritySnapshot(source);
    await evidence("retry-authority", repeated);
    const retryUsage = await bridge("/status");
    expect(retry.response.status).toBe(first.response.status);
    if (selected.caseId === "narration-recovery") {
      expect(retry.body.action).toBe("committed"); expect(retry.body.narration).toBe("published");
    } else expect(retry.body).toEqual(first.body);
    expect(retryUsage.stopCode).toBeNull(); expect(retryUsage.realProviderCalls).toBe(firstUsage.realProviderCalls);
    expect(retryUsage.calls).toEqual(firstUsage.calls);
    expect(repeated).toEqual(after);
    // Persisted slots include the actual Delivery frame; receipts, all world
    // resources, randomness and StoryStore accounts are in this exact equality.
    await evidence("acceptance", { status: storyDisposition === "story-created" || selected.caseId === "narration-recovery" ? "passed" : "needs-review",
      storyDisposition, caseId: selected.caseId, phase,
      mechanicalAction: admitted.body.action, narration: completed.body.narration,
      receipt: selected.caseId === "narration-recovery" ? null : httpRecord(first.body.outcome).receipt,
      faultInjection: selected.caseId === "narration-recovery" ? { syntheticFailures: 1,
        actualRecoveryCalls: recoveryCallCount, sameFrozenRequest: true, worldUntouchedUntilRecovery: true } : null,
      providerCalls: firstUsage.realProviderCalls, retryNewProviderCalls: 0,
      stateSha: canonicalHash(after.state), deliverySha: canonicalHash(after.deliverySlots),
      receiptSha: canonicalHash(after.privateReceipts), storyArchiveSha: after.storyArchive.snapshot.snapshotHash,
      changedNpcKnowledge, retryExactPrivateState: true,
      manualReviewRequired: "Assess story quality, world coherence, NPC knowledge provenance and the saved actual player presentation." });
  } catch (error) {
    await bridge("/stop", {});
    await evidence("failure", { phase, name: error instanceof Error ? error.name : "UnknownFailure",
      // Only the private artifact receives assertion detail. The CLI prints
      // counts and safe failure codes, never a request or response body.
      message: error instanceof Error ? error.message : "PROBE_HTTP_ACCEPTANCE_FAILED" });
    throw error;
  }
});
