import assert from "node:assert/strict";
import test from "node:test";

import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";
import {
  applyVNextProposalBundleCorrection,
  repairableVNextProposalBundlePaths,
} from "../app/_runtime/lib/kp/vnext/proposal-correction.ts";
import { deriveVNextProposalBundlePlan } from "../app/_runtime/lib/kp/vnext/proposal-graph.ts";
import {
  VNextProposalBundleOutputError,
  invokeCorrectKpProposalBundle,
  invokeSubmitKpProposalBundle,
  invokeSubmitKpProposalBundleFirstPass,
  invokeSubmitKpProposalBundleWithOneCorrection,
  parseCorrectKpProposalBundleResponse,
  parseSubmitKpProposalBundleResponse,
} from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import {
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
  decodeVNextStrictToolBundle,
} from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { validateVNextProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator.ts";
import {
  composeDefinition,
  createDefinitionSnapshot,
  normalizedProspectiveRef,
} from "../app/_runtime/lib/rules/authority-read.ts";
import {
  runDeepSeekStrictToolHandshake,
} from "../tools/run-deepseek-strict-tool-handshake.mjs";
import { strictToolHandshakeDefinition } from "../tools/deepseek-vnext2-strict-tool-handshake-definition.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
const CONTEXT_HASH = `sha256:${"c".repeat(64)}`;

function successBranch(overrides = {}) {
  return {
    outcomeCode: overrides.outcomeCode ?? "outcome:inspected",
    summary: overrides.summary ?? "检查完成。",
    effects: [],
    sensoryEvidence: [],
    pressures: [],
    opportunities: [],
  };
}

function worldInteractionArguments() {
  return {
    mode: "adjudication",
    basisRefs: [],
    adjudication: {
      kind: "directSuccess",
      risk: "没有显著风险。",
      successOutcome: "能够检查目标。",
    },
    terminal: { kind: "none" },
    proposals: [{
      kind: "worldInteraction",
      basisRefs: [],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      sceneRef: "scene:atrium",
      targetRefs: ["sceneFeature:chain"],
      directTargetRefs: ["sceneFeature:chain"],
      instrumentRefs: [],
      abilityRef: "none",
      intent: "检查链条。",
      method: "靠近观察。",
      branches: {
        success: successBranch(),
        failure: { kind: "none" },
      },
    }],
  };
}

function materializeThenInteractArguments() {
  const handle = "prospective:alcove";
  const value = worldInteractionArguments();
  value.proposals = [{
    kind: "materializeObject",
    basisRefs: [],
    consumes: [],
    produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }],
    outcomeBinding: "always",
    semanticKind: "sceneFeature",
    templateRef: "template:scene-feature",
    templateHash: HASH,
    visibilityPolicyRef: "visibility:scene-observers",
    definition: {
      sceneRef: "scene:atrium",
      visibilityFactId: "none",
      label: "浅壁龛",
      description: "墙面上刚显露的浅壁龛。",
      observableState: "open",
      affordances: ["inspect"],
      mechanicDefinitionRefs: [],
    },
    summary: "壁龛已成为可引用的场景对象。",
  }, {
    ...value.proposals[0],
    consumes: [{ kind: "prospective", handle }],
    sceneRef: "scene:atrium",
    targetRefs: [handle],
    directTargetRefs: [handle],
    intent: "检查新出现的壁龛。",
    method: "靠近观察。",
  }];
  return value;
}

/** The wire form of a shared ability check: one roll, one interaction that
 * owns it, and a materialization that happens on success alone. `skill` and
 * `abilityRef` ride the `none` sentinel the transport uses for nullable
 * values. */
function sharedCheckArguments() {
  const handle = "prospective:cache";
  return {
    mode: "adjudication",
    basisRefs: [],
    adjudication: {
      kind: "check",
      checkKind: "abilityCheck",
      ability: "str",
      skill: "none",
      dc: 13,
      mode: "normal",
      risk: "石板卡得很紧，撬得开撬不开都有可能。",
      successOutcome: "石板被撬开。",
      failureOutcome: "石板纹丝不动。",
    },
    terminal: { kind: "none" },
    proposals: [{
      kind: "worldInteraction",
      basisRefs: [],
      consumes: [],
      produces: [],
      outcomeBinding: "always",
      sceneRef: "scene:atrium",
      targetRefs: ["sceneFeature:chain"],
      directTargetRefs: ["sceneFeature:chain"],
      instrumentRefs: [],
      abilityRef: "none",
      intent: "撬开压住链条的石板。",
      method: "双手扣住石板边缘发力。",
      branches: {
        success: successBranch({ outcomeCode: "outcome:slab-pried", summary: "石板被撬开。" }),
        failure: successBranch({ outcomeCode: "outcome:slab-stuck", summary: "石板纹丝不动。" }),
      },
    }, {
      kind: "materializeObject",
      basisRefs: [],
      consumes: [],
      produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "onSuccess" }],
      outcomeBinding: "onSuccess",
      semanticKind: "sceneFeature",
      templateRef: "template:scene-feature",
      templateHash: HASH,
      visibilityPolicyRef: "visibility:scene-observers",
      definition: {
        sceneRef: "scene:atrium",
        visibilityFactId: "none",
        label: "石板后的暗格",
        description: "石板被撬开后露出的浅暗格。",
        observableState: "open",
        affordances: ["inspect"],
        mechanicDefinitionRefs: [],
      },
      summary: "石板被撬开后固化出它后面的暗格。",
    }],
  };
}

/** The wire form of an in-world refusal: a terminal bundle whose shape has
 * nowhere to put a DC, which is how SPEC 0001 scenario B's "no fake high DC"
 * stops being a rule someone has to remember. */
function inWorldRefusalArguments() {
  return {
    mode: "terminal",
    basisRefs: ["scene:atrium", "sceneFeature:chain"],
    adjudication: { kind: "none" },
    terminal: {
      kind: "inWorldRefusal",
      intent: "徒手把整扇石门拆下来",
      method: "双手抠住门缘向外硬掰",
      ruling: {
        kind: "missingPrerequisite",
        publicBasis: "石门嵌在整块承重墙里，没有缝隙也没有着力点。",
        prerequisites: [
          { kind: "tool", ref: "none", description: "需要能卡进石缝的撬棍一类工具。" },
        ],
        nextActions: [
          { description: "在场景里找一件能当撬棍的硬物。", basisRefs: ["scene:atrium"] },
        ],
        attemptCosts: [],
      },
    },
    proposals: [],
  };
}

