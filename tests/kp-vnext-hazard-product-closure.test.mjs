import { actDuration } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthoredProbeFixture, freezeAuthoredProbeContext,
  PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_SCENE as SCENE,
  PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE,
} from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { hazardBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { invokeSubmitKpProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";

// Controlled KP decisions travel in the same tool-call shape as a Provider.
// This proves the consecutive authority/knowledge lifecycle, not model quality,
// HTTP/Room persistence, or the independent production request-budget gate.
function strictWire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(strictWire);
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, strictWire(child)]))
    : value;
}

function authoring(triggerKind) {
  const value = hazardBundle();
  value.proposals.pop();
  for (const proposal of value.proposals) proposal.visibilityPolicyRef = "visibility:hidden-until-evidence";
  const mechanics = value.proposals[0].source.content;
  Object.assign(mechanics, {
    target: { kind: "area", rangeInches: "120", shape: { kind: "sphere", radiusInches: "120", propagation: "straight" } },
    save: { ability: "dex", dc: 13, halfOnSuccess: true },
    damage: [{ formula: "1d6", type: "fire", sharedAcrossTargets: true }],
    effects: [{ kind: "grantEffect", condition: "blinded", duration: { kind: "timed", durationMicros: "10000000" } }],
  });
  Object.assign(value.proposals[1].source.content, {
    label: "PRIVATE_HAZARD_IDENTITY",
    trigger: { kind: triggerKind, ref: triggerKind === "enterZone" ? ZONE : SOURCE },
    perceptibleSigns: ["接缝间透出细雾，附近石面上有旧灼痕。"],
    disableMethods: ["阻断供给并固定控制件，使连接无法再次打开。"],
    environmentalConsequences: ["石面留下新的灼痕与冷凝水。"],
  });
  return value;
}

function interaction(intent, { effects = [], evidence, basisRefs = [SOURCE], targetRef = SOURCE, actionable = false } = {}) {
  return {
    kind: "worldInteraction", basisRefs, consumes: [], produces: [], outcomeBinding: "always",
    sceneRef: SCENE, targetRefs: [targetRef], directTargetRefs: [targetRef], instrumentRefs: [], abilityRef: null,
    intent, method: intent,
    branches: {
      success: {
        outcomeCode: "outcome:environment-interaction", summary: "按冻结依据执行本次方法。", effects,
        sensoryEvidence: evidence === undefined ? [] : [{ observerRef: ACTOR, subjectRef: SOURCE,
          sense: "sight", evidence, basisRefs }],
        pressures: actionable ? [{ description: "供给仍未关闭，控制件附近的危险仍在。", sourceRef: SOURCE, basisRefs }] : [],
        opportunities: actionable ? [{ description: "供给连接可以固定。", targetRef: SOURCE, actionHint: "可继续尝试固定供给连接。", basisRefs }] : [],
      },
      failure: null,
    },
  };
}

function bundle(proposal) {
  const value = hazardBundle();
  value.proposals = [proposal];
  value.adjudication = { kind: "directSuccess", durationMicros: actDuration([proposal]), risk: "已固化的危险仍按其独立机械结算。", successOutcome: "执行明确的操作。" };
  return value;
}

function known(context, ref) {
  const entry = context.entries.find(entry => entry.kind === "known" && entry.entryRef === ref);
  assert.ok(entry, `the next KP request must contain the authoritative ${ref}`);
  return entry.value;
}

function hazardContext(context) {
  const entry = context.entries.find(entry => entry.kind === "known" && entry.value?.definitionKind === "environmentHazard");
  assert.ok(entry, "following the visible trigger must load the hidden hazard");
  const hazard = entry.value;
  const relation = context.entries.find(entry => entry.kind === "known"
    && entry.value?.content?.kind === "triggers" && entry.value.content.objectRef === hazard.definitionId);
  assert.ok(relation, "the active or ended trigger is part of the same frozen context");
  known(context, hazard.content.mechanicsRef);
  return { hazard, relation: relation.value };
}

function revision(observableState) {
  return { kind: "definitionRevision", definitionRef: SOURCE, summary: observableState,
    operations: [{ kind: "set", path: ["observableState"], value: observableState }] };
}

