import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../../../app/_runtime/lib/kp/authoritative-types";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";

// SPEC 0006 §7, SPEC 0012 §§3、13 (ADR 0118): Alice slips a coin into Lian's
// apron behind her back; Naes and Varo watch. Varo lets it go. Naes, from its
// own view, turns on Alice: its on-the-spot reaction starts a fight within the
// same action. Alice rolls her own initiative, the Room draws Naes's, and the
// opening is told with the act.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:npc-starts:alice", sessionVersion: 1 } };
const ACTOR = "character:npc-starts:alice", SCENE = "wake";
const LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo", NAES = "npc:black-oak-will:naes";
const result = (name: string, value: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
afterEach(() => vi.restoreAllMocks());

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "爱丽丝", sceneId: SCENE, level: 3, classId: "rogue", raceId: "human", subclassId: "thief",
        scores: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["sleight"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

function covertBundle() {
  const felt = (evidence: string) => ({ observerRef: ACTOR, subjectRef: LIAN, sense: "sight", evidence, basisRefs: [LIAN] });
  const branch = (code: string, summary: string) => ({ outcomeCode: code, summary, effects: [], sensoryEvidence: [felt(summary)], pressures: [], opportunities: [] });
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "sleight", dc: null, mode: "normal",
      risk: "莉安会发现有人碰了她的围裙。", successOutcome: "铜币悄悄落进围裙口袋。", failureOutcome: "莉安察觉有人碰了她的围裙。",
      concealment: { primaryObserverRef: LIAN, sense: "sight", evidence: "看见爱丽丝背过身，把什么东西塞进莉安的围裙口袋。", observers: [
        { observerRef: LIAN, attention: "distracted", basisRefs: [LIAN] },
        { observerRef: VARO, attention: "watching", basisRefs: [LIAN] },
        { observerRef: NAES, attention: "watching", basisRefs: [LIAN] }] } },
    proposals: [{ kind: "worldInteraction", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      intent: "不让莉安察觉，把一枚铜币塞进她的围裙口袋。", method: "背过身，借递汤的动作挡住手。",
      targetRefs: [LIAN], directTargetRefs: [LIAN], instrumentRefs: [], abilityRef: null,
      branches: { success: branch("coin-slipped", "铜币落进了莉安的围裙口袋。"), failure: branch("coin-noticed", "莉安低头看向自己的围裙。") } }] };
}

/** An NPC's own start: only its hostility, its first statistics from its
 * own stat line (hit points as the line says; armour class and speed as its
 * recorded loadout, if any). */
function ownStart(frame: Data, attacked = ACTOR) {
  const npc = String(frame.npcId);
  const entries = frame.requiredContext.entries as Data[];
  const anchor = entries.flatMap(entry => entry.value?.npcCombatAnchors ?? []).find((line: Data) => line.npcRef === npc);
  const loadout = entries.find(entry => entry.entryRef === npc)?.value?.entity?.loadout;
  return { decision: { kind: "startCombat",
    participants: [{ creatureRef: npc, surprise: { kind: "aware" } }, { creatureRef: attacked, surprise: { kind: "aware" } }],
    hostilities: [{ fromRefs: [npc], toRefs: [attacked] }],
    combatStatistics: [{ npcRef: npc, armorClass: loadout?.armorClass ?? 11, speedFeet: loadout?.speedFeet ?? 30,
      hitPointsMaximum: Number(/HP (\d+)/u.exec(String(anchor?.statistics))?.[1] ?? 8), deathPolicy: "deathSaves",
      attacks: [{ kind: "meleeAttack", label: "短棍", ability: "str", reachFeet: 5, damage: "1d6", damageType: "bludgeoning" }] }],
    description: attacked === ACTOR ? "那人从阴影里起身，抄起短棍朝爱丽丝背后扑来。" : "那人抄起短棍朝莉安扑去。" } };
}

/** The NPC asked first turns on Alice and waits for her initiative; the
 * other, asked after, declines. So the other's reaction always comes after
 * a reaction that waits on the player's roll. */
type Capture = { attacked?: string; preparations?: Data[]; frames: Data[]; sent: string[]; turns: number; narrations: Data[] };
function binding(c: Capture): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data;
    const names: string[] = request.tools.map((tool: Data) => tool.function.name);
    if (names[0] === "prepare_npc_combat_statistics") {
      const frame = JSON.parse(request.messages[1].content) as Data;
      (c.preparations ??= []).push(frame);
      return result(names[0], { combatStatistics: frame.targets.map((target: Data) => ({ npcRef: target.npcRef,
        armorClass: target.loadout?.armorClass ?? 11, speedFeet: target.loadout?.speedFeet ?? 30,
        hitPointsMaximum: 8, deathPolicy: "deathSaves", attacks: [{ kind: "meleeAttack", label: "切肉刀", ability: "str", reachFeet: 5, damage: "1d4", damageType: "slashing" }] })) });
    }
    if (names[0] === NPC_COMBAT_TURN_TOOL_NAME) {
      c.turns += 1;
      return result(NPC_COMBAT_TURN_TOOL_NAME, { steps: [{ kind: "basic", action: "dodge" }, { kind: "endTurn" }] });
    }
    expect(names).toEqual(["decline_npc_reaction", "submit_kp_proposal_bundle"]);
    const frame = sentBody(request) as Data;
    c.frames.push(structuredClone(frame));
    c.sent.push(JSON.stringify(request.messages));
    if (c.frames.length > 1) return result("decline_npc_reaction", { reason: "不想在守灵夜惹事。" });
    return result("submit_kp_proposal_bundle", ownStart(frame, c.attacked));
  } };
}

