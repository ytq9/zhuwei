import { canonicalJson, isRecord, ModelOutputValidationError } from "./authoritative-helpers";
import {
  isNpcCombatTurnSteps,
  npcCombatTurnPlanIssues,
  NPC_COMBAT_TURN_MAX_STEPS,
  type NpcCombatTurnOptions,
  type NpcCombatTurnStep,
} from "../rules/authority-read";

/** SPEC 0002 §17, SPEC 0006 §104: the KP proposes an NPC's combat turn from
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
};

export type NpcCombatTurnDecision = { kind: "npcCombatTurnDecision"; steps: NpcCombatTurnStep[] };

const SYSTEM = "你只扮演这一个 NPC，在战斗中决定它这一整个回合做什么。只能依据 npcViewer 中它自己的目标、性格、知识、感官、位置、资源、伤势和恐惧，以及 options 列出的此刻可做之事来决定；不得假设它看不到或不知道的东西。它可以攻击、移动、使用资源、帮助同伴、预备、撤退、躲藏，也可以误判或什么都不做。options.abilities 里的 targets 只是它看得见的生物，inReachNow 只说明此刻够不够得着；先移动再攻击时，移动要先于攻击。看不见的敌人只能以地图上的一点作为攻击目标。按顺序写出这一回合的步骤，最后一步必须是 endTurn；保留反应就直接结束回合。只调用给定工具一次。";

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
      && isNpcCombatTurnSteps(request.interruption.stoppedPlan) && typeof request.interruption.reason === "string"));
}

export function npcCombatTurnModelInput(request: NpcCombatTurnRequest): Record<string, unknown> {
  if (!requestIsValid(request)) throw new ModelOutputValidationError();
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: canonicalJson({ options: request.options, npcViewer: request.projection,
        ...(request.interruption === undefined ? {} : { interruption: request.interruption }) }) },
    ],
    tools: [{ type: "function", function: { name: NPC_COMBAT_TURN_TOOL_NAME,
      description: "写出这个 NPC 这一回合按顺序要做的步骤，以 endTurn 结束。",
      parameters: object({ steps: { type: "array", minItems: 1, maxItems: NPC_COMBAT_TURN_MAX_STEPS, items: stepSchema(request.options) } }) } }],
    tool_choice: "required", parallel_tool_calls: false, temperature: 0.3, max_completion_tokens: 1200,
  };
}

/** The tool arguments must be exactly a plan that fits the offered options. */
export function validateNpcCombatTurnOutput(value: unknown, request: NpcCombatTurnRequest): NpcCombatTurnDecision {
  if (!isRecord(value) || Object.keys(value).join() !== "steps" || !isNpcCombatTurnSteps(value.steps)
    || npcCombatTurnPlanIssues(request.options, value.steps).length > 0) throw new ModelOutputValidationError();
  return { kind: "npcCombatTurnDecision", steps: structuredClone(value.steps) };
}
