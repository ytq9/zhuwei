import { VNEXT_PROPOSAL_CAPABILITIES } from "./proposal-capabilities";
import { isPlainRecord } from "./canonical-json";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";
import { vnextEntryProducerContract } from "./proposal-producer-contract";
import { proposalProspectiveHandles } from "./proposal-reference-slots";
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from "../../rules/profiles/semantic-templates";
import type { ProposalNpcSourceChoices } from "./proposal-context";

type RecordValue = Record<string, unknown>;
type Schema = Record<string, any>;
const branchKinds = new Set(["worldInteraction", "observe", "social"]);
const rulings = ["directSuccess", "check"];
const terminals = ["knowledgeReview", "passTime", "inWorldRefusal", "clarification", "abilityOperation"];
const serverBasisTerminals = new Set(["knowledgeReview", "passTime", "abilityOperation"]);
const object = (properties: Schema): Schema => ({ type: "object", properties,
  required: Object.keys(properties).sort(), additionalProperties: false });
type ResultLayout = Readonly<Record<string, Schema>>;
type ResultLayouts = ReadonlyMap<string, ResultLayout>;

/** Derive presentation groups from the one domain schema. A single existing
 * collection needs no transformation; multiple parallel arrays become one
 * explicit list without adding or removing any domain outcome. */
function resultLayouts(domain: Schema): ResultLayouts {
  const layouts = new Map<string, ResultLayout>();
  for (const variant of domain.$def.proposals.items.anyOf as Schema[]) {
    const branch = variant.properties.branches?.properties.success;
    if (!branch) continue;
    const collections = Object.fromEntries(Object.entries(branch.properties)
      .filter(([, field]) => (field as Schema).type === "array")) as Record<string, Schema>;
    if (Object.keys(collections).length > 1) layouts.set(variant.properties.kind.enum[0], collections);
  }
  return layouts;
}

function resultSchema(branch: Schema, layout: ResultLayout | undefined): Schema {
  if (!layout) return branch;
  const properties = Object.fromEntries(Object.entries(branch.properties).filter(([key]) => !(key in layout)));
  return object({ ...properties, entries: { type: "array",
    description: "Complete list of the actual results for this branch. Choose only a recordKind offered here; [] explicitly means none of these results. The server groups entries and creates the empty collections. Sensory inference indices count only sensoryEvidence entries in this branch, not all entries.",
    items: { anyOf: Object.entries(layout).flatMap(([recordKind, collection]) =>
      (collection.items.anyOf ?? [collection.items]).map((item: Schema) => {
        if (item.type !== "object" || !item.properties || Object.hasOwn(item.properties, "recordKind")) {
          throw new TypeError("PROPOSAL_RESULT_COLLECTION_SCHEMA_UNAVAILABLE");
        }
        return object({ recordKind: { type: "string", enum: [recordKind],
          ...(collection.description ? { description: collection.description } : {}) }, ...item.properties });
      })) },
  } });
}

export class ProposalFillingError extends TypeError {
  constructor(readonly diagnostics: readonly ProposalDiagnostic[]) { super("PROPOSAL_FILLING_INTERFACE_INVALID"); }
}

/** Presentation of the existing domain schema, not a second accepting schema.
 * Model choices stay explicit; only fixed containers and derived declarations
 * disappear. Both ordinary and clarification plans use this same transform. */
