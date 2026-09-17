const ACTOR = "character:probe-actor", SCENE = "scene:probe-gallery", SOURCE = "definition:probe-valve";
const sensory = evidence => ({ observerRef: ACTOR, subjectRef: SOURCE, sense: "hearing", evidence, basisRefs: [SOURCE] });
export function sharedCheckBundle(ownerKind = "observe") {
  const common = { basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE };
  const branch = (suffix, evidence) => ({ outcomeCode: `outcome:${suffix}`, summary: evidence,
    sensoryEvidence: [sensory(evidence)], ...(ownerKind === "observe" ? { characterInferences: [] } : { effects: [], pressures: [], opportunities: [] }) });
  const owner = { ...common, kind: ownerKind, outcomeBinding: "always", method: "倾听变化后旋动阀门。",
    ...(ownerKind === "observe" ? { inquiry: "能否判断阀门内的压力变化？", focusRefs: [SOURCE], existingFactRefs: [] }
      : { intent: "调节阀门。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" } }),
    branches: { success: branch("understood", "听清了压力变化。"), failure: branch("unclear", "声音模糊，未能分辨压力变化。") } };
  const consequence = (outcomeBinding, next) => ({ ...common, kind: "worldInteraction", outcomeBinding,
    targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
    intent: "执行该结果对应的阀门变化。", method: "按已经冻结的结果旋动阀门。",
    branches: { success: { outcomeCode: `outcome:${next}`, summary: `阀门变为${next}。`,
      effects: [{ kind: "definitionRevision", definitionRef: SOURCE,
        operations: [{ kind: "set", path: ["observableState"], value: next }], summary: `阀门变为${next}。` }],
      sensoryEvidence: [], pressures: [], opportunities: [] }, failure: { kind: "none" } } });
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "wis", skill: "perception", dc: 12,
      mode: "normal", risk: "判断错误会使阀门卡住。", successOutcome: "阀门开启。", failureOutcome: "阀门卡住。" },
    // Owner deliberately follows one consequence in source order. Graph
    // dependencies, never list position, determine execution order.
    proposals: [consequence("onSuccess", "opened"), owner, consequence("onFailure", "jammed")] };
}
