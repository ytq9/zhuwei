import {
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  createSubmitKpProposalBundleModelInput,
} from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { parseSubmitKpProposalBundleResponse } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";

/**
 * Behaviour probes for the halves of SPEC 0001's acceptance scenarios that no
 * deterministic fixture can settle.
 *
 * `tests/spec-0001-acceptance.test.mjs` gates the mechanical halves: what the
 * system enforces whatever the model says. The rest of each scenario is a
 * judgement -- whether a DC was honestly chosen, whether a roll was worth
 * asking for -- and a schema cannot police it. A probe therefore states a
 * situation whose correct handling is not in doubt and scores what the model
 * chose, which is the only way those halves become measurable at all.
 *
 * This is deliberately separate from `run-kp-v3-eval.mjs`. That suite measures
 * retrieval, routing and prompt size against a frozen 120-case fixture whose
 * count is itself a hard gate; behavioural acceptance is a different
 * measurement and does not belong inside it.
 *
 * A probe scores one bundle and returns why it failed, never a bare boolean:
 * a rubric that cannot say what went wrong is not evidence.
 */

const COMMON = [
  `只调用 ${SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME} 一次。`,
  "只使用题面给出的冻结引用。",
  "不得生成 rootActionId、角色 authority id、骰面、modifier、Receipt、事件或执行 DAG。",
].join("\n");

/**
 * Shape scaffolding, deliberately mode-agnostic.
 *
 * A judgement rubric has to hold the shape constant and vary only the
 * decision, or it scores the model's ability to fill a schema instead of its
 * ruling. Every field is spelled out for both routes; which route to take is
 * the one thing left unsaid, because that is the thing being measured.
 */
const SHAPE = `两条路径都写清楚了，你只需要自己判断走哪一条：

若你判断这个做法在当前事实下【可行】：
  mode=adjudication、terminal 填 {kind:"none"}、bundle basisRefs 列出你依据的冻结引用。
  proposals 恰好一项 worldInteraction：outcomeBinding=always、basisRefs 与 consumes/produces 为空数组、
  sceneRef=scene:hall、targetRefs 与 directTargetRefs 填你作用的那个冻结引用、instrumentRefs=[]、abilityRef="none"、
  intent 与 method 各一句复述玩家的做法；branches.success 填 outcomeCode、summary，
  effects/sensoryEvidence/pressures/opportunities 均为空数组。
  adjudication 由你选择：
    - 若这次不需要掷骰：用 directSuccess，填 risk 与 successOutcome，branches.failure 填 {kind:"none"}。
    - 若这次确实需要掷骰：用 check，填 checkKind=abilityCheck、ability、skill="none"、dc、mode=normal、
      risk、successOutcome、failureOutcome，并把 branches.failure 也填成真实分支。

若你判断这个做法在当前事实下【不可行】：
  mode=terminal、adjudication 填 {kind:"none"}、proposals 为空数组、bundle basisRefs 列出你依据的冻结引用。
  terminal 用 inWorldRefusal：intent 与 method 复述玩家做法，
  ruling.kind 用 missingPrerequisite 或 worldLawViolation，publicBasis 一句说明为什么不可行，
  prerequisites 至少一条（没有对应冻结引用时 ref 精确填 "none"），nextActions 至少一条，attemptCosts 为空数组。`;

function scene(extra) {
  return `${COMMON}

场景：scene:hall 是一间昏暗的大厅。冻结引用只有 scene:hall、feature:hall:stone-door、feature:hall:wooden-door、character:alice。
feature:hall:stone-door 是一扇嵌在整块承重墙里的石门，没有缝隙、没有把手、没有可撬处。
feature:hall:wooden-door 是一扇普通木门，没有上锁，没有任何机关或危险。
角色 character:alice 徒手，没有工具。

${extra}

${SHAPE}`;
}

