import { VNEXT_PROPOSAL_CAPABILITIES, vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";
import { isPlainRecord } from "./canonical-json";
import { actionDurationMicrosForTier, actionDurationTierForMicros } from "./action-duration";
import { proposalDiagnostic, diagnosticActual, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";
import { vnextEntryProducerContract } from "./proposal-producer-contract";
import { proposalProspectiveHandles } from "./proposal-reference-slots";
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from "../../rules/profiles/semantic-templates";
import type { ProposalNpcSourceChoices } from "./proposal-context";
import { decodeNpcMaterializationWire, encodeNpcMaterializationWire, NpcMaterializationWireError } from "./npc-materialization-wire";

type RecordValue = Record<string, unknown>;
type Schema = Record<string, any>;
const branchKinds = new Set(["worldInteraction", "observe", "social"]);
/** The decision.kind values every form with a step offers; never a type to
 * select (SPEC 0016 §7.2). */
export const PROPOSAL_RULING_KINDS: readonly string[] = Object.freeze(["directSuccess", "check", "concealedCheck"]);
const rulings = PROPOSAL_RULING_KINDS;
/** Wire rulings whose check row decides the outcome. */
const checkRulings = ["check", "concealedCheck"];
const terminals = ["knowledgeReview", "passTime", "inWorldRefusal", "clarification", "abilityOperation"];
const serverBasisTerminals = new Set(["knowledgeReview", "passTime", "abilityOperation"]);
const object = (properties: Schema): Schema => ({ type: "object", properties,
  required: Object.keys(properties).sort(), additionalProperties: false });
const decisionObject = (properties: Schema): Schema => ({ ...object(properties),
  description: "Fill only this decision kind's declared fields." });
type ResultLayout = Readonly<Record<string, Schema>>;
type ResultLayouts = ReadonlyMap<string, ResultLayout>;
// These are presentation names for the existing Rules variants. Their order
// is also the deterministic assembly order; rows keep their order within each
// table. The payload schema and all authority checks still come from Rules.
const SOCIAL_RESULT_TABLES = [
  { field: "relationshipChanges", kind: "relationship", description: "Grounded relationship changes in this branch; [] means no relationship change." },
  { field: "newPromises", kind: "promise", description: "Actual new undertakings in this branch, including promises made in responseText; [] means no new promise. Preserve the expression, deadline and terms." },
  { field: "promiseChanges", kind: "promiseChange", description: "Rulings on changes to existing promises, including amendments, release and refusal; [] means no such ruling. A changed work plan is not automatically a changed promise." },
  { field: "newDebts", kind: "debt", description: "Grounded new debts in this branch; [] means no new debt. Never invent player consent or payment." },
] as const;

function socialResultTables(branch: Schema): Schema {
  const variants = branch.properties.consequences.items.anyOf as Schema[];
  if (variants.length !== SOCIAL_RESULT_TABLES.length) throw new TypeError("PROPOSAL_SOCIAL_TABLE_SCHEMA_UNAVAILABLE");
  return Object.fromEntries(SOCIAL_RESULT_TABLES.map(({ field, kind, description }) => {
    const variant = variants.find(item => item.properties.kind.enum.length === 1 && item.properties.kind.enum[0] === kind);
    if (!variant) throw new TypeError("PROPOSAL_SOCIAL_TABLE_SCHEMA_UNAVAILABLE");
    const { kind: _kind, ...properties } = variant.properties;
    return [field, { type: "array", items: object(properties), description: `${description} All four tables are required, even when empty; together they share the branch's consequence limit.` }];
  }));
}

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

/** Stable presentation and draft coordinates, not execution precedence.
 * SPEC 0016 §7: the server derives execution from typed references and state
 * versions. Keep group-local positions intact for revision patches. */
const STEP_GROUP_LAYOUT: readonly VNextProposalCapabilityId[] = ["materializeStory", "admitStoryFacts", "authorAbility", "authorHazard",
  "authorItem", "materializeNpc", "materializeObject", "materializeItem", "completeObject", "commitNarrativeDetail", "inventoryOperation",
  "worldInteraction", "observe", "social", "formActorPlan"];
type StepGroup = Readonly<{ key: VNextProposalCapabilityId; kind: string; definitionKind?: string }>;
const STEP_GROUPS: readonly StepGroup[] = Object.freeze(STEP_GROUP_LAYOUT.map(key => {
  const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === key);
  if (!capability || ("surface" in capability && capability.surface === "native")) throw new TypeError("PROPOSAL_STEP_GROUP_UNAVAILABLE");
  return Object.freeze({ key, kind: capability.proposalKind, ...("definitionKind" in capability ? { definitionKind: capability.definitionKind } : {}) });
}));
for (const capability of VNEXT_PROPOSAL_CAPABILITIES) {
  if (!("surface" in capability && capability.surface === "native") && !STEP_GROUPS.some(group => group.key === capability.id)) throw new TypeError("PROPOSAL_STEP_GROUP_UNAVAILABLE");
}
/** The wire keys a filling may use, for diagnostics that name the choice. */
export const VNEXT_FILLING_STEP_KEYS: readonly VNextProposalCapabilityId[] = Object.freeze(STEP_GROUPS.map(group => group.key));

/** Where a filling row sits: `check` holds the one step whose outcome the
 * check decides, with both results; `steps` holds every other step, each with
 * at most one result. */
export type VNextFillingContainer = "check" | "steps";
/** One row of a filling document (the root, or a clarification continuation),
 * in decode order: group by group as listed above, a group's check row before
 * its steps rows, each list in its written order. The row carries the kind its
 * group implies, so a filling can be read like a decoded draft. */
export type VNextFillingStep = Readonly<{ container: VNextFillingContainer; key: VNextProposalCapabilityId; index: number; kind: string; row: unknown }>;
export function proposalFillingSteps(filling: unknown): readonly VNextFillingStep[] {
  if (!isPlainRecord(filling)) return Object.freeze([]);
  return Object.freeze(STEP_GROUPS.flatMap(group => FILLING_CONTAINERS.flatMap(container => {
    const groups = filling[container];
    const rows = isPlainRecord(groups) && (container === "steps" || branchKinds.has(group.kind)) ? groups[group.key] : undefined;
    return Array.isArray(rows) ? rows.map((row, index) => Object.freeze({ container, key: group.key, index, kind: group.kind, row })) : [];
  })));
}
const FILLING_CONTAINERS: readonly VNextFillingContainer[] = ["check", "steps"];
/** A decoded step the check decides: a result type with a written failure. */
function isCheckStep(entry: unknown): boolean {
  if (!isPlainRecord(entry) || !branchKinds.has(String(entry.kind)) || !isPlainRecord(entry.branches)) return false;
  const failure = entry.branches.failure;
  return isPlainRecord(failure) && !(Object.keys(failure).length === 1 && failure.kind === "none");
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
    const { consequences: _consequences, ...properties } = branch.properties;
    const response = properties.response, basis = response.properties.basis;
    const worldFact = basis.items.anyOf.find((source: Schema) => source.properties.kind.enum.includes("materializedKnowledge"));
    // Round 86: DeepSeek strict mode let a ref outside this enum through when
    // the enum sat inside an anyOf variant. With no producer selected the item
    // is one plain enum string, "playerExpression" a member of it; the anyOf
    // returns only when a same-bundle worldFact handle must be admitted.
    const source: Schema = sourceRefs === undefined ? { type: "string", pattern: "^\\S+$" } : { type: "string", enum: [...sourceRefs, PLAYER_EXPRESSION_SOURCE] };
    return object({ ...properties, ...socialResultTables(branch), response: object({ ...response.properties, basis: {
      ...basis, description: "Choose exact existing refs from npcSourceChoices for this step's npcRef; the server supplies source kinds. This is what the NPC itself knows or is, never the step's basisRefs: rule profiles, availability and precedent records, the scene's opening and the player's own records are KP basis, not NPC context. The member playerExpression means only what the player said now. worldFactRef explicitly selects a same-bundle worldFact producer; its holder is this npcRef. Never cite a wrapper or infer a new fact from speech.",
      items: newWorldFact ? { anyOf: [source, object({ worldFactRef: { ...worldFact.properties.definitionRef,
        description: "Exact handle of an always-bound worldFact created in this bundle with this npcRef in initialKnowledge. The server derives holder and dependencies. For existing knowledge use its npcSourceChoices string instead." } })] } : source,
    } }) });
  };
  const definitions: Schema = {};
  const shared = new Map<string, string>();
  // The step shapes share their full authored payload schemas. Hoist these
  // exact field definitions before the existing schema compactor, so
  // presenting them does not multiply its bounded input node count.
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
  // One object shape per loaded step type, outside any anyOf, so the strict
  // provider enforces its members (rounds 85/86: constraints inside an anyOf
  // branch were not enforced). The group key says the kind, so the row does
  // not repeat it; a step's own results sit on the step, so no row elsewhere
  // has to name a step, a kind or a branch (rounds 106-116 got those wrong).
  // A steps row writes one result and says when it happens; the check row is
  // the same step shape with two required results of one form, so the model
  // cannot leave the failing side out and writes both the same way (rounds
  // 116-119 left a conversation's failure {kind:'none'}).
  const stepShape = (variant: Schema, container: VNextFillingContainer): Schema => {
    const { consumes: _consumes, produces: _produces, templateHash: _hash, communication: _communication,
      kind: _kind, outcomeBinding, branches, ...properties } = variant.properties;
    const kind = variant.properties.kind.enum[0] as string;
    const contract = vnextEntryProducerContract({ kind, source: { kind: properties.source?.properties?.kind?.enum?.[0] } });
    if (!contract) throw new TypeError("PROPOSAL_PRODUCER_CONTRACT_UNAVAILABLE");
    if (kind === "formActorPlan") delete properties.basisRefs;
    if (kind === "worldInteraction") {
      properties.otherTargetRefs = { ...properties.targetRefs,
        description: "Other actual physical targets besides directTargetRefs. Use [] when there are none; the server combines both target roles." };
      delete properties.targetRefs;
      properties.directTargetRefs = { ...properties.directTargetRefs, description: "Nonempty exact visible or same-bundle targets intentionally manipulated by this method. Other affected targets go in otherTargetRefs." };
    }
    if (contract.count === 1) properties.handle = { type: "string",
      pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      description: "Local name of this new object; reuse it in typed references. The server derives producer kind and dependencies." };
    // The shared guidance says when each binding applies; the field needs no second copy.
    if (container === "steps") { const { description: _description, ...binding } = outcomeBinding; properties.outcomeBinding = binding; }
    if (branches) {
      const failures = branches.properties.failure.anyOf as Schema[];
      if (!failures.some(item => item.properties?.kind?.enum?.includes("none"))
        || !failures.some(item => !item.properties?.kind?.enum?.includes("none"))) throw new TypeError("PROPOSAL_BRANCH_SCHEMA_UNAVAILABLE");
      const name = `${kind}Result`;
      definitions[name] ??= kind === "social" ? socialResult(branches.properties.success) : resultSchema(branches.properties.success, layouts.get(kind));
      // Success and failure are the same form with no description of their
      // own: neither side reads as the default or the lesser one.
      const result = (): Schema => ({ $ref: `#/$def/${name}` });
      if (container === "check") {
        properties.success = result();
        properties.failure = result();
      } else properties.result = result();
    }
    return object(fields(properties));
  };
  const rowsOf = (container: VNextFillingContainer) => STEP_GROUPS.flatMap(group => {
    if (container === "check" && !branchKinds.has(group.kind)) return [];
    const shapes = variants.filter(variant => variant.properties.kind.enum[0] === group.kind
      && (group.definitionKind === undefined || variant.properties.source?.properties?.kind?.enum?.includes(group.definitionKind)))
      .map(variant => stepShape(variant, container));
    return shapes.length === 0 ? [] : [{ group, items: shapes.length === 1 ? shapes[0]! : { anyOf: shapes } }];
  });
  const groups = rowsOf("steps"), checkGroups = rowsOf("check");
  const hasSteps = groups.length > 0, hasCheck = checkGroups.length > 0;
  // A terminal-only selection has no step family. Do not leave empty unions or
  // unreachable definitions for the strict provider to reject or interpret.
  if (hasSteps) {
    definitions.steps = object(Object.fromEntries(groups.map(({ group, items }) => [group.key, { type: "array", items }])));
  }
  if (hasCheck) {
    definitions.check = object(Object.fromEntries(checkGroups.map(({ group, items }) => [group.key, { type: "array", items }])));
  }
  // A check names the type of the step it decides before any step is
  // written (round 121 wrote a check and left the check group empty). The row
  // in check is what counts; the name only points the model, and a diagnostic,
  // at that group.
  const flatPlans = domain.properties.adjudication.anyOf.filter((variant: Schema) =>
    hasSteps && rulings.includes(variant.properties.kind.enum[0])).map((variant: Schema) => object({ ...variant.properties,
    ...(hasCheck && checkRulings.includes(variant.properties.kind.enum[0]) ? { checkStep: { type: "string", enum: checkGroups.map(({ group }) => group.key),
      description: "The check key holding the step whose outcome this check decides." } } : {}) }));
  // A clarification continuation is the same ruling with its own check and
  // steps objects, one level down; no other step shape exists anywhere in the
  // schema. The shared guidance already says each continuation carries its
  // own steps, so the fields repeat no description.
  const continuationPlans = flatPlans.map((plan: Schema) => object({ ...plan.properties,
    ...(hasCheck ? { check: { $ref: "#/$def/check" } } : {}), steps: { $ref: "#/$def/steps" } }));
  const nativeKinds = VNEXT_PROPOSAL_CAPABILITIES.filter(entry => "surface" in entry && entry.surface === "native").map(entry => entry.proposalKind as string);
  const hasNative = domain.properties.terminal.anyOf.some((entry: Schema) => nativeKinds.includes(entry.properties.kind.enum[0]));
  const terminalVariants = domain.properties.terminal.anyOf.filter((variant: Schema) =>
    terminals.includes(variant.properties.kind.enum[0])
      && (variant.properties.kind.enum[0] === "clarification" ? hasSteps || hasNative
        : nativeKinds.includes(variant.properties.kind.enum[0]) || selectedTerminalKinds === undefined || selectedTerminalKinds.includes(variant.properties.kind.enum[0]))).map((variant: Schema) => {
    const properties = { ...variant.properties };
    const kind = properties.kind.enum[0];
    if (!serverBasisTerminals.has(kind)) properties.basisRefs = { ...domain.properties.basisRefs,
      description: "Exact supporting authority references for this decision, selected from the frozen context's citation choices." };
    if (kind === "clarification") {
      const choices = properties.choices;
      const oldContinuations = choices.items.properties.continuation.anyOf as Schema[];
      properties.choices = { ...choices, items: object({ ...choices.items.properties,
        continuation: { anyOf: [...continuationPlans, ...oldContinuations.filter(item => item.properties.kind.enum[0] !== "adjudication")
          .map(item => decisionObject(Object.fromEntries(Object.entries(item.properties)
            .filter(([key]) => key !== "basisRefs" || !serverBasisTerminals.has(item.properties.kind.enum[0])))))] },
      }) };
    }
    return decisionObject(properties);
  });
  return { ...object({ decision: { description: hasSteps
    ? "Choose one decision kind and fill only that branch's declared fields."
    : "Choose one decision kind and fill only that branch's declared fields. The only root field is decision.",
    anyOf: [...flatPlans, ...terminalVariants] },
    ...(hasCheck ? { check: { $ref: "#/$def/check", description: "Under a check, exactly one row: the step decision.checkStep names, with its result on success and on failure." } } : {}),
    ...(hasSteps ? { steps: { $ref: "#/$def/steps", description: "Every other step, grouped by type, each with at most one result; outcome text never stands in for a step." } } : {}) }),
    ...(Object.keys(definitions).length > 0 ? { $def: definitions } : {}) };
}

