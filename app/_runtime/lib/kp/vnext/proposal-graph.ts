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
  VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
  VNEXT_WORLD_INTERACTION_FORM_ID,
} from "./proposal-schema";

export type BundleGraphResult =
  | Readonly<{ kind: "accepted"; plan: VNextDerivedBundlePlan }>
  | Readonly<{ kind: "rejected"; issues: readonly string[] }>;

/** Dependency-only conformance used before context-bound lowering. */
export function validateVNextProposalBundleDependencies(
  entries: readonly VNextProposalBundleEntry[],
): readonly string[] {
  const issues: string[] = [];
  const producers = new Map<string, VNextBundleProducedReference>();
  for (const entry of entries) {
    for (const produced of entry.produces) {
      if (producers.has(produced.handle)) {
        issues.push(`bundle:prospective-producer-duplicate:${produced.handle}`);
      } else {
        producers.set(produced.handle, produced);
      }
    }
  }
  const edges = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    const dependencies: number[] = [];
    const declared = new Set(entry.consumes.flatMap((consume) =>
      consume.kind === "prospective" ? [consume.handle] : []));
    const referenced = new Set(prospectiveHandles(entry));
    for (const handle of referenced) {
      if (!declared.has(handle)) {
        issues.push(`bundle:prospective-consumer-not-declared:${handle}`);
      }
    }
    for (const handle of declared) {
      if (!referenced.has(handle)) {
        issues.push(`bundle:prospective-consume-unused:${handle}`);
      }
    }
    for (const consume of entry.consumes) {
      if (consume.kind !== "prospective") continue;
      const producer = producers.get(consume.handle);
      if (producer === undefined) {
        issues.push(`bundle:prospective-consumer-unbound:${consume.handle}`);
        continue;
      }
      if (!outcomeDominates(producer.outcomeBinding, entry.outcomeBinding)) {
        issues.push(`bundle:prospective-condition-not-dominated:${consume.handle}`);
      }
      const producerIndex = entries.findIndex((candidate) =>
        candidate.produces.some((produced) => produced.handle === consume.handle));
      if (producerIndex >= 0) dependencies.push(producerIndex);
    }
    edges.set(index, dependencies);
  });
  if (hasCycle(edges, entries.length)) issues.push("bundle:dependency-cycle");
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
  const interactions = entries.filter(({ entry }) => entry.kind === "worldInteraction");
  if (interactions.length !== 1 || interactions[0]?.entry.outcomeBinding !== "always") {
    return "invalid";
  }
  return interactions[0].entryRef;
}

function prospectiveHandles(entry: VNextProposalBundleEntry): readonly string[] {
  const refs: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("prospective:")) refs.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value as Record<string, unknown>)) collect(child);
    }
  };
  collect(entry.basisRefs);
  // The `consumes` list itself is authoritative and is not scanned as a
  // payload; scan only schema-defined reference slots. Narrative text remains
  // opaque even when it is byte-identical to a local handle.
  if (entry.kind === "worldInteraction") {
    collect(entry.sceneRef);
    collect(entry.targetRefs);
    collect(entry.directTargetRefs);
    collect(entry.instrumentRefs);
    collect(entry.abilityRef);
    for (const branch of [entry.branches.success, entry.branches.failure]) {
      if (branch === null) continue;
      for (const effect of branch.effects) {
        if (effect.kind === "relationTransition") collect(effect.relationRef);
        else if (effect.kind === "definitionRevision") {
          collect(effect.definitionRef);
          for (const operation of effect.operations) {
            if (operation.kind === "removeByRef") collect(operation.ref);
            else if (operation.kind === "upsertByRef") {
              collect("goalRef" in operation.entry
                ? operation.entry.goalRef
                : operation.entry.planRef);
            }
          }
        } else {
          collect(effect.sourceDefinitionRef);
          collect(effect.zoneRef);
        }
      }
      for (const evidence of branch.sensoryEvidence) {
        collect(evidence.observerRef);
        collect(evidence.subjectRef);
        collect(evidence.basisRefs);
      }
      for (const pressure of branch.pressures) {
        collect(pressure.sourceRef);
        collect(pressure.basisRefs);
      }
      for (const opportunity of branch.opportunities) {
        collect(opportunity.targetRef);
        collect(opportunity.basisRefs);
      }
    }
  } else if (entry.kind === "reviseSemanticDefinition") {
    collect(entry.definitionRef);
    collect(entry.npcRef);
    collect(entry.templateRef);
    for (const operation of entry.operations) {
      if (operation.kind === "removeByRef") collect(operation.ref);
      else if (operation.kind === "upsertByRef") {
        collect("goalRef" in operation.entry
          ? operation.entry.goalRef
          : operation.entry.planRef);
      }
    }
  } else {
    collect(entry.templateRef);
    collect(entry.visibilityPolicyRef);
    collect(entry.definition.sceneRef);
    collect(entry.definition.visibilityFactId);
    collect(entry.definition.mechanicDefinitionRefs);
  }
  return [...new Set(refs)].sort(compareCodeUnits);
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

function rejected(issues: readonly string[]): BundleGraphResult {
  return Object.freeze({
    kind: "rejected",
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
  });
}
