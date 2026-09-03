import assert from "node:assert/strict";
import test from "node:test";

import {
  lowerVNextProposalBundle,
  validateVNextProposalBundle,
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
} from "../app/_runtime/lib/kp/vnext/proposal-bundle.ts";
import { VNEXT_WORLD_INTERACTION_FORM_ID } from "../app/_runtime/lib/kp/vnext/proposals.ts";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";

const ROOT_ACTION = "root:proposal-bundle";
const ACTOR = "character:bundle-actor";
const CONTEXT_HASH = `sha256:${"c".repeat(64)}`;
const BASIS = "fact:bundle-basis";

function branch(overrides = {}) {
  return {
    outcomeCode: "outcome:bundle",
    summary: "结果候选已冻结。",
    effects: [],
    sensoryEvidence: [],
    pressures: [],
    opportunities: [],
    ...overrides,
  };
}

function worldProposal(overrides = {}) {
  return {
    kind: "worldInteraction",
    sceneRef: "scene:bundle",
    targetRefs: ["feature:bundle-target"],
    directTargetRefs: ["feature:bundle-target"],
    instrumentRefs: [],
    abilityRef: null,
    intent: "改变场景中的目标关系。",
    method: "采用当前可用的开放互动方法。",
    branches: {
      success: branch(),
      failure: branch({ outcomeCode: "outcome:bundle-failure" }),
    },
    ...overrides,
  };
}

function worldState() {
  return {
    entities: { [ACTOR]: { id: ACTOR, kind: "player", sceneId: "scene:bundle" } },
    campaignRuntime: { itemSystem: { entries: {} }, definitions: {} },
    combatRuntime: { definitions: {}, entities: {} },
    canonicalFacts: {},
    knowledge: {},
  };
}

function ruling(kind) {
  if (kind === "directSuccess") {
    return {
      kind,
      risk: "风险有限。",
      successOutcome: "行动成功。",
      failureOutcome: "不会产生额外失败结果。",
    };
  }
  if (kind === "check") {
    return {
      kind,
      checkKind: "abilityCheck",
      ability: "dex",
      skill: null,
      dc: 12,
      mode: "normal",
      risk: "存在真实不确定性。",
      successOutcome: "行动成功。",
      failureOutcome: "行动失败并留下相称后果。",
    };
  }
  if (kind === "highRisk") {
    return {
      kind,
      risk: "失败可能造成严重且不可逆的后果。",
      confirmationQuestion: "是否确认承担该风险？",
      successOutcome: "行动成功。",
      failureOutcome: "行动失败并承担已说明的后果。",
      check: {
        checkKind: "abilityCheck",
        ability: "dex",
        skill: null,
        dc: 18,
        mode: "normal",
      },
      acceptedCosts: [],
    };
  }
  return {
    kind,
    publicBasis: "当前做法缺少决定性前提。",
    prerequisites: [{
      kind: "tool",
      ref: "item-definition:required-tool",
      description: "需要一个可用工具。",
    }],
    nextActions: [{
      description: "寻找该工具后再尝试。",
      basisRefs: [BASIS],
    }],
    attemptCosts: [{ kind: "fictionTime", durationMicros: "1" }],
  };
}

function entry({
  proposalRef = "proposal:bundle",
  formId = VNEXT_WORLD_INTERACTION_FORM_ID,
  proposal = worldProposal(),
  feasibility = "directSuccess",
  consumes = [],
  produces = [],
  outcomeBinding = "always",
} = {}) {
  return {
    proposalRef,
    formId,
    basisRefs: [BASIS],
    consumes,
    produces,
    outcomeBinding,
    ruling: typeof feasibility === "string" ? ruling(feasibility) : feasibility,
    proposal,
  };
}

function bundle(...entries) {
  return {
    schema: VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    proposals: entries,
  };
}

function contextFor(refs = [BASIS, "scene:bundle", "feature:bundle-target"], viewerRefs = []) {
  const uniqueRefs = [...new Set(refs)];
  return {
    schema: "zhuwei.adjudication-context/vnext-1",
    intent: {
      submissionRef: "submission:proposal-bundle",
      actorRef: ACTOR,
      text: "测试 Proposal Bundle。",
    },
    entries: uniqueRefs.map((entryRef) => ({
      kind: "known",
      entryRef,
      revisionOrHash: "revision:1",
      value: { entryRef },
    })),
    references: {
      citations: {
        viewerEvidenceRefs: [...new Set(viewerRefs)],
        authorityBasisRefs: uniqueRefs,
        npcKnowledge: [],
        nonCitableRefs: [],
      },
      domains: {
        abilityRefs: [],
        itemRefs: [],
        semanticRefs: uniqueRefs,
      },
    },
    binding: {
      roomEpochRef: "epoch:bundle",
      rootActionId: ROOT_ACTION,
      preparedActionId: "prepared:bundle",
      baseEventSeq: "1",
      stateHash: `sha256:${"a".repeat(64)}`,
      projectionHash: `sha256:${"b".repeat(64)}`,
      profiles: [],
      readSet: [],
      contextHash: CONTEXT_HASH,
    },
  };
}