/** The reserved response-basis member for the player's present words. */
const PLAYER_EXPRESSION_SOURCE = "playerExpression";
const BRANCHES = ["success", "failure"] as const;
/** The wire field holding a decoded branch: a check row keeps success and
 * failure; a steps row writes its one result and has no failure to point at. */
function wireResultField(container: VNextFillingContainer | undefined, branch: typeof BRANCHES[number]): string | undefined {
  return container === "check" ? branch : branch === "success" ? "result" : undefined;
}

/** Pure wire -> domain representation. Invalid semantic fields are preserved
 * for the existing complete validator. Ambiguous or colliding representations
 * fail at their actual argument path; nothing guesses a missing decision. */
export function decodeProposalFilling(value: unknown, domain: Schema): unknown {
  if (!isPlainRecord(value)) fail("TYPE_MISMATCH", "filling:object-required", [], { type: "object" }, value);
  requireOnly(value, ["decision", "check", "steps"], []);
  if (!isPlainRecord(value.decision)) fail(Object.hasOwn(value, "decision") ? "TYPE_MISMATCH" : "FIELD_MISSING",
    "filling:decision-required", ["decision"], { type: "object" }, value.decision);
  const layouts = resultLayouts(domain);
  const decision = value.decision;
  if (typeof decision.kind === "string" && rulings.includes(decision.kind)) {
    for (const container of FILLING_CONTAINERS) if (Object.hasOwn(decision, container)) fail("CONSTRAINT_CONFLICT", `filling:${container}-belong-to-the-root`,
      ["decision", container], `absent; the root ${container} object holds these steps`, decision[container]);
    return decodeDecision({ ...decision, check: value.check, steps: value.steps }, ["decision"], false, layouts);
  }
  // A terminal decision sends the check and steps objects the form requires, every group empty.
  for (const container of FILLING_CONTAINERS) {
    const groups = value[container];
    if (groups === undefined) continue;
    if (!isPlainRecord(groups)) fail("TYPE_MISMATCH", `filling:${container}-object-required`, [container], { type: "object" }, groups);
    const filled = Object.entries(groups).filter(([, rows]) => !(Array.isArray(rows) && rows.length === 0));
    if (filled.length > 0) throw new ProposalFillingError(filled.map(([key, rows]) => proposalDiagnostic("CONSTRAINT_CONFLICT", "filling:terminal-steps-must-be-empty",
      { path: [container, key], pathBase: "arguments", expected: "[]", actual: diagnosticActual(rows) })));
  }
  return decodeDecision(decision, ["decision"], false, layouts);
}

