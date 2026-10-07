import { canonicalHash, isPlainRecord } from "./canonical-json";
import type { VNextRequiredContext } from "./required-context";
import { containerTransferWireSchemas } from "./container-transfer-wire";

/** SPEC 0016 §§4.3、7.1: presentation handles are deterministic over the
 * frozen authority records. They grant no permission and never name a new
 * instance. The original context, read bindings and saved reply stay intact. */
export function proposalReferenceDialect(context: VNextRequiredContext) {
  const refs = new Set(context.entries.map(entry => entry.entryRef));
  const citations = context.references.citations;
  for (const ref of [...citations.viewerEvidenceRefs, ...citations.authorityBasisRefs,
    ...(citations.npcKnowledge ?? []).flatMap(row => row.refs),
    ...(context.references.npcRecall ?? []).map(row => row.npcRef),
    ...(context.references.knowledgeRecall ?? []).flatMap(row => row.records.map(record => record.entryRef))]) refs.add(ref);
  const forward = new Map<string, string>(), reverse = new Map<string, string>();
  for (const ref of [...refs].sort()) {
    if (ref.length < 16) continue;
    const short = `r${canonicalHash(ref).slice(7, 19)}`;
    if (refs.has(short) || reverse.has(short)) throw new TypeError("PROPOSAL_REFERENCE_DIALECT_COLLISION");
    forward.set(ref, short); reverse.set(short, ref);
  }
  return { forward, reverse };
}

const referenceField = /(?:Refs?|Ids?)$|^(?:refs?|ids?|basis|sameAsEntryRef|shown|requestable)$/u;
const referenceMap = new Set(["equipped", "definitions", "entities", "entries", "identifiedDefinitions"]);
function references(value: unknown, names: ReadonlyMap<string, string>, key = ""): unknown {
  // SPEC 0014 §4: these are reference expressions, not narrative text.
  // Preserve their grammar/spacing and map each actual place/feature slot.
  if (typeof value === "string" && (key === "successEndsAt" || key === "failureEndsAt")) {
    const end = /^(\s*)(\S+)(?:(\s+)(inside|onTop)(\s+)(\S+))?(\s*)$/u.exec(value);
    if (end) return `${end[1]}${names.get(end[2]!) ?? end[2]}${end[4] === undefined ? "" : `${end[3]}${end[4]}${end[5]}${names.get(end[6]!) ?? end[6]}`}${end[7]}`;
  }
  if (typeof value === "string") return referenceField.test(key) ? names.get(value) ?? value : value;
  if (Array.isArray(value)) return value.map(member => references(member, names, referenceField.test(key) ? key : ""));
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([field, member]) => [referenceMap.has(key) ? names.get(field) ?? field : field,
    referenceMap.has(key) && typeof member === "string" ? names.get(member) ?? member : references(member, names, field)]));
}

/** Compact schemas share leaf enums. Resolve their use sites before mapping:
 * a definition used as both a reference and a vocabulary retains two forms. */
function schemaReferences(schema: Record<string, any>, names: ReadonlyMap<string, string>) {
  const definitions = schema.$def ?? {}, uses = new Map<string, Set<boolean>>();
  const scan = (value: unknown, slot = "", visited = new Set<string>()) => {
    if (Array.isArray(value)) { value.forEach(child => scan(child, slot, visited)); return; }
    if (!isPlainRecord(value)) return;
    if (typeof value.$ref === "string") {
      const name = value.$ref.slice("#/$def/".length), ref = referenceField.test(slot), signature = `${name}:${ref}`;
      const found = uses.get(name) ?? new Set<boolean>(); found.add(ref); uses.set(name, found);
      if (!visited.has(signature)) { const next = new Set(visited); next.add(signature); scan(definitions[name], slot, next); }
      return;
    }
    for (const [key, member] of Object.entries(value)) {
      if (key === "$def") continue;
      if (key === "properties" && isPlainRecord(member)) Object.entries(member).forEach(([field, shape]) => scan(shape, field, visited));
      else scan(member, slot, visited);
    }
  };
  scan(schema);
  const changes = (value: unknown, slot = "", seen = new Set<string>()): boolean => {
    if (Array.isArray(value)) return value.some(child => changes(child, slot, seen));
    if (!isPlainRecord(value)) return false;
    if (typeof value.$ref === "string") {
      const name = value.$ref.slice(7), signature = `${name}:${slot}`;
      if (seen.has(signature)) return false;
      const next = new Set(seen); next.add(signature); return changes(definitions[name], slot, next);
    }
    return Object.entries(value).some(([key, member]) => key === "enum" && Array.isArray(member) && referenceField.test(slot)
      ? member.some(item => typeof item === "string" && names.has(item))
      : key === "properties" && isPlainRecord(member) ? Object.entries(member).some(([field, shape]) => changes(shape, field, seen))
      : changes(member, slot, seen));
  };
  const specialized = new Set([...uses].flatMap(([name, flags]) => flags.size === 2 && changes(definitions[name], "ref") ? [name] : []));
  const visit = (value: unknown, slot = ""): any => {
    if (Array.isArray(value)) return value.map(child => visit(child, slot));
    if (!isPlainRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$def").map(([key, member]) => [key,
      key === "$ref" && typeof member === "string" && referenceField.test(slot) && specialized.has(member.slice(7))
        ? `${member}-wireRef`
        : key === "properties" && isPlainRecord(member) ? Object.fromEntries(Object.entries(member).map(([field, shape]) => [field, visit(shape, field)]))
        : key === "enum" && Array.isArray(member) && referenceField.test(slot)
          ? member.map(item => typeof item === "string" ? names.get(item) ?? item : item) : visit(member, slot)]));
  };
  const rewritten = Object.fromEntries(Object.entries(definitions).flatMap(([name, shape]) => {
    const flags = uses.get(name);
    return [[name, visit(shape, flags?.size === 1 && flags.has(true) ? "ref" : "")],
      ...(specialized.has(name) ? [[`${name}-wireRef`, visit(shape, "ref")]] : [])];
  }));
  return { ...visit(schema), ...(schema.$def ? { $def: rewritten } : {}) };
}