function clarificationArguments() {
  const continuation = materializeThenInteractArguments();
  const executable = {
    kind: "adjudication",
    basisRefs: [],
    adjudication: continuation.adjudication,
    proposals: continuation.proposals,
  };
  return {
    mode: "terminal",
    basisRefs: [],
    adjudication: { kind: "none" },
    terminal: {
      kind: "clarification",
      intent: "检查墙边结构。",
      method: "靠近并观察。",
      question: "你准备先检查左侧还是右侧壁龛？",
      choices: [{
        choiceId: "inspect-left",
        label: "检查左侧",
        publicRisk: "需要靠近左侧墙面。",
        basisRefs: [],
        continuation: structuredClone(executable),
      }, {
        choiceId: "inspect-right",
        label: "检查右侧",
        publicRisk: "需要靠近右侧墙面。",
        basisRefs: [],
        continuation: structuredClone(executable),
      }, {
        choiceId: "cancel",
        label: "暂不检查",
        publicRisk: "不改变当前世界状态。",
        basisRefs: [],
        continuation: { kind: "cancel" },
      }],
    },
    proposals: [],
  };
}

function namedToolResponse(name, argumentsValue) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(argumentsValue),
          },
        }],
      },
    }],
  };
}

function rawNamedToolResponse(name, rawArguments) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: { name, arguments: rawArguments },
        }],
      },
    }],
  };
}

function toolResponse(argumentsValue) {
  return namedToolResponse(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, argumentsValue);
}

test("vNext-2 uses one locally valid DeepSeek strict tool schema", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const input = createSubmitKpProposalBundleModelInput("提交冻结上下文中的裁决。");
  assert.equal(input.tools.length, 1);
  assert.equal(input.tools[0].function.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  assert.equal(input.tools[0].function.strict, true);
  assert.equal(input.tool_choice, "required");
  assert.equal(input.parallel_tool_calls, false);
  assert.equal(input.max_completion_tokens, 4_000);
  const worldInteractionSchema = SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA
    .properties.proposals.items.anyOf
    .find((entry) => entry.properties.kind.enum[0] === "worldInteraction");
  // `abilityRef` is a nullable reference now, not a pinned sentinel: an
  // attack needs a real Ability and a bare ability check needs none. The
  // pairing spans the Bundle's adjudication and the entry, so it is enforced
  // by the domain rather than by the shape.
  assert.equal(worldInteractionSchema.properties.abilityRef.enum, undefined);
  assert.equal(worldInteractionSchema.properties.abilityRef.pattern, "^\\S+$");
  // Materialization is a union of the legal (semanticKind, visibility,
  // visibilityFactId) combinations, so a single branch no longer describes the
  // surface; the combination table is asserted in its own test below.
  assert.equal(worldInteractionSchema.properties.intent.pattern, "[\\s\\S]+");
  // A consume is a union: a bundle-local handle or a frozen authority ref,
  // and neither branch can carry the other's field.
  assert.deepEqual(
    worldInteractionSchema.properties.consumes.items.anyOf
      .map((branch) => branch.properties.kind.enum[0]),
    ["prospective", "existing"],
  );
  assert.deepEqual(
    worldInteractionSchema.properties.consumes.items.anyOf
      .map((branch) => Object.keys(branch.properties).sort()),
    [["handle", "kind"], ["kind", "ref"]],
  );
  // Every materialization branch is closed the same way, whichever
  // combination it encodes: one semantic kind, and a produced handle bound to
  // the entry's own outcome.
  for (const entry of SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.proposals.items.anyOf
    .filter((branch) => branch.properties.kind.enum[0] === "materializeObject")) {
    assert.equal(entry.properties.semanticKind.enum.length, 1);
    assert.equal(entry.additionalProperties, false);
    assert.equal(entry.properties.produces.items.properties.kind.enum[0], "semanticDefinition");
  }
  const correctionInput = createCorrectKpProposalBundleModelInput("只修正允许的摘要。");
  assert.equal(correctionInput.tools.length, 1);
  assert.equal(
    correctionInput.tools[0].function.name,
    CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  );
  assert.equal(correctionInput.tools[0].function.strict, true);
});

test("strict parser injects the vNext-2 envelope and decodes none sentinels", () => {
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(worldInteractionArguments()));
  assert.equal(bundle.schema, VNEXT2_PROPOSAL_BUNDLE_SCHEMA);
  assert.equal(bundle.kind, "proposalBundle");
  assert.equal(bundle.mode, "adjudication");
  assert.equal(bundle.terminal, null);
  assert.equal(bundle.proposals[0].abilityRef, null);
  assert.equal(bundle.proposals[0].branches.failure, null);
  assert.equal(Object.isFrozen(bundle), true);
});

test("materialize then interact derives one canonical prospective dependency", () => {
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(materializeThenInteractArguments()));
  const graph = deriveVNextProposalBundlePlan({
    bundle,
    rootActionId: "root:bundle-v2",
    actorCharacterId: "character:alice",
    contextHash: CONTEXT_HASH,
    readSet: [],
  });
  assert.equal(graph.kind, "accepted", JSON.stringify(graph));
  assert.deepEqual(graph.plan.executionOrder, graph.plan.entries.map(({ entryRef }) => entryRef));
  assert.equal(graph.plan.entries[1].consumes[0].kind, "prospective");
  assert.equal("ref" in graph.plan.entries[1].consumes[0], false);
  assert.equal(
    graph.plan.entries[0].produces[0].prospectiveRef,
    normalizedProspectiveRef("root:bundle-v2", graph.plan.bundleHash, "prospective:alcove"),
  );
});

test("clarification freezes complete nonrecursive continuations in the first Bundle", () => {
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(clarificationArguments()));
  assert.equal(bundle.mode, "terminal");
  assert.equal(bundle.terminal.kind, "clarification");
  assert.equal(bundle.terminal.choices[0].continuation.kind, "adjudication");
  assert.equal(bundle.terminal.choices[0].continuation.proposals[0].definition.sceneRef, "scene:atrium");
  assert.equal(bundle.terminal.choices[2].continuation.kind, "cancel");

  const invalidSibling = clarificationArguments();
  invalidSibling.terminal.choices[1].continuation.proposals[1].targetRefs = ["none"];
  invalidSibling.terminal.choices[1].continuation.proposals[1].directTargetRefs = ["none"];
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(invalidSibling)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );

  const recursive = clarificationArguments();
  recursive.terminal.choices[0].continuation.proposals = [{
    kind: "clarification",
    choices: [],
  }];
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(recursive)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );
});

