import { compareCodeUnits, isPlainRecord, sameCanonical } from "./canonical-json";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { VNextRequiredContext } from "./required-context";
import { proposalFillingSteps } from "./proposal-filling-interface";
import { proposalInventoryEntryRefs } from "./proposal-context";
import { authoritySceneContainerState } from "../../rules/authority-read";

function transferSources(context: VNextRequiredContext) {
  const authorized = new Set(proposalInventoryEntryRefs(context));
  const entries = context.entries.flatMap(entry => entry.kind === "known" && authorized.has(entry.entryRef) && isPlainRecord(entry.value)
    ? [{ ref: entry.entryRef, value: entry.value }] : []);
  return { takeOut: entries.filter(entry => typeof entry.value.containerRef === "string").map(entry => entry.ref),
    putIn: entries.filter(entry => entry.value.disposition === "held" && entry.value.holderRef === context.intent.actorRef
      && entry.value.containerRef === undefined && (entry.value.equippedSlot === null || entry.value.equippedSlot === undefined)).map(entry => entry.ref) };
}

/** What a revision may name as the source for this container: the read
 * sources, and the carried items the freeze only listed, which a draft that
 * names one reads (ADR 0133). Nothing goes into itself or into a container
 * inside it, so the container and whatever holds it are not put-in sources. */
function transferCandidates(context: VNextRequiredContext, records: ReadonlyMap<string, Record<string, unknown>>, containerRef: string) {
  const holding = new Set([containerRef]);
  for (let ref = records.get(containerRef)?.containerRef; typeof ref === "string" && !holding.has(ref); ref = records.get(ref)?.containerRef) holding.add(ref);
  const listed = (context.references.possessionRecall ?? []).filter(row => !records.has(row.entryRef));
  const sources = transferSources(context);
  const sorted = (refs: readonly string[]) => [...new Set(refs)].sort(compareCodeUnits);
  return {
    takeOut: sorted([...sources.takeOut, ...listed.filter(row => row.containerRef !== null).map(row => row.entryRef)]),
    putIn: sorted([...sources.putIn, ...listed.filter(row => row.containerRef === null && row.equippedSlot === null).map(row => row.entryRef)])
      .filter(ref => !holding.has(ref)),
  };
}

/** The name a read item goes by: its frozen definition's, or else the name
 * the actor's last look into its container recorded. */
function itemLabel(records: ReadonlyMap<string, Record<string, unknown>>, ref: string): string | undefined {
  const item = records.get(ref);
  const content = typeof item?.definitionRef === "string" ? records.get(item.definitionRef)?.content : undefined;
  if (isPlainRecord(content) && typeof content.label === "string") return content.label;
  const memories = typeof item?.containerRef === "string" ? records.get(item.containerRef)?.containerMemories : undefined;
  const remembered = (Array.isArray(memories) ? memories : []).flatMap(memory => isPlainRecord(memory) && Array.isArray(memory.entries) ? memory.entries : [])
    .find(entry => isPlainRecord(entry) && entry.entryId === ref);
  return isPlainRecord(remembered) && typeof remembered.name === "string" ? remembered.name : undefined;
}

/** The name a listed carried item goes by in the directory. */
function listedLabel(context: VNextRequiredContext, ref: string): string | undefined {
  return (context.references.possessionRecall ?? []).find(row => row.entryRef === ref)?.label;
}

/** The entry refs a form's own operations list, read through shared `$def`
 * references; undefined when the form lists none, i.e. takes any ref. */
function listedEntryRefs(schema: unknown, defs: Readonly<Record<string, unknown>>, seen = new Set<string>()): ReadonlySet<string> | undefined {
  if (!isPlainRecord(schema)) return undefined;
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.slice("#/$def/".length);
    if (seen.has(name)) return undefined;
    return listedEntryRefs(defs[name], defs, new Set([...seen, name]));
  }
  if (Array.isArray(schema.enum)) return new Set(schema.enum.filter((item): item is string => typeof item === "string"));
  if (!Array.isArray(schema.anyOf)) return undefined;
  const parts = schema.anyOf.map(part => listedEntryRefs(part, defs, seen));
  return parts.some(part => part !== undefined) ? new Set(parts.flatMap(part => [...(part ?? [])])) : new Set();
}

