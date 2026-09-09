import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { stepActionToDecision } from './fixtures/vnext-action-lifecycle.mjs';
import { soleStep } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { hazardBundle, itemBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { validateAuthoredDefinitionSource } from "../app/_runtime/lib/rules/v2/authored-materialization.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { validateVNextProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";

const PRIVATE = "private:diagnostic-canary-4729";
const cases = [
  { id: "unknown-effect", kind: "ability", path: "/source/content/effects/0/kind",
    mutate(content) { content.effects[0].kind = "flying"; } },
  { id: "untagged-attack", kind: "ability", path: "/source/content/attack/ability",
    mutate(content) { content.attack = { ability: "invalid", proficiency: true }; } },
  { id: "rules-basis", kind: "ability", path: "/source/content/rulesBasis",
    mutate(content) { content.rulesBasis = "srd5.2-2024"; } },
  { id: "weapon-mastery", kind: "ability", path: "/source/content/weaponMastery",
    mutate(content) { content.weaponMastery = PRIVATE; } },
  { id: "compiler-dice", kind: "ability", path: "/source/content/damage/0/formula",
    mutate(content) { content.damage[0].formula = "1001d6"; } },
  { id: "stack-charges", kind: "item", path: "/source/content/chargesMaximum",
    mutate(content) { content.chargesMaximum = 3; } },
];

function validBundle(kind, atomic = false) {
  const bundle = kind === "item" ? itemBundle() : hazardBundle();
  const sourceIndex = kind === "item" ? 1 : 0;
  if (!atomic) {
    const proposal = bundle.proposals[sourceIndex];
    if (kind === "item") {
      proposal.source.content.use = null;
      proposal.consumes = [];
    }
    bundle.proposals = [proposal];
  }
  const index = atomic ? sourceIndex : 0;
  bundle.proposals[index].source.content.description = PRIVATE;
  return { bundle, index };
}
function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  return typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wire(child)])) : value;
}
function candidate(bundle) {
  const { schema: _schema, kind: _kind, ...args } = bundle;
  return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire(args))));
}
function lower(fixture, value) { return lowerVNext2ProposalBundle({ ...fixture, value }); }
function sourceDiagnostic(source, path) {
  const result = validateAuthoredDefinitionSource(source);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(typeof result.code, "string");
  const diagnostic = result.diagnostics.find((item) => item.path === path);
  assert.ok(diagnostic, `missing exact path ${path}: ${JSON.stringify(result)}`);
  assert.equal(typeof diagnostic.reason, "string");
  assert.ok(diagnostic.reason.length > 0);
  assert.equal(JSON.stringify(result.diagnostics).includes(PRIVATE), false);
  return diagnostic;
}
function assertIssues(issues, path, reason) {
  assert.ok(issues.some((issue) => issue.includes(path) && issue.includes(reason)), JSON.stringify(issues));
  assert.equal(JSON.stringify(issues).includes(PRIVATE), false);
}

test("authored diagnostics preserve legal custom Ability and Item values through real validation and Rules", () => {
  for (const kind of ["ability", "item"]) {
    const fixture = createAuthoredProbeFixture(`diagnostic-valid-${kind}`);
    const { bundle } = validBundle(kind);
    const source = bundle.proposals[0].source;
    if (kind === "ability") {
      source.content.save.dc = 55;
      source.content.effect = { kind: "fixedDamage", amount: 2_000_000, damageType: "force" };
    }
    const validated = validateAuthoredDefinitionSource(source);
    assert.equal(validated.ok, true, JSON.stringify(validated));
    assert.deepEqual(validated.source, source);
    const parsed = candidate(bundle);
    assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
    const lowered = lower(fixture, parsed.bundle);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    assert.deepEqual(soleStep(lowered.command).plan.source, source);
    const committed = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, lowered.command.rulesInput);
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    const replayed = fixture.runtime.replay(fixture.genesis, committed.events);
    assert.equal(replayed.kind, "replayed");
    assert.deepEqual(replayed.state, committed.state);
    if (kind === "ability") {
      const definition = Object.values(committed.state.combatRuntime.definitions).find((item) => item.description === PRIVATE);
      assert.ok(definition);
      assert.equal(definition.save.dc, 55);
      assert.equal(definition.effect.amount, 2_000_000);
    }
  }
});

test("source diagnostics identify enum, foreign fields, compiler dice and Item conflicts through the same wire and lowerer", () => {
  const fixture = createAuthoredProbeFixture("diagnostic-wire");
  for (const example of cases) {
    const { bundle, index } = validBundle(example.kind, true);
    const proposal = bundle.proposals[index];
    example.mutate(proposal.source.content);
    const diagnostic = sourceDiagnostic(proposal.source, example.path);
    if (example.id === "compiler-dice") assert.equal(diagnostic.reason, "a dice term exceeds 1,000 dice");
    const path = `/proposals/${index}${example.path}`;
    const parsed = candidate(bundle);
    assert.equal(parsed.kind, "locallyRejected", JSON.stringify(parsed));
    assertIssues(parsed.issues, path, diagnostic.reason);
    const validated = validateVNextProposalBundle(parsed.draft);
    assert.equal(validated.kind, "rejected");
    assertIssues(validated.issues, path, diagnostic.reason);
    const lowered = lower(fixture, parsed.draft);
    assert.equal(lowered.kind, "rejected");
    assertIssues(lowered.issues, path, diagnostic.reason);
    proposal.summary = "";
  }
  const { bundle } = validBundle("ability");
  bundle.proposals[0].summary = "";
});