for (const npcTarget of [false, true]) it(npcTarget ? "an NPC attacks another NPC: Room privately prepares the missing target statistics and records the same one-sided decision"
  : "a bystander turns on the player in the same action, the player rolls initiative, and the other bystander still decides", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c: Capture = { frames: [], sent: [], turns: 0, narrations: [], ...(npcTarget ? { attacked: LIAN } : {}) };
  const stub = await initialize(`npc-starts-combat-room:${npcTarget}`);
  const run = await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    target.authorityRoll = () => 1;
    const scope = createVNextModelCallScope({ roomId: "npc-starts-combat-room", limit: "12", emit() {} });
    const transport = new ActorPlanTransportCapability(scope.bind(binding(c)));
    const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
      commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
      resumePlayerRandomness: (context: unknown, id: string) => target.resumePlayerRandomness(context, id, transport),
      observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
      publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
      deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
      beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
      failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    } as RoomAuthorityCapability;
    const narrationAdapter = { async narrate(request: Data) { c.narrations.push(structuredClone(request)); return { body: "已记录当前可见的行动。" }; },
      async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: scope.bind({ async run(_model, request) {
      const tool = (request as Data).tools[0].function.name;
      if (tool === "offer_kp_proposal_bundle") return result(tool, { requestedCapabilities: ["worldInteraction"] });
      return result(tool, encodeVNextStrictToolBundle(covertBundle() as never));
    } }) });
    const act = (input: RoomActionInput) => handleRoomAction({ principal: ALICE, authority, kp }, input) as Promise<Data>;
    const outcomes: Data[] = [await act({ kind: "intent", submissionId: "slip-coin", text: "趁莉安不注意，背过身把一枚铜币塞进她的围裙口袋" })];
    const rolled: Data[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const pending = ((await target.observe(ALICE)) as Data).pendingPlayerRolls ?? [];
      if (pending.length === 0) break;
      rolled.push({ kind: pending[0].kind, reason: pending[0].reason });
      outcomes.push(await act({ kind: "roll", submissionId: `slip-coin:roll:${attempt}`, randomnessId: String(pending[0].id) } as RoomActionInput));
    }
    // A longer NPC-only tail crosses the archive coalescing deadline. Wait
    // for that already-started waitUntil work before the Worker is torn down.
    await target.authorityArchiveFlight;
    await target.ctx.storage.deleteAlarm();
    const rows = (sql: string) => target.ctx.storage.sql.exec(sql).toArray() as Data[];
    return { outcomes, rolled, state: structuredClone(target.authoritativeReplay().state) as Data,
      events: structuredClone(target.authorityStore.events()) as Data[],
      prepared: Object.values(target.authoritativeReplay().state.campaignRuntime.npcReactions ?? {}).flatMap((reaction: any) => {
        const saved = target.vnextInvocation(reaction.childRootActionId, 4);
        return saved ? [{ ordinal: 4, status: saved.status }] : [];
      }),
      due: rows("SELECT child_root_action_id, work_kind, status FROM authority_due_work") };
  });
  const detail = JSON.stringify({ outcomes: run.outcomes.map(o => ({ kind: o.kind, code: o.code, due: o.dueOutcomes?.map((d: Data) => [d.kind, d.code]) })),
    rolled: run.rolled, turns: c.turns, frames: c.frames.map(f => f.npcId), due: run.due,
    events: run.events.map(e => `${e.eventType}:${String(e.rootActionId).slice(0, 40)}`) }).slice(0, 6000);
  expect(run.outcomes.at(-1)!.kind, detail).toBe("committed");
  const [starter, other] = c.frames.map(frame => String(frame.npcId));
  expect([starter, other].sort(), detail).toEqual([NAES, VARO].sort());
  // Alice rolled her sleight of hand, then her own initiative for the fight the NPC started.
  expect(run.rolled.map(entry => entry.kind), detail).toEqual(npcTarget ? ["check"] : ["check", "init"]);
  // The starter's own view carried its own stat line and no one else's.
  const anchors = c.frames[0].requiredContext.entries.flatMap((entry: Data) => entry.value?.npcCombatAnchors ?? []);
  expect(anchors.map((anchor: Data) => anchor.npcRef), detail).toEqual([starter]);
  expect(c.sent[0], detail).toMatch(/hostilities只写本人这一方/);
  const [encounter] = Object.values(run.state.combatRuntime.encounters) as Data[];
  expect([...encounter.participantEntityIds].sort(), detail).toEqual([npcTarget ? LIAN : ACTOR, starter].sort());
  expect(encounter.hostilities, detail).toEqual([{ fromEntityIds: [starter], toEntityIds: [npcTarget ? LIAN : ACTOR] }]);
  // The other bystander still decided within this action, after the roll.
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [starter]: "reacted", [other]: "declined" });
  if (!npcTarget) expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
  else {
    expect(c.preparations, detail).toHaveLength(1);
    expect(c.preparations![0].missingNpcRefs).toEqual([LIAN]);
    expect(run.state.combatRuntime.entities[LIAN].hitPoints.maximum).toBe("8");
    expect(run.prepared.filter(row => row.ordinal === 4 && row.status === "completed")).toHaveLength(1);
    expect(anchors.some((anchor: Data) => anchor.npcRef === LIAN)).toBe(false);
  }
  // The opening is told to Alice with the starter's description.
  const claims = c.narrations.flatMap(request => (request.renderableClaims?.claims ?? []) as Data[]);
  expect(claims.find(claim => claim.outcomeCode === "encounterStarted")?.summary, detail).toContain(npcTarget ? "朝莉安扑去" : "朝爱丽丝背后扑来");
}, 120_000);
