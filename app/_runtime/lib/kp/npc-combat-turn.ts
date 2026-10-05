import { canonicalJson, isRecord, ModelOutputValidationError } from "./authoritative-helpers";
import {
  isNpcCombatTurnSteps,
  npcCombatTurnPlanIssues,
  NPC_COMBAT_SPEECH_MAX_CHARACTERS,
  NPC_COMBAT_TURN_MAX_STEPS,
  type NpcCombatTurnOptions,
  type NpcCombatTurnStep,
} from "../rules/authority-read";

/** SPEC 0006 §§6、7: the KP proposes an NPC's combat turn from
 * that NPC's own decision projection and the options Rules computed for it.
 * One call returns the whole turn; nothing here picks a target, a route or a
 * pass for the NPC. The plan is checked against the options it was offered;
 * Rules judges each step again when it takes it. */

export const NPC_COMBAT_TURN_TOOL_NAME = "plan_npc_combat_turn";

export type NpcCombatTurnRequest = {
  preparedActionId: string;
  rootActionId: string;
  options: NpcCombatTurnOptions;
  projection: unknown;
  /** A plan for this same turn stopped: what it did and why it stopped. */
  interruption?: { stoppedPlan: NpcCombatTurnStep[]; stoppedAtStep: number; reason: string };
  /** ADR 0117: what it saw and heard of this fight so far, most recent first. */
  fightSoFar?: { by?: string; to?: string[]; what: string }[];
  correction?: { issues: string[]; rejectedSteps: NpcCombatTurnStep[] | null };
};

export type NpcCombatTurnDecision = { kind: "npcCombatTurnDecision"; steps: NpcCombatTurnStep[] };

// SPEC 0006 §7 (ADR 0117): what each step does, never when to take it; the
// NPC decides from its own goals, character, wounds and fears.
const SYSTEM = "你只扮演这一个 NPC，在战斗中决定它这一整个回合做什么。只能依据 npcViewer 中它自己的目标、性格、知识、感官、位置、资源、伤势和恐惧，fightSoFar 里它在这场战斗中看到和听到的事（最新的在前），以及 options 列出的此刻可做之事来决定；不得假设它看不到或不知道的东西。它可以攻击、移动、使用资源、帮助同伴、预备、撤退、躲藏、说话、停手或转而动手，也可以误判或什么都不做。options.stance 写它正与谁交手、看见谁正与它交手、看见的其他参战者及各自能否再战。speak 说出口一句话，在场能听见的都听得到，不占动作；yield 不再与列出的对手交手（投降，或接受已停手者的投降），之后不再攻击他们；turnOn 开始与列出的参战者交手，须紧接 endTurn，之后按新的敌对关系再问它这一回合剩下的行动。options.abilities 里的 targets 只是它看得见且正与之交手的生物，inReachNow 只说明此刻够不够得着；先移动再攻击时，移动要先于攻击。看不见的敌人只能以地图上的一点作为攻击目标。按顺序写出这一回合的步骤，最后一步必须是 endTurn；保留反应就直接结束回合。有 interruption 时，本回合上一份计划在第 stoppedAtStep 步（从 0 数）停下，reason 是原因，它前面的步骤已经做了，这次只写本回合剩下的部分。correction若存在，是上一份尚未执行的计划及其不符合options的具体原因；修正列出的全部问题，不能把那份计划当作已发生。只调用给定工具一次。";

