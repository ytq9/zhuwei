import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { sharedCheckBundle } from "./fixtures/vnext-shared-check.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { validateVNextProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator.ts";
import { validateVNextProposalBundleDependencies } from "../app/_runtime/lib/kp/vnext/proposal-graph.ts";
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA, decodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { itemBundle, hazardBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { worldFactSocialBundle } from "./fixtures/vnext-world-facts.mjs";
import { validateAuthoredDefinitionSource } from "../app/_runtime/lib/rules/v2/authored-materialization.ts";

const domain = wire => ({ ...decodeVNextStrictToolBundle(encodeVNextStrictToolBundle(wire)), schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle" });
function diagnosed(bundle, code, path, constraint) {
  const result = validateVNextProposalBundle(bundle);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  const diagnostic = result.diagnostics.find(entry => entry.code === code
    && JSON.stringify(entry.path) === JSON.stringify(path) && (constraint === undefined || entry.constraint === constraint));
  assert.ok(diagnostic, JSON.stringify(result));
  assert.equal(diagnostic.repair.allowed, false);
  return diagnostic;
}

test("different proposal families retain exact missing, type and value diagnostics", () => {
  for (const kind of ["observe", "worldInteraction"]) {
    for (const [mutate, code, path] of [
      [wire => { delete wire.proposals[1].method; }, "FIELD_MISSING", ["proposals", 1, "method"]],
      [wire => { wire.proposals[1].method = 17; }, "TYPE_MISMATCH", ["proposals", 1, "method"]],
      [wire => { wire.adjudication.dc = 99; }, "VALUE_INVALID", ["adjudication", "dc"]],
    ]) {
      const wire = sharedCheckBundle(kind); mutate(wire);
      const result = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
      assert.equal(result.kind, "locallyRejected");
      assert.ok(result.diagnostics?.some(d => d.code === code && JSON.stringify(d.path) === JSON.stringify(path)), JSON.stringify(result));
    }
  }
});

test("bundle modes locate invalid active containers and inactive branches without supplying decisions", () => {
  for (const mode of ['adjudication', 'terminal']) {
    const bundle = mode === 'adjudication' ? domain(sharedCheckBundle())
      : domain({ mode: 'terminal', basisRefs: [], adjudication: { kind: 'none' }, proposals: [],
        terminal: { kind: 'knowledgeReview', inquiry: '已知信息', scope: 'relevantKnown', knowledgeRefs: [] } });
    assert.equal(validateVNextProposalBundle(bundle).kind, 'accepted');
    for (const [key, value, code] of [
      ['proposals', {}, 'TYPE_MISMATCH'],
      [mode === 'adjudication' ? 'adjudication' : 'terminal', 7, 'TYPE_MISMATCH'],
      [mode === 'adjudication' ? 'terminal' : 'adjudication', {}, 'CONSTRAINT_CONFLICT'],
      ['proposals', mode === 'adjudication' ? [] : [domain(sharedCheckBundle()).proposals[0]], 'VALUE_INVALID'],
    ]) {
      const diagnostic = diagnosed({ ...bundle, [key]: value }, code, [key]);
      assert.ok(diagnostic.expected !== undefined && diagnostic.actual !== undefined);
    }
  }
});

test("enum and reference arrays identify submitted slots across observation and world interaction", () => {
  for (const kind of ["observe", "worldInteraction"]) {
    const enumBundle = domain(sharedCheckBundle(kind));
    enumBundle.adjudication.ability = "luck";
    const enumeration = diagnosed(enumBundle, "VALUE_INVALID", ["adjudication", "ability"]);
    assert.deepEqual(enumeration.expected.enum, ["str", "dex", "con", "int", "wis", "cha"]);
    assert.deepEqual(enumeration.actual, { type: "string", value: "luck" });
    for (const [value, code, suffix] of [[false, "TYPE_MISMATCH", []], [[17], "TYPE_MISMATCH", [0]],
      [["bad reference"], "VALUE_INVALID", [0]], [["fact:repeat", "fact:repeat"], "VALUE_INVALID", [1]]]) {
      const bundle = domain(sharedCheckBundle(kind));
      bundle.proposals[1].basisRefs = value;
      diagnosed(bundle, code, ["proposals", 1, "basisRefs", ...suffix]);
    }
  }
});

test("dependency declarations retain container and member diagnostics before graph validation", () => {
  const existing = { kind: "existing", ref: "definition:loaded" };
  for (const kind of ["observe", "worldInteraction"]) {
    for (const [field, value, code, suffix] of [
      ["consumes", undefined, "FIELD_MISSING", []],
      ["consumes", 7, "TYPE_MISMATCH", []],
      ["produces", {}, "TYPE_MISMATCH", []],
      ["consumes", [7], "TYPE_MISMATCH", [0]],
      ["produces", [null], "TYPE_MISMATCH", [0]],
      ["consumes", [{}], "FIELD_MISSING", [0, "kind"]],
      ["consumes", [{ kind: "unknown" }], "VALUE_INVALID", [0, "kind"]],
      ["consumes", [{ kind: "prospective", handle: 7 }], "TYPE_MISMATCH", [0, "handle"]],
      ["consumes", [{ kind: "prospective", handle: "not-local" }], "VALUE_INVALID", [0, "handle"]],
      ["consumes", [existing, { ...existing }], "VALUE_INVALID", [1]],
      ["produces", [{ kind: "itemEntry", handle: 7, outcomeBinding: "always" }], "TYPE_MISMATCH", [0, "handle"]],
      ["produces", [{ kind: "itemEntry", handle: "prospective:item", outcomeBinding: "later" }], "VALUE_INVALID", [0, "outcomeBinding"]],
      ["produces", [{ kind: "itemEntry", handle: "prospective:item", outcomeBinding: 7 }], "TYPE_MISMATCH", [0, "outcomeBinding"]],
      ["produces", [{}, {}], "VALUE_INVALID", []],
    ]) {
      const wire = domain(sharedCheckBundle(kind));
      if (value === undefined) delete wire.proposals[1][field];
      else wire.proposals[1][field] = value;
      const result = validateVNextProposalBundle(wire);
      assert.equal(result.kind, "rejected");
      const detail = result.diagnostics.find(d => d.code === code
        && JSON.stringify(d.path) === JSON.stringify(["proposals", 1, field, ...suffix]));
      assert.ok(detail, JSON.stringify(result));
      assert.ok(detail.expected !== undefined && detail.actual !== undefined);
      assert.equal(detail.repair.allowed, false);
    }
  }
});

test("observation evidence reports its real branch rather than a synthetic object", () => {
  const bundle = domain(sharedCheckBundle("observe"));
  bundle.proposals[1].branches.success.summary = 7;
  diagnosed(bundle, "TYPE_MISMATCH", ["proposals", 1, "branches", "success", "summary"]);
  bundle.proposals[1].branches.success.summary = "已观察。";
  bundle.proposals[1].branches.success.sensoryEvidence[0].sense = "mindRead";
  diagnosed(bundle, "VALUE_INVALID", ["proposals", 1, "branches", "success", "sensoryEvidence", 0, "sense"]);
});

test("producer contracts identify forbidden, missing and inconsistent declarations across proposal families", () => {
  const observed = domain(sharedCheckBundle("observe"));
  const interacted = domain(sharedCheckBundle("worldInteraction"));
  const social = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker" }));
  const inventory = itemBundle();
  for (const [bundle, ordinal] of [[observed, 1], [interacted, 1], [social, 1], [inventory, 3]]) {
    assert.equal(validateVNextProposalBundle(bundle).kind, "accepted");
    bundle.proposals[ordinal].produces = [{ kind: "semanticDefinition", handle: "prospective:new", outcomeBinding: "always" }];
    const detail = diagnosed(bundle, "CONSTRAINT_CONFLICT", ["proposals", ordinal, "produces"], "proposal-producer-count");
    assert.deepEqual(detail.expected, { type: "array", minItems: 0, maxItems: 0 });
    assert.deepEqual(detail.actual, { type: "array", length: 1 });
  }
  for (const [factory, ordinal] of [[itemBundle, 0], [itemBundle, 1], [itemBundle, 2],
    [hazardBundle, 1], [() => domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker" })), 0]]) {
    for (const damage of ["missing", "kind", "binding"]) {
      const bundle = factory(), declaration = bundle.proposals[ordinal].produces[0];
      assert.equal(validateVNextProposalBundle(bundle).kind, "accepted");
      const expectedKind = declaration.kind;
      if (damage === "missing") bundle.proposals[ordinal].produces = [];
      else if (damage === "kind") declaration.kind = expectedKind === "itemEntry" ? "semanticDefinition" : "itemEntry";
      else declaration.outcomeBinding = "onFailure";
      const suffix = damage === "missing" ? [] : [0, damage === "kind" ? "kind" : "outcomeBinding"];
      const detail = diagnosed(bundle, "CONSTRAINT_CONFLICT", ["proposals", ordinal, "produces", ...suffix]);
      if (damage === "kind") assert.deepEqual(detail.expected.enum, [expectedKind]);
      if (damage === "binding") assert.deepEqual(detail.expected.enum, ["always"]);
    }
  }
});

test("entry discriminants, quantities and branch containers retain their original field requirements", () => {
  for (const kind of ["observe", "worldInteraction"]) {
    for (const [field, value, code] of [["kind", undefined, "FIELD_MISSING"], ["kind", 7, "TYPE_MISMATCH"],
      ["branches", 7, "TYPE_MISMATCH"]]) {
      const bundle = domain(sharedCheckBundle(kind));
      if (value === undefined) delete bundle.proposals[1][field]; else bundle.proposals[1][field] = value;
      diagnosed(bundle, code, ["proposals", 1, field]);
    }
    for (const [value, code] of [[{}, "TYPE_MISMATCH"], [Array(17).fill({}), "VALUE_INVALID"]]) {
      const bundle = domain(sharedCheckBundle(kind));
      bundle.proposals[1].branches.success.sensoryEvidence = value;
      diagnosed(bundle, code, ["proposals", 1, "branches", "success", "sensoryEvidence"]);
    }
  }
  for (const [quantity, code] of [["2", "TYPE_MISMATCH"], [0, "VALUE_INVALID"], [1_000_001, "VALUE_INVALID"]]) {
    const bundle = itemBundle(); bundle.proposals[2].quantity = quantity;
    const detail = diagnosed(bundle, code, ["proposals", 2, "quantity"]);
    assert.deepEqual(detail.expected, { type: "integer", minimum: 1, maximum: 1_000_000 });
  }
  const bundle = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker" }));
  bundle.proposals[1].branches.success.response.text = 7;
  const detail = diagnosed(bundle, "TYPE_MISMATCH", ["proposals", 1, "branches", "success", "response", "text"]);
  assert.equal(detail.expected.type, "string");
});

test("unknown proposal kinds report their actual discriminant across different proposal families", () => {
  for (const [bundle, ordinal] of [[domain(sharedCheckBundle("observe")), 1], [itemBundle(), 2]]) {
    const originalKind = bundle.proposals[ordinal].kind;
    bundle.proposals[ordinal].kind = "unregisteredProposal";
    const detail = diagnosed(bundle, "VALUE_INVALID", ["proposals", ordinal, "kind"]);
    assert.equal(detail.expected.type, "string");
    assert.ok(detail.expected.enum.includes(originalKind));
    assert.ok(!detail.expected.enum.includes("unregisteredProposal"));
    assert.deepEqual(detail.actual, { type: "string", value: "unregisteredProposal" });
  }
});

test("authored reference grammar locates scalar and nested slots without matching prose values", () => {
  for (const [ordinal, path] of [[2, ["definitionRef"]], [2, ["sceneRef"]],
    [3, ["operation", "entryRef"]], [4, ["operation", "targetRefs", 0]]]) {
    for (const invalidRef of ["bad reference", "prospective:"]) {
      const bundle = itemBundle();
      assert.equal(validateVNextProposalBundle(bundle).kind, "accepted");
      let parent = bundle.proposals[ordinal];
      for (const segment of path.slice(0, -1)) parent = parent[segment];
      parent[path.at(-1)] = invalidRef;
      // The same text in prose must not be reported as a reference slot.
      bundle.proposals[ordinal].summary = invalidRef;
      const detail = diagnosed(bundle, "VALUE_INVALID", ["proposals", ordinal, ...path], "reference-field-grammar");
      assert.deepEqual(detail.expected, { type: "string", referenceKind: "existing-or-prospective" });
      assert.deepEqual(detail.actual, { type: "string", value: invalidRef });
    }
  }
});

test("social transport enums use the same field contract without changing speech semantics", () => {
  const bundle = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker" }));
  assert.equal(validateVNextProposalBundle(bundle).kind, "accepted");
  bundle.proposals[1].communication = 7;
  const diagnostic = diagnosed(bundle, "TYPE_MISMATCH", ["proposals", 1, "communication"]);
  assert.deepEqual(diagnostic.expected, { type: "string", enum: ["spokenConversation"] });
});

test("existing NPC knowledge cannot masquerade as a same-bundle materialization", () => {
  for (const ref of ["knowledge:npc:speaker:memory:one", "definition:older-world-fact"]) {
    const bundle = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker", check: true }));
    for (const name of ["success", "failure"]) bundle.proposals[1].branches[name].response.basis[0].definitionRef = ref;
    const result = validateVNextProposalBundle(bundle);
    assert.equal(result.kind, "rejected");
    assert.deepEqual(result.diagnostics.map(d => d.path), [
      ["proposals", 1, "branches", "success", "response", "basis", 0, "definitionRef"],
      ["proposals", 1, "branches", "failure", "response", "basis", 0, "definitionRef"],
    ]);
    assert.ok(result.diagnostics.every(d => d.code === "REFERENCE_UNAVAILABLE" && d.repair.allowed === false));
  }
  const existing = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker" }));
  existing.proposals[1].branches.success.response.basis = [{ kind: "npcContext", ref: "knowledge:npc:speaker:memory:one" }];
  existing.proposals[1].consumes = [];
  assert.equal(validateVNextProposalBundle(existing).kind, "accepted");
  const fresh = domain(worldFactSocialBundle({ sceneRef: "scene:shared", npcRef: "npc:speaker", check: true }));
  assert.equal(validateVNextProposalBundle(fresh).kind, "accepted");
});

test("cross-field failures identify target subset and shared check constraints", () => {
  const target = domain(sharedCheckBundle("worldInteraction"));
  target.proposals[1].directTargetRefs = ["definition:another"];
  diagnosed(target, "CONSTRAINT_CONFLICT", ["proposals", 1, "directTargetRefs"], "direct-targets-must-be-targets");
  const direct = domain(sharedCheckBundle("observe"));
  direct.adjudication = { kind: "directSuccess", durationMicros: "300000000", risk: "无需检定。", successOutcome: "直接完成。" };
  diagnosed(direct, "CONSTRAINT_CONFLICT", ["proposals", 0, "outcomeBinding"], "bundle:non-random-outcome-binding-invalid");
  const missingCheck = domain(sharedCheckBundle("observe"));
  missingCheck.proposals[1].branches.failure = null;
  diagnosed(missingCheck, "CONSTRAINT_CONFLICT", ["adjudication"], "bundle:shared-check-shape-invalid");
});

test("authored source diagnostics retain source reasons and actual nested field paths", () => {
  const bundle = hazardBundle();
  assert.equal(validateVNextProposalBundle(bundle).kind, "accepted");
  delete bundle.proposals[0].source.content.label;
  const missing = diagnosed(bundle, "FIELD_MISSING", ["proposals", 0, "source", "content", "label"]);
  assert.equal(missing.constraint, "required authored source field is missing");
  bundle.proposals[0].source.content.label = "A frozen danger";
  bundle.proposals[0].source.content.damage[0].formula = false;
  const invalid = diagnosed(bundle, "TYPE_MISMATCH", ["proposals", 0, "source", "content", "damage", 0, "formula"]);
  assert.match(invalid.constraint, /expected nonempty canonical NFC text/);
  assert.deepEqual(invalid.actual, { type: "boolean", value: false });
  assert.equal(invalid.expected.type, "string");
});

test("authored schema distinguishes wrong types from invalid values using the original schema metadata", () => {
  for (const [mutate, code, sourcePath, path, type] of [
    [content => { content.damage[0].formula = false; }, "TYPE_MISMATCH", "/source/content/damage/0/formula", ["damage", 0, "formula"], "string"],
    [content => { content.damage[0].formula = ""; }, "VALUE_INVALID", "/source/content/damage/0/formula", ["damage", 0, "formula"], "string"],
    [content => { content.damage[0].type = false; }, "TYPE_MISMATCH", "/source/content/damage/0/type", ["damage", 0, "type"], "string"],
    [content => { content.damage[0].type = "unregistered"; }, "VALUE_INVALID", "/source/content/damage/0/type", ["damage", 0, "type"], "string"],
    [content => { content.save.dc = "13"; }, "TYPE_MISMATCH", "/source/content/save/dc", ["save", "dc"], "integer"],
    [content => { content.save.dc = -1; }, "VALUE_INVALID", "/source/content/save/dc", ["save", "dc"], "integer"],
  ]) {
    const bundle = hazardBundle();
    mutate(bundle.proposals[0].source.content);
    const sourceResult = validateAuthoredDefinitionSource(bundle.proposals[0].source);
    assert.equal(sourceResult.ok, false);
    const sourceDiagnostic = sourceResult.diagnostics.find(diagnostic => diagnostic.path === sourcePath);
    assert.equal(sourceDiagnostic.code, code);
    assert.equal(sourceDiagnostic.expected.type, type);
    const diagnostic = diagnosed(bundle, code, ["proposals", 0, "source", "content", ...path]);
    assert.equal(diagnostic.constraint, sourceDiagnostic.reason);
    assert.deepEqual(diagnostic.expected, sourceDiagnostic.expected);
  }
});

function underClarification(bundle) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "terminal", basisRefs: [], adjudication: null,
    proposals: [], terminal: { kind: "clarification", intent: "执行行动。", method: "按选项执行。", question: "要继续吗？", choices: [
      { choiceId: "continue", label: "继续", publicRisk: "按既定后果执行。", basisRefs: [],
        continuation: { kind: "adjudication", basisRefs: bundle.basisRefs, adjudication: bundle.adjudication, proposals: bundle.proposals } },
      { choiceId: "cancel", label: "取消", publicRisk: "不执行行动。", basisRefs: [], continuation: { kind: "cancel" } },
    ] } };
}

test("nested clarification retains authored and field diagnostic paths", () => {
  const field = underClarification(domain(sharedCheckBundle("observe")));
  assert.equal(validateVNextProposalBundle(field).kind, "accepted");
  field.terminal.choices[0].continuation.proposals[1].method = 17;
  diagnosed(field, "TYPE_MISMATCH", ["terminal", "choices", 0, "continuation", "proposals", 1, "method"]);
  const authored = underClarification(hazardBundle());
  delete authored.terminal.choices[0].continuation.proposals[0].source.content.label;
  diagnosed(authored, "FIELD_MISSING", ["terminal", "choices", 0, "continuation", "proposals", 0, "source", "content", "label"]);
});

test("authored hazard area alternatives remain valid with precise closed-field rejection", () => {
  for (const area of [undefined, { origin: { x: "0", y: "0", elevation: "0" } },
    { origin: { x: "0", y: "0", elevation: "0" }, direction: { x: "1", y: "0", elevation: "0" } }]) {
    const bundle = hazardBundle();
    if (area !== undefined) bundle.proposals[2].branches.success.effects[0].damage.area = area;
    assert.equal(validateVNextProposalBundle(bundle).kind, "accepted", JSON.stringify(validateVNextProposalBundle(bundle)));
  }
  const extra = hazardBundle();
  extra.proposals[2].branches.success.effects[0].damage.unexpected = true;
  diagnosed(extra, "VALUE_INVALID", ["proposals", 2, "branches", "success", "effects", 0, "damage", "unexpected"]);
});

test("graph diagnostics distinguish missing producers, wrong types and duplicate producer slots", () => {
  const missing = itemBundle();
  missing.proposals[3].operation.entryRef = "prospective:missing";
  missing.proposals[3].consumes = [{ kind: "prospective", handle: "prospective:missing" }];
  diagnosed(missing, "REFERENCE_UNAVAILABLE", ["proposals", 3, "consumes", 0, "handle"], "bundle:prospective-consumer-unbound");
  const wrongType = itemBundle();
  wrongType.proposals[2].definitionRef = wrongType.proposals[0].produces[0].handle;
  wrongType.proposals[2].consumes = [{ kind: "prospective", handle: wrongType.proposals[2].definitionRef }];
  const diagnostic = diagnosed(wrongType, "CONSTRAINT_CONFLICT", ["proposals", 2, "definitionRef"], "bundle:prospective-type-mismatch");
  assert.deepEqual(diagnostic.expected, { producerKind: "itemDefinition" });
  assert.equal(diagnostic.actual.producerKind, "abilityDefinition");
  const duplicate = itemBundle();
  duplicate.proposals[1].produces[0].handle = duplicate.proposals[0].produces[0].handle;
  diagnosed(duplicate, "CONSTRAINT_CONFLICT", ["proposals", 1, "produces", 0, "handle"], "bundle:prospective-producer-duplicate");
});

test("dependency cycle and outcome domination diagnostics do not authorize rewriting decisions", () => {
  const cycle = itemBundle();
  const handle = cycle.proposals[2].produces[0].handle;
  cycle.proposals[0].basisRefs.push(handle);
  cycle.proposals[0].consumes.push({ kind: "prospective", handle });
  diagnosed(cycle, "CONSTRAINT_CONFLICT", ["proposals"], "bundle:dependency-cycle");
  const entries = itemBundle().proposals;
  entries[0].produces[0].outcomeBinding = "onFailure";
  const diagnostics = [];
  const issues = validateVNextProposalBundleDependencies(entries, diagnostics);
  assert.ok(issues.some(issue => issue.startsWith("bundle:prospective-condition-not-dominated:")));
  const mismatch = diagnostics.find(diagnostic => diagnostic.constraint === "bundle:prospective-condition-not-dominated");
  assert.deepEqual(mismatch.path, ["proposals", 1, "consumes", 0, "handle"]);
  assert.equal(mismatch.repair.allowed, false);
  assert.equal(mismatch.actual.producerOutcomeBinding, "onFailure");
});


test("enum alternatives cannot accept arrays through implicit string coercion", () => {
  const wire = sharedCheckBundle(); wire.adjudication.mode = ["normal"];
  const result = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
  assert.equal(result.kind, "locallyRejected");
  assert.equal(result.diagnostics[0].code, "TYPE_MISMATCH");
  assert.deepEqual(result.diagnostics[0].path, ["adjudication", "mode"]);
});
