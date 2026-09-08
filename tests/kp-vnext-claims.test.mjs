import assert from "node:assert/strict";
import test from "node:test";

import {
  committedRangeUsesFrozenRenderableClaims,
  deriveAuthorityClaims,
  deriveAuthorityClaimsFromCommittedRange,
  frozenRenderableClaimsConform,
  projectRenderableClaims,
} from "../app/_runtime/lib/rules/v2/claims.ts";
import {
  buildFrozenNarrationMaterial,
  reuseFrozenNarrationMaterialForRetry,
} from "../app/_runtime/lib/kp/vnext/narration.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";

// Test level: T1 — exercises deterministic Claims derivation and Viewer
// projection without Room persistence or model I/O.

const RECEIPT = Object.freeze({
  receiptId: "receipt:conversation:1",
  rootActionId: "root:conversation:1",
  status: "committed",
  branchId: "branch:active",
  eventRange: Object.freeze({ fromEventSeq: "11", toEventSeq: "12" }),
  rulesetVersion: "rules:vnext",
  eventSchemaVersion: "events:vnext",
  scopeProofHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

function sha256(digit) {
  return `sha256:${digit.repeat(64).slice(0, 64)}`;
}

test("typed inventory facts bind actor, recipient and item without inferring roles from sorted participants", () => {
  for (const [label, operation, expected] of [
    ["弩矢", { kind: "release", actorRef: "character:zed", quantity: 1, releaseKind: "placement" }, "远行者已将 1 件弩矢放置在场景中"],
    ["玻璃镜", { kind: "transfer", actorRef: "character:zed", quantity: 2, recipientRef: "character:amy" }, "远行者已将 2 件玻璃镜交给药师"],
  ]) {
    const authority = deriveAuthorityClaims({ receiptId: RECEIPT.receiptId, rootActionId: RECEIPT.rootActionId, materials: [{
      claimRef: "claim:typed-item", kind: "inventoryOutcome", itemRef: "item:visible",
      change: operation.kind === "transfer" ? "transferred" : "updated",
      characterRefs: ["character:amy", "character:zed"], operation,
      summary: "角色已完成这次物品操作。", basis: { authorityRefs: [], viewerRefs: [] }, visibility: { kind: "public" },
    }] });
    const grants = { viewerKey: "viewer:amy", refs: ["item:visible", "character:amy", "character:zed"],
      displayNames: { "item:visible": label, "character:zed": "远行者", "character:amy": "药师" } };
    const projected = projectRenderableClaims(authority, grants);
    assert.deepEqual(projected.claims[0].narrationFacts, [expected]);
    assert.equal(frozenRenderableClaimsConform(projected), true);
    assert.equal(projectRenderableClaims(authority, { ...grants,
      refs: grants.refs.filter(ref => ref !== "character:zed"),
      displayNames: { "item:visible": label, "character:amy": "药师" },
    }).claims.length, 0);
    const tampered = structuredClone(projected);
    tampered.claims[0].operation.privateContext = "CANARY";
    const { claimsHash: _hash, ...core } = tampered;
    tampered.claimsHash = canonicalSha256(core);
    assert.equal(frozenRenderableClaimsConform(tampered), false);
  }
});

test("typed environment interaction facts bind visible actor and target while preserving actual check results", () => {
  for (const check of [undefined, { kind: "attack", result: "failure", total: 9, dc: 15 }]) {
    const range = worldInteractionRange();
    const payload = range.events[0].payload;
    payload.check = check === undefined ? undefined
      : { resolutionKind: "attack", succeeded: false, total: check.total, dc: check.dc };
    payload.branch = check === undefined ? "success" : "failure";
    payload.sensoryEvidence = []; payload.pressures = []; payload.opportunities = [];
    const viewerKey = "viewer:observer";
    const projected = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), {
      viewerKey, refs: ["character:alice", "feature:chandelier", "visibility:scene-observers"],
      displayNames: { "character:alice": "调查员", "feature:chandelier": "铜吊灯" },
    });
    const outcome = projected.claims.find(claim => claim.kind === "mechanicalOutcome");
    assert.equal(outcome.outcomeKind, "worldInteraction");
    assert.deepEqual(outcome.narrationFacts, check === undefined ? ["调查员对铜吊灯的环境互动直接成功"]
      : ["调查员对铜吊灯的环境互动攻击未命中", "调查员对铜吊灯的环境互动检定总值为 9", "调查员对铜吊灯的环境互动难度为 15"]);
    assert.equal(frozenRenderableClaimsConform(projected), true);

  }
});

test("a direct consequence requires the exact applied ledger entry and an actual matching check in the same root and branch", () => {
  const initial = worldInteractionRange(), owner = initial.events[0];
  owner.branchId = "branch:active";
  Object.assign(owner.payload, { resolutionId: "resolution:owner", interactionRef: "proposal:owner", branch: "failure",
    check: { resolutionKind: "abilityCheck", succeeded: false, total: 1, dc: 12 }, sensoryEvidence: [], pressures: [], opportunities: [] });
  const child = { ...structuredClone(owner), eventId: "event:child", eventSeq: "12" };
  Object.assign(child.payload, { resolutionId: "resolution:child", interactionRef: "proposal:child", rulingKind: "directSuccess",
    check: null, branch: "success" });
  const ledger = { ...structuredClone(owner), eventId: "event:settlement", eventSeq: "13", eventType: "AtomicWorldInteractionStepsResolved",
    payload: { actorCharacterId: "character:alice", branch: "failure", checkResolutionId: "resolution:owner",
      steps: [{ proposalRef: "proposal:child", outcomeBinding: "onFailure", status: "applied" }] } };
  initial.events = [owner, child, ledger]; initial.receipt.eventRange.toEventSeq = "13";
  const outcome = range => projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), {
    viewerKey: "viewer:observer", refs: ["character:alice", "feature:chandelier", "visibility:scene-observers"],
  }).claims.find(claim => claim.claimRef === "claim:event:child:interaction").outcomeCode;
  assert.equal(outcome(initial), "applied");
  for (const mutate of [
    range => { range.events[2].payload.checkResolutionId = "resolution:invented"; },
    range => { range.events[2].payload.actorCharacterId = "character:other"; },
    range => { range.events[0].branchId = "branch:other"; },
    range => { range.events[0].payload.resolutionId = "resolution:other"; },
    range => { range.events[0].payload.actorCharacterId = "character:other"; },
    range => { range.events[0].payload.check.succeeded = true; },
    range => { range.events[0].payload.branch = "success"; },
    range => { range.events[0].eventSeq = "14"; range.receipt.eventRange.fromEventSeq = "14"; },
    range => { range.events[2].payload.steps[0].proposalRef = "proposal:other"; },
    range => { range.events[2].payload.steps[0].status = "skipped"; },
    range => { range.events[2].payload.steps[0].outcomeBinding = "onSuccess"; },
  ]) { const range = structuredClone(initial); mutate(range); assert.equal(outcome(range), "success"); }
});