test("clarification proposal budget is global and high risk binds its public risk", () => {
  const overBudget = clarificationArguments();
  const operation = structuredClone(worldInteractionArguments().proposals[0]);
  overBudget.terminal.choices = Array.from({ length: 6 }, (_, choiceIndex) => ({
    choiceId: `choice-${choiceIndex}`,
    label: `选择 ${choiceIndex}`,
    publicRisk: "没有显著风险。",
    basisRefs: [],
    continuation: {
      kind: "adjudication",
      basisRefs: [],
      adjudication: structuredClone(worldInteractionArguments().adjudication),
      proposals: [structuredClone(operation), structuredClone(operation), structuredClone(operation)],
    },
  }));
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(overBudget)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );

  const mismatchedRisk = clarificationArguments();
  const continuation = mismatchedRisk.terminal.choices[0].continuation;
  continuation.adjudication = {
    kind: "highRisk",
    risk: "绳索断裂会坠落。",
    confirmationQuestion: "确认冒险继续吗？",
    successOutcome: "抵达壁龛。",
    failureOutcome: "从墙边坠落。",
    check: {
      checkKind: "none",
      ability: "none",
      skill: "none",
      dc: 0,
      mode: "normal",
    },
    acceptedCosts: [],
  };
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(mismatchedRisk)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );
  mismatchedRisk.terminal.choices[0].publicRisk = "绳索断裂会坠落。";
  assert.equal(
    parseSubmitKpProposalBundleResponse(toolResponse(mismatchedRisk)).mode,
    "terminal",
  );
});

test("clarification choice scope prevents identical frozen branches from sharing refs", () => {
  const terminalBundle = parseSubmitKpProposalBundleResponse(toolResponse(clarificationArguments()));
  const executableChoices = terminalBundle.terminal.choices.slice(0, 2);
  const plans = executableChoices.map((choice) => {
    const continuation = choice.continuation;
    assert.equal(continuation.kind, "adjudication");
    return deriveVNextProposalBundlePlan({
      bundle: {
        schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
        kind: "proposalBundle",
        mode: "adjudication",
        basisRefs: [...terminalBundle.basisRefs, ...choice.basisRefs, ...continuation.basisRefs],
        adjudication: continuation.adjudication,
        terminal: null,
        proposals: continuation.proposals,
      },
      rootActionId: "root:clarification-v2",
      actorCharacterId: "character:alice",
      contextHash: CONTEXT_HASH,
      readSet: [],
      derivationScope: `${canonicalHash(terminalBundle)}:${choice.choiceId}`,
    });
  });
  assert.ok(plans.every((plan) => plan.kind === "accepted"), JSON.stringify(plans));
  assert.notEqual(plans[0].plan.referenceNamespaceHash, plans[1].plan.referenceNamespaceHash);
  assert.notEqual(plans[0].plan.entries[0].entryRef, plans[1].plan.entries[0].entryRef);
  assert.notEqual(
    plans[0].plan.entries[0].produces[0].prospectiveRef,
    plans[1].plan.entries[0].produces[0].prospectiveRef,
  );
});

test("shared check structurally dominates outcome-bound entries", () => {
  const argumentsValue = materializeThenInteractArguments();
  argumentsValue.adjudication = {
    kind: "check",
    checkKind: "abilityCheck",
    ability: "wis",
    skill: "none",
    dc: 12,
    mode: "normal",
    risk: "可能没有发现细节。",
    successOutcome: "发现细节。",
    failureOutcome: "暂时没有发现。",
  };
  argumentsValue.proposals[1].branches.failure = successBranch({
    outcomeCode: "outcome:not-found",
    summary: "暂时没有发现细节。",
  });
  argumentsValue.proposals.push({
    ...structuredClone(argumentsValue.proposals[0]),
    outcomeBinding: "onFailure",
    produces: [{
      handle: "prospective:failure-trace",
      kind: "semanticDefinition",
      outcomeBinding: "onFailure",
    }],
    definition: {
      ...structuredClone(argumentsValue.proposals[0].definition),
      label: "失败痕迹",
    },
    summary: "失败分支痕迹。",
  });
  const decoded = decodeVNextStrictToolBundle(argumentsValue);
  const validation = validateVNextProposalBundle({
    ...decoded,
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
  });
  assert.equal(validation.kind, "accepted", JSON.stringify(validation));
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(argumentsValue));
  const graph = deriveVNextProposalBundlePlan({
    bundle,
    rootActionId: "root:checked-bundle-v2",
    actorCharacterId: "character:alice",
    contextHash: CONTEXT_HASH,
    readSet: [],
  });
  assert.equal(graph.kind, "accepted", JSON.stringify(graph));
  assert.equal(graph.plan.sharedCheckEntryRef, graph.plan.entries[1].entryRef);
  assert.ok(graph.plan.executionOrder.indexOf(graph.plan.entries[1].entryRef)
    < graph.plan.executionOrder.indexOf(graph.plan.entries[2].entryRef));
});

test("strict parser rejects text fallback, wrong/multiple tools, malformed JSON, and model envelope fields", () => {
  const prototypeKey = worldInteractionArguments();
  Object.defineProperty(prototypeKey, "__proto__", {
    enumerable: true,
    value: { polluted: true },
  });
  const invalidResponses = [
    { choices: [{ message: { content: JSON.stringify(worldInteractionArguments()) } }] },
    {
      choices: [{ message: { tool_calls: [{ function: {
        name: "wrong_tool",
        arguments: JSON.stringify(worldInteractionArguments()),
      } }] } }],
    },
    {
      choices: [{ message: { tool_calls: [
        { function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: "{}" } },
        { function: { name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: "{}" } },
      ] } }],
    },
    toolResponse("not-json"),
    toolResponse({ ...worldInteractionArguments(), schema: "model-owned" }),
    toolResponse({
      ...worldInteractionArguments(),
      terminal: { kind: "none", hiddenExtra: true },
    }),
    toolResponse(prototypeKey),
  ];
  for (const response of invalidResponses) {
    assert.throws(
      () => parseSubmitKpProposalBundleResponse(response),
      (error) => error instanceof VNextProposalBundleOutputError,
    );
  }
});