export function proposalFillingSchema(domain: Schema, selectedTerminalKinds?: readonly string[], npcSources?: ProposalNpcSourceChoices): Schema {
  const variants = domain.$def.proposals.items.anyOf as Schema[];
  const layouts = resultLayouts(domain);
  const sourceRefs = npcSources === undefined ? undefined : [...new Set(npcSources.flatMap(source => source.refs))].sort();
  const newWorldFact = variants.some(variant => variant.properties.kind.enum.includes("materializeObject")
    && variant.properties.definition?.properties?.worldFact !== undefined);
  const socialResult = (branch: Schema): Schema => {
    const response = branch.properties.response, basis = response.properties.basis;
    const playerExpression = basis.items.anyOf.find((source: Schema) => source.properties.kind.enum.includes("playerExpression"));
    const worldFact = basis.items.anyOf.find((source: Schema) => source.properties.kind.enum.includes("materializedKnowledge"));
    return object({ ...branch.properties, response: object({ ...response.properties, basis: {
      ...basis, description: "Choose exact existing refs from npcSourceChoices for this step's npcRef; the server supplies source kinds. playerExpression means only what the player said now. worldFactRef explicitly selects a same-bundle worldFact producer; its holder is this npcRef. Never cite a wrapper or infer a new fact from speech.",
      items: { anyOf: [...(sourceRefs?.length === 0 ? [] : [{ type: "string", ...(sourceRefs === undefined ? { pattern: "^\\S+$" } : { enum: sourceRefs }) }]),
        playerExpression, ...(newWorldFact ? [object({ worldFactRef: worldFact.properties.definitionRef })] : [])] },
    } }) });
  };
  const definitions: Schema = {};
  const shared = new Map<string, string>();
  // The direct and checked forms share their full authored payload schemas.
  // Hoist these exact field definitions before the existing schema compactor,
  // so presenting both forms does not multiply its bounded input node count.
  const fields = (properties: Schema): Schema => Object.fromEntries(Object.entries(properties).map(([key, raw]) => {
    const schema = raw as Schema;
    if (schema.type !== "object" && schema.type !== "array") return [key, schema];
    const identity = JSON.stringify(schema);
    let name = shared.get(identity);
    if (name === undefined) {
      name = `field${shared.size}`; shared.set(identity, name); definitions[name] = schema;
    }
    return [key, { $ref: `#/$def/${name}` }];
  }));
  const stepVariants = (checked: boolean): Schema[] => variants.flatMap(variant => {
    const { consumes: _consumes, produces: _produces, templateHash: _hash,
      communication: _communication, outcomeBinding, branches, ...properties } = variant.properties;
    const contract = vnextEntryProducerContract({ kind: properties.kind.enum[0],
      source: { kind: properties.source?.properties?.kind?.enum?.[0] } });
    if (!contract) throw new TypeError("PROPOSAL_PRODUCER_CONTRACT_UNAVAILABLE");
    if (properties.kind.enum[0] === "formActorPlan") delete properties.basisRefs;
    if (properties.kind.enum[0] === "worldInteraction") {
      properties.otherTargetRefs = { ...properties.targetRefs,
        description: "Other actual physical targets besides directTargetRefs. Use [] when there are none; the server combines both target roles." };
      delete properties.targetRefs;
      properties.directTargetRefs = { ...properties.directTargetRefs, description: "Nonempty exact visible or same-bundle targets intentionally manipulated by this method. Other affected targets go in otherTargetRefs." };
    }
    if (contract.count === 1) properties.handle = { type: "string",
      pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      description: "Local name of this new object; reuse it in typed references. The server derives producer kind and dependencies." };
    if (checked) properties.outcomeBinding = outcomeBinding;
    if (!branches) return [object(fields(properties))];
    const layout = layouts.get(properties.kind.enum[0]);
    const branchSchema = (branch: Schema) => properties.kind.enum[0] === "social" ? socialResult(branch) : resultSchema(branch, layout);
    const direct = object(fields({ ...properties, result: branchSchema(branches.properties.success) }));
    return checked ? [direct, object(fields({ ...properties,
      success: branchSchema(branches.properties.success),
      failure: branchSchema(branches.properties.failure.anyOf.find((item: Schema) => !item.properties?.kind?.enum?.includes("none"))),
    }))] : [direct];
  });
  // A terminal-only selection has no step family. Do not leave empty unions or
  // unreachable definitions for the strict provider to reject or interpret.
  if (variants.length > 0) {
    definitions.directSteps = { type: "array", items: { anyOf: stepVariants(false) } };
    definitions.checkSteps = { type: "array", items: { anyOf: stepVariants(true) } };
  }
  const plans = domain.properties.adjudication.anyOf.filter((variant: Schema) =>
    variants.length > 0 && rulings.includes(variant.properties.kind.enum[0])).map((variant: Schema) => object({
      ...variant.properties,
      steps: { $ref: `#/$def/${variant.properties.kind.enum[0] === "check" ? "checkSteps" : "directSteps"}` },
    }));
  const nativeKinds = VNEXT_PROPOSAL_CAPABILITIES.filter(entry => "surface" in entry && entry.surface === "native").map(entry => entry.proposalKind as string);
  const hasNative = domain.properties.terminal.anyOf.some((entry: Schema) => nativeKinds.includes(entry.properties.kind.enum[0]));
  const terminalVariants = domain.properties.terminal.anyOf.filter((variant: Schema) =>
    terminals.includes(variant.properties.kind.enum[0])
      && (variant.properties.kind.enum[0] === "clarification" ? variants.length > 0 || hasNative
        : nativeKinds.includes(variant.properties.kind.enum[0]) || selectedTerminalKinds === undefined || selectedTerminalKinds.includes(variant.properties.kind.enum[0]))).map((variant: Schema) => {
    const properties = { ...variant.properties };
    const kind = properties.kind.enum[0];
    if (!serverBasisTerminals.has(kind)) properties.basisRefs = domain.properties.basisRefs;
    if (kind === "clarification") {
      const choices = properties.choices;
      const oldContinuations = choices.items.properties.continuation.anyOf as Schema[];
      properties.choices = { ...choices, items: object({ ...choices.items.properties,
        continuation: { anyOf: [...plans, ...oldContinuations.filter(item => item.properties.kind.enum[0] !== "adjudication")
          .map(item => item.properties.kind.enum[0] === "abilityOperation"
            ? object(Object.fromEntries(Object.entries(item.properties).filter(([key]) => key !== "basisRefs"))) : item)] },
      }) };
    }
    return object(properties);
  });
  return { ...object({ decision: { description: "Choose one complete decision. Direct success has only results; a check fixes its one ruling and both outcomes now. The server assembles the internal bundle.",
    anyOf: [...plans, ...terminalVariants] } }),
    ...(Object.keys(definitions).length > 0 ? { $def: definitions } : {}) };
}