export function containerTransferWireSchemas(variants: readonly Record<string, any>[], context?: VNextRequiredContext,
  names: ReadonlyMap<string, string> = new Map(), defs: Readonly<Record<string, unknown>> = {}) {
  const acquire = variants.find(row => row.properties?.kind?.enum?.includes("acquire"));
  const store = variants.find(row => row.properties?.kind?.enum?.includes("store"));
  if (!acquire || !store) throw new TypeError("CONTAINER_TRANSFER_WIRE_SCHEMA_UNAVAILABLE");
  const sources = context && transferSources(context);
  // ADR 0132: a declaration names only an entry this form's operations list.
  // That list follows the stage's view, so a carried item another stage read
  // is not offered here, and Room rebuilds the same form from the full context.
  const listed = listedEntryRefs(acquire.properties.entryRef, defs);
  return (["takeOut", "putIn"] as const).flatMap(direction => {
    const refs = sources?.[direction].filter(ref => listed === undefined || listed.has(names.get(ref) ?? ref));
    if (refs?.length === 0) return [];
    const properties = { kind: { type: "string", enum: ["containerTransfer"] }, direction: { type: "string", enum: [direction] },
      containerRef: store.properties.containerRef, entryRef: refs ? { type: "string", enum: refs.map(ref => names.get(ref) ?? ref) } : acquire.properties.entryRef,
      quantity: acquire.properties.quantity, access: { type: "string", enum: ["alreadyOpen", "openNormally"] }, after: { type: "string", enum: ["leaveAsIs", "close"] } };
    return [{ type: "object", properties, required: Object.keys(properties), additionalProperties: false,
      description: `${direction === "takeOut" ? "Take the exact source currently inside containerRef." : "Put the exact loose, unequipped item currently held by this actor into containerRef."} access/after explicitly declare normal opening/closing. Expands to open, acquire/store, close; no implicit unlock, damage, discovery, creation or completion.` }];
  });
}

export class ContainerTransferWireError extends TypeError {
  constructor(readonly diagnostics: readonly ProposalDiagnostic[]) { super("CONTAINER_TRANSFER_WIRE_INVALID"); }
}

/** SPEC 0001 §16, SPEC 0016 §7.3: a registered, finite declaration expands
 * into existing world and inventory primitives. No live read, state patch,
 * implicit unlock, repair, entropy or extra call. The KP chooses all access
 * intent explicitly. Rules still verifies every generated primitive. */