test("each witnessed inventory operation produces its own complete facts and preserves source-stack state", () => {
  const actor = "character:alice", item = "item:source", target = "item:target";
  for (const [operation, expected, state] of [
    [{ kind: "acquire", quantity: 2 }, "艾莉丝取得了 2 件铜片"],
    [{ kind: "release", quantity: 2, releaseKind: "placement" }, "艾莉丝已将 2 件铜片放置在场景中", "已放下"],
    [{ kind: "release", quantity: 2, releaseKind: "drop" }, "艾莉丝已将 2 件铜片丢在场景中", "已丢下"],
    [{ kind: "release", quantity: 2, releaseKind: "loss" }, "艾莉丝已将 2 件铜片遗失在场景中", "已遗失"],
    [{ kind: "transfer", quantity: 2, targetCharacterRef: "character:bram" }, "艾莉丝已将 2 件铜片交给布兰"],
    [{ kind: "equip", action: "wear" }, "艾莉丝已将铜片装备到指定部位", "已装备"],
    [{ kind: "equip", action: "stow" }, "艾莉丝已将铜片从装备部位收起", "已收起"],
    [{ kind: "identify" }, "艾莉丝已辨识铜片", "已识别"],
    [{ kind: "lifecycle", action: "break" }, "铜片已损坏，当前不可正常使用", "损坏"],
    [{ kind: "lifecycle", action: "repair" }, "铜片已修复，可以正常使用", "可用"],
    [{ kind: "lifecycle", action: "destroy" }, "铜片已被销毁", "销毁"],
  ]) {
    const range = authoredRange([["InventoryOperationApplied", {
      actorCharacterId: actor, targetEntryId: target, operation: { ...operation, entryRef: item },
    }]]);
    const projected = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), {
      viewerKey: "viewer:alice", refs: [actor, "character:bram", item, target],
      displayNames: { [actor]: "艾莉丝", "character:bram": "布兰", [item]: "铜片", [target]: "铜片" },
    });
    const targetClaim = projected.claims.find(claim => claim.kind === "inventoryOutcome" && claim.itemRef === target);
    const sourceClaim = projected.claims.find(claim => claim.kind === "inventoryOutcome" && claim.itemRef === item);
    assert.deepEqual(targetClaim.narrationFacts, [expected, ...(state ? [`铜片的状态为 ${state}`] : [])]);
    assert.deepEqual(sourceClaim.narrationFacts, [expected]);
    assert.equal(sourceClaim.state, undefined);
    assert.equal(frozenRenderableClaimsConform(projected), true);
  }
});

test("the mixed stage-three manifest routes only explicit vNext event families to Claims", () => {
  assert.equal(committedRangeUsesFrozenRenderableClaims([
    { eventType: "RandomnessRequested" },
    { eventType: "WorldInteractionResolved" },
  ]), true);
  assert.equal(committedRangeUsesFrozenRenderableClaims([
    { eventType: "SocialDirectResolved" },
  ]), false);
  assert.equal(committedRangeUsesFrozenRenderableClaims([
    { eventType: "CorrectionApplied" },
    { eventType: "BranchActivated" },
  ]), false);
});

function worldInteractionRange({
  appliedEffects = [],
  summary = "这段自由摘要不应直接进入 Viewer Claims。",
  pressure = "隐藏巡逻队将在十秒后抵达。",
  opportunity = "秘密通道现在可以打开。",
} = {}) {
  const receipt = {
    ...RECEIPT,
    receiptId: "receipt:hidden-world-interaction",
    rootActionId: "root:hidden-world-interaction",
    eventRange: { fromEventSeq: "11", toEventSeq: "11" },
  };
  const state = {
    roomId: "room:hidden-world-interaction",
    runtimeEpochId: "epoch:hidden-world-interaction",
    campaignRuntime: { definitions: {} },
    combatRuntime: {
      definitions: {
        "ability:pistol-shot": {
          definitionId: "ability:pistol-shot",
          activation: { kind: "attack", actionGrant: "attack" },
        },
      },
    },
  };
  const event = {
    eventId: "event:epoch:hidden-world-interaction:11",
    eventSeq: "11",
    eventType: "WorldInteractionResolved",
    rootActionId: receipt.rootActionId,
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    scopeProofHash: sha256("1"),
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    payload: {
      actorCharacterId: "character:alice",
      abilityRef: "ability:pistol-shot",
      targetRefs: ["feature:chandelier"],
      directTargetRefs: ["feature:chandelier"],
      basisRefs: ["fact:visible-hall", "fact:hidden-patrol-route"],
      rulingKind: "check",
      branch: "success",
      outcomeCode: "model-authored-outcome-code",
      summary,
      check: { resolutionKind: "attack", succeeded: true, total: 18, dc: 15 },
      appliedEffects,
      sensoryEvidence: [{
        observerRef: "character:alice",
        subjectRef: "feature:chandelier",
        sense: "hearing",
        evidence: "枪声之后，吊灯剧烈摇晃。",
        basisRefs: ["fact:hidden-support-geometry"],
        visibilityPolicyRef: "visibility:character-controller:character:alice",
      }],
      pressures: [{
        description: pressure,
        sourceRef: "npc:hidden-patrol",
        basisRefs: ["fact:hidden-patrol-route"],
        visibilityPolicyRef: "visibility:public",
      }],
      opportunities: [{
        description: opportunity,
        targetRef: "portal:hidden-passage",
        actionHint: "立刻钻进去",
        basisRefs: ["relation:hidden-latch"],
        visibilityPolicyRef: "visibility:public",
      }],
    },
  };
  return {
    receipt,
    actorCharacterId: "character:alice",
    priorState: structuredClone(state),
    state,
    events: [event],
  };
}