/** Pure wire -> domain representation. Invalid semantic fields are preserved
 * for the existing complete validator. Ambiguous or colliding representations
 * fail at their actual argument path; nothing guesses a missing decision. */
export function decodeProposalFilling(value: unknown, domain: Schema): unknown {
  if (!isPlainRecord(value)) fail("TYPE_MISMATCH", "filling:object-required", [], { type: "object" }, value);
  requireOnly(value, ["decision"], []);
  if (!isPlainRecord(value.decision)) fail(Object.hasOwn(value, "decision") ? "TYPE_MISMATCH" : "FIELD_MISSING",
    "filling:decision-required", ["decision"], { type: "object" }, value.decision);
  return decodeDecision(value.decision, ["decision"], false, resultLayouts(domain));
}

function decodeDecision(value: RecordValue, path: ProposalDiagnosticPath, continuation: boolean, layouts: ResultLayouts): RecordValue {
  const { kind, steps, ...content } = value;
  if (typeof kind !== "string" || ![...rulings, ...(continuation ? ["inWorldRefusal", "cancel", "abilityOperation"] : terminals)].includes(kind)) {
    fail(kind === undefined ? "FIELD_MISSING" : typeof kind !== "string" ? "TYPE_MISMATCH" : "VALUE_INVALID", "filling:decision-kind", [...path, "kind"],
      { type: "string", enum: [...rulings, ...(continuation ? ["inWorldRefusal", "cancel", "abilityOperation"] : terminals)] }, kind);
  }
  if (rulings.includes(kind)) {
    rejectOwned(value, ["adjudication", "terminal", "proposals", "basisRefs"], path);
    const proposals = Array.isArray(steps) ? steps.map((entry, index) => decodeStep(entry, [...path, "steps", index], kind === "check", layouts)) : steps;
    const basisRefs = Array.isArray(proposals) ? [...new Set(proposals.flatMap(entry => isPlainRecord(entry) && Array.isArray(entry.basisRefs)
      ? entry.basisRefs.filter((ref): ref is string => typeof ref === "string" && !ref.startsWith("prospective:")) : []))].sort() : [];
    // Missing steps remain missing proposals, so the canonical validator can
    // diagnose them. No empty successful plan is synthesized.
    return continuation ? { kind: "adjudication", basisRefs, adjudication: { kind, ...content }, ...(steps === undefined ? {} : { proposals }) }
      : { mode: "adjudication", basisRefs, adjudication: { kind, ...content }, terminal: null, ...(steps === undefined ? {} : { proposals }) };
  }
  if (steps !== undefined) fail("CONSTRAINT_CONFLICT", "filling:terminal-cannot-have-steps", [...path, "steps"], { required: false }, steps);
  const { basisRefs, ...terminal } = content;
  if (kind === "clarification" && Array.isArray(terminal.choices)) {
    terminal.choices = terminal.choices.map((choice, index) => !isPlainRecord(choice) || !isPlainRecord(choice.continuation) ? choice : {
      ...choice, continuation: decodeDecision(choice.continuation, [...path, "choices", index, "continuation"], true, layouts),
    });
  }
  if (serverBasisTerminals.has(kind) && basisRefs !== undefined) fail("CONSTRAINT_CONFLICT", kind === "knowledgeReview" ? "filling:knowledge-basis-owned" : kind === "passTime" ? "filling:pass-time-basis-owned" : "filling:ability-basis-owned", [...path, "basisRefs"], "absent", basisRefs);
  if (continuation) return kind === "cancel" ? { kind, ...content } : { kind, ...(serverBasisTerminals.has(kind) ? { basisRefs: [] } : basisRefs === undefined ? {} : { basisRefs }), ...terminal };
  return { mode: "terminal", ...(serverBasisTerminals.has(kind) ? { basisRefs: [] } : basisRefs === undefined ? {} : { basisRefs }),
    adjudication: null, terminal: { kind, ...terminal }, proposals: [] };
}