function session(name) {
  const fixture = createAuthoredProbeFixture(name);
  let state = fixture.state;
  const allEvents = [];
  let callCount = 0;

  async function prepare(intent, decide) {
    const rootActionId = `${fixture.rootActionId}:action:${++callCount}`;
    const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId,
      focusRefs: [SOURCE, ZONE, TARGET], intentText: intent });
    const parsed = await invokeSubmitKpProposalBundle({
      modelId: "controlled-tool-fixture",
      message: JSON.stringify({ intent, requiredContext: frozen.context }),
      binding: { async run(_model, request) {
        assert.equal(request.tools[0].function.name, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
        assert.equal(request.parallel_tool_calls, false);
        const message = JSON.parse(request.messages.find(message => message.role === "user").content);
        assert.equal(message.requiredContext.intent.text, intent);
        const { schema: _schema, kind: _kind, ...argumentsValue } = decide(message.requiredContext);
        return { choices: [{ message: { tool_calls: [{ type: "function", function: {
          name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(encodeVNextStrictToolBundle(strictWire(argumentsValue))),
        } }] } }] };
      } },
    });
    const lowered = lowerVNext2ProposalBundle({ value: parsed, rootActionId, actorCharacterId: ACTOR,
      requiredContext: frozen.context, state });
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    return lowered.command.rulesInput;
  }

  function execute(input) {
    const priorState = state;
    let result = fixture.runtime.step(fixture.profiles, state, input);
    const events = [...result.events];
    const randomRequests = [];
    while (result.kind === "awaitingRandomness") {
      randomRequests.push(result.randomnessRequest);
      assert.equal(randomRequests.length, 1, "this frozen hazard requires only its reserved random wave");
      result = fixture.runtime.step(fixture.profiles, result.state, {
        kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
        rolls: result.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(Math.min(2, Number(die.sides)))),
      });
      events.push(...result.events);
    }
    if (result.kind !== "committed") return { result, events, randomRequests };
    state = result.state;
    allEvents.push(...events);
    const restored = fixture.runtime.replay(fixture.genesis, allEvents);
    assert.equal(restored.kind, "replayed", JSON.stringify(restored));
    assert.deepEqual(restored.state, state, "every subsequent action survives the same authoritative replay");
    const projection = fixture.runtime.project(fixture.profiles, state, fixture.viewer, {
      channel: "realtime", committedRange: { receiptId: result.receipt.receiptId,
        actorCharacterId: ACTOR, priorState, events },
    });
    assert.equal(projection.kind, "projected", JSON.stringify(projection));
    assert.ok(projection.renderableClaims, "the complete result reaches the ordinary Viewer Claims seam");
    const publicValue = JSON.stringify(projection);
    assert.equal(publicValue.includes("PRIVATE_HAZARD_IDENTITY"), false);
    assert.equal(publicValue.includes("relation:hazard-trigger:"), false);
    return { result, events, randomRequests, projection };
  }

  async function act(intent, decide) {
    const settled = execute(await prepare(intent, decide));
    assert.equal(settled.result.kind, "committed", JSON.stringify(settled.result));
    return settled;
  }
  return { fixture, prepare, execute, act, get state() { return state; }, get events() { return allEvents; } };
}

async function warn(run, triggerKind) {
  const authored = authoring(triggerKind);
  const sign = authored.proposals[1].source.content.perceptibleSigns[0];
  authored.proposals.push(interaction("查看接近控制件时已经明显可见的迹象。", { evidence: sign }));
  const result = await run.act("我留意前方控制件和地面上明显的异常。", () => authored);
  assert.equal(result.randomRequests.length, 0, "noticing a perceptible sign does not itself invoke the frozen hazard");
  assert.ok(result.projection.renderableClaims.claims.some(claim => claim.kind === "sensoryEvidence" && claim.evidence === sign));
  return sign;
}

async function disable(run) {
  return run.act("我用现场可用的方式阻断供给，再把控制件固定住。", context => {
    const { hazard, relation } = hazardContext(context);
    assert.deepEqual(hazard.content.disableMethods, ["阻断供给并固定控制件，使连接无法再次打开。"]);
    assert.equal(relation.content.state, "active");
    return bundle(interaction("按已调查的原理固定供给连接。", {
      basisRefs: [SOURCE, hazard.definitionId, relation.definitionId],
      effects: [{ kind: "relationTransition", relationRef: relation.definitionId, toState: "ended" }, revision("供给已被阻断，控制件固定在关闭位置。")],
      evidence: "供给声停止，固定后的控制件不再回弹。",
    }));
  });
}

test("contact and disturbance hazards allow signs, investigation, an open method, and a harmless later contact through one wire", async () => {
  for (const triggerKind of ["contactFeature", "disturbFeature"]) {
    const run = session(`hazard-product-${triggerKind}`);
    const sign = await warn(run, triggerKind);
    const inspected = await run.act("我沿着痕迹查看供给连接如何受控制件影响。", context => {
      const { hazard } = hazardContext(context);
      assert.equal(hazard.content.trigger.kind, triggerKind);
      assert.ok(context.entries.some(entry => entry.kind === "known" && JSON.stringify(entry.value).includes(sign)),
        "earlier sensory evidence is knowledge in the following KP request");
      return bundle(interaction("检查连接而不按下或扰动控制件。", {
        basisRefs: [SOURCE, hazard.definitionId], evidence: "供给连接与控制件相连，固定在关闭位置就能截断供给。", actionable: true,
      }));
    });
    assert.equal(inspected.randomRequests.length, 0);
    const disabled = await disable(run);
    assert.equal(disabled.randomRequests.length, 0);
    const later = await run.act("我再次接触控制件，确认它是否还会引发喷流。", context => {
      const { relation } = hazardContext(context);
      assert.equal(relation.content.state, "ended");
      assert.equal(known(context, SOURCE).content.observableState, "供给已被阻断，控制件固定在关闭位置。");
      return bundle(interaction("再次接触已经固定的控制件。", { basisRefs: [SOURCE, relation.definitionId], evidence: "控制件保持关闭，接触后也没有喷流。" }));
    });
    assert.equal(later.randomRequests.length, 0);
    assert.equal(run.state.entities[ACTOR].hitPoints.current, 10);
    assert.equal(run.state.entities[TARGET].hitPoints.current, 20);
    assert.ok(later.projection.renderableClaims.claims.some(claim => claim.evidence === "控制件保持关闭，接触后也没有喷流。"));
  }
});