function lower(value, refs = [BASIS, "scene:bundle", "feature:bundle-target"], extra = {}) {
  const { viewerRefs = [], ...rest } = extra;
  return lowerVNextProposalBundle({
    value,
    requiredContext: contextFor(refs, viewerRefs),
    state: {},
    rootActionId: ROOT_ACTION,
    actorCharacterId: ACTOR,
    ...rest,
  });
}

function assertAccepted(value, label = "") {
  const result = validateVNextProposalBundle(value);
  assert.equal(result.kind, "accepted", `${label}: ${JSON.stringify(result)}`);
  return result;
}

test("Proposal Bundle validator accepts all five shared feasibility rulings", () => {
  for (const feasibility of [
    "directSuccess",
    "check",
    "highRisk",
    "missingPrerequisite",
    "worldLawViolation",
  ]) {
    const formId = feasibility === "missingPrerequisite" || feasibility === "worldLawViolation"
      ? VNEXT_IN_WORLD_REFUSAL_FORM_ID
      : VNEXT_WORLD_INTERACTION_FORM_ID;
    const proposal = formId === VNEXT_IN_WORLD_REFUSAL_FORM_ID
      ? { kind: "inWorldRefusal", intent: "尝试改变世界状态。", method: "徒手尝试。" }
      : worldProposal();
    const result = assertAccepted(bundle(entry({ formId, proposal, feasibility })), feasibility);
    assert.equal(result.bundle.proposals[0].ruling.kind, feasibility);
  }
});

test("Proposal Bundle closed validator rejects authority, dice, and model-DAG fields", () => {
  const cases = [
    ["rootActionId", (value) => { value.rootActionId = ROOT_ACTION; }],
    ["actorCharacterId", (value) => { value.proposals[0].actorCharacterId = ACTOR; }],
    ["contextHash", (value) => { value.proposals[0].contextHash = CONTEXT_HASH; }],
    ["profileHash", (value) => { value.proposals[0].profileHash = CONTEXT_HASH; }],
    ["dice", (value) => { value.proposals[0].ruling.dice = [1]; }],
    ["nodeId", (value) => { value.proposals[0].nodeId = "node:one"; }],
    ["dependsOn", (value) => { value.proposals[0].dependsOn = []; }],
    ["prospective basis ref", (value) => { value.proposals[0].basisRefs = ["prospective:fact"]; }],
    ["branch effects", (value) => {
      value.proposals[0].proposal.branches.success.effects = [{
        kind: "registeredHazard",
        sourceDefinitionRef: "semantic:source",
        zoneRef: "semantic:zone",
        damageProfileRef: "world-damage:not-registered",
      }];
    }],
    ["relation effect", (value) => {
      value.proposals[0].proposal.branches.success.effects = [{
        kind: "relationTransition",
        relationRef: "relation:one",
        toState: "active",
        extra: true,
      }];
    }],
    ["sensory evidence", (value) => {
      value.proposals[0].proposal.branches.success.sensoryEvidence = [{
        observerRef: "character:observer",
        subjectRef: null,
        sense: "sight",
        evidence: "看见变化。",
        basisRefs: [],
      }];
    }],
    ["pressure", (value) => {
      value.proposals[0].proposal.branches.success.pressures = [{
        description: "压力",
        sourceRef: null,
        basisRefs: [BASIS],
        extra: true,
      }];
    }],
    ["opportunity", (value) => {
      value.proposals[0].proposal.branches.success.opportunities = [{
        description: "机会",
        targetRef: null,
        actionHint: null,
        basisRefs: [BASIS],
        extra: true,
      }];
    }],
  ];
  for (const [label, mutate] of cases) {
    const value = structuredClone(bundle(entry()));
    mutate(value);
    const result = validateVNextProposalBundle(value);
    assert.equal(result.kind, "rejected", label);
  }
});