function materializationRange({
  visibilityPolicyId = "visibility:public",
  withSettlement = false,
} = {}) {
  const definitionRef = "definition:materialized:11111111111111111111111111111111";
  const rootActionId = "root:materialization-claims";
  const receipt = {
    ...RECEIPT,
    receiptId: "receipt:materialization-claims",
    rootActionId,
    eventRange: { fromEventSeq: "21", toEventSeq: withSettlement ? "22" : "21" },
  };
  const definition = {
    schema: "zhuwei.semantic-definition/vnext-1",
    definitionKind: "semantic",
    semanticKind: "sceneFeature",
    definitionId: definitionRef,
    revision: "1",
    definitionHash: sha256("4"),
    templateRef: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateRef,
    templateHash: VNEXT_SEMANTIC_TEMPLATES.sceneFeature.templateHash,
    visibilityPolicyRef: visibilityPolicyId,
    content: {
      sceneRef: "scene:atrium",
      visibilityFactId: visibilityPolicyId === "visibility:hidden-until-evidence"
        ? "fact:hidden-alcove"
        : null,
      label: "浅壁龛",
      description: "墙面上显露出一个浅壁龛。",
      observableState: "open",
      affordances: ["inspect"],
      mechanicDefinitionRefs: [],
      privateNotes: "CANARY_PRIVATE_DEFINITION",
    },
  };
  const priorState = {
    roomId: "room:materialization-claims",
    runtimeEpochId: "epoch:materialization-claims",
    campaignRuntime: { definitions: {} },
    combatRuntime: { definitions: {} },
  };
  const state = {
    ...structuredClone(priorState),
    campaignRuntime: { definitions: { [definitionRef]: definition } },
  };
  const materialized = {
    eventId: "event:materialization-claims:21",
    eventSeq: "21",
    eventType: "SemanticDefinitionMaterialized",
    rootActionId,
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    scopeProofHash: sha256("6"),
    visibilityPolicyId,
    secrecy: visibilityPolicyId === "visibility:public" ? "public" : "private",
    payload: {
      actorCharacterId: "character:alice",
      bundleHash: sha256("7"),
      prospectiveRef: "prospective:22222222222222222222222222222222",
      definitionRef,
      semanticKind: "sceneFeature",
      templateRef: definition.templateRef,
      templateHash: definition.templateHash,
      contextHash: sha256("8"),
      basisRefs: ["fact:CANARY_PRIVATE_BASIS"],
      sourceRefs: ["source:CANARY_PRIVATE_SOURCE"],
      summary: "CANARY_MODEL_SUMMARY",
      definition,
    },
  };
  const events = [materialized];
  if (withSettlement) {
    events.push({
      eventId: "event:materialization-claims:22",
      eventSeq: "22",
      eventType: "AtomicWorldInteractionStepsResolved",
      rootActionId,
      roomId: state.roomId,
      runtimeEpochId: state.runtimeEpochId,
      scopeProofHash: sha256("9"),
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      payload: {
        proposalRef: "proposal:CANARY_PRIVATE_SETTLEMENT",
        checkResolutionId: "check:CANARY_PRIVATE_SETTLEMENT",
      },
    });
  }
  return {
    receipt,
    actorCharacterId: "character:alice",
    priorState,
    state,
    events,
  };
}

function feasibilityRange() {
  const rootActionId = "root:feasibility-claims";
  const receipt = {
    ...RECEIPT,
    receiptId: "receipt:feasibility-claims",
    rootActionId,
    eventRange: { fromEventSeq: "31", toEventSeq: "32" },
  };
  const state = {
    roomId: "room:feasibility-claims",
    runtimeEpochId: "epoch:feasibility-claims",
    campaignRuntime: { definitions: {} },
    combatRuntime: { definitions: {} },
  };
  const envelope = (eventSeq, eventType, payload) => ({
    eventId: `event:feasibility-claims:${eventSeq}`,
    eventSeq,
    eventType,
    rootActionId,
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    scopeProofHash: sha256(eventSeq === "31" ? "a" : "b"),
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    payload,
  });
  return {
    receipt,
    actorCharacterId: "character:alice",
    priorState: structuredClone(state),
    state,
    events: [
      envelope("31", "ItemUsed", {
        entryId: "item-entry:lockpick",
        characterId: "character:alice",
        quantityBefore: 2,
        quantityAfter: 1,
        chargesBefore: null,
        chargesAfter: null,
        durabilityBefore: null,
        durabilityAfter: null,
      }),
      envelope("32", "WorldInteractionFeasibilityRuled", {
        actorCharacterId: "character:alice",
        intent: "CANARY_PRIVATE_INTENT",
        method: "CANARY_PRIVATE_METHOD",
        rulingKind: "missingPrerequisite",
        publicBasis: "门锁需要另一把钥匙。",
        prerequisites: [{
          kind: "tool",
          ref: "item-entry:CANARY_PRIVATE_KEY",
          description: "需要匹配这把门锁的钥匙。",
        }],
        nextActions: [{ description: "去守门人处询问钥匙。" }],
        appliedCosts: [{
          kind: "itemCost",
          entryRef: "item-entry:lockpick",
          quantityBefore: 2,
          quantityAfter: 1,
        }],
      }),
    ],
  };
}

