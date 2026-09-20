/**
 * The Rules shape vocabulary: the second recognized public Interface.
 *
 * SPEC 0003 makes Rules a deep module whose Interface is `step` / `project` /
 * `replay`, and everything under `v2/` is private implementation. In practice
 * KP and Room also need to know **what a legal shape looks like** -- whether a
 * value is a well-formed plan, which strings a closed set admits, what a
 * strict-tool schema for one should say. That question is not a second way to
 * change state, and answering it through `step` is not possible: the caller
 * has to build the input before it can be stepped.
 *
 * User ruling of 2026-09-20 (ADR 0036) publishes that vocabulary here rather
 * than leaving 35 imports reaching into `v2/` for it. The line is narrow and
 * `tools/check-modules.mjs` enforces it:
 *
 *   allowed here   type guards (`isX` / `matchesX`), frozen vocabulary sets
 *                  and schema constants, and their types
 *   still private  anything that constructs, compiles, composes or reads
 *                  authoritative state -- `createVersionedRulesRuntime`,
 *                  `composeDefinition`, `compileAtomicWorldInteractionPlan`,
 *                  `authorityEntityComposite`, `hashWorldState`
 *
 * This file re-exports and nothing else. Knowing a shape is legal is not
 * permission to act on it: Rules revalidates every input it is given.
 */

export { ABILITY_OPERATION_SOURCE_SCHEMA, isAbilityOperation } from "./v2/ability-operation";
export { isAtomicWorldContinuation } from "./v2/atomic-world-input";
export { AUTHORED_ABILITY_SOURCE_SCHEMA, AUTHORED_HAZARD_CONTENT_SCHEMA, AUTHORED_ITEM_CONTENT_SCHEMA, AUTHORED_ITEM_OWNERSHIP_SCHEMA, matchesAuthoredSourceSchema } from "./v2/authored-materialization";
export type { AuthoredSourceDiagnostic, AuthoredSourceSchema } from "./v2/authored-materialization";
export { isEnvironmentHazardDefinition } from "./v2/environment-hazards";
export { FROZEN_PLAYER_CHOICE_SCHEMA, isFrozenPlayerChoiceAnswerInput, isFrozenPlayerChoicePlan } from "./v2/frozen-player-choice";
export type { FrozenPlayerChoicePlan } from "./v2/frozen-player-choice";
export { isHistoricalOrigin } from "./v2/historical-world";
export { isItemAssemblyOperation } from "./v2/item-assembly-shapes";
export { ITEM_DEFINITION_SCHEMA, ITEM_ENTRY_SCHEMA } from "./v2/items";
export { KNOWLEDGE_REVIEW_PLAN_SCHEMA } from "./v2/knowledge-review";
export { NPC_MATERIALIZATION_SOURCE_SCHEMA, isNpcMaterializationSource, isNpcMaterializedPayload } from "./v2/npc-materialization";
export { NPC_ACTOR_PLAN_FORMATION_SOURCE_SCHEMA } from "./v2/npc-plan-formation";
export type { NpcActorPlanFormationSource } from "./v2/npc-plan-formation";
export { PROMISE_DUE_TIERS } from "./v2/promise-due";
export { VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA, isSemanticDefinitionMaterializationPlan, isSemanticDefinitionMaterializedPayload } from "./v2/semantic-definitions";
export { isStoryFactBody, isStoryKnowledgeBody } from "./v2/story-facts-admission";
export { isTimePassageDuration, isTimePassagePlan } from "./v2/time-passage";
export { isSha256 } from "./v2/validation";
export { ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, IN_WORLD_ACT_FORM_IDS, isAtomicWorldInteractionStepsPlan, isSemanticDefinitionRevisionPlan, isWorldInteractionResolutionPlan } from "./v2/world-interaction-model";
export { isCanonicalAtomicWorldInteractionStepsInput } from "./v2/world-interactions";
