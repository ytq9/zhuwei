import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleProposalInvocation,
  buildRequiredContext,
  conservativeInputTokens,
  consumeRepair,
  INITIAL_REPAIR_LEDGER,
  proposalInvocationReceipt,
  providerBudgetProfile,
  VNEXT_PROPOSAL_BUDGET,
} from "../app/_runtime/lib/kp/vnext/index.ts";

function hash(seed) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function frozenContext() {
  const built = buildRequiredContext({
    intent: { submissionRef: "submission:s1", actorRef: "character:alice", text: "我用枪打吊灯" },
    entries: [{
      kind: "known",
      entryRef: "feature:chandelier",
      revisionOrHash: hash("a"),
      value: { label: "悬挂吊灯", observableState: "悬挂在半空" },
    }],
    references: {
      citations: {
        viewerEvidenceRefs: ["feature:chandelier"],
        authorityBasisRefs: [],
        npcKnowledge: [],
        nonCitableRefs: [],
      },
      domains: { abilityRefs: [], itemRefs: [], semanticRefs: ["feature:chandelier"] },
    },
    binding: {
      roomEpochRef: "epoch:1",
      rootActionId: "root:s1",
      preparedActionId: "prepared-action:s1",
      baseEventSeq: "7",
      stateHash: hash("b"),
      projectionHash: hash("c"),
      profiles: [{ profileRef: "profile:rules", profileHash: hash("d") }],
      readSet: [],
    },
    maxUnits: 160_000,
  });
  assert.equal(built.kind, "accepted", JSON.stringify(built));
  return built.context;
}

const CONTEXT = frozenContext();
const FORM_SCHEMAS = [{ name: "submit_world_interaction", parameters: { type: "object" } }];

function assemble(overrides = {}) {
  return assembleProposalInvocation({
    context: overrides.context ?? CONTEXT,
    systemPrompt: overrides.systemPrompt ?? "你是本桌的 KP。只依据冻结上下文裁决。",
    formSchemas: overrides.formSchemas ?? FORM_SCHEMAS,
    staticMaterial: overrides.staticMaterial ?? [{ sourceRef: "module:black-oak-will", body: "守灵夜" }],
    invocationKind: overrides.invocationKind ?? "initial",
    ledger: overrides.ledger ?? INITIAL_REPAIR_LEDGER,
    ...(overrides.diagnostics === undefined ? {} : { diagnostics: overrides.diagnostics }),
    ...(overrides.priorProposal === undefined ? {} : { priorProposal: overrides.priorProposal }),
    ...(overrides.budgetProfile === undefined ? {} : { budgetProfile: overrides.budgetProfile }),
  });
}

const REPAIR = {
  invocationKind: "schemaRepair",
  diagnostics: { code: "PROPOSAL_FORM_INVALID", path: "proposal.branches" },
  priorProposal: { formId: "world-interaction.vnext-1" },
};

test("an identical re-assembly reproduces the same request, so a transport retry resends it", () => {
  const first = assemble();
  const second = assemble();

  assert.equal(first.kind, "ready");
  assert.equal(first.invocationOrdinal, 1);
  assert.equal(first.requestHash, second.requestHash);
  assert.deepEqual(first.providerBody, second.providerBody);
  assert.equal(first.budgetReceipt.decision, "accepted");
});

test("a repair reuses the frozen context but is a different request", () => {
  const initial = assemble();
  const repair = assemble(REPAIR);

  assert.equal(repair.kind, "ready");
  assert.equal(repair.invocationOrdinal, 2);
  // Same epistemic slice...
  assert.equal(
    repair.providerBody.requiredContext.binding.contextHash,
    initial.providerBody.requiredContext.binding.contextHash,
  );
  // ...but the diagnostics and prior proposal are new input, so it must be
  // measured and identified on its own.
  assert.notEqual(repair.requestHash, initial.requestHash);
  assert.ok(
    repair.budgetReceipt.estimatedInputTokens > initial.budgetReceipt.estimatedInputTokens,
  );
});

test("the second call is the last one whatever its reason", () => {
  const consumed = consumeRepair(INITIAL_REPAIR_LEDGER);
  assert.equal(consumed.repairConsumed, true);

  const third = assemble({
    ...REPAIR,
    invocationKind: "mechanicalRepair",
    ledger: consumed,
  });
  assert.equal(third.kind, "blocked");
  assert.equal(third.code, "PROPOSAL_REPAIR_EXHAUSTED");
  // The ledger is the server's own fact and cannot be spent twice.
  assert.throws(() => consumeRepair(consumed), /repair-already-consumed/u);
});