export function expandContainerTransferWire(value: unknown, context: VNextRequiredContext) {
  const actor = context.entries.find(entry => entry.kind === "known" && entry.entryRef === context.intent.actorRef);
  const entity = actor?.kind === "known" && isPlainRecord(actor.value) ? actor.value.entity : undefined;
  const scene = isPlainRecord(entity) ? entity.sceneId : undefined;
  const generated = new Set<object>();
  const origins = new Map<string, readonly (string | number)[]>();
  const records = new Map(context.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value)
    ? [[entry.entryRef, entry.value] as const] : []));
  // SPEC 0016 §7.2 (ADR 0095): one revision is told every problem of every
  // declaration, so a wrong source and an undeclared opening arrive together.
  const problems: ProposalDiagnostic[] = [];
  const repair = { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } as const;
  function conflict(path: readonly (string | number)[], operation: unknown, reason: string) {
    problems.push(proposalDiagnostic("CONSTRAINT_CONFLICT", `container-transfer:${reason}`,
      { path, pathBase: "arguments", expected: { requirement: "Declare ordinary access to the exact existing source/container. Locked, foreign-held or undecided mechanisms require their own adjudication/completion; no damage or unlock is implicit." },
        actual: diagnosticActual(operation), repair }));
  }
  const walk = (document: unknown, path: readonly (string | number)[] = []) => {
    if (!isPlainRecord(document)) return;
    if (isPlainRecord(document.steps) && Array.isArray(document.steps.inventoryOperation)) {
      const rows = document.steps.inventoryOperation;
      const intervals = new Map<string, { access: unknown; after: unknown }>();
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (!isPlainRecord(row)) continue;
        const op = row.operation;
        if (!isPlainRecord(op)) continue;
        // A declaration's own fields with no kind is that declaration with
        // its kind left out, not a malformed store (a live revision dropped
        // it and was then told to write kind store).
        // access and after are this declaration's alone; an area use also
        // has a direction, but never takeOut or putIn.
        const kindless = op.kind === undefined && (Object.hasOwn(op, "access") || Object.hasOwn(op, "after")
          || ["takeOut", "putIn"].includes(String(op.direction)));
        if (op.kind !== "containerTransfer" && !kindless) continue;
        const at = [...path, "steps", "inventoryOperation", index, "operation"];
        const before = problems.length;
        if (kindless) problems.push(proposalDiagnostic("FIELD_MISSING", "container-transfer:kind-required", { path: [...at, "kind"],
          pathBase: "arguments", expected: { required: true, enum: ["containerTransfer"] }, actual: diagnosticActual(undefined), repair }));
        if (!sameCanonical(Object.keys({ ...op, kind: "containerTransfer" }).sort(), ["access", "after", "containerRef", "direction", "entryRef", "kind", "quantity"])
          || !["takeOut", "putIn"].includes(String(op.direction)) || !["alreadyOpen", "openNormally"].includes(String(op.access))
          || !["leaveAsIs", "close"].includes(String(op.after)) || typeof op.containerRef !== "string" || typeof op.entryRef !== "string"
          || !Number.isSafeInteger(op.quantity) || Number(op.quantity) < 1 || Number(op.quantity) > 1_000_000 || typeof scene !== "string") {
          conflict(at, op, "invalid-declaration");
          continue;
        }
        const containerRef = op.containerRef, entryRef = op.entryRef;
        const container = records.get(containerRef), item = records.get(entryRef);
        const candidates = transferCandidates(context, records, containerRef);
        // The source: read, in this container to take out, or a loose held
        // item that is neither this container nor anything holding it.
        if (!item) problems.push(proposalDiagnostic("REFERENCE_UNAVAILABLE", "container-transfer:source-not-read", {
          path: [...at, "entryRef"], pathBase: "arguments", actual: diagnosticActual(entryRef),
          expected: { enum: candidates[op.direction === "putIn" ? "putIn" : "takeOut"],
            requirement: "Name an item this stage has read, or a carried item listed in references.possessionRecall, which is read when a draft names it." },
          repair }));
        else if (op.direction === "takeOut" && (item.containerRef !== containerRef || !transferSources(context).takeOut.includes(entryRef))) conflict(at, op, "source-container-mismatch");
        else if (op.direction === "putIn" && !candidates.putIn.includes(entryRef)) {
          const named = itemLabel(records, entryRef);
          const sameName = named === undefined ? [] : candidates.putIn.filter(ref => (itemLabel(records, ref) ?? listedLabel(context, ref)) === named);
          problems.push(proposalDiagnostic("REFERENCE_UNAVAILABLE", "container-transfer:put-in-needs-loose-held-source", {
            path: [...at, "entryRef"], pathBase: "arguments", actual: diagnosticActual(entryRef),
            expected: { enum: candidates.putIn, ...(sameName.length === 0 ? {} : { sameName }),
              requirement: "Select the loose item the actor holds that goes into this container. The container itself, anything holding it, and the stack already inside it are not that item. A carried item listed in references.possessionRecall is read when named here." },
            repair }));
        }
        // The container and the access the declaration chose for it.
        if (!container || !context.references.citations.viewerEvidenceRefs.includes(containerRef)) conflict(at, op, "frozen-visible-container-required");
        else if (container.holderRef && container.holderRef !== context.intent.actorRef) conflict(at, op, "foreign-held-container");
        else {
          const state = isPlainRecord(container.stateMachine) ? container.stateMachine.state
            : authoritySceneContainerState(container.feature, container.content);
          const unrestricted = container.stateMachine === null;
          if (state === "locked") conflict(at, op, "locked-container");
          else if (!unrestricted && !["open", "closed", "destroyed"].includes(String(state))) conflict(at, op, "mechanism-not-defined");
          else {
            if (op.access === "alreadyOpen" && state === "closed") conflict(at, op, "opening-not-declared");
            if (op.after === "close" && (unrestricted || state === "destroyed")) conflict(at, op, "cannot-close-without-working-mechanism");
            const interval = intervals.get(containerRef);
            if (interval && (interval.access !== op.access || interval.after !== op.after)) conflict(at, op, "conflicting-access-declarations");
          }
          if (problems.length > before) continue;
          const interval = intervals.get(containerRef);
          intervals.set(containerRef, { access: op.access, after: op.after });
          const world = (action: "open" | "close") => {
            const result = { basisRefs: row.basisRefs, outcomeBinding: row.outcomeBinding, sceneRef: scene,
              directTargetRefs: [containerRef], otherTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" }, approach: { kind: "none" },
              commonAction: { kind: "operateObject", targetRef: containerRef, destinationRef: "none", option: action },
              intent: action === "open" ? "为本次取放正常打开容器。" : "按已声明的取放后要求合上容器。",
              method: "沿容器已定义的开关机制操作。", result: { outcomeCode: "containerAccess", summary: action === "open" ? "容器正常打开。" : "容器合上。",
                entries: [] } };
            generated.add(result); return result;
          };
          const worlds = Array.isArray(document.steps.worldInteraction) ? document.steps.worldInteraction : (document.steps.worldInteraction = []);
          const append = (action: "open" | "close") => {
            const worldPath = [...path, "steps", "worldInteraction", worlds.length];
            origins.set(JSON.stringify(worldPath), at); worlds.push(world(action));
          };
          if (!interval && op.access === "openNormally" && state === "closed") append("open");
          row.operation = op.direction === "takeOut" ? { kind: "acquire", entryRef, quantity: op.quantity }
            : { kind: "store", entryRef, quantity: op.quantity, containerRef };
          if (!interval && op.after === "close") append("close");
        }
      }
    }
    const decision = isPlainRecord(document.decision) ? document.decision : document;
    if (decision.kind === "clarification" && Array.isArray(decision.choices)) decision.choices.forEach((choice, index) => {
      if (isPlainRecord(choice)) walk(choice.continuation, [...path, ...(decision === document ? [] : ["decision"]), "choices", index, "continuation"]);
    });
  };
  walk(value);
  if (problems.length > 0) throw new ContainerTransferWireError(problems);
  const generatedDomainPaths = new Set<string>();
  const locate = (document: unknown, domainPath: readonly (string | number)[] = []) => {
    if (!isPlainRecord(document)) return;
    proposalFillingSteps(document).forEach((step, index) => {
      if (isPlainRecord(step.row) && generated.has(step.row)) generatedDomainPaths.add(JSON.stringify([...domainPath, "proposals", index]));
    });
    const decision = isPlainRecord(document.decision) ? document.decision : document;
    if (decision.kind === "clarification" && Array.isArray(decision.choices)) decision.choices.forEach((choice, index) => {
      if (isPlainRecord(choice)) locate(choice.continuation, ["terminal", "choices", index, "continuation"]);
    });
  };
  locate(value);
  return { value, origins, generatedDomainPaths };
}

/** Expanded steps have no author-facing row. Point errors back at the
 * declaration which generated them, retaining the authority reason. */
export function containerTransferDiagnostics(diagnostics: readonly ProposalDiagnostic[], origins: ReadonlyMap<string, readonly (string | number)[]>) {
  return diagnostics.map(diagnostic => {
    const path = diagnostic.path ?? [];
    for (let length = path.length; length > 0; length--) {
      const origin = origins.get(JSON.stringify(path.slice(0, length)));
      if (origin) return { ...diagnostic, path: origin, pathBase: "arguments" as const };
    }
    return diagnostic;
  });
}