test("strict main and correction parsers reject duplicate JSON members at every depth", () => {
  const valid = JSON.stringify(worldInteractionArguments());
  const duplicateMode = valid.replace(
    /^\{/u,
    "{\"mode\":\"terminal\",",
  );
  const duplicateNestedSummary = valid.replace(
    /"success":\{/u,
    "\"success\":{\"summary\":\"伪造结果。\",",
  );
  for (const rawArguments of [duplicateMode, duplicateNestedSummary]) {
    assert.throws(
      () => parseSubmitKpProposalBundleResponse(rawNamedToolResponse(
        SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
        rawArguments,
      )),
      (error) => error instanceof VNextProposalBundleOutputError,
    );
  }

  const duplicateCorrectionValue = "{\"changes\":[{\"path\":[\"proposals\",0,\"summary\"],\"value\":\"first\",\"value\":\"second\"}]}";
  assert.throws(
    () => parseCorrectKpProposalBundleResponse(rawNamedToolResponse(
      CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      duplicateCorrectionValue,
    ), {
      baseBundleHash: HASH,
      contextHash: CONTEXT_HASH,
    }),
    (error) => error instanceof VNextProposalBundleOutputError,
  );
});

test("closed domain validator rejects mixed modes, unknown fields, and unbound prospective refs", () => {
  const accepted = parseSubmitKpProposalBundleResponse(toolResponse(worldInteractionArguments()));
  const cases = [
    { ...accepted, terminal: { kind: "clarification" } },
    { ...accepted, unknown: true },
    { ...accepted, proposals: [] },
    {
      ...accepted,
      proposals: [{
        ...accepted.proposals[0],
        consumes: [],
        targetRefs: ["prospective:missing"],
        directTargetRefs: ["prospective:missing"],
      }],
    },
  ];
  for (const value of cases) {
    assert.equal(validateVNextProposalBundle(value).kind, "rejected");
  }
});

test("closed domain rejects ambiguous shared checks and non-random outcome bindings", () => {
  const checked = materializeThenInteractArguments();
  checked.adjudication = {
    kind: "check",
    checkKind: "abilityCheck",
    ability: "wis",
    skill: "none",
    dc: 12,
    mode: "normal",
    risk: "可能没有发现。",
    successOutcome: "发现机关。",
    failureOutcome: "暂未发现。",
  };
  checked.proposals[1].branches.failure = successBranch({
    outcomeCode: "outcome:not-found",
    summary: "暂未发现。",
  });
  checked.proposals.push(structuredClone(checked.proposals[1]));
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(checked)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );

  const direct = worldInteractionArguments();
  direct.proposals[0].outcomeBinding = "onSuccess";
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(direct)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );

  const highRisk = worldInteractionArguments();
  highRisk.adjudication = {
    kind: "highRisk",
    risk: "会消耗唯一机会。",
    confirmationQuestion: "确认继续吗？",
    successOutcome: "行动完成。",
    failureOutcome: "机会已经失去。",
    check: {
      checkKind: "none",
      ability: "none",
      skill: "none",
      dc: 0,
      mode: "normal",
    },
    acceptedCosts: [],
  };
  highRisk.proposals[0].outcomeBinding = "onFailure";
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(highRisk)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );
});

test("closed refs preserve transport sentinels and prospective namespace", () => {
  for (const target of ["none", "prospective:"]) {
    const value = worldInteractionArguments();
    value.proposals[0].targetRefs = [target];
    value.proposals[0].directTargetRefs = [target];
    assert.throws(
      () => parseSubmitKpProposalBundleResponse(toolResponse(value)),
      (error) => error instanceof VNextProposalBundleOutputError,
    );
  }
});

test("the stage-three transport surface is exactly what the server can execute", () => {
  // A tripwire, not a ceiling: every value here is one the layers below the
  // wire already support, and widening it further should be a deliberate edit
  // that updates this list rather than a silent drift.
  assert.deepEqual(
    SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.mode.enum,
    ["adjudication", "terminal"],
  );
  // Only the refusal terminal is on the wire. Clarification is not: each of
  // its choices carries a complete frozen continuation, a far larger schema.
  assert.deepEqual(
    SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.terminal.anyOf
      .map((branch) => branch.properties.kind.enum[0]),
    ["none", "inWorldRefusal"],
  );
  // Materialization is four closed variants rather than one flat shape:
  // `isMaterializedDefinition` binds semanticKind to sceneRef and the
  // visibility policy to visibilityFactId, and those are conditionals the
  // dialect cannot carry. Enumerating the legal combinations is what makes the
  // illegal ones unconstructible instead of merely forbidden.
  assert.deepEqual(
    SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.proposals.items.anyOf
      .map((entry) => entry.properties.kind.enum[0]),
    [
      "materializeObject", "materializeObject", "materializeObject",
      "materializeObject", "worldInteraction",
    ],
  );
  const materializations = SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.proposals.items.anyOf
    .filter((entry) => entry.properties.kind.enum[0] === "materializeObject")
    .map((entry) => ({
      semanticKind: entry.properties.semanticKind.enum[0],
      policies: entry.properties.visibilityPolicyRef.enum,
      sceneRef: entry.properties.definition.properties.sceneRef.enum?.[0] ?? "ref",
      visibilityFactId:
        entry.properties.definition.properties.visibilityFactId.enum?.[0] ?? "ref",
    }));
  assert.deepEqual(materializations, [
    {
      semanticKind: "sceneFeature",
      policies: ["visibility:public", "visibility:scene-observers"],
      sceneRef: "ref",
      visibilityFactId: "none",
    },
    {
      semanticKind: "sceneFeature",
      policies: ["visibility:hidden-until-evidence"],
      sceneRef: "ref",
      visibilityFactId: "ref",
    },
    {
      semanticKind: "worldFact",
      policies: ["visibility:public"],
      sceneRef: "none",
      visibilityFactId: "none",
    },
    {
      semanticKind: "worldFact",
      policies: ["visibility:hidden-until-evidence"],
      sceneRef: "none",
      visibilityFactId: "ref",
    },
  ]);
  // The combinations the domain validator rejects have no branch at all: a
  // world fact is never scene-observers, a hidden reality never lacks the fact
  // that gates its reveal, and a visible one never carries a stray gate.
  for (const variant of materializations) {
    assert.equal(
      variant.semanticKind === "worldFact"
        && variant.policies.includes("visibility:scene-observers"),
      false,
    );
    assert.equal(
      variant.policies.includes("visibility:hidden-until-evidence"),
      variant.visibilityFactId === "ref",
    );
    assert.equal(variant.semanticKind === "sceneFeature", variant.sceneRef === "ref");
  }
  assert.equal("$def" in SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, false);
  assert.equal(decodeVNextStrictToolBundle({
    checkKind: "none",
    ability: "none",
    skill: "none",
    dc: 0,
    mode: "normal",
  }), null);
  assert.deepEqual({ ...decodeVNextStrictToolBundle({
    checkKind: "none",
    ability: "none",
    skill: "none",
    dc: 1,
    mode: "normal",
  }) }, {
    checkKind: "none",
    ability: "none",
    skill: null,
    dc: 1,
    mode: "normal",
  });
  const value = {
    ...parseSubmitKpProposalBundleResponse(toolResponse(worldInteractionArguments())),
    adjudication: {
      kind: "highRisk",
      risk: "存在风险。",
      confirmationQuestion: "确认继续吗？",
      successOutcome: "行动完成。",
      failureOutcome: "行动失败。",
      check: {
        checkKind: "abilityCheck",
        ability: "wis",
        skill: null,
        dc: 12,
        mode: "normal",
        rootActionId: "model-owned",
      },
      acceptedCosts: [],
    },
  };
  assert.equal(validateVNextProposalBundle(value).kind, "rejected");
});

