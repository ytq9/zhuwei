import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SOURCE as SOURCE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA as TRANSPORT_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { expandDeepSeekSchema } from "./fixtures/expand-deepseek-schema.mjs";
const SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA = expandDeepSeekSchema(TRANSPORT_SCHEMA);
import { parseSubmitKpProposalBundleCandidateArguments, VNextProposalBundleOutputError } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { repairableVNextProposalBundlePaths } from "../app/_runtime/lib/kp/vnext/proposal-correction.ts";
import { selectPlanReadSet } from "../app/_runtime/lib/kp/vnext/proposals.ts";

const none = () => ({ kind: "none" });
function branch() {
  return { outcomeCode: "outcome:observed", summary: "完成观察。", effects: [],
    sensoryEvidence: [{ observerRef: ACTOR, subjectRef: none(), sense: "sight", evidence: "看到了当前位置。", basisRefs: [SCENE] }],
    pressures: [{ description: "时间正在经过。", sourceRef: none(), basisRefs: [SCENE] }],
    opportunities: [{ description: "可以继续观察。", targetRef: none(), actionHint: "none", basisRefs: [SCENE] }] };
}
function observation() {
  return { mode: "adjudication", basisRefs: [SOURCE], adjudication: {
    kind: "directSuccess", durationMicros: "6000000", risk: "没有显著风险。", successOutcome: "可以直接观察。",
  }, terminal: none(), proposals: [{ kind: "worldInteraction", basisRefs: [SOURCE], consumes: [], produces: [],
    outcomeBinding: "always", sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [],
    abilityRef: none(), intent: "观察现有对象。", method: "靠近观察。", branches: { success: branch(), failure: none() } }] };
}
function check() {
  const value = observation();
  value.adjudication = { kind: "check", durationMicros: "6000000", checkKind: "abilityCheck", ability: "str", skill: none(), dc: 12, mode: "normal",
    risk: "操作有失败的可能。", successOutcome: "操作成功。", failureOutcome: "操作失败。" };
  value.proposals[0].branches.failure = branch();
  return value;
}
function refusal() {
  return { mode: "terminal", basisRefs: [SOURCE], adjudication: none(), proposals: [], terminal: {
    kind: "inWorldRefusal", intent: "实施当前无法完成的动作。", method: "尝试徒手处理。", ruling: {
      kind: "missingPrerequisite", publicBasis: "尚缺必要工具。",
      prerequisites: [{ kind: "tool", ref: none(), description: "需要合适工具。" }],
      nextActions: [{ description: "寻找工具。", basisRefs: [SCENE] }], attemptCosts: [],
    },
  } };
}
function parse(value) { return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(value))); }
function at(value, path) { return path.reduce((current, key) => current[key], value); }
const nullableCases = [
  { make: observation, path: ["proposals", 0, "abilityRef"] },
  { make: observation, path: ["proposals", 0, "branches", "success", "sensoryEvidence", 0, "subjectRef"] },
  { make: observation, path: ["proposals", 0, "branches", "success", "pressures", 0, "sourceRef"] },
  { make: observation, path: ["proposals", 0, "branches", "success", "opportunities", 0, "targetRef"] },
  { make: check, path: ["adjudication", "skill"] },
  { make: refusal, path: ["terminal", "ruling", "prerequisites", 0, "ref"] },
];

test("explicit none references use the supported strict dialect and the existing candidate decoder", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(TRANSPORT_SCHEMA), []);
  for (const { make, path } of nullableCases) {
    const value = make();
    const result = parse(value);
    assert.equal(result.kind, "accepted", JSON.stringify(result));
    assert.equal(at(result.bundle, path), null);
    const oldWire = make();
    at(oldWire, path.slice(0, -1))[path.at(-1)] = "none";
    const legacy = parse(oldWire);
    assert.equal(legacy.kind, "accepted");
    assert.deepEqual(legacy.bundle, result.bundle, "wire representations share one unchanged domain meaning");
  }
});

test("nonempty references survive decoding while empty and omitted references never become none", () => {
  for (const { make, path } of nullableCases) {
    const real = make();
    const ref = path.at(-1) === "skill" ? "athletics" : path.at(-1) === "abilityRef" ? "ability:existing" : SOURCE;
    at(real, path.slice(0, -1))[path.at(-1)] = ref;
    const accepted = parse(real);
    assert.equal(accepted.kind, "accepted", JSON.stringify(accepted));
    assert.equal(at(accepted.bundle, path), ref);
    for (const omitted of [false, true]) {
      const value = make();
      const parent = at(value, path.slice(0, -1));
      if (omitted) delete parent[path.at(-1)];
      else parent[path.at(-1)] = "";
      const rejected = parse(value);
      assert.equal(rejected.kind, "locallyRejected", JSON.stringify({ path, omitted, rejected }));
      assert.deepEqual(repairableVNextProposalBundlePaths(rejected.draft), []);
    }
  }
});

test("availability wrapper IDs remain unreadable while their real supporting authority references are usable", () => {
  const fixture = createAuthoredProbeFixture("nullable-wire-basis");
  const context = fixture.requiredContext;
  const permission = context.entries.find((entry) => entry.kind === "openBlank");
  assert.ok(permission);
  const rejected = selectPlanReadSet(context, [permission.entryRef]);
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.code, "CONTEXT_INSUFFICIENT");
  assert.ok(rejected.issues.some((issue) => issue.includes("dependency-not-read-bound")));
  assert.equal(selectPlanReadSet(context, [...permission.basisRefs, permission.authorizationRef,
    "continuity:adjudicationPrecedents"]).kind, "accepted");
});

test("malformed provider JSON remains a first-pass failure with no implicit punctuation repair", () => {
  const valid = JSON.stringify(encodeVNextStrictToolBundle(observation()));
  const missingRootClose = parseSubmitKpProposalBundleCandidateArguments(valid.slice(0, -1));
  assert.equal(missingRootClose.kind, "locallyRejected");
  assert.equal(missingRootClose.validationCode, "PROPOSAL_JSON_INVALID");
  assert.equal(missingRootClose.syntaxEvidence.originalArguments, valid.slice(0, -1),
    "complete frozen semantics can request explicit narrow correction, never implicit acceptance");
  assert.throws(() => parseSubmitKpProposalBundleCandidateArguments(valid + "}"), VNextProposalBundleOutputError);
});
