import { proposalProspectiveHandles as prospectiveHandles } from "./proposal-reference-slots";
import { diagnosticActual, diagnosticsFromIssues, proposalDiagnostic, type ProposalDiagnostic, type ProposalDiagnosticPath } from "./proposal-diagnostics";
import { vnextSharedCheckOwnerOrdinal } from "./proposal-check-owner";
import {
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
} from "./canonical-json";
import { normalizedProspectiveRef } from "../../rules/authority-read";
import type {
  VNextAdjudicationBundle,
  VNextBundleFormId,
  VNextBundleProducedReference,
  VNextBundleReference,
  VNextDerivedBundleEntry,
  VNextDerivedBundlePlan,
  VNextOutcomeBinding,
  VNextProposalBundleEntry,
} from "./proposal-schema";
import {
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_INVENTORY_OPERATION_FORM_ID,
  VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  VNEXT_OBSERVE_FORM_ID,
  VNEXT_SOCIAL_FORM_ID,
  VNEXT_OBJECTIVE_CONTINUITY_FORM_ID,
} from "./proposal-schema";

export type BundleGraphResult =
  | Readonly<{ kind: "accepted"; plan: VNextDerivedBundlePlan }>
  | Readonly<{ kind: "rejected"; issues: readonly string[]; diagnostics: readonly ProposalDiagnostic[] }>;

/** Dependency-only conformance used before context-bound lowering. */
export function validateVNextProposalBundleDependencies(
  entries: readonly VNextProposalBundleEntry[],
  diagnostics?: ProposalDiagnostic[],
): readonly string[] {
  const issues: string[] = [];
  const add = (issue: string, diagnostic: ProposalDiagnostic) => {
    issues.push(issue);
    diagnostics?.push(diagnostic);
  };
  const producers = new Map<string, VNextBundleProducedReference>();
  entries.forEach((entry, entryIndex) => {
    entry.produces.forEach((produced, producedIndex) => {
      if (producers.has(produced.handle)) {
        add(`bundle:prospective-producer-duplicate:${produced.handle}`,
          proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:prospective-producer-duplicate", {
            path: ["proposals", entryIndex, "produces", producedIndex, "handle"],
            expected: { producersPerHandle: 1 }, actual: diagnosticActual(produced.handle),
          }));
      } else {
        producers.set(produced.handle, produced);
      }
    });
  });
  const edges = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    const dependencies: number[] = [];
    const declared = new Set(entry.consumes.flatMap((consume) =>
      consume.kind === "prospective" ? [consume.handle] : []));
    const referenced = new Set(prospectiveHandles(entry));
    for (const handle of referenced) {
      if (!declared.has(handle)) {
        add(`bundle:prospective-consumer-not-declared:${handle}`,
          proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:prospective-consumer-not-declared", {
            path: ["proposals", index, "consumes"], expected: { declaration: { kind: "prospective", handle } },
          }));
      }
    }
    for (const handle of declared) {
      if (!referenced.has(handle)) {
        add(`bundle:prospective-consume-unused:${handle}`,
          proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:prospective-consume-unused", {
            path: ["proposals", index, "consumes", entry.consumes.findIndex(consume => consume.kind === "prospective" && consume.handle === handle), "handle"],
            expected: { referencedByPayload: true }, actual: diagnosticActual(handle),
          }));
      }
    }
    for (const [ref, expected, path] of typedProducedRequirements(entry)) {
      if (ref.startsWith("prospective:") && producers.get(ref)?.kind !== expected) {
        add(`bundle:prospective-type-mismatch:${ref}:${expected}`,
          proposalDiagnostic(producers.has(ref) ? "CONSTRAINT_CONFLICT" : "REFERENCE_UNAVAILABLE", "bundle:prospective-type-mismatch", {
            path: ["proposals", index, ...path], expected: { producerKind: expected },
            actual: { ref, ...(producers.has(ref) ? { producerKind: producers.get(ref)!.kind } : { producer: "not-declared" }) },
          }));
      }
    }
    for (const [consumeIndex, consume] of entry.consumes.entries()) {
      if (consume.kind !== "prospective") continue;
      const producer = producers.get(consume.handle);
      if (producer === undefined) {
        add(`bundle:prospective-consumer-unbound:${consume.handle}`,
          proposalDiagnostic("REFERENCE_UNAVAILABLE", "bundle:prospective-consumer-unbound", {
            path: ["proposals", index, "consumes", consumeIndex, "handle"],
            expected: { producerInBundle: true }, actual: diagnosticActual(consume.handle),
          }));
        continue;
      }
      if (!outcomeDominates(producer.outcomeBinding, entry.outcomeBinding)) {
        add(`bundle:prospective-condition-not-dominated:${consume.handle}`,
          proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:prospective-condition-not-dominated", {
            path: ["proposals", index, "consumes", consumeIndex, "handle"],
            expected: { producerOutcomeBinding: ["always", entry.outcomeBinding] },
            actual: { handle: consume.handle, producerOutcomeBinding: producer.outcomeBinding, consumerOutcomeBinding: entry.outcomeBinding },
          }));
      }
      const producerIndex = entries.findIndex((candidate) =>
        candidate.produces.some((produced) => produced.handle === consume.handle));
      if (producerIndex >= 0) dependencies.push(producerIndex);
    }
    edges.set(index, dependencies);
  });
  if (hasCycle(edges, entries.length)) add("bundle:dependency-cycle",
    proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:dependency-cycle", {
      path: ["proposals"], expected: { dependencyGraph: "acyclic" },
      actual: { dependencies: [...edges].map(([ordinal, dependsOn]) => ({ ordinal, dependsOn })) },
    }));
  return Object.freeze([...new Set(issues)].sort(compareCodeUnits));
}