test("NPC goal and plan operations match the active Rules reference-field allowlist", () => {
  const operations = [{
    kind: "upsertByRef",
    path: ["semantics", "goals"],
    entry: {
      goalRef: "goal:warn-party",
      description: "在钟响前警告队伍。",
    },
  }, {
    kind: "upsertByRef",
    path: ["semantics", "plans"],
    entry: {
      planRef: "plan:inspect-ledger",
      description: "核对账册上的新痕迹。",
    },
  }];
  const argumentsValue = worldInteractionArguments();
  argumentsValue.proposals = [{
    kind: "reviseSemanticDefinition",
    basisRefs: [],
    consumes: [],
    produces: [],
    outcomeBinding: "always",
    definitionRef: "definition:npc:warden",
    semanticKind: "npc",
    npcRef: "npc:warden",
    baseRevision: "1",
    baseHash: HASH,
    templateRef: "template:npc",
    templateHash: HASH,
    operations,
    summary: "守卫形成了新的目标和计划。",
  }];
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(argumentsValue));
  assert.equal(bundle.proposals[0].kind, "reviseSemanticDefinition");

  const snapshot = createDefinitionSnapshot("definition:npc:warden", "1", {
    semantics: { attitude: "wary", goals: [], plans: [] },
  });
  const composed = composeDefinition({
    base: snapshot,
    expectedRevision: snapshot.revision,
    expectedHash: snapshot.definitionHash,
    allowlist: [{
      kind: "value",
      path: ["semantics", "attitude"],
    }, {
      kind: "referenceArray",
      path: ["semantics", "goals"],
      referenceField: "goalRef",
    }, {
      kind: "referenceArray",
      path: ["semantics", "plans"],
      referenceField: "planRef",
    }],
    operations,
  });
  assert.equal(composed.kind, "accepted", JSON.stringify(composed));
});

test("world facts cannot claim scene-observer visibility without a scene binding", () => {
  const value = materializeThenInteractArguments();
  value.proposals = [{
    ...value.proposals[0],
    semanticKind: "worldFact",
    visibilityPolicyRef: "visibility:scene-observers",
    definition: {
      ...value.proposals[0].definition,
      sceneRef: "none",
    },
  }];
  assert.throws(
    () => parseSubmitKpProposalBundleResponse(toolResponse(value)),
    (error) => error instanceof VNextProposalBundleOutputError,
  );
});

test("one sparse correction can repair only an allowed path and is then fully revalidated", () => {
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(worldInteractionArguments()));
  const rejectedDraft = structuredClone(bundle);
  rejectedDraft.proposals[0].branches.success.summary = "";
  assert.equal(validateVNextProposalBundle(rejectedDraft).kind, "rejected");
  const path = ["proposals", 0, "branches", "success", "summary"];
  const correction = {
    schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
    baseBundleHash: canonicalHash(rejectedDraft),
    contextHash: CONTEXT_HASH,
    attempt: 1,
    changes: [{ path, value: "修复后的公开结果。" }],
  };
  const result = applyVNextProposalBundleCorrection({
    bundle: rejectedDraft,
    correction,
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    allowedPaths: [path],
  });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(result.bundle.proposals[0].branches.success.summary, "修复后的公开结果。");

  assert.equal(applyVNextProposalBundleCorrection({
    bundle: rejectedDraft,
    correction: { ...correction, attempt: 2 },
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    allowedPaths: [path],
  }).kind, "rejected");
  assert.equal(applyVNextProposalBundleCorrection({
    bundle: rejectedDraft,
    correction: {
      ...correction,
      changes: [{ path: ["adjudication", "kind"], value: "check" }],
    },
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    allowedPaths: [["adjudication", "kind"]],
  }).kind, "rejected");

  const authorityDraft = structuredClone(bundle);
  authorityDraft.proposals[0].branches.success.effects = [{
    kind: "relationTransition",
    relationRef: "relation:major-a",
    toState: "ended",
  }];
  const authorityPath = [
    "proposals", 0, "branches", "success", "effects", 0, "relationRef",
  ];
  assert.equal(applyVNextProposalBundleCorrection({
    bundle: authorityDraft,
    correction: {
      schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
      baseBundleHash: canonicalHash(authorityDraft),
      contextHash: CONTEXT_HASH,
      attempt: 1,
      changes: [{ path: authorityPath, value: "relation:major-b" }],
    },
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    allowedPaths: [authorityPath],
  }).kind, "rejected");
});

test("summary-only correction reaches a frozen clarification continuation", () => {
  const bundle = parseSubmitKpProposalBundleResponse(toolResponse(clarificationArguments()));
  const rejectedDraft = structuredClone(bundle);
  rejectedDraft.terminal.choices[1].continuation.proposals[1]
    .branches.success.summary = "";
  const path = [
    "terminal", "choices", 1, "continuation", "proposals", 1,
    "branches", "success", "summary",
  ];
  assert.deepEqual(repairableVNextProposalBundlePaths(rejectedDraft), [path]);
  const result = applyVNextProposalBundleCorrection({
    bundle: rejectedDraft,
    correction: {
      schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
      baseBundleHash: canonicalHash(rejectedDraft),
      contextHash: CONTEXT_HASH,
      attempt: 1,
      changes: [{ path, value: "右侧壁龛已检查。" }],
    },
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    allowedPaths: [path],
  });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(
    result.bundle.terminal.choices[1].continuation.proposals[1]
      .branches.success.summary,
    "右侧壁龛已检查。",
  );
});

