import { VNEXT_SEMANTIC_TEMPLATES } from "../../app/_runtime/lib/rules/profiles/semantic-templates.ts";

export function worldFactSocialBundle({ sceneRef, npcRef, check = false,
  description = "她幼年跟随祖父学习修补渔网。", occurrence = "幼年期间，早于本次谈话。",
  response = "小时候，祖父教过我补渔网。", explanation = "未记载的个人经历，与已固定背景、年龄及知识边界相容。",
  judgment = "compatible", holders = [npcRef] }) {
  const handle = "prospective:new-experience", template = VNEXT_SEMANTIC_TEMPLATES.worldFact;
  const branch = failure => ({ outcomeCode: failure ? "declined" : "answered", summary: "对方作出回应。",
    response: { kind: "speech", text: failure ? "现在不想说这件事。" : response,
      motive: "PRIVATE-FACT-MOTIVE：依照自己的经历和意愿回答。",
      basis: [{ kind: "materializedKnowledge", definitionRef: handle, holderRef: npcRef }] }, consequences: [] });
  return { mode: "adjudication", basisRefs: [npcRef], terminal: { kind: "none" },
    adjudication: check ? { kind: "check", checkKind: "abilityCheck", ability: "cha", skill: "persuasion", dc: 12, mode: "normal",
      risk: "她可能不愿透露。", successOutcome: "愿意回答。", failureOutcome: "拒绝透露。" }
      : { kind: "directSuccess", risk: "普通交谈。", successOutcome: "作出回应。" },
    proposals: [{ kind: "materializeObject", semanticKind: "worldFact", basisRefs: [], consumes: [], outcomeBinding: "always",
      produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], templateRef: template.templateRef,
      templateHash: template.templateHash, visibilityPolicyRef: "visibility:hidden-until-evidence", summary: "固定此前未记载的经历。",
      definition: { sceneRef: "none", visibilityFactId: "none", label: "一段旧经历", description,
        observableState: "none", affordances: "none", mechanicDefinitionRefs: [],
        worldFact: { subjectRefs: holders, occurrence, consistency: { judgment, explanation },
          initialKnowledge: holders.map(holderRef => ({ holderRef, acquisitionBasisRefs: [holderRef], acquisitionExplanation: "PRIVATE-ACQUISITION：本人亲历并记得这件事。" })) } } },
      { kind: "social", basisRefs: [npcRef], consumes: [{ kind: "prospective", handle }], produces: [], outcomeBinding: "always",
        sceneRef, npcRef, addressedThreadRef: { kind: "none" }, goal: "了解对方过往。", method: "礼貌询问。", communication: "spokenConversation",
        audience: "participants", retryChange: { kind: "none" }, branches: { success: branch(false), failure: check ? branch(true) : { kind: "none" } } }] };
}