test("an NPC source claim remains attributed and does not publish the hidden world truth", () => {
  const authorityClaims = deriveAuthorityClaims({
    receiptId: RECEIPT.receiptId,
    rootActionId: RECEIPT.rootActionId,
    materials: [
      {
        claimRef: "claim:keeper:door",
        kind: "sourceClaim",
        speakerRef: "npc:keeper",
        statement: "门后没有守卫。",
        basis: {
          authorityRefs: ["fact:two-guards-behind-door"],
          viewerRefs: ["event:keeper-spoke"],
        },
        visibility: {
          kind: "grants",
          allOf: ["npc:keeper", "event:keeper-spoke"],
        },
      },
      {
        claimRef: "claim:hidden-guards",
        kind: "sceneFeature",
        featureRef: "feature:guards-behind-door",
        description: "门后实际有两名守卫。",
        basis: {
          authorityRefs: ["fact:two-guards-behind-door"],
          viewerRefs: [],
        },
        visibility: {
          kind: "grants",
          allOf: ["fact:two-guards-behind-door"],
        },
      },
    ],
  });
  const projected = projectRenderableClaims(authorityClaims, {
    viewerKey: "character:alice",
    refs: ["npc:keeper", "event:keeper-spoke"],
    displayNames: { "npc:keeper": "守门人" },
  });

  assert.equal(projected.viewerKey, "character:alice");
  assert.equal(projected.claims.length, 1);
  assert.deepEqual(projected.claims[0], {
    claimRef: "claim:keeper:door",
    kind: "sourceClaim",
    speakerRef: "npc:keeper",
    speakerName: "守门人",
    statement: "门后没有守卫。",
    basisRefs: ["event:keeper-spoke"],
    narrationFacts: ["守门人声称（尚未由这条记录证实）：门后没有守卫"],
  });
  assert.doesNotMatch(JSON.stringify(projected), /two-guards|两名守卫/u);
  assert.match(projected.claimsHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.claims), true);
});

test("a hidden relation cannot affect either the Viewer payload or its frozen hash", () => {
  const visibleEvidence = {
    claimRef: "claim:alice-hears-click",
    kind: "sensoryEvidence",
    observerRef: "character:alice",
    subjectRef: "feature:stone-wall",
    sense: "hearing",
    evidence: "墙后传来一声轻响。",
    basis: {
      authorityRefs: ["event:mechanism-moved"],
      viewerRefs: ["event:alice-heard-click"],
    },
    visibility: {
      kind: "grants",
      allOf: ["character:alice", "feature:stone-wall", "event:alice-heard-click"],
    },
  };
  const hiddenRelation = {
    claimRef: "claim:hidden-latch-relation",
    kind: "relationChanged",
    relationRef: "relation:secret-latch-opens-vault",
    relationKind: "triggers",
    subjectRef: "mechanism:secret-latch",
    objectRef: "portal:hidden-vault-door",
    change: "began",
    description: "暗扣已经连接到密库门。",
    basis: {
      authorityRefs: ["fact:secret-vault-mechanism"],
      viewerRefs: [],
    },
    visibility: {
      kind: "grants",
      allOf: ["relation:secret-latch-opens-vault"],
    },
  };
  const grants = {
    viewerKey: "character:alice",
    refs: ["character:alice", "feature:stone-wall", "event:alice-heard-click"],
  };
  const withHiddenRelation = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: "receipt:hidden-relation",
    rootActionId: "root:hidden-relation",
    materials: [visibleEvidence, hiddenRelation],
  }), grants);
  const withoutHiddenRelation = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: "receipt:hidden-relation",
    rootActionId: "root:hidden-relation",
    materials: [visibleEvidence],
  }), grants);

  assert.deepEqual(withHiddenRelation, withoutHiddenRelation);
  assert.doesNotMatch(JSON.stringify(withHiddenRelation), /secret-latch|hidden-vault|暗扣|密库门/u);
});

test("FrozenRenderableClaims rejects recomputed envelopes with unknown fields", () => {
  const projected = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: "receipt:closed-renderable-claims",
    rootActionId: "root:closed-renderable-claims",
    materials: [{
      claimRef: "claim:closed-renderable-claims",
      kind: "sceneFeature",
      featureRef: "feature:closed-door",
      description: "门已经关闭。",
      basis: { authorityRefs: [], viewerRefs: [] },
      visibility: { kind: "public" },
    }],
  }), {
    viewerKey: "character:alice",
    projectionHash: sha256("f"),
    refs: ["feature:closed-door"],
  });
  const rehash = (candidate) => {
    const {
      schema,
      receiptId,
      rootActionId,
      viewerKey,
      projectionHash,
      claims,
    } = candidate;
    return {
      ...candidate,
      claimsHash: canonicalSha256({
        schema,
        receiptId,
        rootActionId,
        viewerKey,
        projectionHash,
        claims,
      }),
    };
  };

  assert.equal(frozenRenderableClaimsConform(projected), true);
  assert.equal(frozenRenderableClaimsConform(rehash({
    ...structuredClone(projected),
    privateCanary: "TOP_LEVEL_PRIVATE",
  })), false);
  const claimCanary = structuredClone(projected);
  claimCanary.claims[0].privateCanary = "CLAIM_PRIVATE";
  assert.equal(frozenRenderableClaimsConform(rehash(claimCanary)), false);
  const nestedCanary = structuredClone(projected);
  nestedCanary.claims[0].state = "closed";
  nestedCanary.claims[0].unknownNestedMeaning = "PRIVATE_NESTED";
  assert.equal(frozenRenderableClaimsConform(rehash(nestedCanary)), false);
  const narrationCanary = structuredClone(projected);
  narrationCanary.claims[0].narrationFacts = ["伪造的新事实。"];
  assert.equal(frozenRenderableClaimsConform(rehash(narrationCanary)), false);
});