test("Rules independently retains source diagnostics and publishes no effects for malformed direct and atomic sources", () => {
  for (const example of cases) for (const atomic of [false, true]) {
    const fixture = createAuthoredProbeFixture(`diagnostic-rules-${example.id}-${atomic}`);
    const { bundle, index } = validBundle(example.kind, atomic);
    const lowered = lower(fixture, bundle);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const input = structuredClone(lowered.command.rulesInput);
    const source = atomic ? atomicCompletionInput(input).steps[index].rulesInput.plan.source : input.plan.source;
    example.mutate(source.content);
    const diagnostic = sourceDiagnostic(source, example.path);
    const before = structuredClone(fixture.state);
    const result = stepActionToDecision(fixture.runtime, fixture.profiles, fixture.state, input);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.deepEqual(result.events, []);
    assert.deepEqual(fixture.state, before);
    assert.ok(result.rejection.diagnostics?.some((item) => item.path?.includes(example.path)
      && item.message.includes(diagnostic.reason)), JSON.stringify({ id: example.id, atomic, rejection: result.rejection }));
    assert.equal(JSON.stringify(result.rejection).includes(PRIVATE), false);
  }
});

test("invalid source values do not enter static diagnostics", () => {
  const { bundle } = validBundle("ability");
  const source = bundle.proposals[0].source;
  source.content.effects[0].kind = "flying";
  const first = validateAuthoredDefinitionSource(source);
  source.content.effects[0].kind = PRIVATE;
  const second = validateAuthoredDefinitionSource(source);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.deepEqual(second.diagnostics, first.diagnostics);
  assert.equal(JSON.stringify(second.diagnostics).includes(PRIVATE), false);
  source.content.effects[0] = { kind: "endEffect", condition: "blinded", sourceRef: `${PRIVATE} invalid ref` };
  sourceDiagnostic(source, "/source/content/effects/0/sourceRef");
});

test("inventory and ownership type errors retain exact nested paths", () => {
  for (const [ordinal, path, mutate] of [
    [3, ["operation"], proposal => { proposal.operation = 7; }],
    [3, ["operation", "entryRef"], proposal => { proposal.operation.entryRef = 7; }],
    [2, ["ownership", "ownerRef"], proposal => { proposal.ownership = { kind: "character", ownerRef: 7 }; }],
  ]) for (const nested of [false, true]) {
    const bundle = itemBundle();
    assert.equal(candidate(bundle).kind, "accepted");
    bundle.proposals[ordinal].summary = PRIVATE;
    mutate(bundle.proposals[ordinal]);
    const value = nested ? {
      schema: bundle.schema, kind: bundle.kind, mode: "terminal", basisRefs: [], adjudication: null, proposals: [],
      terminal: { kind: "clarification", intent: "继续已定行动。", method: "采用已定操作。", question: "继续还是取消？", choices: [
        { choiceId: "continue", label: "继续", publicRisk: "保留既定后果。", basisRefs: [],
          continuation: { kind: "adjudication", basisRefs: bundle.basisRefs, adjudication: bundle.adjudication, proposals: bundle.proposals } },
        { choiceId: "cancel", label: "取消", publicRisk: "不执行。", basisRefs: [], continuation: { kind: "cancel" } },
      ] },
    } : bundle;
    const before = structuredClone(value);
    const parsed = candidate(value);
    assert.equal(parsed.kind, "locallyRejected");
    const expectedPath = [...(nested ? ["terminal", "choices", 0, "continuation"] : []), "proposals", ordinal, ...path];
    const diagnostic = parsed.diagnostics.find(detail => JSON.stringify(detail.path) === JSON.stringify(expectedPath));
    assert.ok(diagnostic, JSON.stringify(parsed.diagnostics));
    assert.equal(diagnostic.code, "TYPE_MISMATCH");
    assert.deepEqual(diagnostic.actual, { type: "number", value: 7 });
    if (path.length === 1) assert.ok(diagnostic.expected.anyOf.every(branch => branch.type === "object"));
    else assert.equal(diagnostic.expected.type, "string");
    assert.equal(diagnostic.repair.allowed, false);
    assert.equal(JSON.stringify(parsed.diagnostics).includes(PRIVATE), false);
    bundle.proposals[ordinal].summary = "";
    bundle.proposals[ordinal].summary = PRIVATE;
    assert.deepEqual(value, before);
  }
});