test("high-risk and explicit clarification lower to pending input before Rules execution", () => {
  const highRisk = lower(bundle(entry({ feasibility: "highRisk" })));
  assert.equal(highRisk.kind, "accepted", JSON.stringify(highRisk));
  assert.equal(highRisk.command.kind, "pendingClarification");
  assert.equal("rulesInput" in highRisk.command, false);
  assert.equal(JSON.stringify(highRisk.command).includes("randomness"), false);
  assert.equal(JSON.stringify(highRisk.command).includes("effects"), false);
  assert.equal(JSON.stringify(highRisk.command).includes("attemptCosts"), false);

  const clarification = lower(bundle(entry({
    formId: VNEXT_CLARIFICATION_FORM_ID,
    proposal: {
      kind: "clarification",
      intent: "处理可能造成重大后果的目标。",
      method: "采用一种尚待确认的做法。",
      question: "你要选择哪一种目标？",
      choices: [
        {
          choiceId: "target-a",
          label: "目标 A",
          publicRisk: "可能造成显著资源消耗。",
          basisRefs: [BASIS],
        },
        {
          choiceId: "target-b",
          label: "目标 B",
          publicRisk: "可能攻击另一主体。",
          basisRefs: [BASIS],
        },
      ],
    },
    feasibility: "check",
  })));
  assert.equal(clarification.kind, "accepted", JSON.stringify(clarification));
  assert.equal(clarification.command.kind, "pendingClarification");
  assert.equal(clarification.command.question, "你要选择哪一种目标？");
  assert.deepEqual(clarification.command.choices.map(({ choiceId }) => choiceId), ["target-a", "target-b"]);
});

test("missing prerequisite and world-law violation lower to traceable in-world refusal without effects or randomness", () => {
  for (const feasibility of ["missingPrerequisite", "worldLawViolation"]) {
    const value = bundle(entry({
      formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
      proposal: { kind: "inWorldRefusal", intent: "尝试不可能的行动。", method: "徒手尝试。" },
      feasibility,
    }));
    // The refusal commits as a public event, so the cited prerequisite has to
    // be something this Viewer can already see.
    const result = lower(
      value,
      [BASIS, "item-definition:required-tool"],
      { viewerRefs: ["item-definition:required-tool"] },
    );
    assert.equal(result.kind, "accepted", JSON.stringify(result));
    assert.equal(result.command.kind, "inWorldRefusal");
    assert.equal(result.command.ruling.kind, feasibility);
    assert.equal(result.command.ruling.prerequisites[0].ref, "item-definition:required-tool");
    assert.equal(result.command.ruling.attemptCosts[0].durationMicros, "1");
    assert.equal(JSON.stringify(result.command).includes("randomness"), false);
    assert.equal(JSON.stringify(result.command).includes("effects"), false);
  }
});

test("in-world refusal rejects a prerequisite ref the Viewer cannot see", () => {
  // Authority-read-bound is not the same as player-visible. A prerequisite
  // naming a fact the actor has no evidence for would otherwise ride into the
  // public, scene-observer-visible refusal payload.
  const value = bundle(entry({
    formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
    proposal: { kind: "inWorldRefusal", intent: "尝试不可能的行动。", method: "徒手尝试。" },
    feasibility: "missingPrerequisite",
  }));
  const result = lower(
    value,
    [BASIS, "item-definition:required-tool"],
    { viewerRefs: [] },
  );
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "PROPOSAL_REFERENCE_INVALID");
  assert.deepEqual(
    result.issues,
    ["refusal:prerequisite-not-viewer-visible:item-definition:required-tool"],
  );
});