test("authority-only summaries, pressures, opportunities, and actual targets cannot perturb Viewer Claims", () => {
  const hiddenTargetEffect = {
    kind: "damage",
    targetRef: "npc:hidden-target",
    sourceDefinitionRef: "hazard:falling-chandelier",
    amount: 17,
    damageType: "bludgeoning",
    died: false,
  };
  const grants = {
    viewerKey: "principal:alice\u001fcharacter:alice",
    projectionHash: sha256("9"),
    refs: [
      "character:alice",
      "feature:chandelier",
      "fact:visible-hall",
      "visibility:character-controller:character:alice",
      "visibility:scene-observers",
    ],
  };
  const baseline = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(worldInteractionRange()),
    grants,
  );
  const withAuthorityCanaries = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(worldInteractionRange({
      appliedEffects: [hiddenTargetEffect],
      summary: "CANARY_SUMMARY：密道后有王冠。",
      pressure: "CANARY_PRESSURE：隐藏巡逻路线。",
      opportunity: "CANARY_OPPORTUNITY：按下暗扣。",
    })),
    grants,
  );

  assert.deepEqual(withAuthorityCanaries, baseline);
  assert.equal(withAuthorityCanaries.projectionHash, grants.projectionHash);
  assert.doesNotMatch(
    JSON.stringify(withAuthorityCanaries),
    /CANARY|hidden-target|hidden-patrol|hidden-passage|hidden-latch|王冠|暗扣/u,
  );
  assert.deepEqual(withAuthorityCanaries.claims.map(({ kind }) => kind), [
    "mechanicalOutcome",
    "sensoryEvidence",
    "actionCommitted",
  ]);
  assert.equal(withAuthorityCanaries.claims[0].check.kind, "attack");
});

test("materialization claims come from the committed definition and ignore the private settlement ledger", () => {
  const grants = {
    viewerKey: "principal:alice\u001fcharacter:alice",
    projectionHash: sha256("c"),
    refs: [
      "character:alice",
      "receipt:materialization-claims",
      "visibility:character-controller:character:alice",
      "definition:materialized:11111111111111111111111111111111",
      "event:materialization-claims:21",
    ],
  };
  const withoutSettlement = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(materializationRange()),
    grants,
  );
  const withSettlement = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(materializationRange({ withSettlement: true })),
    grants,
  );
  assert.deepEqual(withSettlement, withoutSettlement);
  assert.deepEqual(withSettlement.claims.map(({ kind }) => kind), [
    "definitionRevised",
    "sceneFeature",
    "actionCommitted",
  ]);
  assert.match(withSettlement.claims[0].summary, /浅壁龛/u);
  assert.equal(withSettlement.claims[1].state, "open");
  assert.equal(withSettlement.claims[1].interactionHint, "inspect");
  assert.doesNotMatch(
    JSON.stringify(withSettlement),
    /CANARY|prospective:|template:|bundleHash|contextHash/u,
  );
});

test("a vNext range cannot degrade to actionCommitted when a result event is unmapped", () => {
  const atomicOnly = materializationRange({ withSettlement: true });
  atomicOnly.events = atomicOnly.events.filter(({ eventType }) =>
    eventType === "AtomicWorldInteractionStepsResolved");
  atomicOnly.receipt.eventRange = { fromEventSeq: "22", toEventSeq: "22" };
  assert.throws(
    () => deriveAuthorityClaimsFromCommittedRange(atomicOnly),
    /VNEXT_CLAIMS_INSUFFICIENT/u,
  );

  const unknownSibling = materializationRange();
  unknownSibling.events.push({
    ...structuredClone(unknownSibling.events[0]),
    eventId: "event:materialization-claims:22",
    eventSeq: "22",
    eventType: "FutureNarratableResult",
  });
  unknownSibling.receipt.eventRange = { fromEventSeq: "21", toEventSeq: "22" };
  assert.throws(
    () => deriveAuthorityClaimsFromCommittedRange(unknownSibling),
    /VNEXT_CLAIM_EVENT_UNKNOWN:FutureNarratableResult/u,
  );
});

test("hidden materialization produces a valid empty Viewer claim snapshot", () => {
  const projected = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(materializationRange({
      visibilityPolicyId: "visibility:hidden-until-evidence",
    })),
    {
      viewerKey: "principal:bob\u001fcharacter:bob",
      projectionHash: sha256("d"),
      refs: [],
    },
  );
  assert.deepEqual(projected.claims, []);
  assert.equal(frozenRenderableClaimsConform(projected), true);
  assert.match(projected.claimsHash, /^sha256:[0-9a-f]{64}$/u);
});

test("world refusal claims expose the public reason and next actions without duplicating attempt costs", () => {
  const projected = projectRenderableClaims(
    deriveAuthorityClaimsFromCommittedRange(feasibilityRange()),
    {
      viewerKey: "principal:alice\u001fcharacter:alice",
      projectionHash: sha256("e"),
      refs: [
        "character:alice",
        "receipt:feasibility-claims",
        "item-entry:lockpick",
        "visibility:character-controller:character:alice",
        "visibility:scene-observers",
        "event:feasibility-claims:31",
        "event:feasibility-claims:32",
      ],
    },
  );
  assert.deepEqual(projected.claims.map(({ kind }) => kind), [
    "inventoryOutcome",
    "mechanicalOutcome",
    "opportunity",
    "actionCommitted",
  ]);
  assert.equal(projected.claims.filter(({ kind }) => kind === "inventoryOutcome").length, 1);
  assert.equal(projected.claims[1].outcomeCode, "missingPrerequisite");
  assert.match(projected.claims[1].summary, /门锁需要另一把钥匙.*需要匹配/u);
  assert.equal(projected.claims[2].description, "去守门人处询问钥匙。");
  assert.doesNotMatch(JSON.stringify(projected), /CANARY|PRIVATE_KEY|PRIVATE_INTENT|PRIVATE_METHOD/u);
});