function decodeDecision(value: RecordValue, path: ProposalDiagnosticPath, continuation: boolean, layouts: ResultLayouts): RecordValue {
  const { kind, steps, check, ...content } = value;
  const paths: Record<VNextFillingContainer, ProposalDiagnosticPath> = continuation
    ? { check: [...path, "check"], steps: [...path, "steps"] } : { check: ["check"], steps: ["steps"] };
  const stepsPath = paths.steps;
  if (typeof kind !== "string" || ![...rulings, ...(continuation ? ["inWorldRefusal", "cancel", "abilityOperation"] : terminals)].includes(kind)) {
    fail(kind === undefined ? "FIELD_MISSING" : typeof kind !== "string" ? "TYPE_MISMATCH" : "VALUE_INVALID", "filling:decision-kind", [...path, "kind"],
      { type: "string", enum: [...rulings, ...(continuation ? ["inWorldRefusal", "cancel", "abilityOperation"] : terminals)] }, kind);
  }
  if (rulings.includes(kind)) {
    rejectOwned(value, ["adjudication", "terminal", "proposals"], path);
    // The retired results table: every result now sits on its own step.
    if (Object.hasOwn(value, "results")) fail("VALUE_INVALID", "filling:additional-field", continuation ? [...path, "results"] : ["results"], { allowedFields: ["decision", "check", "steps"] }, value.results);
    if (!isPlainRecord(steps)) fail(steps === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "filling:steps-object-required", stepsPath, { type: "object", keys: "one array per loaded step type" }, steps);
    if (check !== undefined && !isPlainRecord(check)) fail("TYPE_MISMATCH", "filling:check-object-required", paths.check,
      { type: "object", keys: "one array per loaded observe/social/worldInteraction type" }, check);
    const named = content.checkStep;
    if (!checkRulings.includes(kind) && named !== undefined) fail("CONSTRAINT_CONFLICT", "filling:check-step-needs-a-check", [...path, "checkStep"],
      "absent; only a check names the step it decides", named);
    const proposals = decodeStepGroups({ check, steps }, paths, checkRulings.includes(kind) ? "check" : kind, layouts, typeof named === "string" ? named : undefined);
    const basisRefs = rulingBasis(proposals.flatMap(entry => isPlainRecord(entry) && Array.isArray(entry.basisRefs) ? entry.basisRefs : []));
    // The ruling's basis is derived from its steps; the wire offers no such
    // field on a ruling. Round 85 copied the step's list onto the ruling
    // anyway. A copy that restates the derived list says nothing and is
    // dropped; any other list is a claim on a server-owned field.
    if (Object.hasOwn(value, "basisRefs") && !(Array.isArray(value.basisRefs) && sameRefs(rulingBasis(value.basisRefs), basisRefs))) rejectOwned(value, ["basisRefs"], path);
    // The wire carries the act's duration as one coarse tier; the domain keeps
    // exact microseconds. An unknown tier passes through so the domain
    // validator diagnoses the value instead of silently dropping it.
    const { duration, basisRefs: _restated, checkStep: _named, ...ruling } = content;
    const durationMicros = duration === undefined ? {} : { durationMicros: actionDurationMicrosForTier(duration) ?? duration };
    // SPEC 0016 §7.3: the wire's covert ruling is a check whose DC Rules
    // derives; the domain keeps it a check with the KP's declaration.
    const adjudication = kind === "concealedCheck" ? decodeConcealedCheck(ruling, durationMicros) : { kind, ...ruling, ...durationMicros };
    return continuation ? { kind: "adjudication", basisRefs, adjudication, proposals }
      : { mode: "adjudication", basisRefs, adjudication, terminal: null, proposals };
  }
  if (steps !== undefined) fail("CONSTRAINT_CONFLICT", "filling:terminal-cannot-have-steps", [...path, "steps"], { required: false }, steps);
  if (check !== undefined) fail("CONSTRAINT_CONFLICT", "filling:terminal-cannot-have-steps", [...path, "check"], { required: false }, check);
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

/** Reads the check and steps objects group by group in the fixed order, a
 * group's check row first, each list in its written order. Every step is
 * decoded on its own and every problem is reported together (round 114 was
 * told one step's one problem per round); a step that failed stays as
 * written, with the kind its group implies, so the others keep their
 * positions. SPEC 0016 §7.3: a check has exactly one step with both results. */
function decodeStepGroups(filling: Readonly<{ check: unknown; steps: RecordValue }>, paths: Record<VNextFillingContainer, ProposalDiagnosticPath>,
  rulingKind: string, layouts: ResultLayouts, namedCheckStep?: string): unknown[] {
  const problems: ProposalDiagnostic[] = [];
  const report = (code: ProposalDiagnostic["code"], constraint: string, path: ProposalDiagnosticPath, expected: unknown, actual: unknown): void => {
    problems.push(proposalDiagnostic(code, constraint, { path, pathBase: "arguments", expected, actual: diagnosticActual(actual) }));
  };
  for (const [key, rows] of Object.entries(filling.steps)) {
    const group = STEP_GROUPS.find(entry => entry.key === key);
    if (!group) report("VALUE_INVALID", "filling:step-group-unknown", [...paths.steps, key], { enum: VNEXT_FILLING_STEP_KEYS }, rows);
    else if (!Array.isArray(rows)) report("TYPE_MISMATCH", "filling:step-group-array-required", [...paths.steps, key], { type: "array" }, rows);
  }
  const checkKeys = STEP_GROUPS.filter(group => branchKinds.has(group.kind)).map(group => group.key);
  if (isPlainRecord(filling.check)) for (const [key, rows] of Object.entries(filling.check)) {
    if (!checkKeys.some(id => id === key)) report("VALUE_INVALID", "filling:check-group-unknown", [...paths.check, key], { enum: checkKeys }, rows);
    else if (!Array.isArray(rows)) report("TYPE_MISMATCH", "filling:check-group-array-required", [...paths.check, key], { type: "array" }, rows);
  }
  const rows = proposalFillingSteps(filling);
  const checkRows = rows.filter(row => row.container === "check");
  // An empty check is reported at the group the decision named, when it
  // named one this form has.
  const namedPath = namedCheckStep !== undefined && checkKeys.some(key => key === namedCheckStep) ? [...paths.check, namedCheckStep] : paths.check;
  if (rulingKind === "check" && checkRows.length !== 1) report(checkRows.length === 0 ? "FIELD_MISSING" : "CONSTRAINT_CONFLICT",
    checkRows.length === 0 ? "filling:check-step-required" : "filling:one-check-step", checkRows.length === 0 ? namedPath : paths.check,
    CHECK_STEP_EXPECTED, checkRows.length === 0 ? valueAt({ check: filling.check }, ["check", ...namedPath.slice(paths.check.length)]) : filling.check);
  if (rulingKind !== "check") for (const row of checkRows) report("CONSTRAINT_CONFLICT", "filling:check-step-needs-a-check",
    [...paths.check, row.key, row.index], { directSuccess: "every step goes in steps with its one result; check holds a step only under a check" }, row.row);
  const proposals = rows.map(({ container, key, index, kind, row }) => {
    const path = [...paths[container], key, index];
    if (!isPlainRecord(row)) return row;
    const group = STEP_GROUPS.find(entry => entry.key === key)!;
    const { kind: stated, ...rest } = row;
    const entry: RecordValue = { kind, ...rest };
    // The group says the kind. A restated kind that agrees says nothing; one
    // that disagrees is a claim on the group's own field.
    if (stated !== undefined && stated !== kind) {
      report("VALUE_INVALID", "filling:step-kind-must-match-group", [...path, "kind"], { const: kind, orOmit: true }, stated);
      return entry;
    }
    if (group.definitionKind !== undefined && isPlainRecord(rest.source) && rest.source.kind !== group.definitionKind) {
      report("VALUE_INVALID", "filling:definition-kind-must-match-group", [...path, "source", "kind"], { const: group.definitionKind }, rest.source.kind);
      return entry;
    }
    try { return decodeStep(entry, path, rulingKind === "check", layouts, container); }
    catch (error) {
      if (!(error instanceof ProposalFillingError)) throw error;
      problems.push(...error.diagnostics);
      return entry;
    }
  });
  if (problems.length > 0) throw new ProposalFillingError(problems);
  return proposals;
}

const CHECK_STEP_EXPECTED = Object.freeze({ rows: 1,
  step: "the one observe/social/worldInteraction step whose outcome the check decides, under its type, with success and failure both written",
  otherSteps: "every other step goes in steps with one result and binds always, onSuccess or onFailure",
  hiddenAct: "when being noticed is the failure, the conversation partner's reaction and npcPerceives are the check step's failure; other bystanders' witness records go in a steps.observe row bound onFailure" });

function decodeStep(value: unknown, path: ProposalDiagnosticPath, checked: boolean, layouts: ResultLayouts, container: VNextFillingContainer): unknown {
  if (!isPlainRecord(value)) return value;
  rejectOwned(value, ["consumes", "produces", "templateHash", "communication", "branches"], path);
  const { handle, success, failure, result, ...entry } = value;
  const contract = vnextEntryProducerContract(entry);
  if (!contract) return { ...value }; // The canonical kind diagnostic owns this.
  // A step's problems are reported together at the end of its decoding.
  const problems: ProposalDiagnostic[] = [];
  const report = (code: ProposalDiagnostic["code"], constraint: string, at: ProposalDiagnosticPath, expected: unknown, actual: unknown): void => {
    problems.push(proposalDiagnostic(code, constraint, { path: at, pathBase: "arguments", expected, actual: diagnosticActual(actual) }));
  };
  if (contract.count === 0 && Object.hasOwn(value, "handle")) report("CONSTRAINT_CONFLICT", "filling:nonproducer-handle", [...path, "handle"], "absent", handle);
  if (container === "check") {
    // The check step happens whatever the roll; the roll picks its result.
    if (Object.hasOwn(entry, "outcomeBinding") && entry.outcomeBinding !== "always") report("VALUE_INVALID", "filling:check-step-binding",
      [...path, "outcomeBinding"], "absent; the check decides which result of this step happens", entry.outcomeBinding);
    entry.outcomeBinding = "always";
  } else if (!checked) {
    // The form always carries outcomeBinding; a directSuccess step can only say always.
    if (Object.hasOwn(entry, "outcomeBinding") && entry.outcomeBinding !== "always") report("VALUE_INVALID", "filling:direct-outcome-binding-always", [...path, "outcomeBinding"], { const: "always" }, entry.outcomeBinding);
    entry.outcomeBinding = "always";
  }
  if (entry.kind === "materializeNpc") {
    try { entry.source = decodeNpcMaterializationWire(entry.source); }
    catch (error) {
      if (!(error instanceof NpcMaterializationWireError)) throw error;
      throw new ProposalFillingError(error.diagnostics.map(diagnostic => ({ ...diagnostic,
        path: [...path, "source", ...(diagnostic.path ?? [])] })));
    }
  }
  if (entry.kind === "worldInteraction") {
    rejectOwned(value, ["targetRefs"], path);
    // Both target arrays are reported together: round 113 spent one round on
    // each. The complete validator then names every other field of the step.
    const direct = entry.directTargetRefs, other = entry.otherTargetRefs;
    if (!Array.isArray(direct)) report(direct === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "filling:direct-targets-array-required", [...path, "directTargetRefs"], { type: "array" }, direct);
    if (!Array.isArray(other)) report(other === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH", "filling:other-targets-array-required", [...path, "otherTargetRefs"], { type: "array" }, other);
    if (Array.isArray(direct) && Array.isArray(other)) {
      // Preserve repeated submitted entries so the same validator can diagnose
      // them. Only the role overlap is structural, not a second target choice.
      entry.targetRefs = [...new Set(direct), ...other.filter(ref => !direct.includes(ref))];
      delete entry.otherTargetRefs;
    }
  }
  entry.produces = contract.count === 0 ? [] : [{ ...(handle === undefined ? {} : { handle }),
    kind: contract.kind, ...(entry.outcomeBinding === undefined ? {} : { outcomeBinding: entry.outcomeBinding }) }];
  if (branchKinds.has(String(entry.kind))) {
    const layout = layouts.get(String(entry.kind));
    const decode = (body: unknown, field: string) => {
      try { return entry.kind === "social" ? decodeSocialTables(body, [...path, field]) : decodeResult(body, layout, [...path, field]); }
      catch (error) {
        if (!(error instanceof ProposalFillingError)) throw error;
        problems.push(...error.diagnostics);
        return body;
      }
    };
    if (container === "check") {
      // Both results sit on the check step under the domain's own names; a
      // missing one is the complete validator's FIELD_MISSING at the same place.
      if (Object.hasOwn(value, "result")) report("CONSTRAINT_CONFLICT", "filling:check-step-has-two-results", [...path, "result"],
        { success: "this step's result when the check succeeds", failure: "this step's result when the check fails" }, result);
      entry.branches = { ...(success === undefined ? {} : { success: decode(success, "success") }),
        ...(failure === undefined ? {} : { failure: decode(failure, "failure") }) };
    } else {
      // A steps row has one result, which the domain names success.
      for (const field of BRANCHES) if (Object.hasOwn(value, field)) report("CONSTRAINT_CONFLICT", "filling:two-results-only-in-check", [...path, field],
        { result: "this step's one result", check: "the step whose outcome the check decides goes in check with success and failure" }, value[field]);
      entry.branches = { ...(result === undefined ? {} : { success: decode(result, "result") }), failure: { kind: "none" } };
    }
  } else {
    for (const field of [...BRANCHES, "result"]) {
      if (Object.hasOwn(value, field)) report("CONSTRAINT_CONFLICT", "filling:result-not-supported-by-type", [...path, field],
        { kind: entry.kind, thisField: "remove it; a step of this type has no result" }, value[field]);
    }
  }
  if (entry.kind === "formActorPlan") {
    rejectOwned(value, ["basisRefs", "planId", "activityId", "due", "trigger", "activityKind", "contextHash", "readSet", "trace", "alternateTarget"], path);
    entry.basisRefs = [];
  }
  if (entry.kind === "social") {
    entry.communication = "spokenConversation";
    for (const branchName of BRANCHES) {
      const branch = (entry.branches as RecordValue | undefined)?.[branchName];
      const field = wireResultField(container, branchName);
      if (field === undefined || !isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) continue;
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
  if (problems.length > 0) throw new ProposalFillingError(problems);
  return entry;
}

/** Decode a reviewed, unconditional definition through the same field codec.
 * This creates no synthetic adjudication or outcome; normal Bundle validation
 * still owns the complete producer/dependency and source contracts. */
export function decodeProposalMaterialSteps(value: unknown, domain: Schema): unknown[] {
  if (!Array.isArray(value) || value.length !== 1) throw new TypeError("STORY_DEFINITION_REQUIRES_ONE_STEP");
  return value.map((step, index) => {
    if (!isPlainRecord(step) || step.outcomeBinding !== "always") throw new TypeError("STORY_DEFINITION_MUST_BE_UNCONDITIONAL");
    const { outcomeBinding: _outcome, ...body } = step;
    return decodeStep(body, ["steps", index], false, resultLayouts(domain), "steps");
  });
}

/** Explicit conversion for internal fixtures and tools, never a parser fallback
 * accepting the retired wire. Only the new decision shape is accepted above. */
export function encodeProposalFilling(value: unknown, domain: Schema): unknown {
  if (!isPlainRecord(value) || (value.mode !== "adjudication" && value.mode !== "terminal")) return value;
  const encoded = encodeDecision(value, false, resultLayouts(domain));
  // A terminal decision still sends the steps object: the strict form requires
  // it whenever any step type is selected, every group of it empty.
  if (value.mode !== "adjudication" || !isPlainRecord(encoded)) return { decision: encoded, steps: {} };
  const { check, steps, ...ruling } = encoded;
  return { decision: ruling, ...(check === undefined ? {} : { check }), steps };
}

/** Encoded steps -> the groups of the wire, keyed by the capability that fills
 * each, in the fixed group order, each group keeping its own order. */
function groupSteps(steps: unknown): RecordValue {
  const groups = new Map<string, unknown[]>();
  const place = (key: string, step: unknown): void => {
    const rows = groups.get(key) ?? [];
    rows.push(step); groups.set(key, rows);
  };
  if (!Array.isArray(steps)) { if (steps !== undefined) place("invalid", steps); }
  else for (const step of steps) {
    if (!isPlainRecord(step)) { place("invalid", step); continue; }
    const { kind, ...row } = step;
    place(vnextProposalCapabilityForEntry(step) ?? String(kind), row);
  }
  const keys = [...VNEXT_FILLING_STEP_KEYS, ...groups.keys()].filter((key, index, all) => all.indexOf(key) === index && groups.has(key));
  return Object.fromEntries(keys.map(key => [key, groups.get(key)!]));
}

/** Wire concealedCheck -> the domain check with the KP's declaration. A
 * malformed field passes through for the complete validator to diagnose. */
function decodeConcealedCheck(ruling: RecordValue, durationMicros: RecordValue): RecordValue {
  const { primaryObserverRef, observers, noticedEvidence, ...rest } = ruling;
  const notice = isPlainRecord(noticedEvidence) ? noticedEvidence : {};
  return { kind: "check", checkKind: "abilityCheck", dc: null, ...rest, ...durationMicros,
    concealment: { primaryObserverRef, sense: notice.sense, evidence: notice.evidence, observers } };
}

/** The domain check with a declaration -> the wire concealedCheck. */
function encodeConcealedCheck(ruling: RecordValue): RecordValue {
  if (ruling.kind !== "check" || !isPlainRecord(ruling.concealment)) return ruling;
  const { concealment, checkKind: _checkKind, dc: _dc, kind: _kind, ...rest } = ruling;
  return { kind: "concealedCheck", ...rest, primaryObserverRef: concealment.primaryObserverRef,
    observers: concealment.observers, noticedEvidence: { sense: concealment.sense, evidence: concealment.evidence } };
}

function encodeDecision(value: RecordValue, continuation: boolean, layouts: ResultLayouts): unknown {
  if (value.mode === "adjudication" || (continuation && value.kind === "adjudication")) {
    if (!isPlainRecord(value.adjudication)) return { steps: groupSteps(value.proposals) };
    const { durationMicros, ...ruling } = value.adjudication;
    // The step a check decides is written in check; a draft that marks two
    // stays two, so the decoder reports it instead of the encoder choosing.
    const checked = Array.isArray(value.proposals) ? value.proposals.filter(isCheckStep) : [];
    const named = ruling.kind === "check" && checked.length > 0 ? vnextProposalCapabilityForEntry(checked[0]) : undefined;
    return { ...encodeConcealedCheck(ruling), ...(durationMicros === undefined ? {} : { duration: actionDurationTierForMicros(durationMicros) ?? durationMicros }),
      ...(named === undefined ? {} : { checkStep: named }),
      ...(checked.length === 0 ? {} : { check: groupSteps(checked.map(entry => encodeStep(entry, layouts, "check"))) }),
      steps: groupSteps(Array.isArray(value.proposals) ? value.proposals.filter(entry => !isCheckStep(entry))
        .map(entry => encodeStep(entry, layouts, "steps")) : value.proposals) };
  }
  const source = continuation ? value : value.terminal;
  if (!isPlainRecord(source)) return source;
  const result = { ...source };
  if (!serverBasisTerminals.has(String(source.kind)) && source.kind !== "cancel") result.basisRefs = value.basisRefs;
  else delete result.basisRefs;
  if (source.kind === "clarification" && Array.isArray(source.choices)) result.choices = source.choices.map(choice =>
    !isPlainRecord(choice) || !isPlainRecord(choice.continuation) ? choice : { ...choice, continuation: encodeDecision(choice.continuation, true, layouts) });
  return result;
}

function encodeStep(value: unknown, layouts: ResultLayouts, container: VNextFillingContainer): unknown {
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
  // A steps row always carries the binding, an unconditional domain step
  // spelling it always; the check decides the check row's result instead, so
  // only a binding the check row cannot have is kept, for the decoder to refuse.
  if (container === "steps") entry.outcomeBinding = outcomeBinding === undefined ? "always" : outcomeBinding;
  else if (outcomeBinding !== undefined && outcomeBinding !== "always") entry.outcomeBinding = outcomeBinding;
  if (entry.kind === "materializeNpc") entry.source = encodeNpcMaterializationWire(entry.source);
  if (entry.kind === "formActorPlan") delete entry.basisRefs;
  if (entry.kind === "worldInteraction") {
    entry.otherTargetRefs = Array.isArray(entry.targetRefs) && Array.isArray(entry.directTargetRefs)
      ? entry.targetRefs.filter(ref => !(entry.directTargetRefs as unknown[]).includes(ref)) : entry.targetRefs;
    delete entry.targetRefs;
  }
  if (Array.isArray(produces) && produces.length === 1 && isPlainRecord(produces[0])) entry.handle = produces[0].handle;
  if (isPlainRecord(branches)) {
    const layout = layouts.get(String(entry.kind));
    const branch = (body: unknown) => entry.kind === "social" ? encodeSocialBranch(body, entry.npcRef) : encodeResult(body, layout);
    if (container === "check") {
      if (Object.hasOwn(branches, "success")) entry.success = branch(branches.success);
      if (Object.hasOwn(branches, "failure")) entry.failure = branches.failure === null ? { kind: "none" } : branch(branches.failure);
    } else if (Object.hasOwn(branches, "success")) entry.result = branch(branches.success);
  }
  return entry;
}

function decodeSocialSource(value: unknown, npcRef: unknown, path: ProposalDiagnosticPath): unknown {
  // The wire spells the player's present words as the reserved member
  // "playerExpression" of the same closed enum as the NPC's refs, so the slot
  // needs no anyOf; the older object spelling still decodes to the same source.
  if (value === PLAYER_EXPRESSION_SOURCE) return { kind: "playerExpression" };
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

function decodeSocialTables(value: unknown, path: ProposalDiagnosticPath): unknown {
  if (!isPlainRecord(value) || (Object.keys(value).length === 1 && value.kind === "none")) return value;
  rejectOwned(value, ["consequences"], path);
  const content = { ...value }, consequences: RecordValue[] = [];
  for (const { field, kind } of SOCIAL_RESULT_TABLES) {
    const rows = content[field];
    if (!Array.isArray(rows)) fail(rows === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
      "social:explicit-result-table-required", [...path, field], { type: "array", required: true }, rows);
    for (const [index, row] of rows.entries()) {
      if (!isPlainRecord(row)) fail("TYPE_MISMATCH", "social:result-table-row-required", [...path, field, index], { type: "object" }, row);
      rejectOwned(row, ["kind"], [...path, field, index]);
      consequences.push({ kind, ...row });
    }
    delete content[field];
  }
  return { ...content, consequences };
}

function encodeSocialTables(value: RecordValue): RecordValue {
  if (SOCIAL_RESULT_TABLES.some(({ field }) => Object.hasOwn(value, field))) throw new TypeError("PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION");
  // A broken internal fixture must not become a complete, empty social result.
  if (!Array.isArray(value.consequences)) return value;
  const { consequences, ...content } = value;
  const tables: Record<string, RecordValue[]> = Object.fromEntries(SOCIAL_RESULT_TABLES.map(({ field }) => [field, []]));
  for (const consequence of consequences) {
    const table = isPlainRecord(consequence) && SOCIAL_RESULT_TABLES.find(table => table.kind === consequence.kind);
    if (!table) throw new TypeError("PROPOSAL_SOCIAL_CONSEQUENCE_KIND_UNAVAILABLE");
    const { kind: _kind, ...payload } = consequence;
    tables[table.field]!.push(payload);
  }
  return { ...content, ...tables };
}

function encodeSocialBranch(value: unknown, npcRef: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  value = encodeSocialTables(value);
  if (!isPlainRecord(value) || !isPlainRecord(value.response) || !Array.isArray(value.response.basis)) return value;
  return { ...value, response: { ...value.response, basis: value.response.basis.map(source => {
    if (!isPlainRecord(source)) return source;
    if (source.kind === "npcContext" && Object.keys(source).sort().join(",") === "kind,ref") return source.ref;
    if (source.kind === "playerExpression" && Object.keys(source).length === 1) return PLAYER_EXPRESSION_SOURCE;
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

/** Intent-field diagnostics use decision-field provenance. Existing source
 * transforms keep their own exact mapping; domain-only paths stay explicit. */
export function proposalIntentEchoArgumentDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[]): readonly ProposalDiagnostic[] {
  return diagnostics.map(diagnostic => {
    const path = diagnostic.pathBase !== "arguments" && diagnostic.pathBase !== "rulesInput"
      && diagnostic.path?.at(-1) === "intent" && diagnostic.constraint === "closed-object-additional-field"
      ? proposalDecisionFieldArgumentPath(draft, diagnostic.path) : undefined;
    return { ...diagnostic, ...(path === undefined ? {} : { path, pathBase: "arguments" as const }) };
  });
}

/** Wire path of decoded proposals[index] under `owner` ([] for the root): read
 * off the wire's check and steps groups when the arguments are at hand, else
 * counted from the draft's own entries of the same type and place, which the
 * decoder lists in the same order. */
function stepArgumentPath(container: RecordValue, owner: readonly (string | number)[], index: number, wire?: unknown): (string | number)[] {
  const filling = wire === undefined ? undefined : owner.length ? valueAt(wire, owner) : wire;
  if (isPlainRecord(filling)) {
    const hit = proposalFillingSteps(filling)[index];
    if (hit !== undefined) return [...owner, hit.container, hit.key, hit.index];
  }
  const proposals = Array.isArray(container.proposals) ? container.proposals : [];
  const key = vnextProposalCapabilityForEntry(proposals[index]);
  if (key === undefined) return [...owner, "steps"];
  const place = (entry: unknown): VNextFillingContainer => isCheckStep(entry) ? "check" : "steps";
  const at = place(proposals[index]);
  return [...owner, at, key, proposals.slice(0, index).filter(entry => vnextProposalCapabilityForEntry(entry) === key && place(entry) === at).length];
}

/** The container a step path names, read at the owner's depth. */
function stepContainer(stepPath: readonly (string | number)[], owner: readonly (string | number)[]): VNextFillingContainer | undefined {
  const part = stepPath[owner.length];
  return part === "check" || part === "steps" ? part : undefined;
}

/** The inverse of the social tables and source transforms. Row locations come
 * from the original arguments when supplied, including after journal recovery;
 * grouping must not point a diagnostic at a different result or consequence. */
export function socialResultArgumentDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[], argumentsValue?: unknown): readonly ProposalDiagnostic[] {
  return diagnostics.flatMap(diagnostic => {
    if (diagnostic.pathBase === "arguments" || !diagnostic.path || !isPlainRecord(draft)) return diagnostic;
    let value: RecordValue = draft, remaining = [...diagnostic.path];
    const owner: (string | number)[] = [];
    if (remaining[0] === "terminal" && remaining[1] === "choices" && typeof remaining[2] === "number" && remaining[3] === "continuation") {
      const terminal = value.terminal, index = remaining[2];
      if (!isPlainRecord(terminal) || !Array.isArray(terminal.choices) || !isPlainRecord(terminal.choices[index])
        || !isPlainRecord(terminal.choices[index].continuation)) return diagnostic;
      value = terminal.choices[index].continuation; owner.push("decision", "choices", index, "continuation"); remaining = remaining.slice(4);
    }
    const [field, ordinal, branches, branchName, response, basis, index] = remaining;
    if (field !== "proposals" || typeof ordinal !== "number" || !Array.isArray(value.proposals)) return diagnostic;
    const entry = value.proposals[ordinal];
    if (!isPlainRecord(entry) || entry.kind !== "social" || !isPlainRecord(entry.branches)) return diagnostic;
    const stepPath = stepArgumentPath(value, owner, ordinal, argumentsValue);
    // A same-bundle worldFact the NPC cites: the consume is reported where the
    // wire spells it, {worldFactRef} inside the response basis of each branch.
    if (branches === "consumes" && typeof branchName === "number" && Array.isArray(entry.consumes)) {
      const consume = entry.consumes[branchName];
      if (!isPlainRecord(consume) || consume.kind !== "prospective") return diagnostic;
      const paths = BRANCHES.flatMap(name => {
        const branch = (entry.branches as RecordValue)[name];
        const resultField = wireResultField(stepContainer(stepPath, owner), name);
        if (resultField === undefined || !isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) return [];
        return branch.response.basis.flatMap((source, at) => isPlainRecord(source) && source.kind === "materializedKnowledge"
          && source.definitionRef === consume.handle ? [[...stepPath, resultField, "response", "basis", at, "worldFactRef"]] : []);
      });
      return paths.length ? paths.map(path => ({ ...diagnostic, path, pathBase: "arguments" as const })) : diagnostic;
    }
    if (branches !== "branches" || (branchName !== "success" && branchName !== "failure")) return diagnostic;
    const branch = entry.branches[branchName];
    const resultField = wireResultField(stepContainer(stepPath, owner), branchName);
    if (resultField === undefined) return { ...diagnostic, path: stepPath, pathBase: "arguments" as const };
    const prefix = [...stepPath, resultField];
    // The wire groups a branch's consequences into its four typed tables.
    if (response === "consequences") {
      if (!isPlainRecord(branch) || !Array.isArray(branch.consequences)) return diagnostic;
      if (basis === undefined) return { ...diagnostic, path: prefix, pathBase: "arguments" as const };
      if (typeof basis !== "number") return diagnostic;
      const consequence = branch.consequences[basis];
      if (!isPlainRecord(consequence)) return diagnostic;
      const table = SOCIAL_RESULT_TABLES.find(table => table.kind === consequence.kind);
      if (!table) return diagnostic;
      const row = branch.consequences.slice(0, basis).filter(value => isPlainRecord(value) && value.kind === table.kind).length;
      return { ...diagnostic, path: [...prefix, table.field, row, ...remaining.slice(6).filter((part, i) => i !== 0 || part !== "kind")], pathBase: "arguments" as const };
    }
    if (response !== "response" || basis !== "basis") return diagnostic;
    const path = [...prefix, "response", "basis"];
    if (index === undefined) return { ...diagnostic, path, pathBase: "arguments" as const };
    if (typeof index !== "number") return diagnostic;
    path.push(index);
    if (!isPlainRecord(branch) || !isPlainRecord(branch.response) || !Array.isArray(branch.response.basis)) return diagnostic;
    const source = branch.response.basis[index];
    if (!isPlainRecord(source)) return diagnostic;
    if (source.kind === "materializedKnowledge") path.push("worldFactRef");
    else if (source.kind === "playerExpression" && remaining.length > 7) path.push(...remaining.slice(7));
    else if (source.kind !== "npcContext") return diagnostic;
    return { ...diagnostic, path, pathBase: "arguments" as const };
  });
}

/** Diagnostics sent to KP share the sole filling document's coordinates.
 * Derived containers point to their owning input, never a fictitious wire
 * field. The original validator paths remain in the private repair ticket. */
export function proposalFillingDiagnostics(draft: unknown, diagnostics: readonly ProposalDiagnostic[], wire: unknown): readonly ProposalDiagnostic[] {
  return socialResultArgumentDiagnostics(draft, diagnostics, wire).map(diagnostic => {
    const path = diagnostic.pathBase === "arguments" ? diagnostic.path ?? []
      : diagnostic.pathBase === "rulesInput" ? [] : fillingPath(draft, wire, diagnostic.path ?? []);
    const { path: _oldPath, pathBase: _oldBase, authorityPath: _privateAuthorityPath, ...detail } = diagnostic;
    // The validator's cardinality rule on the proposals array reads, on the
    // wire, as the groups object having no step at all (round 119 ruled over
    // three empty groups): say what the groups are and what one of them needs.
    if (diagnostic.pathBase !== "arguments" && diagnostic.path?.at(-1) === "proposals" && path.at(-1) === "steps" && isPlainRecord(valueAt(wire, path))) {
      detail.expected = { type: "object", groups: Object.keys(valueAt(wire, path) as RecordValue),
        atLeastOneStepInSomeGroup: "a directSuccess or check ruling needs a step; every group [] belongs to a terminal decision only" };
    }
    // Preserve Rules' precise actual error for an owner-level diagnostic.
    const actual = path.length && diagnostic.pathBase !== "rulesInput" ? valueAt(wire, path) : undefined;
    return { ...detail, path, pathBase: "arguments" as const,
      ...(actual === undefined ? {} : { actual: isPlainRecord(actual) || Array.isArray(actual)
        ? { ...diagnosticActual(actual) as Record<string, unknown>, sourcePath: path,
          ...(JSON.stringify(actual).length <= 512 ? { value: actual } : {}) } : diagnosticActual(actual) }) };
  });
}

function valueAt(value: unknown, path: ProposalDiagnosticPath): unknown {
  for (const part of path) {
    if ((!isPlainRecord(value) && !Array.isArray(value)) || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function fillingPath(draft: unknown, wire: unknown, path: ProposalDiagnosticPath): ProposalDiagnosticPath {
  if (!isPlainRecord(draft) || !isPlainRecord(wire)) return [];
  let container = draft, remaining = [...path];
  const owner: (string | number)[] = [];
  if (remaining[0] === "terminal" && remaining[1] === "choices" && typeof remaining[2] === "number" && remaining[3] === "continuation") {
    const index = remaining[2];
    const nested = valueAt(draft, remaining.slice(0, 4));
    const raw = valueAt(wire, ["decision", "choices", index, "continuation"]);
    if (!isPlainRecord(nested) || !isPlainRecord(raw)) return ["decision", "choices", index];
    container = nested; remaining = remaining.slice(4);
    owner.push("decision", "choices", index, "continuation");
  }
  const decision = owner.length ? owner : ["decision"];
  const stepsBase = [...owner, "steps"];
  const [field, index, ...tail] = remaining;
  if (["decision", "check", "steps"].includes(String(field))) return path;
  if (field === "adjudication" || field === "terminal") {
    if (index === "durationMicros" && field === "adjudication") return [...decision, "duration", ...tail];
    return [...decision, ...remaining.slice(1)];
  }
  if (field === "proposals") {
    if (typeof index !== "number") return stepsBase;
    const stepPath = stepArgumentPath(container, owner, index, wire);
    if (stepPath.length === stepsBase.length) return stepPath;
    // The group names the kind: a diagnosis of the kind is one of the group.
    if (tail[0] === "kind") return stepPath.slice(0, -1);
    const entry = valueAt(container, ["proposals", index]);
    const rawStep = valueAt(wire, stepPath);
    if (!isPlainRecord(entry) || !isPlainRecord(rawStep)) return stepPath;
    if (tail[0] === "branches") {
      const branch = tail[1];
      if (branch !== "success" && branch !== "failure") return stepPath;
      const wireField = wireResultField(stepContainer(stepPath, owner), branch);
      if (wireField === undefined) return stepPath;
      const prefix = [...stepPath, wireField], rest = tail.slice(2);
      const row = rawStep[wireField];
      if (!isPlainRecord(row)) return prefix;
      if (typeof rest[0] === "string" && Array.isArray(row.entries)) {
        const entries = row.entries.flatMap((item, ordinal) => isPlainRecord(item) && item.recordKind === rest[0] ? [ordinal] : []);
        if (typeof rest[1] === "number" && entries[rest[1]] !== undefined)
          return [...prefix, "entries", entries[rest[1]]!, ...rest.slice(2)];
        if (entries.length || !Object.hasOwn(row, rest[0])) return [...prefix, "entries"];
      }
      return [...prefix, ...rest];
    }
    if (tail[0] === "produces") return tail.at(-1) !== "outcomeBinding" ? [...stepPath, "handle"]
      : stepContainer(stepPath, owner) === "check" ? stepPath : [...stepPath, "outcomeBinding"];
    if (tail[0] === "consumes") {
      const consume = valueAt(entry, ["consumes", ...(typeof tail[1] === "number" ? [tail[1]] : [])]);
      if (isPlainRecord(consume) && consume.kind === "existing" && Array.isArray(rawStep.basisRefs)) {
        const ordinal = rawStep.basisRefs.indexOf(consume.ref);
        if (ordinal >= 0) return [...stepPath, "basisRefs", ordinal];
      }
      return stepPath;
    }
    if (tail[0] === "targetRefs") {
      const ref = valueAt(entry, tail);
      for (const field of ["directTargetRefs", "otherTargetRefs"]) {
        const refs = rawStep[field];
        if (Array.isArray(refs) && refs.includes(ref)) return [...stepPath, field, refs.indexOf(ref)];
      }
      return stepPath;
    }
    if (["templateHash", "communication"].includes(String(tail[0]))) return stepPath;
    return [...stepPath, ...tail];
  }
  if (field === "basisRefs") return owner.length ? owner : container.mode === "adjudication" ? ["steps"] : ["decision", "basisRefs", ...remaining.slice(1)];
  return owner;
}

function decodeResult(value: unknown, layout: ResultLayout | undefined, path: ProposalDiagnosticPath): unknown {
  if (!layout || !isPlainRecord(value) || (Object.keys(value).length === 1 && value.kind === "none")) return value;
  rejectOwned(value, Object.keys(layout), path);
  if (!Array.isArray(value.entries)) fail(value.entries === undefined ? "FIELD_MISSING" : "TYPE_MISMATCH",
    "filling:complete-result-entries-required", [...path, "entries"], { type: "array", required: true }, value.entries);
  const { entries, ...content } = value;
  const collections = Object.fromEntries(Object.keys(layout).map(key => [key, [] as unknown[]]));
  // Every entry of the row is read; each that this form cannot take is
  // reported, together, at its own position.
  const problems: ProposalDiagnostic[] = [];
  for (const [index, record] of entries.entries()) {
    if (!isPlainRecord(record)) {
      problems.push(proposalDiagnostic("TYPE_MISMATCH", "filling:result-entry-object-required", { path: [...path, "entries", index], pathBase: "arguments", expected: { type: "object" }, actual: diagnosticActual(record) }));
      continue;
    }
    const { recordKind, ...payload } = record;
    if (typeof recordKind !== "string" || !Object.hasOwn(layout, recordKind)) {
      problems.push(proposalDiagnostic(recordKind === undefined ? "FIELD_MISSING" : typeof recordKind !== "string" ? "TYPE_MISMATCH" : "VALUE_INVALID",
        "filling:result-kind-for-form", { path: [...path, "entries", index, "recordKind"], pathBase: "arguments", expected: { enum: Object.keys(layout) }, actual: diagnosticActual(recordKind) }));
      continue;
    }
    collections[recordKind].push(payload);
  }
  if (problems.length > 0) throw new ProposalFillingError(problems);
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

/** The basis a ruling derives from its steps: the distinct existing (non-prospective) refs, sorted. */
function rulingBasis(refs: readonly unknown[]): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === "string" && !ref.startsWith("prospective:")))].sort();
}

function sameRefs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ref, index) => ref === b[index]);
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