test("prospective references require one producer and an outcome-dominating condition", () => {
  const duplicate = bundle(
    entry({ proposalRef: "proposal:first", produces: [{
      handle: "prospective:fact",
      kind: "canonicalFact",
      outcomeBinding: "always",
    }] }),
    entry({ proposalRef: "proposal:second", produces: [{
      handle: "prospective:fact",
      kind: "canonicalFact",
      outcomeBinding: "always",
    }] }),
  );
  assert.deepEqual(validateVNextProposalBundle(duplicate), {
    kind: "rejected",
    code: "BUNDLE_DEPENDENCY_INVALID",
    issues: ["bundle:prospective-producer-duplicate:prospective:fact"],
  });

  const unbound = bundle(entry({
    consumes: [{ kind: "prospective", handle: "prospective:missing" }],
  }));
  assert.deepEqual(validateVNextProposalBundle(unbound), {
    kind: "rejected",
    code: "BUNDLE_DEPENDENCY_INVALID",
    issues: ["bundle:prospective-consumer-unbound:prospective:missing"],
  });

  const notDominated = bundle(
    entry({
      proposalRef: "proposal:producer",
      produces: [{
        handle: "prospective:fact",
        kind: "canonicalFact",
        outcomeBinding: "onSuccess",
      }],
      outcomeBinding: "onSuccess",
    }),
    entry({
      proposalRef: "proposal:consumer",
      consumes: [{ kind: "prospective", handle: "prospective:fact" }],
      outcomeBinding: "onFailure",
    }),
  );
  assert.deepEqual(validateVNextProposalBundle(notDominated), {
    kind: "rejected",
    code: "BUNDLE_DEPENDENCY_INVALID",
    issues: ["bundle:prospective-condition-not-dominated:prospective:fact"],
  });

  const cyclic = bundle(
    entry({
      proposalRef: "proposal:cycle-a",
      consumes: [{ kind: "prospective", handle: "prospective:b" }],
      produces: [{
        handle: "prospective:a",
        kind: "canonicalFact",
        outcomeBinding: "always",
      }],
    }),
    entry({
      proposalRef: "proposal:cycle-b",
      consumes: [{ kind: "prospective", handle: "prospective:a" }],
      produces: [{
        handle: "prospective:b",
        kind: "canonicalFact",
        outcomeBinding: "always",
      }],
    }),
  );
  assert.deepEqual(validateVNextProposalBundle(cyclic), {
    kind: "rejected",
    code: "BUNDLE_DEPENDENCY_INVALID",
    issues: ["bundle:dependency-cycle"],
  });
});

test("trusted high-risk confirmation is bound to the frozen ruling and context", () => {
  const value = bundle(entry({ feasibility: "highRisk" }));
  const frozenRuling = value.proposals[0].ruling;
  const result = lower(value, [BASIS, "scene:bundle", "feature:bundle-target"], {
    highRiskConfirmation: {
      kind: "highRiskConfirmation",
      confirmationId: "confirmation:bundle",
      rootActionId: ROOT_ACTION,
      contextHash: CONTEXT_HASH,
      proposalRef: value.proposals[0].proposalRef,
      rulingHash: canonicalHash(frozenRuling),
    },
  });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(result.command.kind, "highRiskConfirmed");
  assert.equal(result.command.confirmationId, "confirmation:bundle");
});

test("highRisk confirmed lowering rejects accepted costs the actor cannot actually pay", () => {
  const costRef = "item-entry:missing-tool";
  const value = bundle(entry({
    feasibility: {
      ...ruling("highRisk"),
      acceptedCosts: [{ kind: "item", entryRef: costRef, quantity: 1, charges: 0, durability: 0 }],
    },
  }));
  const frozenRuling = value.proposals[0].ruling;
  const result = lower(
    value,
    [BASIS, "scene:bundle", "feature:bundle-target", costRef],
    {
      state: { campaignRuntime: { itemSystem: { entries: {} } }, entities: {} },
      highRiskConfirmation: {
        kind: "highRiskConfirmation",
        confirmationId: "confirmation:bundle-cost",
        rootActionId: ROOT_ACTION,
        contextHash: CONTEXT_HASH,
        proposalRef: value.proposals[0].proposalRef,
        rulingHash: canonicalHash(frozenRuling),
      },
    },
  );
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "COST_INVALID");
  assert.deepEqual(result.issues, [`cost:item-unavailable:${costRef}`]);
});