function decodeStep(value: unknown, path: ProposalDiagnosticPath, checked: boolean, layouts: ResultLayouts): unknown {
  if (!isPlainRecord(value)) return value;
  rejectOwned(value, ["consumes", "produces", "templateHash", "communication", "branches", ...(!checked ? ["outcomeBinding"] : [])], path);
  const { handle, result, success, failure, ...entry } = value;
  const contract = vnextEntryProducerContract(entry);
  if (!contract) return { ...value }; // The canonical kind diagnostic owns this.
  if (contract.count === 0 && Object.hasOwn(value, "handle")) fail("CONSTRAINT_CONFLICT", "filling:nonproducer-handle", [...path, "handle"], "absent", handle);
  if (!checked) entry.outcomeBinding = "always";
  if (entry.kind === "worldInteraction") {
    rejectOwned(value, ["targetRefs"], path);
    if (!Array.isArray(entry.otherTargetRefs)) fail(entry.otherTargetRefs === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
      "filling:other-targets-array-required", [...path, "otherTargetRefs"], { type: "array" }, entry.otherTargetRefs);
    if (!Array.isArray(entry.directTargetRefs)) fail(entry.directTargetRefs === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
      "filling:direct-targets-array-required", [...path, "directTargetRefs"], { type: "array" }, entry.directTargetRefs);
    // Preserve repeated submitted entries so the same validator can diagnose
    // them. Only the role overlap is structural, not a second target choice.
    const direct = entry.directTargetRefs;
    entry.targetRefs = [...new Set(direct), ...entry.otherTargetRefs.filter(ref => !direct.includes(ref))];
    delete entry.otherTargetRefs;
  }
  entry.produces = contract.count === 0 ? [] : [{ ...(handle === undefined ? {} : { handle }),
    kind: contract.kind, ...(entry.outcomeBinding === undefined ? {} : { outcomeBinding: entry.outcomeBinding }) }];
  if (branchKinds.has(String(entry.kind))) {
    if (!checked && (Object.hasOwn(value, "success") || Object.hasOwn(value, "failure"))) {
      fail("CONSTRAINT_CONFLICT", "filling:direct-result-required", path, { result: "complete direct result" }, value);
    }
    if (Object.hasOwn(value, "result") && (Object.hasOwn(value, "success") || Object.hasOwn(value, "failure"))) {
      fail("CONSTRAINT_CONFLICT", "filling:exclusive-result-shapes", path, "result or success/failure", value);
    }
    const layout = layouts.get(String(entry.kind));
    entry.branches = Object.hasOwn(value, "result") ? { success: decodeResult(result, layout, [...path, "result"]), failure: null }
      : { ...(success === undefined ? {} : { success: decodeResult(success, layout, [...path, "success"]) }),
        ...(failure === undefined ? {} : { failure: decodeResult(failure, layout, [...path, "failure"]) }) };
    if (checked && !Object.hasOwn(value, "result") && (failure === null
      || (isPlainRecord(failure) && Object.keys(failure).length === 1 && failure.kind === "none"))) {
      fail("CONSTRAINT_CONFLICT", "filling:check-failure-result-required", [...path, "failure"], "complete failure result", failure);
    }
  } else if (["result", "success", "failure"].some(key => Object.hasOwn(value, key))) {
    fail("CONSTRAINT_CONFLICT", "filling:result-not-supported-by-type", path, { kind: entry.kind }, value);
  }
  if (entry.kind === "formActorPlan") {
    rejectOwned(value, ["basisRefs", "planId", "activityId", "due", "trigger", "activityKind", "contextHash", "readSet", "trace", "alternateTarget"], path);
    entry.basisRefs = [];
  }
  if (entry.kind === "social") {
    entry.communication = "spokenConversation";
    for (const branchName of ["success", "failure"] as const) {
      const branch = (entry.branches as RecordValue | undefined)?.[branchName];
      if (!isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) continue;
      const field = Object.hasOwn(value, "result") ? "result" : branchName;
      entry.branches = { ...(entry.branches as RecordValue), [branchName]: { ...branch,
        response: { ...branch.response, basis: branch.response.basis.map((source, index) =>
          decodeSocialSource(source, entry.npcRef, [...path, field, "response", "basis", index])) } } };
    }
  }
  if (entry.kind === "materializeObject") {
    // The immutable template catalog is included in the request/workflow hash;
    // an unknown choice must fail, not select a nearby template.
    if (typeof entry.templateRef !== "string") fail(entry.templateRef === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
      "materialization:exact-static-template-required", [...path, "templateRef"], { type: "string", referenceKind: "semanticTemplate" }, entry.templateRef);
    const template = VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.find(item => item.templateRef === entry.templateRef);
    if (!template) fail(entry.templateRef === undefined ? "FIELD_MISSING" : "REFERENCE_UNAVAILABLE", "materialization:exact-static-template-required", [...path, "templateRef"],
      { referenceKind: "semanticTemplate" }, entry.templateRef);
    entry.templateHash = template.templateHash;
  }
  const existing = Array.isArray(entry.basisRefs) ? entry.basisRefs.filter((ref): ref is string => typeof ref === "string" && !ref.startsWith("prospective:")) : [];
  entry.consumes = entry.kind === "commitNarrativeDetail" ? [] : [
    ...[...new Set(existing)].sort().map(ref => ({ kind: "existing", ref })),
    ...proposalProspectiveHandles(entry).map(handle => ({ kind: "prospective", handle })),
  ];
  return entry;
}