test("ability effects are rendered from typed semantics rather than an ability-name special case", () => {
  const effectClaim = ({ claimRef, abilityRef, abilityName, summary, bonusDice }) => ({
    claimRef,
    kind: "abilityEffectApplied",
    abilityRef,
    abilityName,
    sourceRef: "character:cleric",
    targetRefs: ["character:alice"],
    effect: {
      summary,
      appliesTo: "nextAbilityCheck",
      bonusDice,
      duration: "upToOneMinute",
      concentration: true,
    },
    basis: {
      authorityRefs: [`event:${claimRef}:committed`],
      viewerRefs: [`event:${claimRef}:observed`],
    },
    visibility: {
      kind: "grants",
      allOf: [abilityRef, "character:cleric", "character:alice"],
    },
  });
  const grants = {
    viewerKey: "character:alice",
    refs: [
      "ability:guidance",
      "ability:invented-fortune",
      "character:cleric",
      "character:alice",
      "event:claim:guidance:observed",
      "event:claim:invented:observed",
    ],
    displayNames: {
      "ability:guidance": "神导术",
      "ability:invented-fortune": "旅途好运",
    },
  };
  const projected = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: "receipt:ability-effects",
    rootActionId: "root:ability-effects",
    materials: [
      effectClaim({
        claimRef: "claim:guidance",
        abilityRef: "ability:guidance",
        abilityName: "神导术",
        summary: "下一次属性检定获得额外加值。",
        bonusDice: "1d4",
      }),
      effectClaim({
        claimRef: "claim:invented",
        abilityRef: "ability:invented-fortune",
        abilityName: "旅途好运",
        summary: "下一次属性检定获得另一枚额外骰。",
        bonusDice: "1d6",
      }),
    ],
  }), grants);

  assert.deepEqual(projected.claims.map(({ abilityRef, abilityName, effect }) => ({
    abilityRef,
    abilityName,
    effect,
  })), [
    {
      abilityRef: "ability:guidance",
      abilityName: "神导术",
      effect: {
        summary: "下一次属性检定获得额外加值。",
        appliesTo: "nextAbilityCheck",
        bonusDice: "1d4",
        duration: "upToOneMinute",
        concentration: true,
      },
    },
    {
      abilityRef: "ability:invented-fortune",
      abilityName: "旅途好运",
      effect: {
        summary: "下一次属性检定获得另一枚额外骰。",
        appliesTo: "nextAbilityCheck",
        bonusDice: "1d6",
        duration: "upToOneMinute",
        concentration: true,
      },
    },
  ]);
});

test("Viewer labels cannot be copied from Authority material or from an ungranted ref", () => {
  const authorityClaims = deriveAuthorityClaims({
    receiptId: "receipt:viewer-label-boundary",
    rootActionId: "root:viewer-label-boundary",
    materials: [{
      claimRef: "claim:viewer-label-boundary",
      kind: "abilityEffectApplied",
      abilityRef: "ability:hidden-label",
      abilityName: "PRIVATE_AUTHORITY_ABILITY_NAME",
      sourceRef: "character:alice",
      targetRefs: ["character:alice"],
      effect: { summary: "该效果已经生效。" },
      basis: { authorityRefs: [], viewerRefs: [] },
      visibility: { kind: "public" },
    }],
  });
  const grants = {
    viewerKey: "character:alice",
    refs: ["ability:hidden-label", "character:alice"],
  };
  const projected = projectRenderableClaims(authorityClaims, grants);
  assert.equal(projected.claims[0].abilityName, "该能力");
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_AUTHORITY_ABILITY_NAME/u);
  assert.throws(
    () => projectRenderableClaims(authorityClaims, {
      ...grants,
      displayNames: { "ability:not-granted": "伪造名称" },
    }),
    /VIEWER_DISPLAY_NAME_INVALID/u,
  );
});

test("narration retry reuses the exact Receipt-bound Viewer material after world state changes", () => {
  const frozenClaims = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: RECEIPT.receiptId,
    rootActionId: RECEIPT.rootActionId,
    materials: [{
      claimRef: "claim:door-opened",
      kind: "mechanicalOutcome",
      actorRef: "character:alice",
      targetRefs: ["feature:door"],
      outcomeCode: "opened",
      summary: "门已经打开。",
      basis: {
        authorityRefs: ["event:door-opened"],
        viewerRefs: ["event:alice-saw-door-open"],
      },
      visibility: {
        kind: "grants",
        allOf: ["character:alice", "feature:door"],
      },
    }],
  }), {
    viewerKey: "character:alice",
    projectionHash: sha256("8"),
    refs: ["character:alice", "feature:door", "event:alice-saw-door-open"],
  });
  const first = buildFrozenNarrationMaterial(RECEIPT, "character:alice", frozenClaims);

  const unrelatedNewWorldState = {
    revision: 999,
    committedDelta: {
      changes: [{ kind: "secretChanged", value: "后来出现的新秘密" }],
    },
  };
  unrelatedNewWorldState.revision += 1;
  unrelatedNewWorldState.committedDelta.changes.push({
    kind: "anotherSecretChanged",
    value: "重试期间才发生的事实",
  });

  const rebuilt = buildFrozenNarrationMaterial(RECEIPT, "character:alice", frozenClaims);
  const retry = reuseFrozenNarrationMaterialForRetry(first);

  assert.deepEqual(rebuilt, first);
  assert.strictEqual(retry, first);
  assert.equal(first.renderableClaims.projectionHash, sha256("8"));
  assert.equal(retry.renderableClaims.claimsHash, frozenClaims.claimsHash);
  assert.deepEqual(retry.renderableClaims.claims, frozenClaims.claims);
  assert.deepEqual(Object.keys(first).sort(), [
    "materialHash",
    "receipt",
    "renderableClaims",
    "schema",
    "viewerKey",
  ]);
  assert.doesNotMatch(JSON.stringify(first), /committedDelta|后来出现|重试期间/u);
  assert.match(first.materialHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.receipt), true);
});

