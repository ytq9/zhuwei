import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequiredContext,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import {
  composeDefinition,
  createDefinitionSnapshot,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

function hash(seed) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function referenceDirectory() {
  return {
    citations: {
      viewerEvidenceRefs: ["fact:hall"],
      authorityBasisRefs: ["fact:hidden-support", "fact:hall"],
      npcKnowledge: [{ npcRef: "npc:warden", refs: ["knowledge:warden:alarm"] }],
      nonCitableRefs: ["binding:internal"],
    },
    domains: {
      abilityRefs: ["ability:pistol-shot"],
      itemRefs: ["item-entry:pistol"],
      semanticRefs: ["fact:hall", "fact:hidden-support"],
    },
  };
}

function requiredContextInput() {
  return {
    intent: {
      submissionRef: "submission:shoot-chain:1",
      actorRef: "character:alice",
      text: "我用枪打断吊灯的支撑，让它砸向下面的敌人。",
    },
    entries: [
      {
        kind: "unavailable",
        entryRef: "optional:voice-history",
        reason: "truncated",
        critical: false,
      },
      {
        kind: "openBlank",
        entryRef: "slot:chain-description",
        scopeRef: "scene:hall",
        allowedKinds: ["material-description", "structural-description"],
        basisRefs: ["fact:hall"],
        authorizationRef: "authorization:chain-description",
        authorizationHash: hash("authorization"),
      },
      {
        kind: "known",
        entryRef: "fact:hall",
        revisionOrHash: "revision:12",
        value: {
          name: "宴会厅",
          objects: ["object:chain", "object:chandelier"],
        },
      },
      {
        kind: "ambiguous",
        entryRef: "slot:target",
        obligation: "target",
        resolution: "clarificationRequired",
        candidates: [
          { ref: "object:west-chain", matchKind: "alias", score: 2, basisRefs: ["fact:hall"] },
          { ref: "object:east-chain", matchKind: "alias", score: 2, basisRefs: ["fact:hall"] },
        ],
        frontierExhausted: true,
        viewerSafe: true,
      },
      {
        kind: "knownAbsent",
        entryRef: "slot:second-exit",
        scopeRef: "scene:hall",
        selector: { kind: "exactRef", ref: "object:second-exit" },
        basisRefs: ["fact:hall"],
      },
    ],
    references: referenceDirectory(),
    binding: {
      roomEpochRef: "epoch:room:1",
      rootActionId: "root:shoot-chain:1",
      preparedActionId: "prepared:shoot-chain:1",
      baseEventSeq: "42",
      stateHash: hash("a"),
      projectionHash: hash("b"),
      profiles: [
        { profileRef: "profile:rules", profileHash: hash("c") },
        { profileRef: "profile:event", profileHash: hash("d") },
      ],
      readSet: [],
    },
    maxUnits: 20_000,
  };
}

test("vNext RequiredContext preserves and canonically hashes the complete epistemic snapshot", () => {
  const firstInput = requiredContextInput();
  const first = buildRequiredContext(firstInput);
  assert.equal(first.kind, "accepted", JSON.stringify(first));
  assert.deepEqual(first.context.entries.map(({ entryRef, kind }) => [entryRef, kind]), [
    ["fact:hall", "known"],
    ["optional:voice-history", "unavailable"],
    ["slot:chain-description", "openBlank"],
    ["slot:second-exit", "knownAbsent"],
    ["slot:target", "ambiguous"],
  ]);
  assert.deepEqual(first.context.binding.profiles.map(({ profileRef }) => profileRef), [
    "profile:event",
    "profile:rules",
  ]);
  assert.deepEqual(first.context.binding.readSet, []);
  assert.equal(first.context.entries.find(({ entryRef }) => entryRef === "fact:hall").revisionOrHash,
    "revision:12");
  assert.deepEqual(first.context.references.citations.authorityBasisRefs, [
    "fact:hall",
    "fact:hidden-support",
  ]);
  assert.deepEqual(first.context.references.citations.npcKnowledge, [{
    npcRef: "npc:warden",
    refs: ["knowledge:warden:alarm"],
  }]);
  assert.match(first.context.binding.contextHash, /^sha256:[0-9a-f]{64}$/u);

  const reordered = structuredClone(firstInput);
  reordered.entries.reverse();
  reordered.entries.find(({ kind }) => kind === "openBlank").allowedKinds.reverse();
  reordered.entries.find(({ kind }) => kind === "ambiguous").candidates.reverse();
  reordered.binding.profiles.reverse();
  reordered.references.citations.viewerEvidenceRefs.reverse();
  reordered.references.domains.semanticRefs.reverse();
  const second = buildRequiredContext(reordered);
  assert.equal(second.kind, "accepted", JSON.stringify(second));
  assert.equal(second.context.binding.contextHash, first.context.binding.contextHash);
  assert.deepEqual(second.context, first.context);

  const revised = structuredClone(firstInput);
  revised.entries.find(({ entryRef }) => entryRef === "fact:hall").revisionOrHash = "revision:13";
  const third = buildRequiredContext(revised);
  assert.equal(third.kind, "accepted", JSON.stringify(third));
  assert.notEqual(third.context.binding.contextHash, first.context.binding.contextHash);
});

test("vNext RequiredContext rejects premature transaction reads, critical unavailable input, unclassified entries, and overflow", () => {
  const prematureReadInput = requiredContextInput();
  prematureReadInput.binding.readSet = [{ ref: "fact:hall", revisionOrHash: "revision:12" }];
  const prematureRead = buildRequiredContext(prematureReadInput);
  assert.equal(prematureRead.kind, "rejected");
  assert.equal(prematureRead.code, "CONTEXT_INVALID");
  assert.deepEqual(prematureRead.issues, [
    "binding.readSet:must-be-empty-before-proposal-lowering",
  ]);

  const unavailableInput = requiredContextInput();
  unavailableInput.entries.push({
    kind: "unavailable",
    entryRef: "mechanics:actor-position",
    reason: "invalidProjection",
    critical: true,
  });
  const unavailable = buildRequiredContext(unavailableInput);
  assert.deepEqual(unavailable, {
    kind: "rejected",
    code: "CONTEXT_CRITICAL_UNAVAILABLE",
    issues: ["entry:mechanics:actor-position:invalidProjection"],
  });
  assert.equal("context" in unavailable, false);

  const unclassifiedInput = requiredContextInput();
  unclassifiedInput.references.citations.viewerEvidenceRefs = [];
  unclassifiedInput.references.citations.authorityBasisRefs = ["fact:hidden-support"];
  const unclassified = buildRequiredContext(unclassifiedInput);
  assert.equal(unclassified.kind, "rejected");
  assert.equal(unclassified.code, "CONTEXT_INVALID");
  assert.equal("context" in unclassified, false);

  const overflowInput = requiredContextInput();
  overflowInput.maxUnits = 1;
  const overflow = buildRequiredContext(overflowInput);
  assert.equal(overflow.kind, "rejected");
  assert.equal(overflow.code, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal("context" in overflow, false);
});

const NPC_DEFINITION = {
  kind: "npc",
  links: {
    entityRef: "npc:gray-gate-warden",
    sceneRef: "scene:gate",
    sourceRefs: ["fact:gray-gate-employment"],
  },
  metadata: {
    createdBy: "kp",
    continuityKey: "gray-gate-warden",
  },
  semantics: {
    name: "灰门守卫",
    description: "穿旧斗篷的守门人",
    attitude: "wary",
    voice: "简短而谨慎",
    goals: [
      { goalRef: "goal:old-rumor", text: "查清旧传闻" },
      { goalRef: "goal:watch-gate", text: "守住灰门" },
    ],
    relationships: [
      { relationshipRef: "relationship:guild", description: "受雇于行会" },
      { relationshipRef: "relationship:watch", description: "认识城防队" },
    ],
  },
};

const NPC_ALLOWLIST = [
  { kind: "value", path: ["semantics", "attitude"] },
  { kind: "value", path: ["semantics", "description"] },
  { kind: "referenceArray", path: ["semantics", "goals"], referenceField: "goalRef" },
  {
    kind: "referenceArray",
    path: ["semantics", "relationships"],
    referenceField: "relationshipRef",
  },
];

function npcCompositionInput(operations) {
  const base = createDefinitionSnapshot("definition:npc:gray-gate-warden", "7", NPC_DEFINITION);
  return {
    base,
    expectedRevision: base.revision,
    expectedHash: base.definitionHash,
    allowlist: NPC_ALLOWLIST,
    operations,
  };
}

test("Definition Composer applies sparse NPC semantics, preserves all omitted fields, and canonicalizes ref arrays", () => {
  const operations = [
    {
      kind: "upsertByRef",
      path: ["semantics", "goals"],
      entry: { goalRef: "goal:warn-party", text: "在钟响前警告队伍" },
    },
    {
      kind: "set",
      path: ["semantics", "attitude"],
      value: "cooperative",
    },
    {
      kind: "removeByRef",
      path: ["semantics", "relationships"],
      ref: "relationship:guild",
    },
    {
      kind: "upsertByRef",
      path: ["semantics", "goals"],
      entry: { goalRef: "goal:watch-gate", text: "守门并保护来客" },
    },
  ];
  const input = npcCompositionInput(operations);
  const original = structuredClone(input.base);
  const composed = composeDefinition(input);
  assert.equal(composed.kind, "accepted", JSON.stringify(composed));
  assert.equal(composed.nextRevision, "8");
  assert.match(composed.nextHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(composed.snapshot.definitionHash, composed.nextHash);
  assert.equal(composed.nextDefinition.semantics.name, "灰门守卫");
  assert.equal(composed.nextDefinition.semantics.voice, "简短而谨慎");
  assert.equal(composed.nextDefinition.semantics.description, "穿旧斗篷的守门人");
  assert.equal(composed.nextDefinition.semantics.attitude, "cooperative");
  assert.deepEqual(composed.nextDefinition.links, NPC_DEFINITION.links);
  assert.deepEqual(composed.nextDefinition.metadata, NPC_DEFINITION.metadata);
  assert.deepEqual(composed.nextDefinition.semantics.goals, [
    { goalRef: "goal:old-rumor", text: "查清旧传闻" },
    { goalRef: "goal:warn-party", text: "在钟响前警告队伍" },
    { goalRef: "goal:watch-gate", text: "守门并保护来客" },
  ]);
  assert.deepEqual(composed.nextDefinition.semantics.relationships, [
    { relationshipRef: "relationship:watch", description: "认识城防队" },
  ]);
  assert.deepEqual(input.base, original, "composition must not mutate the base snapshot");
  assert.equal(Object.isFrozen(composed.nextDefinition), true);

  const reordered = composeDefinition(npcCompositionInput([...operations].reverse()));
  assert.equal(reordered.kind, "accepted", JSON.stringify(reordered));
  assert.equal(reordered.nextHash, composed.nextHash);
  assert.deepEqual(reordered.nextDefinition, composed.nextDefinition);
});

test("Definition Composer rejects every mechanical path and nested mechanical payload with zero output", () => {
  for (const field of [
    "hp",
    "hitPoints",
    "position",
    "ownership",
    "quantity",
    "equipped",
    "charges",
    "durability",
    "resources",
  ]) {
    const input = npcCompositionInput([{
      kind: "set",
      path: ["semantics", field],
      value: 99,
    }]);
    input.allowlist = [{ kind: "value", path: ["semantics", field] }];
    const result = composeDefinition(input);
    assert.equal(result.kind, "rejected", field);
    assert.equal(result.code, "MECHANICAL_FIELD_FORBIDDEN", field);
    assert.equal("nextDefinition" in result, false, field);
  }

  const nested = npcCompositionInput([{
    kind: "set",
    path: ["semantics", "description"],
    value: { text: "伪装成描述", resources: { reaction: 99 } },
  }]);
  const nestedResult = composeDefinition(nested);
  assert.equal(nestedResult.kind, "rejected");
  assert.equal(nestedResult.code, "MECHANICAL_FIELD_FORBIDDEN");
  assert.equal("nextDefinition" in nestedResult, false);
});

test("Definition snapshots reject mechanical state at any base depth instead of preserving a second fact source", () => {
  const invalidDefinition = {
    ...NPC_DEFINITION,
    semantics: {
      ...NPC_DEFINITION.semantics,
      privateNotes: {
        observedObject: {
          durability: 3,
        },
      },
    },
  };
  assert.throws(
    () => createDefinitionSnapshot("definition:npc:invalid-mechanics", "1", invalidDefinition),
    /base:mechanical-field:base\.definition\.semantics\.privateNotes\.observedObject\.durability/u,
  );

  const valid = createDefinitionSnapshot("definition:npc:valid-base", "1", NPC_DEFINITION);
  const forgedBase = {
    ...valid,
    definition: invalidDefinition,
  };
  const composed = composeDefinition({
    base: forgedBase,
    expectedRevision: forgedBase.revision,
    expectedHash: forgedBase.definitionHash,
    allowlist: NPC_ALLOWLIST,
    operations: [{
      kind: "set",
      path: ["semantics", "attitude"],
      value: "friendly",
    }],
  });
  assert.equal(composed.kind, "rejected");
  assert.equal(composed.code, "DEFINITION_INVALID");
  assert.equal("nextDefinition" in composed, false);
});

test("Definition Composer rejects revision, expected-hash, and base-hash conflicts without a partial definition", () => {
  const operation = [{
    kind: "set",
    path: ["semantics", "attitude"],
    value: "friendly",
  }];

  const wrongRevisionInput = npcCompositionInput(operation);
  wrongRevisionInput.expectedRevision = "6";
  const wrongRevision = composeDefinition(wrongRevisionInput);
  assert.equal(wrongRevision.kind, "rejected");
  assert.equal(wrongRevision.code, "DEFINITION_CONFLICT");
  assert.equal("nextDefinition" in wrongRevision, false);

  const wrongHashInput = npcCompositionInput(operation);
  wrongHashInput.expectedHash = hash("e");
  const wrongHash = composeDefinition(wrongHashInput);
  assert.equal(wrongHash.kind, "rejected");
  assert.equal(wrongHash.code, "DEFINITION_CONFLICT");
  assert.equal("nextDefinition" in wrongHash, false);

  const corruptBaseInput = npcCompositionInput(operation);
  corruptBaseInput.base = { ...corruptBaseInput.base, definitionHash: hash("f") };
  corruptBaseInput.expectedHash = corruptBaseInput.base.definitionHash;
  const corruptBase = composeDefinition(corruptBaseInput);
  assert.equal(corruptBase.kind, "rejected");
  assert.equal(corruptBase.code, "DEFINITION_INVALID");
  assert.equal("nextDefinition" in corruptBase, false);
});