/** Explicit conversion for internal fixtures and tools, never a parser fallback
 * accepting the retired wire. Only the new decision shape is accepted above. */
export function encodeProposalFilling(value: unknown, domain: Schema): unknown {
  if (!isPlainRecord(value) || (value.mode !== "adjudication" && value.mode !== "terminal")) return value;
  return { decision: encodeDecision(value, false, resultLayouts(domain)) };
}

function encodeDecision(value: RecordValue, continuation: boolean, layouts: ResultLayouts): unknown {
  if (value.mode === "adjudication" || (continuation && value.kind === "adjudication")) {
    if (!isPlainRecord(value.adjudication)) return { steps: value.proposals };
    return { ...value.adjudication, steps: Array.isArray(value.proposals)
      ? value.proposals.map(entry => encodeStep(entry, (value.adjudication as RecordValue).kind === "check", layouts)) : value.proposals };
  }
  const source = continuation ? value : value.terminal;
  if (!isPlainRecord(source)) return source;
  const result = { ...source };
  if (!serverBasisTerminals.has(String(source.kind)) && source.kind !== "cancel") result.basisRefs = value.basisRefs;
  else delete result.basisRefs;
  if (source.kind === "clarification" && Array.isArray(source.choices)) result.choices = source.choices.map(choice =>
    !isPlainRecord(choice) || !isPlainRecord(choice.continuation) ? choice
      : { ...choice, continuation: encodeDecision(choice.continuation, true, layouts) });
  return result;
}