function object(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

const COORDINATE = { type: "string", pattern: "^-?(0|[1-9][0-9]{0,9})$" };
const POINT = { x: COORDINATE, y: COORDINATE };

function destinationSchema(options: NpcCombatTurnOptions): Record<string, unknown>[] {
  if (!options.movement.canMove) return [];
  const refs = options.movement.destinations.map(destination => destination.ref);
  return [
    ...(refs.length === 0 ? [] : [object({ kind: { const: "nextTo" }, ref: { type: "string", enum: refs } })]),
    ...(options.movement.pointAllowed ? [object({ kind: { const: "point" }, ...POINT })] : []),
  ];
}

function abilitySchemas(options: NpcCombatTurnOptions): Record<string, unknown>[] {
  return options.abilities.map(ability => {
    const targets = ability.targeting === "none" ? [object({ kind: { const: "none" } })]
      : ability.targeting === "point" ? [object({ kind: { const: "point" }, ...POINT })]
        : [...(ability.targets.length === 0 ? [] : [object({ kind: { const: "creature" },
          ref: { type: "string", enum: ability.targets.map(target => target.ref) } })]),
          ...(ability.aimAtPointAllowed ? [object({ kind: { const: "point" }, ...POINT })] : [])];
    return object({ kind: { const: "ability" }, abilityRef: { const: ability.abilityRef }, target: { anyOf: targets } });
  });
}

function stepSchema(options: NpcCombatTurnOptions): Record<string, unknown> {
  const destinations = destinationSchema(options);
  const abilities = abilitySchemas(options);
  const variants: Record<string, unknown>[] = [
    ...(destinations.length === 0 ? [] : [object({ kind: { const: "move" }, to: { anyOf: destinations } })]),
    ...abilities,
    ...(options.basicActions.length === 0 ? [] : [object({ kind: { const: "basic" }, action: { type: "string", enum: options.basicActions } })]),
    ...(options.help === null ? [] : [object({ kind: { const: "basic" }, action: { const: "help" },
      allyRef: { type: "string", enum: options.help.allyRefs },
      enemyRef: { anyOf: [{ type: "null" }, ...(options.help.enemyRefs.length === 0 ? [] : [{ type: "string", enum: options.help.enemyRefs }])] } })]),
    ...(options.ready === null ? [] : [object({ kind: { const: "ready" },
      trigger: object({ ref: { type: "string", enum: options.ready.triggerRefs }, event: { type: "string", enum: options.ready.events } }),
      response: { anyOf: [...(destinations.length === 0 ? [] : [object({ kind: { const: "move" }, to: { anyOf: destinations } })]),
        ...abilities] } })]),
    // ADR 0117: words, a yield and a turn on someone, from its own options.
    ...(options.speak ? [object({ kind: { const: "speak" }, words: { type: "string", minLength: 1, maxLength: NPC_COMBAT_SPEECH_MAX_CHARACTERS } })] : []),
    ...(options.stance.yieldRefs.length === 0 ? [] : [object({ kind: { const: "yield" },
      fromRefs: { type: "array", minItems: 1, items: { type: "string", enum: options.stance.yieldRefs } } })]),
    ...(options.stance.turnOnRefs.length === 0 ? [] : [object({ kind: { const: "turnOn" },
      targetRefs: { type: "array", minItems: 1, items: { type: "string", enum: options.stance.turnOnRefs } } })]),
    object({ kind: { const: "endTurn" } }),
  ];
  return { anyOf: variants };
}

function requestIsValid(request: NpcCombatTurnRequest): boolean {
  const projection = isRecord(request?.projection) ? request.projection : undefined;
  const viewer = isRecord(projection?.viewer) ? projection.viewer : undefined;
  return isRecord(request) && typeof request.preparedActionId === "string" && typeof request.rootActionId === "string"
    && isRecord(request.options) && request.options.schema === "zhuwei.npc-combat-turn-options/v1"
    && viewer?.kind === "npc" && viewer.subjectId === request.options.npcRef
    && (request.interruption === undefined || (isRecord(request.interruption)
      && isNpcCombatTurnSteps(request.interruption.stoppedPlan) && typeof request.interruption.reason === "string"))
    && (request.correction === undefined || (Array.isArray(request.correction.issues) && request.correction.issues.length > 0
      && request.correction.issues.every(issue => typeof issue === "string")
      && (request.correction.rejectedSteps === null || isNpcCombatTurnSteps(request.correction.rejectedSteps))))
    && (request.fightSoFar === undefined || (Array.isArray(request.fightSoFar)
      && request.fightSoFar.every(item => isRecord(item) && typeof item.what === "string")));
}

export function npcCombatTurnModelInput(request: NpcCombatTurnRequest): Record<string, unknown> {
  if (!requestIsValid(request)) throw new ModelOutputValidationError();
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: canonicalJson({ options: request.options, npcViewer: request.projection,
        fightSoFar: request.fightSoFar ?? [],
        ...(request.correction === undefined ? {} : { correction: request.correction }),
        ...(request.interruption === undefined ? {} : { interruption: request.interruption }) }) },
    ],
    tools: [{ type: "function", function: { name: NPC_COMBAT_TURN_TOOL_NAME,
      description: "写出这个 NPC 这一回合按顺序要做的步骤，以 endTurn 结束。",
      parameters: object({ steps: { type: "array", minItems: 1, maxItems: NPC_COMBAT_TURN_MAX_STEPS, items: stepSchema(request.options) } }) } }],
    tool_choice: "required", parallel_tool_calls: false, temperature: 0.3, max_completion_tokens: 1200,
  };
}

/** Diagnostics use only the NPC's offered options and its own uncommitted
 * response. No world/KP-only reason is copied into this correction. */
export function npcCombatTurnOutputIssues(value: unknown, request: NpcCombatTurnRequest): string[] {
  if (!isRecord(value) || Object.keys(value).join() !== "steps" || !isNpcCombatTurnSteps(value.steps))
    return ["response:one-steps-object-with-a-canonical-plan-ending-in-endTurn-required"];
  return npcCombatTurnPlanIssues(request.options, value.steps);
}
export function npcCombatTurnCorrection(value: unknown, request: NpcCombatTurnRequest): NonNullable<NpcCombatTurnRequest["correction"]> {
  return { issues: npcCombatTurnOutputIssues(value, request),
    rejectedSteps: isRecord(value) && isNpcCombatTurnSteps(value.steps) ? structuredClone(value.steps) : null };
}

/** The tool arguments must be exactly a plan that fits the offered options. */
export function validateNpcCombatTurnOutput(value: unknown, request: NpcCombatTurnRequest): NpcCombatTurnDecision {
  const issues = npcCombatTurnOutputIssues(value, request);
  if (issues.length) throw Object.assign(new ModelOutputValidationError(), { issues });
  return { kind: "npcCombatTurnDecision", steps: structuredClone((value as { steps: NpcCombatTurnStep[] }).steps) };
}
