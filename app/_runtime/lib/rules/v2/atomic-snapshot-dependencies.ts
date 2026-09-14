import type { AtomicWorldInteractionStep, AtomicWorldInteractionRulesInput } from "./world-interaction-model";
import type { NpcDecisionContext } from "./npc-decision-context";
import { authoredWorldFactConform } from "./world-facts";
import { materializedSemanticDefinition } from "./semantic-definitions";

type Read = Readonly<{ ref: string; revision?: string; acceptsInventoryPrefix?: boolean }>;
type Snapshot = Readonly<{ reads: readonly Read[]; npc?: NpcDecisionContext; listenerScene?: string }>;
type Outcome = "success" | "failure";
type Write = Readonly<
  | { kind: "ref"; ref: string; toRevision?: string }
  | { kind: "knowledge" | "continuity" | "entity"; subject: string }
  | { kind: "listeners"; scene: string }
  | { kind: "timeline"; inventoryPrefix: boolean }
  | { kind: "visibleFact"; policy: string; subjects: readonly string[] }
  | { kind: "sceneFactWithoutLocationBinding" }
  | { kind: "narrativeBinding"; sourceRef: string }
  | { kind: "nativeTargets"; refs: readonly string[] | null }
>;

/** SPEC 0016 §7: execution snapshots read a particular state version, unlike
 * ordinary optimistic readSets (which bind the transaction's source). A writer
 * that replaces a read version must follow its reader; a producer of the read
 * version must precede it. Existing typed prefix contracts can also prove
 * consumption of a new version. No state is
 * executed, refreshed or searched for an order here.
 *
 * These are additional edges, shared by lowering, canonical-plan validation
 * and Rules compilation. Produces/consumes, costs and branch/check dependencies
 * retain their own contracts. In particular formNpcActorPlan premises are
 * source reads, not an execution-time NPC snapshot.
 */
export function atomicSnapshotDependencies(steps: readonly AtomicWorldInteractionStep[]): ReadonlyMap<string, readonly string[]> {
  const dependencies = new Map(steps.map(step => [step.proposalRef, new Set<string>()]));
  const outcomes: Outcome[] = steps.some(step => step.ruling === "check") ? ["success", "failure"] : ["success"];
  // Conditions select which typed effects coexist. Derive each branch's
  // constraints before joining them into the one frozen execution order.
  for (const outcome of outcomes) {
    const reachable = steps.filter(step => step.outcomeBinding === "always"
      || step.outcomeBinding === (outcome === "success" ? "onSuccess" : "onFailure"));
    const readers = reachable.map(step => ({ step, snapshot: executionSnapshot(step.rulesInput, outcome) }));
    for (const writer of reachable) {
      const writes = possibleWrites(writer.rulesInput, outcome);
      for (const { step: reader, snapshot } of readers) {
        if (!snapshot || reader.proposalRef === writer.proposalRef) continue;
        const extended = consumesKnowledgeVersion(reader, writer);
        for (const write of writes) {
          if (!conflicts(snapshot, write) || extended && (write.kind === "knowledge" || write.kind === "visibleFact")) continue;
          if (write.kind === "ref") {
            // A composed mechanic may explicitly read the version produced by
            // an authored prelude (completeObject). That is a forward version
            // dependency, not a read of the old transaction-source version.
            // Check every read: one matching version cannot excuse another
            // read of the old version in the same frozen decision.
            for (const read of snapshot.reads.filter(read => read.ref === write.ref)) {
              if (write.toRevision !== undefined && read.revision === write.toRevision)
                dependencies.get(reader.proposalRef)!.add(writer.proposalRef);
              else dependencies.get(writer.proposalRef)!.add(reader.proposalRef);
            }
          } else dependencies.get(writer.proposalRef)!.add(reader.proposalRef);
        }
      }
    }
  }
  return new Map([...dependencies].map(([ref, refs]) => [ref, [...refs].sort()]));
}

