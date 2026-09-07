import assert from "node:assert/strict";
import test from "node:test";
import { proposalProspectiveHandles } from "../app/_runtime/lib/kp/vnext/proposal-reference-slots.ts";

const h = name => `prospective:${name}`;
const sorted = names => [...new Set(names.map(h))].sort();
const common = { basisRefs: [h("basis"), "fact:existing"], consumes: [{ kind: "prospective", handle: h("declared-only") }],
  produces: [{ handle: h("producer-only"), kind: "semanticDefinition", outcomeBinding: "always" }] };
const senses = [{ observerRef: h("observer"), subjectRef: h("subject"), basisRefs: [h("evidence-basis")], evidence: h("prose") }];
const operations = [{ kind: "removeByRef", ref: h("removed") },
  { kind: "upsertByRef", entry: { goalRef: h("goal"), description: h("prose") } },
  { kind: "upsertByRef", entry: { planRef: h("plan"), description: h("prose") } },
  { kind: "set", path: ["description"], value: { sourceRef: h("arbitrary-value"), nested: h("prose") } }];

test("prospective references use one typed traversal across every proposal family", () => {
  const cases = [
    [{ kind: "worldInteraction", sceneRef: h("scene"), targetRefs: [h("target")], directTargetRefs: [h("target")],
      instrumentRefs: [h("instrument")], abilityRef: h("ability"), branches: { success: {
        effects: [{ kind: "traversePassage", passageRef: h("passage") }, { kind: "relationTransition", relationRef: h("relation") },
          { kind: "definitionRevision", definitionRef: h("definition"), operations },
          { kind: "registeredHazard", sourceDefinitionRef: h("hazard-source"), zoneRef: h("zone"),
            damage: { kind: "authored", hazardDefinitionRef: h("hazard") } }],
        sensoryEvidence: senses, pressures: [{ sourceRef: h("pressure"), basisRefs: [h("pressure-basis")] }],
        opportunities: [{ targetRef: h("opportunity"), basisRefs: [h("opportunity-basis")] }],
      }, failure: { effects: [{ kind: "traversePassage", passageRef: h("failure-passage") }], sensoryEvidence: [], pressures: [], opportunities: [] } } },
      ["scene", "target", "instrument", "ability", "passage", "relation", "definition", "removed", "goal", "plan", "hazard-source", "zone", "hazard",
        "observer", "subject", "evidence-basis", "pressure", "pressure-basis", "opportunity", "opportunity-basis", "failure-passage"]],
    [{ kind: "observe", sceneRef: h("scene"), focusRefs: [h("focus")], existingFactRefs: [h("fact")],
      branches: { success: { sensoryEvidence: senses }, failure: null } }, ["scene", "focus", "fact", "observer", "subject", "evidence-basis"]],
    [{ kind: "social", sceneRef: h("scene"), npcRef: h("npc"), addressedThreadRef: h("thread"),
      retryChange: { priorThreadRef: h("prior-thread"), basisRefs: [h("retry-basis")] }, branches: { success: {
        response: { basis: [{ kind: "npcContext", ref: h("npc-context") },
          { kind: "materializedKnowledge", definitionRef: h("new-fact"), holderRef: h("holder") }] },
        consequences: [{ kind: "promise", authorityRefs: [h("promise-authority")] },
          { kind: "relationship", relationshipRef: h("relationship"), basisFactRefs: [h("relationship-basis")] },
          { kind: "debt", basisFactRefs: [h("debt-basis")] }],
      }, failure: null } }, ["scene", "npc", "thread", "prior-thread", "retry-basis", "npc-context", "new-fact", "holder", "promise-authority", "relationship", "relationship-basis", "debt-basis"]],
    [{ kind: "commitNarrativeDetail", sceneRef: h("scene"), description: h("prose") }, ["scene"]],
    [{ kind: "reviseSemanticDefinition", definitionRef: h("definition"), npcRef: h("npc"), templateRef: h("template"), operations },
      ["definition", "npc", "template", "removed", "goal", "plan"]],
    [{ kind: "materializeObject", templateRef: h("template"), visibilityPolicyRef: h("policy"), definition: {
      sceneRef: h("scene"), visibilityFactId: h("visibility"), mechanicDefinitionRefs: [h("mechanic")],
      passage: { fromLocationRef: h("from"), toLocationRef: h("to") },
      worldFact: { subjectRefs: [h("subject")], initialKnowledge: [{ holderRef: h("holder"), acquisitionBasisRefs: [h("acquisition")] }] },
    } }, ["template", "policy", "scene", "visibility", "mechanic", "from", "to", "subject", "holder", "acquisition"]],
    [{ kind: "materializeDefinition", source: { kind: "hazard", content: {
      trigger: { kind: "disturbFeature", ref: h("trigger") }, mechanicsRef: h("mechanic"), perceptibleSigns: [h("prose")],
    } } }, ["trigger", "mechanic"]],
    [{ kind: "materializeDefinition", source: { kind: "item", content: {
      equippedAbilityRefs: [h("equipped")], use: { kind: "useObject", abilityRef: h("use") },
      equipment: { weapon: { ammunitionDefinitionRef: h("ammunition") } }, description: h("prose"),
    } } }, ["equipped", "use", "ammunition"]],
    [{ kind: "materializeDefinition", source: { kind: "ability", content: {
      effect: { kind: "endEffect", sourceRef: h("source") }, effects: [{ kind: "endEffect", sourceRef: h("second-source") }],
      costs: [{ kind: "item", resourceId: h("cost") }, { kind: "classResource", resourceId: h("not-item") }, { kind: "spellSlot", level: 1 }],
    } } }, ["source", "second-source", "cost"]],
    [{ kind: "materializeItem", definitionRef: h("definition"), sceneRef: h("scene"), uniquenessBasisRef: h("unique"),
      ownership: { kind: "character", ownerRef: h("owner") } }, ["definition", "scene", "unique", "owner"]],
    ...["acquire", "identify", "equip", "lifecycle"].map(kind => [{ kind: "inventoryOperation", operation: { kind, entryRef: h("entry") } }, ["entry"]]),
    [{ kind: "inventoryOperation", operation: { kind: "release", entryRef: h("entry"), sceneRef: h("scene") } }, ["entry", "scene"]],
    [{ kind: "inventoryOperation", operation: { kind: "transfer", entryRef: h("entry"), targetCharacterRef: h("recipient") } }, ["entry", "recipient"]],
    [{ kind: "inventoryOperation", operation: { kind: "use", entryRef: h("entry"), targetRefs: [h("target")] } }, ["entry", "target"]],
  ];
  for (const [partial, names] of cases) {
    const input = { ...common, ...partial, summary: h("prose") };
    const before = structuredClone(input);
    const result = proposalProspectiveHandles(input);
    assert.deepEqual(result, sorted(["basis", ...names]), `${partial.kind}/${partial.source?.kind ?? partial.operation?.kind ?? ""}`);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(input, before);
  }
});

