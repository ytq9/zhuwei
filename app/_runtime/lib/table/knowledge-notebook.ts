type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : undefined;

export type KnowledgeCard = {
  id: string;
  name: string;
  text: string;
  hint: string;
  layer: "talk" | "full";
  background?: boolean;
  notes?: Array<{ id: string; text: string; hint: string; layer: "talk" | "full"; source?: string }>;
};

const kinds: Record<string, string> = {
  sensoryEvidence: "感官证据", sourceClaim: "来源主张", characterInference: "角色推断", canonicalFact: "已知事实",
};

// SPEC 0005 §§6、7、SPEC 0010 §7：仅整理当前 Viewer 已取得的投影。
// 分组只用公开的对象身份与已有证据链，不按相似措辞推测同一对象或真伪。
export function knowledgeNotebook(readModel: RecordValue, withheld: ReadonlySet<string>): KnowledgeCard[] {
  const allKnowledge = (Array.isArray(readModel.knowledge) ? readModel.knowledge : []).filter(record);
  const knowledgeRefs = new Set(allKnowledge.map(entry => String(entry.knowledgeRef)));
  const knowledge = allKnowledge.filter(entry => text(entry.knowledgeRef) && !withheld.has(String(entry.knowledgeRef)));
  const held = new Map(knowledge.map(entry => [String(entry.knowledgeRef), entry]));
  const facts = new Map((Array.isArray(readModel.visibleFacts) ? readModel.visibleFacts : []).filter(record)
    .map(fact => [String(fact.id), fact]));
  const names = new Map<string, string>();
  for (const collection of [readModel.visibleItems, readModel.entities]) {
    for (const entity of (Array.isArray(collection) ? collection : record(collection) ? Object.values(collection) : []).filter(record)) {
      const id = text(entity.itemEntryId) ?? text(entity.entryId) ?? text(entity.entityId) ?? text(entity.id);
      const name = text(entity.name);
      if (id && name) names.set(id, name);
    }
  }
  function subject(entry: RecordValue, visiting = new Set<string>()): string | undefined {
    const id = String(entry.knowledgeRef);
    if (visiting.has(id)) return undefined;
    const fact = facts.get(id);
    if (entry.objectKind === "sensoryEvidence" && record(fact?.value)) return text(fact.value.subjectRef);
    if (entry.objectKind !== "characterInference" || !Array.isArray(entry.provenanceChain)) return undefined;
    const sources = entry.provenanceChain.filter((ref): ref is string => typeof ref === "string" && knowledgeRefs.has(ref));
    if (!sources.length) return undefined;
    const subjects = sources.map(ref => held.has(ref) ? subject(held.get(ref)!, new Set([...visiting, id])) : undefined);
    return subjects.every(value => value !== undefined && value === subjects[0]) ? subjects[0] : undefined;
  }
  const groups = new Map<string, KnowledgeCard>();
  for (const entry of knowledge) {
    const id = String(entry.knowledgeRef), kind = text(entry.objectKind);
    // Ordinary turns remain in the viewer's conversation history; a spoken
    // sentence does not automatically become a separate discovery card.
    if (!kind || (kind === "sourceClaim" && (id.startsWith("claim:social:") || id.startsWith("claim:social-npc:")))) continue;
    const content = entry.content;
    const title = record(content) ? text(content.title) ?? text(content.name) : undefined;
    const body = typeof content === "string" ? text(content) : !record(content) ? undefined
      : content.schema === "zhuwei.character-inference/v1"
        ? [text(content.conclusion), text(content.confidence)].filter(Boolean).join("\n")
        : text(content.text) ?? text(content.publicText) ?? text(content.summary) ?? text(content.description);
    if (!body) continue;
    const subjectRef = subject(entry);
    const background = !subjectRef && !title;
    const key = subjectRef ? `subject:${subjectRef}` : title ? id : "notebook:background";
    const layer = entry.layer === "full" ? "full" as const : "talk" as const;
    const hint = kinds[kind] ?? "已知信息";
    const sourceRef = text(entry.sourceCharacterId);
    const source = sourceRef ? `由${names.get(sourceRef) ?? "他人"}转述` : undefined;
    const note = { id, text: body, hint, layer, ...(source ? { source } : {}) };
    const current = groups.get(key);
    if (current) {
      current.notes ??= [{ id: current.id, text: current.text, hint: current.hint, layer: current.layer }];
      current.notes.push(note);
      if (current.hint !== hint) current.hint = "观察与推断";
      if (layer !== "full") current.layer = "talk";
    } else {
      groups.set(key, { id: subjectRef || background ? key : id, name: title ?? (subjectRef ? names.get(subjectRef) ?? "观察记录" : "其他见闻"),
        text: body, hint, layer, ...(background ? { background: true } : {}),
        ...(subjectRef || background || source ? { notes: [note] } : {}) });
    }
  }
  return [...groups.values()];
}