/**
 * Validates and lowers only the server-derived dependency graph.  It never
 * calls Rules, changes state, or creates a speculative projection.
 */
export function deriveVNextProposalBundlePlan(input: Readonly<{
  bundle: VNextAdjudicationBundle;
  rootActionId: string;
  actorCharacterId: string;
  contextHash: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  /** Required for a Bundle nested under a clarification choice. */
  derivationScope?: string;
}>): BundleGraphResult {
  const dependencyDiagnostics: ProposalDiagnostic[] = [];
  const dependencyIssues = validateVNextProposalBundleDependencies(input.bundle.proposals, dependencyDiagnostics);
  if (dependencyIssues.length > 0) return rejected(dependencyIssues, dependencyDiagnostics);
  const bundleHash = canonicalHash(input.bundle);
  if (input.derivationScope !== undefined
    && (input.derivationScope.length < 1
      || input.derivationScope.length > 500
      || input.derivationScope.trim() !== input.derivationScope
      || input.derivationScope.normalize("NFC") !== input.derivationScope)) {
    return rejected(["bundle:derivation-scope-invalid"]);
  }
  const derivationScope = input.derivationScope ?? null;
  const referenceNamespaceHash = derivationScope === null
    ? bundleHash
    : canonicalHash({
        schema: "zhuwei.kp-proposal-reference-namespace/vnext-1",
        bundleHash,
        derivationScope,
      });
  const entries = input.bundle.proposals;
  const producerByHandle = new Map<string, {
    entry: VNextProposalBundleEntry;
    produced: VNextBundleProducedReference;
    ordinal: number;
  }>();
  const issues: string[] = [];

  entries.forEach((entry, ordinal) => {
    for (const produced of entry.produces) {
      if (producerByHandle.has(produced.handle)) {
        issues.push(`bundle:prospective-producer-duplicate:${produced.handle}`);
      } else {
        producerByHandle.set(produced.handle, { entry, produced, ordinal });
      }
    }
  });

  const entryRefs = entries.map((entry, ordinal) => ({
    entry,
    ordinal,
    entryRef: deriveEntryRef(
      input.rootActionId,
      input.contextHash,
      referenceNamespaceHash,
      ordinal,
      entry.kind,
    ),
  }));
  const sharedCheckEntryRef = sharedCheckOwner(input.bundle, entryRefs);
  if (sharedCheckEntryRef === "invalid") {
    return rejected(["bundle:shared-check-world-interaction-required"]);
  }
  const edges = new Map<string, string[]>();
  for (const current of entryRefs) {
    const dependencies: string[] = [];
    const declaredProspective = new Set(
      current.entry.consumes
        .filter((consume): consume is Extract<VNextBundleReference, { kind: "prospective" }> =>
          consume.kind === "prospective")
        .map((consume) => consume.handle),
    );
    const referencedProspective = new Set(prospectiveHandles(current.entry));
    for (const handle of referencedProspective) {
      if (!declaredProspective.has(handle)) {
        issues.push(`bundle:prospective-consumer-not-declared:${handle}`);
      }
    }
    for (const handle of declaredProspective) {
      if (!referencedProspective.has(handle)) {
        issues.push(`bundle:prospective-consume-unused:${handle}`);
      }
    }
    for (const consume of current.entry.consumes) {
      if (consume.kind !== "prospective") continue;
      const producer = producerByHandle.get(consume.handle);
      if (producer === undefined) {
        issues.push(`bundle:prospective-consumer-unbound:${consume.handle}`);
        continue;
      }
      if (!outcomeDominates(producer.produced.outcomeBinding, current.entry.outcomeBinding)) {
        issues.push(`bundle:prospective-condition-not-dominated:${consume.handle}`);
      }
      const producerRef = entryRefs[producer.ordinal]?.entryRef;
      if (producerRef === undefined) {
        issues.push(`bundle:prospective-producer-unbound:${consume.handle}`);
      } else {
        dependencies.push(producerRef);
      }
    }
    if (sharedCheckEntryRef !== null
      && current.entry.outcomeBinding !== "always"
      && current.entryRef !== sharedCheckEntryRef) {
      dependencies.push(sharedCheckEntryRef);
    }
    edges.set(current.entryRef, [...new Set(dependencies)].sort(compareCodeUnits));
  }

  if (issues.length > 0) return rejected(issues);
  const executionOrder = topologicalOrder(entryRefs.map(({ entryRef }) => entryRef), edges);
  if (executionOrder === undefined) return rejected(["bundle:dependency-cycle"]);

  const derivedEntries = entryRefs.map(({ entry, ordinal, entryRef }) => ({
    entryRef,
    formId: formIdForKind(entry.kind),
    kind: entry.kind,
    ordinal,
    outcomeBinding: entry.outcomeBinding,
    consumes: entry.consumes.map((consume) => consume.kind === "existing"
      ? { kind: "existing" as const, ref: consume.ref }
      : { kind: "prospective" as const, handle: consume.handle }),
    produces: entry.produces.map((produced) => ({
      handle: produced.handle,
      prospectiveRef: prospectiveRef(
        input.rootActionId,
        referenceNamespaceHash,
        produced.handle,
      ),
      kind: produced.kind,
      outcomeBinding: produced.outcomeBinding,
    })),
  })) as VNextDerivedBundleEntry[];

  return Object.freeze({
    kind: "accepted",
    plan: deepFreeze({
      schema: VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
      bundleHash,
      derivationScope,
      referenceNamespaceHash,
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      contextHash: input.contextHash,
      readSet: input.readSet.map((entry) => ({ ...entry })),
      entries: derivedEntries,
      executionOrder,
      sharedCheckEntryRef,
      adjudication: input.bundle.adjudication,
    }),
  });
}