/** Scenario B: an action the frozen facts make impossible. */
const IMPOSSIBLE_PROMPT = scene(
  `玩家说：“我徒手把那扇石门整个拆下来。”`,
);

/** Scenario H: an action with no risk and nothing to resolve. */
const TRIVIAL_PROMPT = scene(
  `玩家说：“我推开那扇没上锁的木门走过去。”`,
);

function rulingOf(bundle) {
  if (bundle.mode === "terminal") return bundle.terminal?.kind ?? "unknownTerminal";
  return bundle.adjudication?.kind ?? "unknownAdjudication";
}

export const SPEC_0001_BEHAVIOUR_PROBES = Object.freeze([
  Object.freeze({
    probeId: "B-impossible-is-refused-not-priced",
    scenario: "B",
    demand: "不可行的行动要明说不可行，不得用一个够不到的 DC 代替说明",
    prompt: IMPOSSIBLE_PROMPT,
    score(bundle) {
      const ruling = rulingOf(bundle);
      if (ruling === "inWorldRefusal") {
        const { prerequisites = [], nextActions = [] } = bundle.terminal.ruling;
        if (prerequisites.length === 0 || nextActions.length === 0) {
          return { pass: false, reason: "拒绝了，但没有说明缺什么或可以怎么改走" };
        }
        return { pass: true, reason: null };
      }
      if (ruling === "check") {
        // This is the failure the scenario names: pricing an impossible action
        // as an expensive one instead of saying it cannot be done.
        return { pass: false, reason: `用 DC ${bundle.adjudication.dc} 的检定代替了说明不可行` };
      }
      return { pass: false, reason: `既没有拒绝也没有检定，而是 ${ruling}` };
    },
  }),
  Object.freeze({
    probeId: "H-trivial-needs-no-roll",
    scenario: "H",
    demand: "普通无风险动作直接成功并推进，不要求掷骰",
    prompt: TRIVIAL_PROMPT,
    score(bundle) {
      const ruling = rulingOf(bundle);
      if (ruling === "directSuccess") return { pass: true, reason: null };
      if (ruling === "check") {
        return { pass: false, reason: `为一个无风险动作要了 DC ${bundle.adjudication.dc} 的检定` };
      }
      if (ruling === "inWorldRefusal") {
        return { pass: false, reason: "拒绝了一个既可行又无风险的动作" };
      }
      return { pass: false, reason: `既没有直接成功也没有检定，而是 ${ruling}` };
    },
  }),
]);

/**
 * Runs the probes against an `invoke(modelInput)` the caller supplies, so the
 * same rubric scores a live provider and a recorded fixture without changing.
 */
export async function runSpec0001BehaviourProbes({ invoke, probes = SPEC_0001_BEHAVIOUR_PROBES }) {
  const results = [];
  for (const probe of probes) {
    const modelInput = createSubmitKpProposalBundleModelInput(probe.prompt);
    let outcome;
    try {
      const bundle = parseSubmitKpProposalBundleResponse(await invoke(modelInput));
      outcome = probe.score(bundle);
      outcome = { ...outcome, ruling: rulingOf(bundle) };
    } catch (error) {
      // A draft the parser rejects is a failure of this probe too: an
      // unparseable answer is not a judgement the scenario can be scored on.
      outcome = {
        pass: false,
        reason: `输出未通过解析或校验：${error instanceof Error ? error.message : String(error)}`,
        ruling: null,
      };
    }
    results.push(Object.freeze({
      probeId: probe.probeId,
      scenario: probe.scenario,
      demand: probe.demand,
      ...outcome,
    }));
  }
  const passed = results.filter((entry) => entry.pass).length;
  return Object.freeze({
    schemaVersion: "zhuwei.spec-0001-behaviour-probe-report/v1",
    probeCount: results.length,
    passed,
    failed: results.length - passed,
    scenarios: Object.freeze([...new Set(results.map((entry) => entry.scenario))].sort()),
    results: Object.freeze(results),
  });
}
