import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAuthorityClaims,
  deriveAuthorityClaimsFromCommittedRange,
  projectRenderableClaims,
} from "../app/_runtime/lib/rules/v2/claims.ts";
import {
  buildFrozenNarrationMaterial,
  reuseFrozenNarrationMaterialForRetry,
} from "../app/_runtime/lib/kp/vnext/narration.ts";

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
  });

  assert.equal(projected.viewerKey, "character:alice");
  assert.equal(projected.claims.length, 1);
  assert.deepEqual(projected.claims[0], {
    claimRef: "claim:keeper:door",
    kind: "sourceClaim",
    speakerRef: "npc:keeper",
    statement: "门后没有守卫。",
    basisRefs: ["event:keeper-spoke"],
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
      inference: "爱丽丝认为守卫有所隐瞒。",
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