test("repair metadata is required on a repair and forbidden on an initial call", () => {
  assert.equal(assemble({ invocationKind: "schemaRepair" }).code, "PROPOSAL_FORM_INVALID");
  assert.equal(
    assemble({ diagnostics: { code: "x" }, priorProposal: {} }).code,
    "PROPOSAL_FORM_INVALID",
  );
});

test("the gate measures the assembled request, not the context alone", () => {
  // A profile the frozen context fits inside comfortably on its own.
  const tight = providerBudgetProfile("test:tight", {
    contextWindowTokens: 1_200,
    completionReserveTokens: 400,
    safetyMarginTokens: 200,
    counterRef: "conservative-v1",
  });
  const small = assemble({ budgetProfile: tight });
  assert.equal(small.kind, "ready");

  // The same context overflows once a large system prompt is assembled around
  // it -- which a ceiling applied to the context alone would never catch.
  const large = assemble({
    budgetProfile: tight,
    systemPrompt: "裁决守则。".repeat(200),
  });
  assert.equal(large.kind, "blocked");
  assert.equal(large.code, "PROPOSAL_INPUT_BUDGET_EXCEEDED");
  assert.equal(large.budgetReceipt.decision, "blocked");
  assert.ok(large.budgetReceipt.estimatedInputTokens > large.budgetReceipt.allowedInputTokens);
  // Nothing was assembled to send.
  assert.equal("providerBody" in large, false);
  assert.equal("requestHash" in large, false);
});

test("a budget refusal cannot be dressed up as a provider call", () => {
  const large = assemble({
    budgetProfile: providerBudgetProfile("test:tiny", {
      contextWindowTokens: 300,
      completionReserveTokens: 100,
      safetyMarginTokens: 100,
      counterRef: "conservative-v1",
    }),
  });
  assert.equal(large.kind, "blocked");

  const receipt = proposalInvocationReceipt({
    contextHash: CONTEXT.binding.contextHash,
    assembled: large,
    invocationKind: "initial",
    invocationOrdinal: 1,
    budgetProfileHash: VNEXT_PROPOSAL_BUDGET.profileHash,
  });
  assert.equal(receipt.providerRunCount, 0);
  assert.equal("modelInvocationReceipt" in receipt, false);
  assert.equal(receipt.budgetDecision, "blocked");

  // A refusal that never reached a provider must not be able to present
  // evidence of a call, or it becomes indistinguishable from a timeout.
  assert.throws(
    () => proposalInvocationReceipt({
      contextHash: CONTEXT.binding.contextHash,
      assembled: large,
      invocationKind: "initial",
      invocationOrdinal: 1,
      budgetProfileHash: VNEXT_PROPOSAL_BUDGET.profileHash,
      modelInvocationReceipt: { latencyMs: 12 },
    }),
    /blocked-invocation-cannot-carry-model-receipt/u,
  );

  const sent = proposalInvocationReceipt({
    contextHash: CONTEXT.binding.contextHash,
    assembled: assemble(),
    invocationKind: "initial",
    invocationOrdinal: 1,
    budgetProfileHash: VNEXT_PROPOSAL_BUDGET.profileHash,
    modelInvocationReceipt: { latencyMs: 12 },
  });
  assert.equal(sent.providerRunCount, 1);
});

test("the conservative counter overestimates and is deterministic", () => {
  assert.equal(conservativeInputTokens("吊灯"), conservativeInputTokens("吊灯"));
  // A CJK character costs a whole token; latin costs a third of one. Both are
  // above what a BPE tokenizer typically produces, on purpose.
  const cjk = conservativeInputTokens("吊灯铁链") - conservativeInputTokens("");
  const latin = conservativeInputTokens("abcd") - conservativeInputTokens("");
  assert.equal(cjk, 4);
  assert.equal(latin, 2);
  assert.ok(cjk > latin);

  assert.throws(
    () => providerBudgetProfile("test:inverted", {
      contextWindowTokens: 1_000,
      completionReserveTokens: 800,
      safetyMarginTokens: 400,
      counterRef: "conservative-v1",
    }),
    /must-exceed-reserve-and-margin/u,
  );
  assert.throws(
    () => providerBudgetProfile("test:unknown-counter", {
      contextWindowTokens: 1_000,
      completionReserveTokens: 100,
      safetyMarginTokens: 100,
      counterRef: "exact-v1",
    }),
    /counterRef:unsupported/u,
  );
});