export function proposalWireReferences<T>(value: T, context: VNextRequiredContext): T {
  return references(value, proposalReferenceDialect(context).forward) as T;
}

/** Diagnostic values have no field-name provenance. Only exact frozen IDs
 * in actual/expected are mapped; free-form explanations stay unchanged. */
export function proposalWireDiagnosticReferences<T>(value: T, context: VNextRequiredContext): T {
  const names = proposalReferenceDialect(context).forward;
  const visit = (node: unknown): unknown => typeof node === "string" ? names.get(node) ?? node
    : Array.isArray(node) ? node.map(visit) : isPlainRecord(node)
      ? Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)])) : node;
  return visit(value) as T;
}

export function proposalUsesTypedReplacement(capabilities: readonly string[], context?: VNextRequiredContext): boolean {
  return context !== undefined && capabilities.every(id => ["inventoryOperation", "worldInteraction", "storyContinuity"].includes(id));
}

/** Only deterministic scene bindings disappear. The KP's targets, method,
 * risk, time and results remain its choices, including clarification paths. */
export function bindProposalWire(value: unknown, context: VNextRequiredContext): unknown {
  const decoded = references(value, proposalReferenceDialect(context).reverse);
  const actor = context.entries.find(entry => entry.kind === "known" && entry.entryRef === context.intent.actorRef);
  const entity = actor?.kind === "known" && isPlainRecord(actor.value) ? actor.value.entity : undefined;
  const scene = isPlainRecord(entity) && typeof entity.sceneId === "string" ? entity.sceneId : undefined;
  if (!scene) return decoded;
  const walk = (document: unknown) => {
    if (!isPlainRecord(document)) return;
    for (const container of [document.check, document.steps]) {
      if (!isPlainRecord(container)) continue;
      for (const kind of ["worldInteraction", "observe", "social"]) {
        const rows = container[kind];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) if (isPlainRecord(row) && !Object.hasOwn(row, "sceneRef")) row.sceneRef = scene;
      }
    }
    const decision = isPlainRecord(document.decision) ? document.decision : document;
    if (decision.kind === "clarification" && Array.isArray(decision.choices))
      for (const choice of decision.choices) if (isPlainRecord(choice)) walk(choice.continuation);
  };
  walk(decoded);
  return decoded;
}

export function proposalDialectModelInput<T extends { messages: readonly { role: string; content: string }[]; tools: readonly unknown[] }>(
  input: T, context?: VNextRequiredContext): T {
  if (!context) return input;
  // All bound production bodies are the machine JSON context. Unbound
  // vocabulary/tests are not silently given another reference dialect.
  const messages = input.messages.map(message => {
    if (message.role !== "system") return message;
    const start = message.content.indexOf('{"requiredContext":');
    if (start < 0) return message;
    const end = message.content.indexOf("\n", start);
    const body = message.content.slice(start, end < 0 ? undefined : end);
    const parsed = JSON.parse(body);
    return { ...message, content: message.content.slice(0, start) + JSON.stringify(proposalWireReferences(parsed, context))
      + (end < 0 ? "" : message.content.slice(end)) };
  });
  if (messages.every((message, i) => message === input.messages[i])) return input;
  const tools = input.tools.map((tool: any) => ({ ...tool, function: { ...tool.function,
    parameters: schemaReferences(tool.function.parameters, proposalReferenceDialect(context).forward) } }));
  for (const tool of tools) {
    const operation = tool.function.parameters.$def?.steps?.properties?.inventoryOperation?.items?.properties?.operation;
    if (Array.isArray(operation?.anyOf)) operation.anyOf.push(...containerTransferWireSchemas(operation.anyOf, context, proposalReferenceDialect(context).forward));
  }
  const actor = context.entries.find(entry => entry.kind === "known" && entry.entryRef === context.intent.actorRef);
  const scoped = actor?.kind === "known" && isPlainRecord(actor.value) && isPlainRecord(actor.value.entity)
    && typeof actor.value.entity.sceneId === "string";
  const visit = (node: unknown) => {
    if (!isPlainRecord(node)) { if (Array.isArray(node)) node.forEach(visit); return; }
    const fields = node.properties;
    if (scoped && isPlainRecord(fields) && Object.hasOwn(fields, "sceneRef")
      && ((Object.hasOwn(fields, "commonAction") && Object.hasOwn(fields, "directTargetRefs"))
        || (Object.hasOwn(fields, "focusRefs") && Object.hasOwn(fields, "inquiry"))
        || (Object.hasOwn(fields, "npcRef") && Object.hasOwn(fields, "actorSpeech")))) {
      delete fields.sceneRef;
      if (Array.isArray(node.required)) node.required = node.required.filter(field => field !== "sceneRef");
    }
    Object.values(node).forEach(visit);
  };
  tools.forEach(visit);
  return { ...input, messages, tools } as T;
}