function encodeStep(value: unknown, checked: boolean, layouts: ResultLayouts): unknown {
  if (!isPlainRecord(value)) return value;
  const { consumes, produces, templateHash: _hash, communication: _communication,
    outcomeBinding, branches, ...entry } = value;
  // Old internal domain callers may have selected causal sources only in the
  // existing-consume list. Carry those same choices into the one source field.
  if (Array.isArray(entry.basisRefs) && Array.isArray(consumes)) {
    const basisRefs = entry.basisRefs;
    entry.basisRefs = [...basisRefs, ...new Set(consumes.flatMap(reference => isPlainRecord(reference)
      && reference.kind === "existing" && !basisRefs.includes(reference.ref) ? [reference.ref] : []))];
  }
  if (checked) entry.outcomeBinding = outcomeBinding;
  if (entry.kind === "formActorPlan") delete entry.basisRefs;
  if (entry.kind === "worldInteraction") {
    entry.otherTargetRefs = Array.isArray(entry.targetRefs) && Array.isArray(entry.directTargetRefs)
      ? entry.targetRefs.filter(ref => !(entry.directTargetRefs as unknown[]).includes(ref)) : entry.targetRefs;
    delete entry.targetRefs;
  }
  if (Array.isArray(produces) && produces.length === 1 && isPlainRecord(produces[0])) entry.handle = produces[0].handle;
  if (isPlainRecord(branches)) {
    const noFailure = branches.failure === null || (isPlainRecord(branches.failure) && Object.keys(branches.failure).length === 1 && branches.failure.kind === "none");
    const layout = layouts.get(String(entry.kind));
    const branch = (value: unknown) => entry.kind === "social" ? encodeSocialBranch(value, entry.npcRef) : encodeResult(value, layout);
    if (noFailure) entry.result = branch(branches.success);
    else { entry.success = branch(branches.success); if (Object.hasOwn(branches, "failure")) entry.failure = branch(branches.failure); }
  }
  return entry;
}

function decodeSocialSource(value: unknown, npcRef: unknown, path: ProposalDiagnosticPath): unknown {
  if (typeof value === "string") return { kind: "npcContext", ref: value };
  if (!isPlainRecord(value)) fail("TYPE_MISMATCH", "social:source-selection-required", path,
    "existing ref, playerExpression, or explicit worldFactRef", value);
  if (Object.keys(value).length === 1 && value.kind === "playerExpression") return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, "worldFactRef")) {
    // Handle shape, producer kind and holder permission remain the existing
    // validator's responsibility; the codec only changes the field layout.
    return { kind: "materializedKnowledge", definitionRef: value.worldFactRef, holderRef: npcRef };
  }
  fail("CONSTRAINT_CONFLICT", "social:source-selection-shape", path,
    "existing ref, {kind:playerExpression}, or {worldFactRef:prospective handle}", value);
}

function encodeSocialBranch(value: unknown, npcRef: unknown): unknown {
  if (!isPlainRecord(value) || !isPlainRecord(value.response) || !Array.isArray(value.response.basis)) return value;
  return { ...value, response: { ...value.response, basis: value.response.basis.map(source => {
    if (!isPlainRecord(source)) return source;
    if (source.kind === "npcContext" && Object.keys(source).sort().join(",") === "kind,ref") return source.ref;
    if (source.kind === "materializedKnowledge" && Object.keys(source).sort().join(",") === "definitionRef,holderRef,kind") {
      if (source.holderRef !== npcRef) throw new TypeError("SOCIAL_SOURCE_HOLDER_CANNOT_BE_ENCODED");
      return { worldFactRef: source.definitionRef };
    }
    return source;
  }) } };
}

/** Exact inverse for an existing, untransformed decision content field. This
 * is codec provenance, not a second schema: acceptance still comes from the
 * domain validator. Transformed containers and derived fields have no mapping. */
export function proposalDecisionFieldArgumentPath(draft: unknown, path: ProposalDiagnosticPath): ProposalDiagnosticPath | undefined {
  if (!isPlainRecord(draft)) return undefined;
  let source = draft, remaining = [...path], prefix: (string | number)[] = ["decision"];
  let continuation = false;
  if (remaining[0] === "terminal" && remaining[1] === "choices" && typeof remaining[2] === "number" && remaining[3] === "continuation") {
    const terminal = draft.terminal, index = remaining[2];
    if (!isPlainRecord(terminal) || terminal.kind !== "clarification" || !Array.isArray(terminal.choices)
      || !isPlainRecord(terminal.choices[index]) || !isPlainRecord(terminal.choices[index].continuation)) return undefined;
    source = terminal.choices[index].continuation; remaining = remaining.slice(4);
    prefix.push("choices", index, "continuation"); continuation = true;
  }
  if (source.mode === "adjudication" || (continuation && source.kind === "adjudication")) {
    if (remaining.shift() !== "adjudication" || !isPlainRecord(source.adjudication)
      || !rulings.includes(String(source.adjudication.kind))) return undefined;
    source = source.adjudication;
  } else if (!continuation) {
    if (source.mode !== "terminal" || remaining.shift() !== "terminal" || !isPlainRecord(source.terminal)
      || !terminals.includes(String(source.terminal.kind))) return undefined;
    source = source.terminal;
  } else if (!["inWorldRefusal", "cancel", "abilityOperation"].includes(String(source.kind))) return undefined;
  const field = remaining[0];
  if (remaining.length !== 1 || typeof field !== "string" || !Object.hasOwn(source, field)
    || ["basisRefs", "steps", "choices", "adjudication", "terminal", "proposals", "mode"].includes(field)) return undefined;
  return [...prefix, field];
}