test("the Viewer claim contract projects every supported typed material through one seam", () => {
  const basis = (suffix) => ({
    authorityRefs: [`authority:only:${suffix}`],
    viewerRefs: [`viewer:basis:${suffix}`],
  });
  const publicVisibility = { kind: "public" };
  const materials = [
    {
      claimRef: "claim:mechanical",
      kind: "mechanicalOutcome",
      summary: "检定成功。",
      basis: basis("mechanical"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:ability",
      kind: "abilityEffectApplied",
      abilityRef: "ability:ward",
      abilityName: "守护",
      sourceRef: "character:alice",
      targetRefs: ["character:bob"],
      effect: { summary: "目标获得守护。" },
      basis: basis("ability"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:sensory",
      kind: "sensoryEvidence",
      observerRef: "character:alice",
      sense: "sight",
      evidence: "门缝里有光。",
      basis: basis("sensory"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:source",
      kind: "sourceClaim",
      speakerRef: "npc:keeper",
      statement: "钥匙在楼上。",
      basis: basis("source"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:inference",
      kind: "characterInference",
      characterRef: "character:alice",
      inference: "守卫有所隐瞒。",
      basis: basis("inference"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:feature",
      kind: "sceneFeature",
      featureRef: "feature:door",
      description: "木门已经打开。",
      basis: basis("feature"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:relation",
      kind: "relationChanged",
      relationRef: "relation:door-connects-hall",
      relationKind: "connects",
      subjectRef: "feature:door",
      objectRef: "scene:hall",
      change: "began",
      description: "门现在通向大厅。",
      basis: basis("relation"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:definition",
      kind: "definitionRevised",
      definitionRef: "npc:keeper",
      definitionKind: "npc",
      summary: "守卫开始愿意协助爱丽丝。",
      basis: basis("definition"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:pressure",
      kind: "pressure",
      description: "巡逻队正在接近。",
      basis: basis("pressure"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:opportunity",
      kind: "opportunity",
      description: "敞开的门现在可以进入。",
      basis: basis("opportunity"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:inventory",
      kind: "inventoryOutcome",
      itemRef: "item-entry:torch",
      change: "used",
      summary: "火把已经使用。",
      characterRefs: ["character:alice"],
      quantity: { before: 2, after: 1 },
      basis: basis("inventory"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:objective",
      kind: "objectiveContinuity",
      objectiveRef: "objective:open-door",
      transition: "completed",
      summary: "打开大门的目标已经完成。",
      participantRefs: ["character:alice"],
      basis: basis("objective"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:story",
      kind: "storyContinuity",
      storyRef: "story:gray-gate",
      transition: "candidate",
      summary: "灰门事件出现了收束候选。",
      characterRefs: ["character:alice"],
      basis: basis("story"),
      visibility: publicVisibility,
    },
    {
      claimRef: "claim:action",
      kind: "actionCommitted",
      actorRef: "character:alice",
      status: "committed",
      summary: "行动已经提交。",
      basis: basis("action"),
      visibility: publicVisibility,
    },
  ];
  const grants = {
    viewerKey: "character:alice",
    refs: [
      "ability:ward",
      "character:alice",
      "character:bob",
      "npc:keeper",
      "feature:door",
      "relation:door-connects-hall",
      "scene:hall",
      "item-entry:torch",
      "objective:open-door",
      "story:gray-gate",
      ...materials.map(({ claimRef }) => `viewer:basis:${claimRef.slice("claim:".length)}`),
    ],
    displayNames: {
      "ability:ward": "守护",
      "npc:keeper": "守门人",
      "character:alice": "爱丽丝",
    },
  };
  const projected = projectRenderableClaims(deriveAuthorityClaims({
    receiptId: "receipt:all-claim-kinds",
    rootActionId: "root:all-claim-kinds",
    materials,
  }), grants);

  assert.deepEqual(projected.claims.map(({ kind }) => kind), [
    "mechanicalOutcome",
    "abilityEffectApplied",
    "sensoryEvidence",
    "sourceClaim",
    "characterInference",
    "sceneFeature",
    "relationChanged",
    "definitionRevised",
    "pressure",
    "opportunity",
    "inventoryOutcome",
    "objectiveContinuity",
    "storyContinuity",
    "actionCommitted",
  ]);
  assert.doesNotMatch(JSON.stringify(projected), /authority:only/u);
});

function authoredRange(payloads, priorEffects = {}) {
  const base = materializationRange();
  const seed = base.events[0];
  base.priorState.combatRuntime.effects = priorEffects;
  base.priorState.combatRuntime.entities = { "character:alice": { conditions: {} } };
  base.state.combatRuntime.effects = {};
  base.state.combatRuntime.entities = { "character:alice": { conditions: {} } };
  base.events = payloads.map(([eventType, payload], index) => ({ ...seed, eventId: `event:authored:${index}`, eventSeq: String(21 + index), eventType, payload,
    visibilityPolicyId: "visibility:scene-observers", secrecy: "public" }));
  base.receipt.eventRange = { fromEventSeq: "21", toEventSeq: String(20 + payloads.length) };
  return base;
}
function conditionEffect() {
  return { schema: "zhuwei.condition-effect/v1", effectId: "effect:hidden-canary", kind: "condition", sourceRef: "source:CANARY_HIDDEN", sourceDefinitionRef: "ability:CANARY_HIDDEN",
    targetEntityId: "character:alice", condition: "blinded", level: null, duration: { kind: "timed", durationMicros: "10000000" }, startedAtFictionMicros: "0", expiresAt: { kind: "fictionTime", entityId: "character:alice", dueMicros: "10000000" }, visibilityPolicyId: "visibility:scene-observers" };
}
function authoredGrants(extra = []) {
  return { viewerKey: "viewer:alice", refs: ["character:alice", "visibility:scene-observers", "visibility:character-controller:character:alice", ...extra], displayNames: { "character:alice": "艾莉丝" } };
}

test("condition applied and ended claims retain visible mechanics without requiring or leaking hidden Ability refs", () => {
  const effect = conditionEffect();
  const range = authoredRange([
    ["EffectApplied", { effect }],
    ["EffectEnded", { effectId: effect.effectId, targetEntityId: "character:alice", reason: "durationExpired" }],
    ["AtomicWorldInteractionStepsResolved", {}],
  ]);
  const projected = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), authoredGrants());
  const outcomes = projected.claims.filter(({ kind }) => kind === "mechanicalOutcome");
  assert.equal(outcomes.length, 2);
  assert.match(outcomes[0].summary, /目盲.*10 秒/u);
  assert.match(outcomes[1].summary, /目盲.*结束/u);
  assert.ok(outcomes[0].narrationFacts.includes("作用目标：艾莉丝"));
  assert.doesNotMatch(JSON.stringify(projected), /CANARY|effect:hidden/u);
  const later = authoredRange([["EffectEnded", { effectId: effect.effectId, targetEntityId: "character:alice", reason: "explicitEnd" }], ["AtomicWorldInteractionStepsResolved", {}]], { [effect.effectId]: effect });
  assert.ok(deriveAuthorityClaimsFromCommittedRange(later).claims.some(({ outcomeCode }) => outcomeCode === "effectEnded"));
});

test("definition registration remains a private ledger while actual item appearance and inventory outcomes render", () => {
  const onlyDefinition = authoredRange([
    ["DefinitionRegistered", { definition: { label: "CANARY_DEFINITION" } }],
    ["AuthoredMaterializationResolved", { kind: "hazardDefinition", ref: "hazard:private", actorCharacterId: "character:alice", contextHash: sha256("2"), summary: "CANARY_SUMMARY" }],
  ]);
  const projected = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(onlyDefinition), authoredGrants());
  assert.deepEqual(projected.claims.map(({ kind }) => kind), ["actionCommitted"]);
  assert.doesNotMatch(JSON.stringify(projected), /CANARY|hazard:private/u);
  const range = authoredRange([
    ["ItemDefinitionRegistered", { definition: { definitionId: "item-definition:private" } }],
    ["ItemMaterialized", { entry: { entryId: "item-entry:rope", quantity: 2, holderRef: null } }],
    ["InventoryOperationApplied", { actorCharacterId: "character:alice", targetEntryId: "item-entry:rope", operation: { kind: "acquire", entryRef: "item-entry:rope", quantity: 2 }, summary: "CANARY_SUMMARY" }],
  ]);
  const visible = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), authoredGrants(["item-entry:rope"]));
  const claims = visible.claims.filter(({ kind }) => kind === "inventoryOutcome");
  assert.deepEqual(claims.map(({ change }) => change), ["materialized", "acquired"]);
  assert.deepEqual(claims[0].quantity, { before: 0, after: 2 });
  assert.match(claims[1].summary, /2 件/u);
  assert.doesNotMatch(JSON.stringify(visible), /CANARY|item-definition:private/u);
});

test("item Activity, elapsed time, recovery and native condition changes have explicit closed claim coverage", () => {
  const range = authoredRange([
    ["ActivityStarted", { activityId: "activity:use", characterId: "character:alice" }],
    ["FictionTimeAdvanced", { durationMicros: "6500000", reason: "CANARY_CAUSE" }],
    ["ActivityCompleted", { activityId: "activity:use" }],
    ["HealingResolved", { entityId: "character:alice", before: "10", after: "17" }],
    ["TemporaryHitPointsGranted", { entityId: "character:alice", before: "0", after: "4", sourceDefinitionId: "ability:CANARY_HIDDEN" }],
    ["ConditionChanged", { entityId: "character:alice", conditions: { prone: true } }],
    ["AtomicWorldInteractionStepsResolved", {}],
  ]);
  // Activity lookup now consults the current authority collection before the
  // same-range ActivityStarted event. Keep this partial fixture well-shaped.
  range.priorState.campaignRuntime.activities = {};
  range.state.campaignRuntime.activities = {};
  const visible = projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range), authoredGrants());
  assert.equal(visible.claims.filter(({ kind }) => kind === "mechanicalOutcome").length, 5);
  assert.match(JSON.stringify(visible), /6.5 秒|由 10 变为 17|临时生命值|倒地/u);
  assert.doesNotMatch(JSON.stringify(visible), /CANARY/u);
});

test("native reaction completion renders its visible outcome and keeps the atomic continuation private",()=>{
  const range=authoredRange([
    ["AtomicWorldInteractionSuspended",{continuation:{candidateState:"CANARY_CANDIDATE"}}],
    ["CombatPendingOpened",{pending:{ownerFrame:"CANARY_FRAME"}}],
    ["CombatPendingClosed",{pendingInputId:"pending:CANARY"}],
    ["ReactionAnswered",{answer:{kind:"useReaction"}}],
    ["SpellCastingStarted",{cast:{abilityRef:"ability:CANARY"}}],
    ["SpellCountered",{sourceEntityId:"character:alice",abilityRef:"ability:CANARY",castId:"cast:CANARY"}],
    ["SpellResolved",{sourceEntityId:"character:CANARY_HIDDEN",abilityRef:"ability:CANARY",castId:"cast:CANARY"}],
    ["AtomicWorldInteractionResumed",{}],
    ["AtomicWorldInteractionStepsResolved",{}],
  ]);
  const visible=projectRenderableClaims(deriveAuthorityClaimsFromCommittedRange(range),authoredGrants());
  assert.equal(visible.claims.filter(c=>c.kind==="mechanicalOutcome").length,1);
  assert.match(JSON.stringify(visible),/施法被反制/u);
  assert.doesNotMatch(JSON.stringify(visible),/CANARY/u);
});
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";