test("atomic multi-step lowering orders steps by the produces/consumes graph and records dependsOn", () => {
  const selfTargeting = worldProposal({ targetRefs: [ACTOR], directTargetRefs: [ACTOR] });
  const producerEntry = entry({
    proposalRef: "proposal:step-a",
    proposal: selfTargeting,
    produces: [{ handle: "prospective:new-fact", kind: "canonicalFact", outcomeBinding: "onSuccess" }],
    outcomeBinding: "onSuccess",
    feasibility: "directSuccess",
  });
  const consumerEntry = entry({
    proposalRef: "proposal:step-b",
    proposal: selfTargeting,
    consumes: [{ kind: "prospective", handle: "prospective:new-fact" }],
    outcomeBinding: "onSuccess",
    feasibility: "directSuccess",
  });
  // Listed consumer-first in the bundle to prove real reordering, not
  // input-order passthrough.
  const value = bundle(consumerEntry, producerEntry);
  const result = lower(
    value,
    [BASIS, "scene:bundle", ACTOR],
    // Only the actual direct target is Viewer-addressable; the rest of the
    // authority slice stays invisible so the direct-target gate still applies.
    { state: worldState(), viewerRefs: [ACTOR] },
  );
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(result.command.kind, "atomicRulesSteps");
  assert.equal(result.command.bundleHash, canonicalHash(value));
  assert.equal(result.command.contextHash, CONTEXT_HASH);
  assert.equal(result.command.sharedRuling, "directSuccess");
  assert.equal(result.command.steps.length, 2);
  assert.deepEqual(
    result.command.steps.map(({ proposalRef }) => proposalRef),
    ["proposal:step-a", "proposal:step-b"],
  );
  assert.deepEqual(result.command.steps[0].dependsOn, []);
  assert.deepEqual(result.command.steps[1].dependsOn, ["proposal:step-a"]);
  assert.equal(result.command.steps[0].ruling, "directSuccess");
  assert.equal(result.command.steps[1].ruling, "directSuccess");
  assert.equal(result.command.steps[0].outcomeBinding, "onSuccess");
  assert.deepEqual(result.command.steps[0].produces, producerEntry.produces);
  assert.deepEqual(result.command.steps[1].consumes, consumerEntry.consumes);
  assert.ok(result.command.steps.every(({ rulesInput }) => rulesInput.kind === "resolveWorldInteraction"));
});

test("atomic multi-step lowering requires one canonical shared ruling", () => {
  const direct = entry({ proposalRef: "proposal:direct", feasibility: "directSuccess" });
  const checked = entry({ proposalRef: "proposal:checked", feasibility: "check" });
  const result = lower(bundle(direct, checked));
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "BUNDLE_DEPENDENCY_INVALID");
  assert.deepEqual(result.issues, ["bundle:shared-ruling-mismatch"]);
});
test("atomic multi-step lowering rejects mixing executable entries with clarification or refusal", () => {
  const executable = entry({ proposalRef: "proposal:exec", feasibility: "directSuccess" });
  const refusalEntry = entry({
    proposalRef: "proposal:refusal",
    formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
    proposal: { kind: "inWorldRefusal", intent: "尝试不可能的行动。", method: "徒手尝试。" },
    feasibility: "missingPrerequisite",
  });
  const result = lower(
    bundle(executable, refusalEntry),
    [BASIS, "scene:bundle", "feature:bundle-target", "item-definition:required-tool"],
  );
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "BUNDLE_DEPENDENCY_INVALID");
  assert.deepEqual(result.issues, ["bundle:shared-ruling-mismatch"]);

  const clarificationEntry = entry({
    proposalRef: "proposal:clarify",
    formId: VNEXT_CLARIFICATION_FORM_ID,
    proposal: {
      kind: "clarification",
      intent: "处理可能造成重大后果的目标。",
      method: "采用一种尚待确认的做法。",
      question: "你要选择哪一种目标？",
      choices: [
        { choiceId: "a", label: "A", publicRisk: "风险 A。", basisRefs: [BASIS] },
        { choiceId: "b", label: "B", publicRisk: "风险 B。", basisRefs: [BASIS] },
      ],
    },
    feasibility: "check",
  });
  const checkedExecutable = entry({ proposalRef: "proposal:checked-exec", feasibility: "check" });
  const withClarification = lower(bundle(checkedExecutable, clarificationEntry));
  assert.equal(withClarification.kind, "rejected", JSON.stringify(withClarification));
  assert.equal(withClarification.code, "BUNDLE_LOWERING_UNSUPPORTED");

  const highRiskEntry = entry({ proposalRef: "proposal:risky", feasibility: "highRisk" });
  const secondHighRiskEntry = entry({ proposalRef: "proposal:risky-two", feasibility: "highRisk" });
  const withHighRisk = lower(bundle(highRiskEntry, secondHighRiskEntry));
  assert.equal(withHighRisk.kind, "rejected", JSON.stringify(withHighRisk));
  assert.equal(withHighRisk.code, "BUNDLE_LOWERING_UNSUPPORTED");
});

test("atomic multi-step lowering rejects an unproduced consumed handle before building any step", () => {
  const consumerOnly = entry({
    proposalRef: "proposal:consumer-only",
    consumes: [{ kind: "prospective", handle: "prospective:missing" }],
    feasibility: "directSuccess",
  });
  const other = entry({ proposalRef: "proposal:other", feasibility: "directSuccess" });
  const result = lower(bundle(consumerOnly, other));
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "BUNDLE_DEPENDENCY_INVALID");
  assert.deepEqual(result.issues, ["bundle:prospective-consumer-unbound:prospective:missing"]);
});