test("provider invocation sends the exact strict request through an injected binding", async () => {
  const calls = [];
  const bundle = await invokeSubmitKpProposalBundle({
    binding: {
      async run(model, input, options) {
        calls.push({ model, input, options });
        return toolResponse(worldInteractionArguments());
      },
    },
    modelId: "deepseek-v4-flash",
    message: "只裁定冻结上下文。",
    signal: new AbortController().signal,
  });
  assert.equal(bundle.mode, "adjudication");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.tools.length, 1);
  assert.equal(calls[0].input.tools[0].function.strict, true);
  assert.equal(calls[0].input.tool_choice, "required");
});

test("provider uses one summary-only correction and completely revalidates the Bundle", async () => {
  const rejected = worldInteractionArguments();
  rejected.proposals[0].branches.success.summary = "";
  const path = ["proposals", 0, "branches", "success", "summary"];
  const calls = [];
  const persistedTickets = [];
  const queue = [
    toolResponse(rejected),
    namedToolResponse(CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {
      changes: [{ path, value: "检查完成。" }],
    }),
  ];
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({
    binding: {
      async run(model, input, options) {
        calls.push({ model, input, options });
        return queue.shift();
      },
    },
    modelId: "deepseek-v4-flash",
    message: "只裁定冻结上下文。",
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    async persistRepairTicket(ticket) {
      assert.equal(calls.length, 1);
      persistedTickets.push(ticket);
    },
  });

  assert.equal(result.kind, "locallyAccepted", JSON.stringify(result));
  assert.equal(result.repairUsed, true);
  assert.equal(result.invocationCount, 2);
  assert.equal(result.bundle.proposals[0].branches.success.summary, "检查完成。");
  assert.equal(calls.length, 2);
  assert.equal(persistedTickets.length, 1);
  assert.equal(Object.isFrozen(persistedTickets[0]), true);
  assert.equal(calls[0].input.tools[0].function.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  assert.equal(calls[1].input.tools[0].function.name, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  const repairContext = JSON.parse(calls[1].input.messages[0].content);
  assert.deepEqual(repairContext.allowedPaths, [path]);
  assert.equal(repairContext.contextHash, CONTEXT_HASH);
});

test("provider does not spend correction on authority errors and never makes a third call", async () => {
  const invalidReference = worldInteractionArguments();
  invalidReference.proposals[0].targetRefs = ["none"];
  invalidReference.proposals[0].directTargetRefs = ["none"];
  let calls = 0;
  const unrepairable = await invokeSubmitKpProposalBundleWithOneCorrection({
    binding: {
      async run() {
        calls += 1;
        return toolResponse(invalidReference);
      },
    },
    modelId: "deepseek-v4-flash",
    message: "只裁定冻结上下文。",
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    persistRepairTicket() {
      assert.fail("unrepairable authority errors must not create a repair ticket");
    },
  });
  assert.deepEqual(unrepairable, {
    kind: "rejected",
    code: "PROPOSAL_FORM_INVALID",
    issues: ["bundle:world-interaction-invalid"],
    repairUsed: false,
    invocationCount: 1,
  });
  assert.equal(calls, 1);

  const twoSummaries = worldInteractionArguments();
  twoSummaries.proposals[0].branches.success.summary = "";
  twoSummaries.proposals[0].branches.success.effects = [{
    kind: "definitionRevision",
    definitionRef: "definition:npc:warden",
    operations: [{
      kind: "set",
      path: ["description"],
      value: "守卫仍在门边。",
    }],
    summary: "",
  }];
  const partialPath = ["proposals", 0, "branches", "success", "summary"];
  const partialQueue = [
    toolResponse(twoSummaries),
    namedToolResponse(CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {
      changes: [{ path: partialPath, value: "主结果已修正。" }],
    }),
  ];
  const partial = await invokeSubmitKpProposalBundleWithOneCorrection({
    binding: {
      async run() {
        calls += 1;
        return partialQueue.shift();
      },
    },
    modelId: "deepseek-v4-flash",
    message: "只裁定冻结上下文。",
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    persistRepairTicket() {},
  });
  assert.equal(partial.kind, "rejected");
  assert.equal(partial.code, "PROPOSAL_REPAIR_EXHAUSTED");
  assert.equal(partial.invocationCount, 2);
  assert.equal(calls, 3);
});

test("persisted repair ticket resumes correction without repeating the main call", async () => {
  const rejected = worldInteractionArguments();
  rejected.proposals[0].branches.success.summary = "";
  const path = ["proposals", 0, "branches", "success", "summary"];
  let mainCalls = 0;
  const firstPass = await invokeSubmitKpProposalBundleFirstPass({
    binding: {
      async run() {
        mainCalls += 1;
        return toolResponse(rejected);
      },
    },
    modelId: "deepseek-v4-flash",
    message: "只裁定冻结上下文。",
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
  });
  assert.equal(firstPass.kind, "repairRequired", JSON.stringify(firstPass));
  const persisted = structuredClone(firstPass.repairTicket);
  let correctionCalls = 0;
  const result = await invokeCorrectKpProposalBundle({
    binding: {
      async run() {
        correctionCalls += 1;
        return namedToolResponse(CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {
          changes: [{ path, value: "恢复后的检查结果。" }],
        });
      },
    },
    modelId: "deepseek-v4-flash",
    requiredContext: { binding: { contextHash: CONTEXT_HASH } },
    repairTicket: persisted,
  });
  assert.equal(result.kind, "locallyAccepted", JSON.stringify(result));
  assert.equal(result.bundle.proposals[0].branches.success.summary, "恢复后的检查结果。");
  assert.equal(mainCalls, 1);
  assert.equal(correctionCalls, 1);

  const tampered = structuredClone(persisted);
  tampered.allowedPaths = [["adjudication", "risk"]];
  await assert.rejects(
    invokeCorrectKpProposalBundle({
      binding: { async run() { assert.fail("tampered ticket must fail before Provider I/O"); } },
      modelId: "deepseek-v4-flash",
      requiredContext: { binding: { contextHash: CONTEXT_HASH } },
      repairTicket: tampered,
    }),
    /VNEXT_PROPOSAL_REPAIR_TICKET_INVALID/u,
  );
});

test("concrete vNext-2 handshake definition passes offline without claiming live evidence", async () => {
  let positiveCalls = 0;
  let negativeCalls = 0;
  const report = await runDeepSeekStrictToolHandshake({
    definition: strictToolHandshakeDefinition,
    executionMode: "offline-fixture",
    validatedAt: "2026-09-03T00:00:00.000Z",
    invoke: async (_model, input) => {
      positiveCalls += 1;
      if (input.tools[0].function.name === CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
        return namedToolResponse(CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, {
          changes: [{
            path: ["proposals", 0, "branches", "success", "summary"],
            value: "检查完成。",
          }],
        });
      }
      const prompt = input.messages[0].content;
      // Keyed on wording unique to the refusal case: the shared contract
      // lines mention inWorldRefusal on every submit prompt.
      if (prompt.includes("徒手把整扇石门")) return toolResponse(inWorldRefusalArguments());
      if (prompt.includes("prospective:cache")) return toolResponse(sharedCheckArguments());
      return toolResponse(prompt.includes("prospective:alcove")
        ? materializeThenInteractArguments()
        : worldInteractionArguments());
    },
    invokeInvalidSchema: async () => {
      negativeCalls += 1;
      return { status: 422, generatedOutput: false };
    },
  });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(positiveCalls, 5);
  assert.equal(negativeCalls, 1);
  assert.equal(report.liveProviderCalls, 0);
  assert.equal(report.registrationAccepted, false);
  assert.equal(report.evidence.executionMode, "offline-fixture");
  assert.equal(report.evidence.successfulStrictToolCalls, 5);
  assert.equal(report.evidence.invalidSchemaRejections, 1);
  assert.deepEqual(
    report.evidence.contracts.map(({ contractId }) => contractId),
    ["correct-proposal-bundle", "submit-proposal-bundle"],
  );
});

/**
 * SPEC 0001 acceptance scenario B: an action that the frozen facts make
 * impossible must be refused plainly, with the missing prerequisite and a real
 * alternative path -- and explicitly *not* behind an unreachable DC.
 *
 * The refusal terminal is what carries that, and until now it existed at every
 * layer except the wire: the domain validator, `lowerTerminal` and the Rules
 * feasibility seam all accepted it while `mode` was pinned to "adjudication".
 * These assertions cover the transport half of that round trip.
 */
function refusalWireBundle(overrides = {}) {
  return {
    mode: "terminal",
    basisRefs: ["scene:hall", "feature:hall:stone-door"],
    adjudication: { kind: "none" },
    terminal: {
      kind: "inWorldRefusal",
      intent: "徒手把整扇石门拆下来",
      method: "双手抠住门缘向外硬掰",
      ruling: {
        kind: "missingPrerequisite",
        publicBasis: "石门嵌在整块承重墙里，没有缝隙也没有着力点。",
        prerequisites: [
          { kind: "tool", ref: "none", description: "需要能卡进石缝的撬棍一类工具。" },
        ],
        nextActions: [
          { description: "在大厅里找一件能当撬棍的硬物。", basisRefs: ["scene:hall"] },
        ],
        attemptCosts: [],
      },
      ...overrides,
    },
    proposals: [],
  };
}

test("a wire refusal decodes and validates as a terminal bundle", () => {
  const decoded = decodeVNextStrictToolBundle(refusalWireBundle());
  // The unused half of the bundle and an inapplicable prerequisite ref both
  // ride the `none` sentinel and must come back as real nulls.
  assert.equal(decoded.adjudication, null);
  assert.equal(decoded.terminal.ruling.prerequisites[0].ref, null);

  const result = validateVNextProposalBundle({
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    ...decoded,
  });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(result.bundle.mode, "terminal");
  assert.equal(result.bundle.terminal.kind, "inWorldRefusal");
  assert.deepEqual(result.bundle.proposals, []);
});

test("a refusal cannot carry a check, which is what scenario B forbids", () => {
  const terminalBranches = SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.terminal.anyOf;
  const refusal = terminalBranches.find((branch) =>
    branch.properties?.kind?.enum?.[0] === "inWorldRefusal");
  assert.ok(refusal, "the refusal terminal must be on the wire");

  // "Do not set a fake high DC" is enforced by shape, not by asking nicely:
  // the refusal branch has no field a DC could live in, at any depth.
  const keys = new Set();
  (function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [key, child] of Object.entries(node)) {
      keys.add(key);
      walk(child);
    }
  })(refusal);
  for (const forbidden of ["dc", "ability", "skill", "mode", "checkKind"]) {
    assert.equal(keys.has(forbidden), false, `refusal must not carry ${forbidden}`);
  }
});