/** Only the new echo removal uses decision-field provenance. Existing source
 * transforms keep their own exact mapping; domain-only paths stay explicit. */
export function proposalIntentEchoArgumentDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[]): readonly ProposalDiagnostic[] {
  return diagnostics.map(diagnostic => {
    const path = diagnostic.pathBase !== "arguments" && diagnostic.pathBase !== "rulesInput"
      && diagnostic.path?.at(-1) === "intent" && (diagnostic.constraint === "closed-object-additional-field"
        || diagnostic.repair.changes?.some(change => change.operation === "remove"
          && change.path.length === diagnostic.path!.length && change.path.every((part, index) => part === diagnostic.path![index])))
      ? proposalDecisionFieldArgumentPath(draft, diagnostic.path) : undefined;
    const changes = diagnostic.repair.changes?.map(change => change.operation === "remove"
      ? { ...change, path: proposalDecisionFieldArgumentPath(draft, change.path) ?? change.path } : change);
    return { ...diagnostic, ...(path === undefined ? {} : { path, pathBase: "arguments" as const }),
      ...(changes === undefined ? {} : { repair: { ...diagnostic.repair, changes } }) };
  });
}

/** The inverse of the exact social source transform. No invented scalar
 * locations: derived ref/kind/holder members point to their original choice. */
export function socialSourceArgumentDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[]): readonly ProposalDiagnostic[] {
  return diagnostics.flatMap(diagnostic => {
    if (diagnostic.pathBase === "arguments" || !diagnostic.path || !isPlainRecord(draft)) return diagnostic;
    let value: RecordValue = draft, remaining = [...diagnostic.path], prefix: (string | number)[] = ["decision"];
    if (remaining[0] === "terminal" && remaining[1] === "choices" && typeof remaining[2] === "number" && remaining[3] === "continuation") {
      const terminal = value.terminal, index = remaining[2];
      if (!isPlainRecord(terminal) || !Array.isArray(terminal.choices) || !isPlainRecord(terminal.choices[index])
        || !isPlainRecord(terminal.choices[index].continuation)) return diagnostic;
      value = terminal.choices[index].continuation; prefix.push("choices", index, "continuation"); remaining = remaining.slice(4);
    }
    const [field, ordinal, branches, branchName, response, basis, index] = remaining;
    if (field === "proposals" && typeof ordinal === "number" && branches === "consumes" && typeof branchName === "number"
      && Array.isArray(value.proposals)) {
      const entry = value.proposals[ordinal];
      if (isPlainRecord(entry) && entry.kind === "social" && Array.isArray(entry.consumes) && isPlainRecord(entry.branches)) {
        const consume = entry.consumes[branchName];
        if (isPlainRecord(consume) && consume.kind === "prospective") {
          const paths = ["success", "failure"].flatMap(name => {
            const branch = (entry.branches as RecordValue)[name];
            if (!isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) return [];
            return branch.response.basis.flatMap((source, index) => isPlainRecord(source)
              && source.kind === "materializedKnowledge" && source.definitionRef === consume.handle
              ? [[...prefix, "steps", ordinal, entry.branches && (entry.branches as RecordValue).failure === null ? "result" : name,
                "response", "basis", index, "worldFactRef"]] : []);
          });
          if (paths.length) return paths.map(path => ({ ...diagnostic, path, pathBase: "arguments" as const }));
        }
      }
    }
    if (field !== "proposals" || typeof ordinal !== "number" || branches !== "branches"
      || (branchName !== "success" && branchName !== "failure") || response !== "response" || basis !== "basis"
      || !Array.isArray(value.proposals)) return diagnostic;
    const entry = value.proposals[ordinal];
    if (!isPlainRecord(entry) || entry.kind !== "social" || !isPlainRecord(entry.branches)) return diagnostic;
    const resultField = entry.branches.failure === null ? "result" : branchName;
    const path = [...prefix, "steps", ordinal, resultField, "response", "basis"];
    if (index === undefined) return { ...diagnostic, path, pathBase: "arguments" as const };
    if (typeof index !== "number") return diagnostic;
    path.push(index);
    const branch = entry.branches[branchName];
    if (!isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) return diagnostic;
    const source = branch.response.basis[index];
    if (!isPlainRecord(source)) return diagnostic;
    if (source.kind === "materializedKnowledge") path.push("worldFactRef");
    else if (source.kind === "playerExpression" && remaining.length > 7) path.push(...remaining.slice(7));
    else if (source.kind !== "npcContext") return diagnostic;
    return { ...diagnostic, path, pathBase: "arguments" as const };
  });
}