test("a warned zone hazard freezes independent saves, area damage, condition, and lasting environmental consequences", async () => {
  const run = session("hazard-product-enter-zone");
  await warn(run, "enterZone");
  const triggered = await run.act("我知道区域里的灼痕意味着危险，仍然明确进入暴露范围。", context => {
    const { hazard, relation } = hazardContext(context);
    assert.equal(hazard.content.trigger.ref, ZONE);
    assert.equal(relation.content.state, "active");
    return bundle(interaction("明确进入已预示的范围，按原有危险承担暴露后果。", {
      targetRef: ZONE, basisRefs: [SOURCE, ZONE, hazard.definitionId],
      effects: [{ kind: "registeredHazard", sourceDefinitionRef: SOURCE, zoneRef: ZONE,
        damage: { kind: "authored", hazardDefinitionRef: hazard.definitionId, area: { origin: { x: "150", y: "100", elevation: "0" } } } },
      revision(hazard.content.environmentalConsequences[0])],
      evidence: "喷流掠过，石面出现新的灼痕和水珠。",
    }));
  });
  assert.equal(triggered.randomRequests.length, 1);
  assert.equal(triggered.randomRequests[0].hazardRolls.filter(spec => spec.purposeKey.includes(":save:")).length, 2,
    "Geometry applies the same frozen area to both exposed creatures");
  assert.equal(run.state.entities[ACTOR].hitPoints.current, 8);
  assert.equal(run.state.entities[TARGET].hitPoints.current, 18);
  for (const target of [ACTOR, TARGET]) assert.ok(Object.values(run.state.combatRuntime.effects)
    .some(effect => effect.targetEntityId === target && effect.condition === "blinded"));
  assert.equal(run.state.campaignRuntime.definitions[SOURCE].content.observableState, "石面留下新的灼痕与冷凝水。");
  assert.ok(triggered.projection.renderableClaims.claims.some(claim => claim.kind === "mechanicalOutcome"));
  // Do not pretend a blinded character can immediately perform a visual
  // follow-up. The next context must instead preserve both cause and condition.
  const following = freezeAuthoredProbeContext(run.fixture, run.state, { focusRefs: [SOURCE, ZONE, ACTOR], intentText: "我在这片危险区域里现在还能察觉什么？" }).context;
  assert.equal(known(following, SOURCE).content.observableState, "石面留下新的灼痕与冷凝水。");
  assert.ok(known(following, ACTOR).effects.some(effect => effect.condition === "blinded"));
  assert.equal(hazardContext(following).relation.content.state, "active");
});

test("a proposal frozen before disabling cannot revive the hazard or expose its private basis on retry", async () => {
  const run = session("hazard-product-stale-trigger");
  await warn(run, "contactFeature");
  await assert.rejects(run.prepare("检查明显迹象。", () => bundle(interaction("检查明显迹象。", {
    evidence: "接缝间仍有细雾。", basisRefs: [SOURCE, SOURCE],
  }))), "duplicate model references remain invalid before Rules canonicalization");
  const stale = await run.prepare("我准备接触当前控制件。", context => {
    const { hazard } = hazardContext(context);
    return bundle(interaction("接触当前尚未关闭的控制件。", { basisRefs: [SOURCE, hazard.definitionId],
      effects: [{ kind: "registeredHazard", sourceDefinitionRef: SOURCE, zoneRef: ZONE,
        damage: { kind: "authored", hazardDefinitionRef: hazard.definitionId, area: { origin: { x: "150", y: "100", elevation: "0" } } } }],
    }));
  });
  await disable(run);
  const before = structuredClone(run.state);
  const eventCount = run.events.length;
  const rejected = run.execute(stale);
  assert.equal(rejected.result.kind, "rejected", JSON.stringify(rejected.result));
  assert.equal(rejected.randomRequests.length, 0, "changed trigger authority rejects before any dice");
  assert.deepEqual(rejected.events, []);
  assert.equal(run.events.length, eventCount);
  assert.deepEqual(run.state, before);
  const otherViewer = run.fixture.runtime.project(run.fixture.profiles, run.state, {
    kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: TARGET,
  });
  assert.equal(otherViewer.kind, "projected");
  assert.equal(JSON.stringify(otherViewer).includes("PRIVATE_HAZARD_IDENTITY"), false);
  assert.equal(JSON.stringify(otherViewer).includes("relation:hazard-trigger:"), false);
  assert.equal(JSON.stringify(otherViewer).includes("供给声停止，固定后的控制件不再回弹。"), false,
    "the other player does not acquire the actor's private sensory evidence");
});