test("unknown and malformed nested reference containers are neither traversed nor repaired", () => {
  const values = [undefined, null, 7, false, "bad", [], [[h("nested-array")]], { arbitrary: h("nested-object") }, Object.create(null)];
  for (const value of values) {
    assert.doesNotThrow(() => proposalProspectiveHandles(value));
    for (const kind of ["worldInteraction", "observe", "social", "commitNarrativeDetail", "reviseSemanticDefinition", "materializeObject", "materializeDefinition", "materializeItem", "inventoryOperation"]) {
      const input = { kind, basisRefs: value, sceneRef: value, targetRefs: value, directTargetRefs: value, instrumentRefs: value,
        branches: { success: value, failure: value }, operations: value, definition: value, source: value, ownership: value, operation: value };
      assert.deepEqual(proposalProspectiveHandles(input), []);
    }
    const branches = { success: { effects: value, sensoryEvidence: value, pressures: value, opportunities: value,
      response: { basis: value }, consequences: value }, failure: null };
    for (const kind of ["worldInteraction", "observe", "social"]) assert.deepEqual(proposalProspectiveHandles({ kind, branches }), []);
    assert.deepEqual(proposalProspectiveHandles({ kind: "materializeDefinition", source: { kind: "hazard", content: { trigger: { kind: value, ref: h("hidden") } } } }), []);
    assert.deepEqual(proposalProspectiveHandles({ kind: "materializeObject", definition: { worldFact: { initialKnowledge: value }, passage: value } }), []);
    assert.deepEqual(proposalProspectiveHandles({ kind: "worldInteraction", branches: { success: { effects: [{ kind: "definitionRevision", operations: [{ kind: "upsertByRef", entry: value }] }] } } }), []);
  }
  const cyclic = {}; cyclic.nested = cyclic; cyclic.sourceRef = h("not-a-scalar");
  assert.deepEqual(proposalProspectiveHandles({ kind: "inventoryOperation", operation: { kind: "acquire", entryRef: cyclic } }), []);
  assert.deepEqual(proposalProspectiveHandles({ kind: "unknown", basisRefs: [h("ignored")] }), []);
  assert.deepEqual(proposalProspectiveHandles({ kind: "inventoryOperation", operation: { kind: "acquire", entryRef: "prospective:" } }), ["prospective:"],
    "malformed handle grammar stays visible to the existing validator; extraction must not silently drop it");
});

test("prose, scoped knowledge and unrelated NPC/context records never create prospective dependencies", () => {
  const privateHandle = h("other-npc-private"), ownHandle = h("own-new-fact");
  const observation = { kind: "observe", basisRefs: ["fact:public"], sceneRef: "scene:public", focusRefs: [], existingFactRefs: [],
    inquiry: privateHandle, method: privateHandle, branches: { success: { sensoryEvidence: [], characterInferences: [{
      conclusion: privateHandle, evidence: [{ kind: "heldKnowledge", ref: privateHandle }],
    }] }, failure: null }, npcContext: { records: [{ ref: privateHandle }] } };
  assert.deepEqual(proposalProspectiveHandles(observation), []);
  const social = { kind: "social", sceneRef: "scene:public", npcRef: "npc:one", basisRefs: [],
    branches: { success: { response: { text: privateHandle, motive: privateHandle, basis: [
      { kind: "playerExpression" }, { kind: "materializedKnowledge", definitionRef: ownHandle, holderRef: "npc:one" },
    ], context: { records: [{ ref: privateHandle }] } }, consequences: [] }, failure: null },
    unrelatedProposal: { kind: "social", basisRefs: [privateHandle] },
  };
  assert.deepEqual(proposalProspectiveHandles(social), [ownHandle]);
  assert.deepEqual(proposalProspectiveHandles(observation), [], "one invocation cannot leak handles from another NPC or proposal");
  assert.deepEqual(proposalProspectiveHandles({ kind: "worldInteraction", branches: { success: { effects: [
    { kind: "unknown", sourceDefinitionRef: privateHandle }, { kind: "definitionRevision", definitionRef: "definition:existing",
      operations: [{ kind: "set", path: ["description"], value: { abilityRef: privateHandle } }] },
  ] } }, consumes: [{ kind: "prospective", handle: privateHandle }], produces: [{ handle: privateHandle }] }), []);
});