function decodeResult(value: unknown, layout: ResultLayout | undefined, path: ProposalDiagnosticPath): unknown {
  if (!layout || !isPlainRecord(value) || (Object.keys(value).length === 1 && value.kind === "none")) return value;
  rejectOwned(value, Object.keys(layout), path);
  if (!Array.isArray(value.entries)) fail(value.entries === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
    "filling:complete-result-entries-required", [...path, "entries"], { type: "array", required: true }, value.entries);
  const { entries, ...content } = value;
  const collections = Object.fromEntries(Object.keys(layout).map(key => [key, [] as unknown[]]));
  for (const [index, record] of entries.entries()) {
    if (!isPlainRecord(record)) fail("TYPE_MISMATCH", "filling:result-entry-object-required", [...path, "entries", index], { type: "object" }, record);
    const { recordKind, ...payload } = record;
    if (typeof recordKind !== "string" || !Object.hasOwn(layout, recordKind)) fail(recordKind === undefined ? "FIELD_MISSING" : typeof recordKind !== "string" ? "TYPE_MISMATCH" : "VALUE_INVALID",
      "filling:result-kind-for-form", [...path, "entries", index, "recordKind"], { enum: Object.keys(layout) }, recordKind);
    collections[recordKind].push(payload);
  }
  return { ...content, ...collections };
}

function encodeResult(value: unknown, layout: ResultLayout | undefined): unknown {
  if (!layout || !isPlainRecord(value)) return value;
  if (Object.hasOwn(value, "entries")) throw new TypeError("PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION");
  // Invalid internal fixtures must stay invalid, not turn a missing collection
  // into a valid empty result. Only complete domain collections can be encoded.
  if (Object.keys(layout).some(key => !Array.isArray(value[key]))) return value;
  const content = Object.fromEntries(Object.entries(value).filter(([key]) => !(key in layout)));
  const entries = Object.keys(layout).flatMap(recordKind => (value[recordKind] as unknown[]).map(payload => {
    if (isPlainRecord(payload) && Object.hasOwn(payload, "recordKind")) throw new TypeError("PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION");
    return isPlainRecord(payload) ? { recordKind, ...payload } : payload;
  }));
  return { ...content, entries };
}

function requireOnly(value: RecordValue, fields: string[], path: ProposalDiagnosticPath): void {
  const extra = Object.keys(value).filter(key => !fields.includes(key));
  if (extra.length) throw new ProposalFillingError(extra.map(key => proposalDiagnostic("VALUE_INVALID", "filling:additional-field", {
    path: [...path, key], pathBase: "arguments", expected: { allowedFields: fields }, actual: diagnosticActual(value[key]),
  })));
}

function rejectOwned(value: RecordValue, fields: string[], path: ProposalDiagnosticPath): void {
  const supplied = fields.filter(key => Object.hasOwn(value, key));
  if (supplied.length) throw new ProposalFillingError(supplied.map(key => proposalDiagnostic("CONSTRAINT_CONFLICT", "filling:server-owned-field", {
    path: [...path, key], pathBase: "arguments", expected: "absent from model arguments", actual: diagnosticActual(value[key]),
  })));
}

function fail(code: ProposalDiagnostic["code"], constraint: string, path: ProposalDiagnosticPath, expected: unknown, actual: unknown): never {
  throw new ProposalFillingError([proposalDiagnostic(code, constraint, { path, pathBase: "arguments", expected, actual: diagnosticActual(actual) })]);
}