function hasCycle(edges: ReadonlyMap<number, readonly number[]>, count: number): boolean {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) if (visit(dependency)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (let index = 0; index < count; index += 1) if (visit(index)) return true;
  return false;
}

export function formIdForKind(
  kind: VNextProposalBundleEntry["kind"],
): Exclude<VNextBundleFormId, "clarification.vnext-1" | "in-world-refusal.vnext-1"> {
  if (kind === "formActorPlan") return VNEXT_OBJECTIVE_CONTINUITY_FORM_ID;
  if (kind === "social") return VNEXT_SOCIAL_FORM_ID;
  if (kind === "observe") return VNEXT_OBSERVE_FORM_ID;
  if (kind === "inventoryOperation") return VNEXT_INVENTORY_OPERATION_FORM_ID;
  return kind === "worldInteraction"
    ? VNEXT_WORLD_INTERACTION_FORM_ID
    : VNEXT_MATERIALIZATION_FORM_ID;
}

export function deriveEntryRef(
  rootActionId: string,
  contextHash: string,
  referenceNamespaceHash: string,
  ordinal: number,
  kind: VNextProposalBundleEntry["kind"],
): string {
  const digest = canonicalHash({
    schema: VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
    rootActionId,
    contextHash,
    referenceNamespaceHash,
    ordinal,
    kind,
  }).slice("sha256:".length, "sha256:".length + 32);
  return `proposal:${digest}`;
}

export function prospectiveRef(
  rootActionId: string,
  bundleHash: string,
  handle: string,
): string {
  return normalizedProspectiveRef(rootActionId, bundleHash, handle);
}

