import { isPlainRecord, sameCanonical } from "./canonical-json";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { VNextRequiredContext } from "./required-context";
import { proposalFillingSteps } from "./proposal-filling-interface";
import { proposalInventoryEntryRefs } from "./proposal-context";

function transferSources(context: VNextRequiredContext) {
  const authorized = new Set(proposalInventoryEntryRefs(context));
  const entries = context.entries.flatMap(entry => entry.kind === "known" && authorized.has(entry.entryRef) && isPlainRecord(entry.value)
    ? [{ ref: entry.entryRef, value: entry.value }] : []);
  return { takeOut: entries.filter(entry => typeof entry.value.containerRef === "string").map(entry => entry.ref),
    putIn: entries.filter(entry => entry.value.disposition === "held" && entry.value.holderRef === context.intent.actorRef
      && entry.value.containerRef === undefined && (entry.value.equippedSlot === null || entry.value.equippedSlot === undefined)).map(entry => entry.ref) };
}

export function containerTransferWireSchemas(variants: readonly Record<string, any>[], context?: VNextRequiredContext, names: ReadonlyMap<string, string> = new Map()) {
  const acquire = variants.find(row => row.properties?.kind?.enum?.includes("acquire"));
  const store = variants.find(row => row.properties?.kind?.enum?.includes("store"));
  if (!acquire || !store) throw new TypeError("CONTAINER_TRANSFER_WIRE_SCHEMA_UNAVAILABLE");
  const sources = context && transferSources(context);
  return (["takeOut", "putIn"] as const).flatMap(direction => {
    const refs = sources?.[direction];
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
  function fail(path: readonly (string | number)[], operation: unknown, reason: string): never {
    throw new ContainerTransferWireError([proposalDiagnostic("CONSTRAINT_CONFLICT", `container-transfer:${reason}`,
      { path, pathBase: "arguments", expected: { requirement: "Declare ordinary access to the exact existing source/container. Locked, foreign-held or undecided mechanisms require their own adjudication/completion; no damage or unlock is implicit." },
        actual: diagnosticActual(operation), repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } })]);
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
        if (!isPlainRecord(op) || op.kind !== "containerTransfer") continue;
        const at = [...path, "steps", "inventoryOperation", index, "operation"];
        if (!sameCanonical(Object.keys(op).sort(), ["access", "after", "containerRef", "direction", "entryRef", "kind", "quantity"])
          || !["takeOut", "putIn"].includes(String(op.direction)) || !["alreadyOpen", "openNormally"].includes(String(op.access))
          || !["leaveAsIs", "close"].includes(String(op.after)) || typeof op.containerRef !== "string" || typeof op.entryRef !== "string"
          || !Number.isSafeInteger(op.quantity) || Number(op.quantity) < 1 || Number(op.quantity) > 1_000_000 || typeof scene !== "string") fail(at, op, "invalid-declaration");
        const container = records.get(op.containerRef), item = records.get(op.entryRef);
        if (!container || !item || !context.references.citations.viewerEvidenceRefs.includes(op.containerRef)) fail(at, op, "frozen-visible-container-required");
        if (container.holderRef && container.holderRef !== context.intent.actorRef) fail(at, op, "foreign-held-container");
        if (op.direction === "takeOut" && (item.containerRef !== op.containerRef || !transferSources(context).takeOut.includes(op.entryRef))) fail(at, op, "source-container-mismatch");
        if (op.direction === "putIn" && !transferSources(context).putIn.includes(op.entryRef)) {
          throw new ContainerTransferWireError([proposalDiagnostic("REFERENCE_UNAVAILABLE", "container-transfer:put-in-needs-loose-held-source", {
            path: [...at, "entryRef"], pathBase: "arguments", actual: diagnosticActual(op.entryRef),
            expected: { enum: transferSources(context).putIn, requirement: "Select the actual loose item held by the actor; the remaining stack already inside this container is not that item." },
            repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" } })]);
        }
        const state = isPlainRecord(container.stateMachine) ? container.stateMachine.state
          : isPlainRecord(container.feature) ? container.feature.state : undefined;
        const unrestricted = container.stateMachine === null;
        if (state === "locked") fail(at, op, "locked-container");
        if (!unrestricted && !["open", "closed", "destroyed"].includes(String(state))) fail(at, op, "mechanism-not-defined");
        if (op.access === "alreadyOpen" && state === "closed") fail(at, op, "opening-not-declared");
        if (op.after === "close" && (unrestricted || state === "destroyed")) fail(at, op, "cannot-close-without-working-mechanism");
        const interval = intervals.get(op.containerRef);
        if (interval && (interval.access !== op.access || interval.after !== op.after)) fail(at, op, "conflicting-access-declarations");
        intervals.set(op.containerRef, { access: op.access, after: op.after });
        const world = (action: "open" | "close") => {
          const result = { basisRefs: row.basisRefs, outcomeBinding: row.outcomeBinding, sceneRef: scene,
            directTargetRefs: [op.containerRef], otherTargetRefs: [], instrumentRefs: [], abilityRef: { kind: "none" }, approach: { kind: "none" },
            commonAction: { kind: "operateObject", targetRef: op.containerRef, destinationRef: "none", option: action },
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
        row.operation = op.direction === "takeOut" ? { kind: "acquire", entryRef: op.entryRef, quantity: op.quantity }
          : { kind: "store", entryRef: op.entryRef, quantity: op.quantity, containerRef: op.containerRef };
        if (!interval && op.after === "close") append("close");
      }
    }
    const decision = isPlainRecord(document.decision) ? document.decision : document;
    if (decision.kind === "clarification" && Array.isArray(decision.choices)) decision.choices.forEach((choice, index) => {
      if (isPlainRecord(choice)) walk(choice.continuation, [...path, ...(decision === document ? [] : ["decision"]), "choices", index, "continuation"]);
    });
  };
  walk(value);
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