test("the wire offers every attempt cost the server can spend, each closed to its own fields", () => {
  const refusal = SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA.properties.terminal.anyOf.find((branch) =>
    branch.properties?.kind?.enum?.[0] === "inWorldRefusal");
  const variants = refusal.properties.ruling.properties.attemptCosts.items.anyOf;
  // Rules has a transition for each of these kinds now, so the wire offers
  // each. A refusal that cost the actor ten minutes can say so instead of
  // being priced at nothing because `item` was the only word available.
  assert.deepEqual(
    variants.map((variant) => variant.properties.kind.enum[0]),
    ["item", "fictionTime", "resource"],
  );
  // Per-variant fields rather than one shape with optional ones: an item cost
  // can never arrive carrying a duration, and a time cost can never arrive
  // carrying an entry.
  assert.deepEqual(
    variants.map((variant) => variant.required),
    [
      ["charges", "durability", "entryRef", "kind", "quantity"],
      ["durationMicros", "kind"],
      ["amount", "kind", "resourceId"],
    ],
  );

  for (const attemptCosts of [
    [{ kind: "item", entryRef: "item-entry:hall:torch", quantity: 0, charges: 1, durability: 0 }],
    [{ kind: "fictionTime", durationMicros: "600000000" }],
    [{ kind: "resource", resourceId: "spellSlot:1", amount: 1 }],
  ]) {
    const withCost = refusalWireBundle();
    withCost.terminal.ruling.attemptCosts = attemptCosts;
    const result = validateVNextProposalBundle({
      schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
      ...decodeVNextStrictToolBundle(withCost),
    });
    assert.equal(result.kind, "accepted", JSON.stringify({ attemptCosts, result }));
  }
});

/**
 * The four materialization variants are only worth enumerating if each one
 * actually survives the domain validator that motivated them. This walks the
 * wire shapes the schema now offers, decodes each the way the provider adapter
 * would, and asserts `isMaterializedDefinition` accepts every one.
 */