function executionSnapshot(input: AtomicWorldInteractionRulesInput, outcome: Outcome): Snapshot | undefined {
  if (input.kind === "resolveWorldInteraction" && input.plan.social) {
    const social = input.plan.social;
    return {
      npc: social.npcContext,
      // rebindFrozenSocialPrefix proves inventory changes to the actor and
      // timeline. It does not authorize changes to the NPC's decision domain.
      reads: [
        { ref: input.actorCharacterId, acceptsInventoryPrefix: true },
        ...social.npcContext.records.map(record => ({ ref: record.ref,
          ...(record.kind === "timeline" ? { acceptsInventoryPrefix: true } : {}) })),
        ...social.npcContext.knowledge.map(record => ({ ref: record.entryRef })),
        ...social.listeners.filter(ref => ref !== input.actorCharacterId && ref !== social.npcRef).map(ref => ({ ref })),
      ],
      ...(social.audience === "sceneListeners" ? { listenerScene: input.plan.sceneRef } : {}),
    };
  }
  // A composed revision freezes its base. It cannot silently use a preceding
  // step's different definition, even though ordinary readSets can rebind.
  if (input.kind === "reviseSemanticDefinition") return { reads: [{ ref: input.plan.definitionRef, revision: input.plan.baseRevision }] };
  if (input.kind === "resolveWorldInteraction") {
    const branch = input.plan.branches[input.plan.ruling.kind === "check" ? outcome : "success"];
    const reads = branch.effects.flatMap(effect =>
      effect.kind === "definitionRevision" || effect.kind === "relationTransition"
        ? [{ ref: effect.nextDefinition.definitionId, revision: (BigInt(effect.nextDefinition.revision) - 1n).toString() }] : []);
    if (reads.length) return { reads };
  }
  return undefined;
}

/** A may-write description of each registered command, not a second effect
 * interpreter. Native mechanics with dynamic/area targets conservatively
 * overlap creature snapshots; their actual permission and effects remain in
 * the native Rules preflight. Adding a command requires extending this switch.
 */
function possibleWrites(input: AtomicWorldInteractionRulesInput, outcome: Outcome): Write[] {
  switch (input.kind) {
    case "materializeSemanticDefinition": {
      const plan = input.plan, definition = materializedSemanticDefinition(input.rootActionId, plan);
      const writes: Write[] = [{ kind: "ref", ref: definition.definitionRef, toRevision: definition.definition.revision }, ...narrativeBindings(plan.sourceRefs)];
      if (plan.semanticKind === "worldFact" && authoredWorldFactConform(plan.content.worldFact)) {
        writes.push({ kind: "visibleFact", policy: plan.visibilityPolicyRef, subjects: plan.content.worldFact.subjectRefs },
          ...plan.content.worldFact.initialKnowledge.map(value => ({ kind: "knowledge" as const, subject: value.holderRef })));
      }
      if (plan.semanticKind === "location" && typeof plan.content.sceneRef === "string")
        writes.push({ kind: "ref", ref: plan.content.sceneRef });
      return writes;
    }
    case "admitStoryFacts": {
      const bound = new Map(input.plan.bindings.map(binding => [binding.ref, binding.authorityRef]));
      return input.plan.facts.flatMap(fact => fact.knowledge.map(knowledge =>
        ({ kind: "knowledge" as const, subject: bound.get(knowledge.holderRef) ?? knowledge.holderRef })));
    }
    case "materializeNpc": return [{ kind: "listeners", scene: input.plan.sceneRef }];
    case "materializeDefinition": return [];
    case "materializeItem":
      // These create fresh definitions/unheld entries, not an existing
      // creature/decision record. Their consumers are bound by handles.
      return narrativeBindings(input.plan.sourceRefs);
    case "reviseSemanticDefinition": return [{ kind: "ref", ref: input.plan.definitionRef,
      toRevision: (BigInt(input.plan.baseRevision) + 1n).toString() }];
    case "formNpcActorPlan": return [
      { kind: "continuity", subject: input.plan.source.npcRef },
      { kind: "entity", subject: input.plan.source.npcRef },
      // Its trace is visible in the NPC's scene. The plan does not carry a
      // scene binding, so its new visible record cannot be assumed disjoint.
      { kind: "sceneFactWithoutLocationBinding" },
    ];
    case "commitNarrativeDetail": return [{ kind: "visibleFact",
      policy: input.plan.audience === "sceneObservers" ? "visibility:scene-observers" : `visibility:knowledge-holder:${input.actorCharacterId}`,
      subjects: [input.plan.sceneRef] }];
    case "performAbilityOperation": return [
      { kind: "entity", subject: input.actorCharacterId },
      { kind: "timeline", inventoryPrefix: false },
      { kind: "nativeTargets", refs: input.plan.operation.kind === "invoke" && input.plan.operation.target.kind === "creatures"
        ? input.plan.operation.target.refs : null },
    ];
    case "inventoryOperation": {
      const operation = input.plan.operation;
      const writes: Write[] = [{ kind: "timeline", inventoryPrefix: true }];
      // Actor changes have the same proved prefix exception as elapsed time.
      // NPC target changes never have that exception.
      if (operation.kind === "transfer") writes.push({ kind: "entity", subject: operation.targetCharacterRef });
      if (operation.kind === "identify") writes.push({ kind: "knowledge", subject: input.actorCharacterId });
      if (operation.kind === "use") writes.push({ kind: "nativeTargets", refs: operation.area ? null : operation.targetRefs });
      return writes;
    }
    case "resolveWorldInteraction": {
      const plan = input.plan, writes: Write[] = [];
      const branch = plan.branches[plan.ruling.kind === "check" ? outcome : "success"];
      writes.push(...branch.sensoryEvidence.map(evidence => ({ kind: "knowledge" as const, subject: evidence.observerRef })));
      for (const effect of branch.effects) {
        switch (effect.kind) {
          case "definitionRevision":
          case "relationTransition": writes.push({ kind: "ref", ref: effect.nextDefinition.definitionId, toRevision: effect.nextDefinition.revision }); break;
          case "traversePassage": writes.push({ kind: "entity", subject: input.actorCharacterId },
            { kind: "timeline", inventoryPrefix: false }, { kind: "nativeTargets", refs: null }); break;
          case "registeredHazard": writes.push({ kind: "nativeTargets", refs: null }); break;
        }
      }
      if (plan.observation) writes.push({ kind: "knowledge", subject: input.actorCharacterId });
      if (plan.social) {
        writes.push(...plan.social.listeners.map(subject => ({ kind: "knowledge" as const, subject })),
          { kind: "continuity", subject: plan.social.npcRef }, { kind: "continuity", subject: input.actorCharacterId });
      }
      return writes;
    }
    default: { const exhaustive: never = input; return exhaustive; }
  }
}