function sharedCheckOwner(
  bundle: VNextAdjudicationBundle,
  entries: readonly Readonly<{
    entry: VNextProposalBundleEntry;
    entryRef: string;
  }>[],
): string | null | "invalid" {
  const requiresCheck = bundle.adjudication.kind === "check"
    || (bundle.adjudication.kind === "highRisk" && bundle.adjudication.check !== null);
  if (!requiresCheck) return null;
  const ordinal = vnextSharedCheckOwnerOrdinal(entries.map(({ entry }) => entry));
  return ordinal === undefined ? "invalid" : entries[ordinal].entryRef;
}

function outcomeDominates(
  producer: VNextOutcomeBinding,
  consumer: VNextOutcomeBinding,
): boolean {
  return producer === "always" || producer === consumer;
}

function topologicalOrder(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return false;
    if (visited.has(node)) return true;
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(node);
    visited.add(node);
    result.push(node);
    return true;
  };
  for (const node of nodes) if (!visit(node)) return undefined;
  return Object.freeze(result);
}

function rejected(issues: readonly string[], diagnostics = diagnosticsFromIssues("BUNDLE_DEPENDENCY_INVALID", issues)): BundleGraphResult {
  return Object.freeze({
    kind: "rejected",
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
    diagnostics: deepFreeze([...diagnostics]),
  });
}

function typedProducedRequirements(entry: VNextProposalBundleEntry): Array<[string, VNextBundleProducedReference["kind"], ProposalDiagnosticPath]> {
  const result: Array<[string, VNextBundleProducedReference["kind"], ProposalDiagnosticPath]> = [];
  if (entry.kind === "materializeNpc") {
    entry.source.mechanicalTemplate.intrinsicAbilityRefs.forEach((ref, i) => result.push([ref, "abilityDefinition", ["source", "mechanicalTemplate", "intrinsicAbilityRefs", i]]));
    entry.source.mechanicalTemplate.itemDefinitionRefs.forEach((ref, i) => result.push([ref, "itemDefinition", ["source", "mechanicalTemplate", "itemDefinitionRefs", i]]));
  } else if (entry.kind === "materializeDefinition") {
    if (entry.source.kind === "hazard") result.push([String(entry.source.content.mechanicsRef), "abilityDefinition", ["source", "content", "mechanicsRef"]]);
    if (entry.source.kind === "item") {
      for (const [index, ref] of entry.source.content.equippedAbilityRefs.entries()) result.push([ref, "abilityDefinition", ["source", "content", "equippedAbilityRefs", index]]);
      if (entry.source.content.use) result.push([entry.source.content.use.abilityRef, "abilityDefinition", ["source", "content", "use", "abilityRef"]]);
      if (entry.source.content.equipment?.weapon?.ammunitionDefinitionRef) result.push([entry.source.content.equipment.weapon.ammunitionDefinitionRef, "itemDefinition", ["source", "content", "equipment", "weapon", "ammunitionDefinitionRef"]]);
    }
    if (entry.source.kind === "ability" && Array.isArray(entry.source.content.costs)) {
      for (const [index, cost] of entry.source.content.costs.entries()) if (cost && typeof cost === "object" && !Array.isArray(cost)
        && cost.kind === "item") result.push([String(cost.resourceId), "itemEntry", ["source", "content", "costs", index, "resourceId"]]);
    }
  } else if (entry.kind === "materializeItem") result.push([entry.definitionRef, "itemDefinition", ["definitionRef"]]);
  else if (entry.kind === "inventoryOperation") {
    if (entry.operation.kind === "assemble") entry.operation.components.forEach((component, index) => result.push([component.entryRef, "itemEntry", ["operation", "components", index, "entryRef"]]));
    else if (entry.operation.kind !== "disassemble") result.push([entry.operation.entryRef, "itemEntry", ["operation", "entryRef"]]);
  }
  else if (entry.kind === "worldInteraction") {
    if (entry.abilityRef) result.push([entry.abilityRef, "abilityDefinition", ["abilityRef"]]);
    for (const key of ["success", "failure"] as const) for (const [index, effect] of (entry.branches[key]?.effects ?? []).entries()) {
      if (effect.kind === "registeredHazard" && effect.damage.kind === "authored") result.push([effect.damage.hazardDefinitionRef, "hazardDefinition", ["branches", key, "effects", index, "damage", "hazardDefinitionRef"]]);
    }
  }
  return result;
}