function materializeWireBundle(variant) {
  const definition = {
    sceneRef: variant.sceneRef,
    visibilityFactId: variant.visibilityFactId,
    label: "祭坛后的凹槽",
    description: "祭坛背面有一处刚被注意到的凹槽。",
    observableState: "刚刚露出",
    affordances: ["可以伸手探查"],
    mechanicDefinitionRefs: [],
  };
  return {
    mode: "adjudication",
    basisRefs: ["scene:atrium"],
    adjudication: {
      kind: "directSuccess",
      risk: "让一处先前没被注意到的细节显形，不带来额外风险。",
      successOutcome: "该细节成为可引用的固化事实。",
    },
    terminal: { kind: "none" },
    proposals: [{
      kind: "materializeObject",
      basisRefs: ["scene:atrium"],
      consumes: [],
      produces: [
        { handle: "prospective:niche", kind: "semanticDefinition", outcomeBinding: "always" },
      ],
      outcomeBinding: "always",
      semanticKind: variant.semanticKind,
      templateRef: "template:probe:niche",
      templateHash: `sha256:${"9".repeat(64)}`,
      visibilityPolicyRef: variant.visibilityPolicyRef,
      definition,
      summary: "把刚被注意到的细节固化为可引用事实。",
    }],
  };
}

test("every materialization variant the wire offers is one the domain accepts", () => {
  const variants = [
    {
      name: "scene feature, visible to the room",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:scene-observers",
      sceneRef: "scene:atrium",
      visibilityFactId: "none",
    },
    {
      name: "scene feature, public",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:public",
      sceneRef: "scene:atrium",
      visibilityFactId: "none",
    },
    {
      // SPEC 0001 section 7: an open blank made relevant is frozen before it is
      // revealed, and the fact that gates the reveal is named up front.
      name: "scene feature, hidden until evidence",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:hidden-until-evidence",
      sceneRef: "scene:atrium",
      visibilityFactId: "fact:atrium:niche-not-yet-seen",
    },
    {
      name: "world fact, public",
      semanticKind: "worldFact",
      visibilityPolicyRef: "visibility:public",
      sceneRef: "none",
      visibilityFactId: "none",
    },
    {
      name: "world fact, hidden until evidence",
      semanticKind: "worldFact",
      visibilityPolicyRef: "visibility:hidden-until-evidence",
      sceneRef: "none",
      visibilityFactId: "fact:world:ledger-was-forged",
    },
  ];

  for (const variant of variants) {
    const decoded = decodeVNextStrictToolBundle(materializeWireBundle(variant));
    const entry = decoded.proposals[0];
    // The `none` sentinel is how the wire says "not applicable"; the domain
    // checks real nulls.
    assert.equal(
      entry.definition.sceneRef,
      variant.sceneRef === "none" ? null : variant.sceneRef,
      variant.name,
    );
    assert.equal(
      entry.definition.visibilityFactId,
      variant.visibilityFactId === "none" ? null : variant.visibilityFactId,
      variant.name,
    );
    const result = validateVNextProposalBundle({
      schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
      ...decoded,
    });
    assert.equal(result.kind, "accepted", `${variant.name}: ${JSON.stringify(result)}`);
  }
});

test("the domain still rejects the combinations the wire cannot express", () => {
  // These are the shapes the union removed. They must stay rejected, so that
  // the wire's silence about them is a real guarantee and not a coincidence.
  const illegal = [
    {
      name: "a world fact scoped to scene observers",
      semanticKind: "worldFact",
      visibilityPolicyRef: "visibility:scene-observers",
      sceneRef: "none",
      visibilityFactId: "none",
    },
    {
      name: "a hidden reality with no fact gating its reveal",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:hidden-until-evidence",
      sceneRef: "scene:atrium",
      visibilityFactId: "none",
    },
    {
      name: "a visible feature carrying a stray gate",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:scene-observers",
      sceneRef: "scene:atrium",
      visibilityFactId: "fact:atrium:niche-not-yet-seen",
    },
    {
      name: "a world fact bound to a scene",
      semanticKind: "worldFact",
      visibilityPolicyRef: "visibility:public",
      sceneRef: "scene:atrium",
      visibilityFactId: "none",
    },
  ];

  for (const variant of illegal) {
    const result = validateVNextProposalBundle({
      schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
      ...decodeVNextStrictToolBundle(materializeWireBundle(variant)),
    });
    assert.equal(result.kind, "rejected", variant.name);
    assert.deepEqual(result.issues, ["bundle:materialization-invalid"], variant.name);
  }
});

test("a consume may name a frozen reference as well as a bundle-local handle", () => {
  // The domain has always modelled both kinds; only the wire was pinned to
  // prospective. An existing consume declares a dependency on a ref the world
  // already froze, which is how an entry can say what it is acting upon
  // without first creating it.
  const bundle = {
    mode: "adjudication",
    basisRefs: ["scene:atrium", "sceneFeature:chain"],
    adjudication: {
      kind: "directSuccess",
      risk: "靠近查看已知的铁链，不带来额外风险。",
      successOutcome: "角色看清了铁链的磨损情况。",
    },
    terminal: { kind: "none" },
    proposals: [{
      kind: "worldInteraction",
      basisRefs: ["scene:atrium", "sceneFeature:chain"],
      consumes: [{ kind: "existing", ref: "sceneFeature:chain" }],
      produces: [],
      outcomeBinding: "always",
      sceneRef: "scene:atrium",
      targetRefs: ["sceneFeature:chain"],
      directTargetRefs: ["sceneFeature:chain"],
      instrumentRefs: [],
      abilityRef: "none",
      intent: "查看铁链的磨损。",
      method: "凑近观察链节。",
      branches: {
        success: {
          outcomeCode: "outcome:probe:chain-read",
          summary: "角色看清了链节的磨损。",
          effects: [],
          sensoryEvidence: [],
          pressures: [],
          opportunities: [],
        },
        failure: { kind: "none" },
      },
    }],
  };

  const decoded = decodeVNextStrictToolBundle(bundle);
  // The decoder builds null-prototype records, so compare the fields rather
  // than the object identity.
  assert.deepEqual(
    decoded.proposals[0].consumes.map((entry) => ({ ...entry })),
    [{ kind: "existing", ref: "sceneFeature:chain" }],
  );
  // `abilityRef` is no longer pinned, so the sentinel still has to resolve to
  // null for an interaction that uses no Ability.
  assert.equal(decoded.proposals[0].abilityRef, null);

  const result = validateVNextProposalBundle({
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    ...decoded,
  });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
});