function conflicts(snapshot: Snapshot, write: Write): boolean {
  const npc = snapshot.npc, reads = snapshot.reads;
  switch (write.kind) {
    case "ref": return reads.some(read => read.ref === write.ref);
    case "entity": return reads.some(read => read.ref === write.subject);
    case "knowledge": return reads.some(read => read.ref === `knowledge-catalog:${write.subject}`);
    case "continuity": return npc?.npcRef === write.subject;
    case "narrativeBinding": return npc?.records.some(record => record.kind === "fact" && record.ref === write.sourceRef) ?? false;
    case "sceneFactWithoutLocationBinding": return npc !== undefined;
    case "listeners": return snapshot.listenerScene === write.scene;
    case "timeline": return reads.some(read => read.ref.startsWith("character-timeline:")
      && !(write.inventoryPrefix && read.acceptsInventoryPrefix));
    case "nativeTargets": return reads.some(read => !read.acceptsInventoryPrefix
      && (write.refs === null ? read.ref === npc?.npcRef : write.refs.includes(read.ref)));
    case "visibleFact": {
      if (!npc) return false;
      const scene = npc.records.find(record => record.kind === "scene")?.ref;
      return write.policy.startsWith("visibility:public")
        || write.policy === `visibility:knowledge-holder:${npc.npcRef}`
        || ["visibility:scene-observers", "visibility:channel-participants"].includes(write.policy)
          && (write.subjects.includes(npc.npcRef) || scene !== undefined && write.subjects.includes(scene));
    }
  }
}

function narrativeBindings(refs: readonly string[]): Write[] {
  return refs.filter(ref => ref.startsWith("narrative-detail:")).map(sourceRef => ({ kind: "narrativeBinding", sourceRef }));
}

function consumesKnowledgeVersion(reader: AtomicWorldInteractionStep, writer: AtomicWorldInteractionStep): boolean {
  const input = reader.rulesInput, producer = writer.rulesInput;
  if (input.kind !== "resolveWorldInteraction" || !input.plan.social
    || producer.kind !== "materializeSemanticDefinition" || producer.plan.semanticKind !== "worldFact"
    || writer.outcomeBinding !== "always" || !reader.consumes.some(consume => consume.kind === "prospective"
      && writer.produces.some(produced => produced.handle === consume.handle))) return false;
  const definitionRef = materializedSemanticDefinition(producer.rootActionId, producer.plan).definitionRef;
  return Object.values(input.plan.social.branches).some(branch => branch.response.basis.some(source =>
    source.kind === "materializedKnowledge" && source.holderRef === input.plan.social!.npcRef
      && (source.definitionRef === definitionRef || source.definitionRef === producer.plan.handle)));
}
