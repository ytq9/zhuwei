import type { AuthoritativeModuleProfile } from "../module/authoritative";
import { canonicalHash, canonicalUnits, compareCodeUnits, deepFreeze, isPlainRecord } from "../kp/vnext/canonical-json";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import { requiredContextBasisReferences } from "../kp/vnext/required-context-runtime";
import { parseAbsenceSelector } from "../kp/vnext/context/availability";
import type { AuthoritativeWorldState } from "../rules/authority-read";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import { isRegisteredAbilityRecord } from "../rules/profiles/ability-compiler";
import { authorityRevisionOrHash } from "../rules/authority-read";
import { authorityCharacterTimeline, authorityEntityComposite, authorityGeometryFeatureComposite } from "../rules/v2/authority-bindings";
import { isWorldFactPointer, worldFactDefinition } from "../rules/v2/world-facts";
import { hashWorldState } from "../rules/v2/validation";
import { worldStoryTriggerMatchesAuthority, worldStoryLibraryCatalogValid, type RoomWorldStoryTrigger } from "./story-world-event";
import type { StoryLibraryCatalog } from "./story-library-contracts";
import { STORY_LIBRARY_CATALOG_REF } from "./story-library";
import type { StoryCapabilityDescription, StoryContext, StoryContextMaterial, StoryFailureCode,
  StoryHash, StoryJson, StoryReadDependency, StoryRequest } from "./story-creation";

export type RoomStoryContextInput = Readonly<{
  /** Room-authenticated scope, never a client/model-supplied WorldState. */
  request: StoryRequest;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  moduleProfile: AuthoritativeModuleProfile;
  /** Actual host payload schemas. Their prose grants neither facts nor writes. */
  capabilityDescriptions: readonly StoryCapabilityDescription[];
  /** Canonical UTF-8 bytes / 4, not provider tokens. The final request has its own gate. */
  maxUnits: number;
}>;
export type RoomStoryContextResult =
  | Readonly<{ kind: "ready"; context: StoryContext }>
  | Readonly<{ kind: "blocked"; code: StoryFailureCode; issues: readonly string[] }>;
export type RoomWorldStoryContextInput = Omit<RoomStoryContextInput, "requiredContext"> & Readonly<{
  /** Verified and persisted by the Room around a real terminal due commit. */
  trigger: RoomWorldStoryTrigger;
  libraryCatalog: StoryLibraryCatalog;
}>;
export type RoomStoryContextValidationInput = Readonly<{
  request: StoryRequest;
  context: StoryContext;
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  moduleProfile: AuthoritativeModuleProfile;
}>;
export type RoomStoryContextValidation =
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "conflict"; changedRefs: readonly string[] }>;

const BINDING_REF = "story-context:binding";
const CAPABILITY_PREFIX = "story-context:capability:";
const MEMBERS_REF = "story-context:scope-members";
const hash = (value: unknown): StoryHash => canonicalHash(value) as StoryHash;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareCodeUnits);
const asJson = (value: unknown): StoryJson => { hash(value); return structuredClone(value) as StoryJson; };

// These are final exception guards, not retrieval cutoffs. No partial closure
// can escape if a connected graph or an authority scan exhausts them.
const MAX_VISITS = 200_000;
const MAX_RECORDS = 10_000;
type Binding = Readonly<{ actorRef: string; requestHash: StoryHash; maxUnits: number }> & (
  | Readonly<{ schema: "zhuwei.room-story-context-binding/v1"; requiredContextHash: string }>
  | Readonly<{ schema: "zhuwei.room-world-story-context-binding/v1"; triggerRef: string; triggerHash: StoryHash; libraryCatalogHash: StoryHash }>
);
type Source = { ref: string; kind: StoryContextMaterial["kind"]; value: unknown;
  subjects: readonly string[]; links: readonly string[]; required: readonly string[];
  owner?: string; category: string };
type WorldInput = Pick<RoomStoryContextInput, "request" | "state" | "profiles" | "moduleProfile" | "capabilityDescriptions">
  & Readonly<{ worldTrigger?: RoomWorldStoryTrigger; libraryCatalog?: StoryLibraryCatalog }>;

class ContextBlocked extends Error {
  constructor(readonly code: StoryFailureCode, readonly issue: string) { super(issue); }
}
const fail = (issue: string, code: StoryFailureCode = "STORY_CONTEXT_INSUFFICIENT"): never => { throw new ContextBlocked(code, issue); };

/** One private, complete authoring view. It does not project a player/NPC view,
 * pick a story, advance time, or turn proposed materials into canonical facts. */
export function buildRoomStoryContext(input: RoomStoryContextInput): RoomStoryContextResult {
  try {
    const { requiredContext: frozen, request, state } = input;
    if (!Number.isSafeInteger(input.maxUnits) || input.maxUnits <= 0) fail("budget:positive-safe-integer-required", "STORY_BUDGET_EXHAUSTED");
    const { contextHash, ...binding } = frozen.binding;
    if (hash({ ...frozen, binding }) !== contextHash || frozen.schema !== "zhuwei.adjudication-context/vnext-1") fail("trigger:frozen-context-integrity");
    if (request.source.kind !== "playerAction" || request.source.sourceId !== binding.rootActionId
      || binding.roomEpochRef !== state.runtimeEpochId || binding.stateHash !== hashWorldState(state)
      || binding.baseEventSeq !== state.version) fail("trigger:authority-snapshot-mismatch", "STORY_CONTEXT_STALE");
    const profileBindings = Object.values(input.profiles).flatMap(value => Array.isArray(value) ? value : [value])
      .map(ref => ({ profileRef: ref.profileId, profileHash: ref.profileHash }))
      .sort((a, b) => compareCodeUnits(a.profileRef, b.profileRef));
    if (hash(profileBindings) !== hash([...binding.profiles].sort((a, b) => compareCodeUnits(a.profileRef, b.profileRef)))) fail("trigger:runtime-profile-mismatch");
    const actor = state.entities[frozen.intent.actorRef];
    if (!actor || actor.kind !== "player" || actor.tenureStatus !== "active") fail("trigger:active-player-required");
    const bases = requiredContextBasisReferences(frozen);
    if (request.trigger.basisRefs.length === 0 || request.trigger.basisRefs.some(ref => bases.rejection(ref) !== undefined)) fail("trigger:authorized-read-bases-required");
    for (const entry of frozen.entries) {
      if (entry.kind === "unavailable" && entry.critical) fail(`trigger:unavailable:${entry.entryRef}`);
      if (entry.kind === "ambiguous" && entry.resolution === "clarificationRequired"
        && entry.candidates.some(candidate => [...request.scope.entityIds, ...request.scope.sceneIds].includes(candidate.ref))) fail(`trigger:ambiguous:${entry.entryRef}`);
    }
    const context = collect(input, { schema: "zhuwei.room-story-context-binding/v1", actorRef: actor.id,
      requestHash: hash(request), requiredContextHash: contextHash, maxUnits: input.maxUnits });
    return { kind: "ready", context };
  } catch (error) {
    return { kind: "blocked", code: error instanceof ContextBlocked ? error.code : "STORY_CONTEXT_INSUFFICIENT",
      issues: [error instanceof ContextBlocked ? error.issue : "context:invalid-authority-material"] };
  }
}

/** An independent author view after real world work. No fabricated player
 * intent/RequiredContext and no full-story knowledge for the acting NPC. */
export function buildRoomWorldStoryContext(input: RoomWorldStoryContextInput): RoomStoryContextResult {
  try {
    if (!Number.isSafeInteger(input.maxUnits) || input.maxUnits <= 0) fail("budget:positive-safe-integer-required", "STORY_BUDGET_EXHAUSTED");
    if (!worldStoryTriggerMatchesAuthority(input.trigger, input.state, input.profiles, true)) {
      fail("trigger:world-authority-snapshot-mismatch", "STORY_CONTEXT_STALE");
    }
    return { kind: "ready", context: collect({ ...input, worldTrigger: input.trigger }, {
      schema: "zhuwei.room-world-story-context-binding/v1", actorRef: input.trigger.actorRef,
      triggerRef: input.trigger.triggerRef, triggerHash: input.trigger.triggerHash,
      libraryCatalogHash: input.libraryCatalog.catalogHash,
      requestHash: hash(input.request), maxUnits: input.maxUnits,
    }) };
  } catch (error) {
    return { kind: "blocked", code: error instanceof ContextBlocked ? error.code : "STORY_CONTEXT_INSUFFICIENT",
      issues: [error instanceof ContextBlocked ? error.issue : "context:invalid-world-authority-material"] };
  }
}

/** Recompute the same typed queries, including empty membership witnesses.
 * Room calls this again in its atomic admission transaction. A whole-state
 * version change alone is not a conflict, and a caller cannot omit a lock to
 * hide a newly relevant participant, fact, knowledge record or commitment. */
export function validateRoomStoryContext(input: RoomStoryContextValidationInput): RoomStoryContextValidation {
  try {
    const { contextHash, ...body } = input.context;
    if (hash(body) !== contextHash || input.context.format !== "zhuwei.story-context/v1") return conflict([BINDING_REF]);
    const bindings = input.context.materials.filter(material => material.ref === BINDING_REF);
    const binding = bindings[0]?.content;
    if (bindings.length !== 1 || bindings[0]?.kind !== "contentBoundary" || !isPlainRecord(binding)
      || !text(binding.actorRef) || binding.requestHash !== hash(input.request)
      || !Number.isSafeInteger(binding.maxUnits) || Number(binding.maxUnits) <= 0) return conflict([BINDING_REF]);
    let worldTrigger: RoomWorldStoryTrigger | undefined, libraryCatalog: StoryLibraryCatalog | undefined;
    if (binding.schema === "zhuwei.room-story-context-binding/v1") {
      if (!text(binding.requiredContextHash)) return conflict([BINDING_REF]);
    } else if (binding.schema === "zhuwei.room-world-story-context-binding/v1") {
      const sources = input.context.materials.filter(material => material.ref === binding.triggerRef);
      if (!text(binding.triggerRef) || !text(binding.triggerHash) || sources.length !== 1 || sources[0]?.kind !== "fact") return conflict([BINDING_REF]);
      worldTrigger = sources[0].content as unknown as RoomWorldStoryTrigger;
      const catalogs = input.context.materials.filter(material => material.ref === STORY_LIBRARY_CATALOG_REF);
      if (catalogs.length !== 1 || catalogs[0].kind !== "contentBoundary" || !text(binding.libraryCatalogHash)) return conflict([BINDING_REF]);
      libraryCatalog = catalogs[0].content as unknown as StoryLibraryCatalog;
    } else return conflict([BINDING_REF]);
    const capabilityDescriptions = input.context.materials.filter(material => material.ref.startsWith(CAPABILITY_PREFIX))
      .map(material => material.content as unknown as StoryCapabilityDescription);
    const current = collect({ ...input, capabilityDescriptions, ...(worldTrigger === undefined ? {} : { worldTrigger, libraryCatalog }) }, binding as unknown as Binding);
    const expected = new Map(input.context.readSet.map(dep => [dep.ref, hash(dep)]));
    const actual = new Map(current.readSet.map(dep => [dep.ref, hash(dep)]));
    const changedRefs = sorted([...expected.keys(), ...actual.keys()]).filter(ref => expected.get(ref) !== actual.get(ref));
    if (changedRefs.length > 0) return conflict(changedRefs);
    return current.contextHash === contextHash ? { kind: "valid" } : conflict([BINDING_REF]);
  } catch (error) { return conflict([error instanceof ContextBlocked ? error.issue : BINDING_REF]); }
}

function conflict(changedRefs: readonly string[]): RoomStoryContextValidation {
  return { kind: "conflict", changedRefs: Object.freeze([...changedRefs]) };
}

function collect(input: WorldInput, binding: Binding): StoryContext {
  const { state, request, profiles, moduleProfile: module } = input;
  if (request.format !== "zhuwei.story-request/v1" || request.source.roomId !== state.roomId
    || request.source.runtimeEpochId !== state.runtimeEpochId || request.source.branchId !== state.activeBranchId
    || binding.requestHash !== hash(request)) fail("source:room-epoch-branch-mismatch", "STORY_CONTEXT_STALE");
  if (hash(profiles.manifest) !== hash(state.runtimeManifestRef)) fail("source:runtime-mismatch", "STORY_CONTEXT_STALE");
  if (hash(module.moduleRef) !== hash(state.campaignRuntime.campaign?.moduleRef)) fail("source:module-binding-mismatch", "STORY_CONTEXT_STALE");
  const { moduleRef, ...moduleBody } = module;
  if (hash({ ...moduleBody, moduleRef: { profileId: moduleRef.profileId } }) !== moduleRef.profileHash) fail("source:module-content-integrity");
  const worldTrigger = input.worldTrigger;
  if (binding.schema === "zhuwei.room-world-story-context-binding/v1") {
    if (!worldTrigger || worldTrigger.triggerRef !== binding.triggerRef || worldTrigger.triggerHash !== binding.triggerHash
      || worldTrigger.actorRef !== binding.actorRef || !worldStoryTriggerMatchesAuthority(worldTrigger, state, profiles)
      || !input.libraryCatalog || input.libraryCatalog.catalogHash !== binding.libraryCatalogHash
      || !worldStoryLibraryCatalogValid(worldTrigger, input.libraryCatalog)
      || hash(request.source) !== hash(worldTrigger.source) || request.trigger.kind !== "causalDevelopment"
      || request.trigger.goal !== worldTrigger.goal || hash(request.scope) !== hash(worldTrigger.scope)
      || hash(request.trigger.basisRefs) !== hash([worldTrigger.triggerRef, worldTrigger.actorRef, ...worldTrigger.scope.sceneIds])) {
      fail("trigger:world-source-binding-mismatch", "STORY_CONTEXT_STALE");
    }
  } else if (worldTrigger !== undefined) fail("trigger:unexpected-world-source");
  for (const ref of request.scope.sceneIds) if (!state.scenes[ref]) fail(`scope:location-unavailable:${ref}`);
  for (const ref of [...request.scope.entityIds, binding.actorRef]) if (!state.entities[ref]) fail(`scope:entity-unavailable:${ref}`);
  if (new Set(request.scope.sceneIds).size !== request.scope.sceneIds.length
    || new Set(request.scope.entityIds).size !== request.scope.entityIds.length) fail("scope:duplicate-reference");

  const sources = sourceDirectory(state);
  let visits = sources.size;
  const selected = new Map<string, Source>();
  const subjects = new Set([...request.scope.sceneIds, ...request.scope.entityIds, binding.actorRef]);
  const explicit = new Set([...subjects, ...request.trigger.basisRefs]);
  const scopedScenes = new Set(request.scope.sceneIds);
  const missing = new Set<string>();
  const resolve = (ref: string): Source | undefined => sources.get(ref);
  function select(source: Source) {
    if (selected.has(source.ref)) return;
    if (selected.size >= MAX_RECORDS) fail("closure:record-limit", "STORY_BUDGET_EXHAUSTED");
    selected.set(source.ref, source);
    subjects.add(source.ref);
    if (source.category === "location") scopedScenes.add(source.ref);
    if (source.kind === "npc") subjects.add(source.ref);
    // A loaded record's typed identity/dependency fields, never strings in
    // prose, connect it to other records. Embedded resources remain in place.
    for (const ref of source.links) if (resolve(ref)) explicit.add(ref);
    for (const ref of source.required) {
      if (resolve(ref)) explicit.add(ref); else missing.add(ref);
    }
  }
  let previous = -1;
  while (previous !== selected.size) {
    previous = selected.size;
    for (const source of sources.values()) {
      if (++visits > MAX_VISITS) fail("closure:work-limit", "STORY_BUDGET_EXHAUSTED");
      const owner = source.owner === undefined ? undefined : state.entities[source.owner];
      // KP's finite NPC history is available; a bystander's private player
      // knowledge is not pulled in merely because both stand in one scene.
      if (source.category === "knowledge" && owner?.kind === "player" && source.owner !== binding.actorRef) continue;
      const sceneRef = state.entities[source.ref]?.sceneId;
      const relevant = explicit.has(source.ref) || source.subjects.some(ref => subjects.has(ref))
        || (source.category === "entity" && sceneRef !== undefined && scopedScenes.has(sceneRef));
      if (relevant) select(source);
    }
  }
  if (missing.size > 0) fail(`closure:missing-required:${sorted(missing).join(",")}`);

  const materials = new Map<string, StoryContextMaterial>();
  const deps = new Map<string, StoryReadDependency>();
  const timelines = new Map<string, string>();
  let units = 0;
  function add(material: StoryContextMaterial) {
    if (materials.has(material.ref)) fail(`context:duplicate-reference:${material.ref}`, "STORY_IDENTITY_CONFLICT");
    units += canonicalUnits(material);
    if (units > binding.maxUnits) fail("context:complete-material-exceeds-budget", "STORY_BUDGET_EXHAUSTED");
    materials.set(material.ref, material);
  }
  function lock(ref: string, kind: StoryReadDependency["kind"], value?: unknown) {
    const revision = value === undefined ? authorityRevisionOrHash(state, ref) : hash(value);
    if (revision === null) fail(`closure:authority-binding-unavailable:${ref}`);
    const next: StoryReadDependency = { ref, kind, revision: revision!, hash: revision as StoryHash };
    if (deps.has(ref) && hash(deps.get(ref)) !== hash(next)) fail(`closure:ambiguous-authority-reference:${ref}`);
    deps.set(ref, next);
  }
  const profileRef = `profile-context:${moduleRef.profileId}`;
  add(material(profileRef, "anchor", { moduleRef, coreTruth: module.storyBible.coreTruth,
    storyAnchors: module.storyBible.storyAnchors, initialPressures: module.storyBible.initialPressures,
    sequelSignals: module.storyBible.sequelSignals, ...(module.storyBible.premiseCatalog === undefined ? {} : { premiseCatalog: module.storyBible.premiseCatalog }) }, [], []));
  lock(profileRef, "fact");
  add(material(BINDING_REF, "contentBoundary", binding, [], []));
  lock(BINDING_REF, "collection", { binding, request, profiles });
  if (worldTrigger !== undefined) {
    add(material(worldTrigger.triggerRef, "fact", worldTrigger, [worldTrigger.actorRef, ...worldTrigger.scope.sceneIds], []));
    lock(worldTrigger.triggerRef, "collection", { trigger: worldTrigger, receipt: state.receipts[worldTrigger.rootActionId] });
    // A frozen operational inventory informs reuse and writing choices. It
    // grants no world fact, candidate existence, or NPC knowledge.
    add(material(STORY_LIBRARY_CATALOG_REF, "contentBoundary", input.libraryCatalog!, [], []));
    lock(STORY_LIBRARY_CATALOG_REF, "collection", input.libraryCatalog!);
  }
  add(material("story-context:content-boundary", "contentBoundary", module.storyBible.contentBoundary, [], [profileRef]));
  // Every loaded location brings its real residents and its independent
  // present frontier. Reading another place never advances/synchronizes it.
  for (const sceneRef of sorted(scopedScenes)) {
    const frontiers = Object.entries(state.multiplayerRuntime.causalFrontiers)
      .filter(([, frontier]) => frontier.sceneId === sceneRef).sort(([left], [right]) => compareCodeUnits(left, right));
    if (frontiers.length === 0) fail(`timeline:scene-frontier-unavailable:${sceneRef}`);
    const witnesses = frontiers.map(([timelineId, frontier]) => {
      const timeline = state.fictionTimelines[timelineId];
      if (!timeline || timeline.branchId !== state.activeBranchId || frontier.timelineId !== timelineId
        || frontier.branchId !== state.activeBranchId || frontier.nowMicros !== timeline.nowMicros
        || !/^(0|[1-9][0-9]*)$/.test(timeline.nowMicros)
        || !(frontier.eventHeadId === null || text(frontier.eventHeadId))
        || !Array.isArray(frontier.causalParentTimelineIds) || frontier.causalParentTimelineIds.some(parent =>
          typeof parent !== "string" || state.fictionTimelines[parent]?.branchId !== state.activeBranchId)) {
        fail(`timeline:invalid-scene-frontier:${sceneRef}:${timelineId}`);
      }
      timelines.set(timelineId, timeline.nowMicros);
      return { timelineId, timeline, frontier };
    });
    const ref = `story-context:scene-frontiers:${sceneRef}`;
    const witness = { sceneRef, witnesses,
      temporalMeaning: "independent-current-frontiers;not-synchronized;parent-timeline-ids-do-not-grant-historical-content" };
    add(material(ref, "fact", witness, [sceneRef], [sceneRef]));
    lock(ref, "timeline", witness);
  }
  for (const ref of sorted(scopedScenes)) {
    if (module.storyBible.openBlanks.length === 0) continue;
    add(material(`story-context:open:${ref}`, "fact", { scopeRef: ref, moduleRef,
      openBlanks: module.storyBible.openBlanks, meaning: "permission-to-prepare-candidates;not-existence-or-mechanical-permission" }, [ref], [profileRef, ref], "open"));
  }
  for (const source of [...selected.values()].sort((a, b) => compareCodeUnits(a.ref, b.ref))) {
    const { ref, kind } = source;
    if (ref === profileRef) continue;
    let availability: StoryContextMaterial["availability"] = "known";
    if (source.category === "fact" && isPlainRecord(source.value) && source.value.kind === "localAbsence") {
      const value = source.value.value;
      if (isPlainRecord(value) && value.status === "active" && text(value.scopeRef)
        && value.scopeRevisionOrHash === authorityRevisionOrHash(state, value.scopeRef)
        && parseAbsenceSelector(value.selector) !== undefined) availability = "scopedAbsent";
      // An expired denial is unresolved availability, not an assertion that a
      // particular NPC explicitly lacks knowledge of it.
      else availability = "ambiguous";
    }
    add(material(ref, kind, source.value, source.subjects, source.required, availability));
    lock(ref, source.category === "entity" ? "entity" : source.category === "knowledge" ? "knowledge"
      : kind === "narrativeCommitment" ? "narrativeCommitment" : "fact");
    if (source.category !== "entity") continue;
    const entity = state.entities[ref];
    const timeline = authorityCharacterTimeline(state, ref);
    if (!timeline || !timeline.timeline || timeline.timeline.branchId !== state.activeBranchId
      || !/^(0|[1-9][0-9]*)$/.test(timeline.timeline.nowMicros)) return fail(`timeline:current-binding-unavailable:${ref}`);
    if (state.multiplayerRuntime.causalFrontiers[timeline.timelineId]?.sceneId !== entity.sceneId) {
      fail(`timeline:entity-scene-frontier-mismatch:${ref}`);
    }
    timelines.set(timeline.timelineId, timeline.timeline.nowMicros);
    lock(`character-timeline:${ref}`, "timeline");
    if (entity.kind !== "npc" && ref !== binding.actorRef) continue;
    lock(`knowledge-catalog:${ref}`, "collection");
    const npcAnchor = module.storyBible.importantNpcs.find(anchor => anchor.entityId === ref);
    if (!npcAnchor) continue;
    add(material(`story-context:npc-anchor:${ref}`, "anchor", npcAnchor, [ref], [profileRef, ref]));
    npcAnchor.declaredUnknowns.forEach((unknown, index) => add(material(`story-context:declared-unknown:${ref}:${index}`,
      "knowledge", { holderRef: ref, text: unknown, source: "moduleNpcAnchor", temporalMeaning: "declared-at-module-start;later-acquisition-remains-possible" },
      [ref], [profileRef, ref], "explicitlyUnknown")));
  }
  // The fingerprint includes every selected record and query roots. An empty
  // relation/fact set has a witness; new matching records alter the result.
  lock(MEMBERS_REF, "collection", { scope: request.scope,
    members: [...selected.values()].map(source => ({ ref: source.ref, category: source.category,
      revision: authorityRevisionOrHash(state, source.ref) })).sort((a, b) => compareCodeUnits(a.ref, b.ref)) });
  const capabilities = [...input.capabilityDescriptions].sort((a, b) => compareCodeUnits(a.capability, b.capability));
  for (const capability of capabilities) {
    const schema = capability.schema;
    if (!text(capability.capability) || !isPlainRecord(schema) || schema.type !== "object"
      || !isPlainRecord(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required)
      || schema.required.some(key => typeof key !== "string" || !Object.hasOwn(schema.properties as object, key))) fail("capability:invalid-host-schema", "STORY_CAPABILITY_UNSUPPORTED");
    const ref = `${CAPABILITY_PREFIX}${capability.capability}`;
    add(material(ref, "definition", capability, [], []));
    lock(ref, "collection", capability);
  }
  if (request.trigger.basisRefs.some(ref => !materials.has(ref))) fail("trigger:source-material-unavailable");
  const contextBody = { format: "zhuwei.story-context/v1" as const,
    // Runtime manifests expose an immutable content revision, not the story
    // format's semantic version. Retain it instead of inventing a Rules v1.
    runtimeRef: { id: profiles.manifest.profileId, version: profiles.manifest.profileHash, hash: hash(profiles) },
    moduleRef: { id: moduleRef.profileId, version: module.moduleVersion, hash: moduleRef.profileHash },
    materials: [...materials.values()].sort((a, b) => compareCodeUnits(a.ref, b.ref)),
    readSet: [...deps.values()].sort((a, b) => compareCodeUnits(a.ref, b.ref)),
    timelines: [...timelines].map(([timelineId, micros]) => ({ timelineId, micros })).sort((a, b) => compareCodeUnits(a.timelineId, b.timelineId)),
    supportedCapabilities: capabilities.map(capability => capability.capability), missingRequiredRefs: [] };
  const context: StoryContext = { ...contextBody, contextHash: hash(contextBody) };
  if (canonicalUnits(context) > binding.maxUnits) fail("context:complete-artifact-exceeds-budget", "STORY_BUDGET_EXHAUSTED");
  return deepFreeze(context);
}

function material(ref: string, kind: StoryContextMaterial["kind"], content: unknown,
  subjects: readonly string[], basis: readonly string[], availability: StoryContextMaterial["availability"] = "known"): StoryContextMaterial {
  return { ref, kind, availability, content: asJson(content), subjectRefs: sorted(subjects), basisRefs: sorted(basis) };
}

/** A typed directory, not a recursive search for strings that resemble refs.
 * Collection membership and body reads are taken from the same snapshot. */
function sourceDirectory(state: AuthoritativeWorldState): Map<string, Source> {
  const directory = new Map<string, Source>();
  const aliases = new Map<string, string[]>();
  function add(ref: string, kind: Source["kind"], value: unknown, subjects: readonly string[],
    links: readonly string[], required: readonly string[], category: string, owner?: string) {
    if (directory.has(ref)) fail(`authority:duplicate-reference:${ref}`);
    directory.set(ref, { ref, kind, value, subjects, links, required, category, ...(owner === undefined ? {} : { owner }) });
  }
  function addCatalogDefinition(ref: string, value: unknown, category: string) {
    const existing = directory.get(ref);
    if (!existing) { add(ref, "definition", value, [], [], [], category); return; }
    // DefinitionRegistered and NpcMaterialized intentionally index one frozen
    // definition in both runtimes. Their identity is the validated definition
    // and compiler artifact, not the catalog that happens to contain it.
    if (existing.kind !== "definition" || !["definition", "itemDefinition", "abilityDefinition"].includes(existing.category)
      || catalogDefinitionHash(ref, existing.value) !== catalogDefinitionHash(ref, value)) {
      fail(`authority:conflicting-definition:${ref}`, "STORY_IDENTITY_CONFLICT");
    }
  }
  for (const [ref, entity] of Object.entries(state.entities)) add(ref, entity.kind === "npc" ? "npc" : "fact",
    { ...authorityEntityComposite(state, ref), name: entity.name }, [ref], [entity.sceneId],
    [entity.sceneId, ...(entity.semanticDefinitionRef ? [entity.semanticDefinitionRef] : [])], "entity");
  for (const [ref, scene] of Object.entries(state.scenes)) add(ref, "location",
    { ...scene, combatScene: state.combatRuntime.scenes[ref] ?? null }, [ref], [], [], "location");
  for (const [ref, definition] of Object.entries(state.campaignRuntime.definitions)) {
    const content = isPlainRecord(definition.content) ? definition.content : {};
    const links = recordRefs(content);
    const fact = isPlainRecord(content.worldFact) ? content.worldFact : undefined;
    const subjects = [...strings(fact?.subjectRefs), ...[content.sceneRef, content.subjectRef, content.objectRef].filter(text)];
    const mechanics = strings(content.mechanicDefinitionRefs);
    for (const id of mechanics) if (!directory.has(id) && authorityGeometryFeatureComposite(state, id)) {
      const geometry = authorityGeometryFeatureComposite(state, id)!;
      add(id, "definition", geometry, [geometry.sceneRef], [], [], "geometry");
    }
    add(ref, "definition", definition, subjects, links, [...mechanics,
      ...(definition.semanticKind === "worldRelation" ? [content.subjectRef, content.objectRef].filter(text) : [])], "definition");
  }
  for (const [ref, fact] of Object.entries(state.canonicalFacts)) {
    if (fact.branchId !== state.activeBranchId) continue;
    const pointer = isWorldFactPointer(fact.value);
    const definition = pointer ? worldFactDefinition(state, fact) : undefined;
    // Invalid pointers are checked only if selected; unrelated damaged content
    // cannot be mistaken for a decisive missing record.
    const pointerRefs = pointer && isPlainRecord(fact.value) && text(fact.value.definitionRef) ? [fact.value.definitionRef] : [];
    const valueRefs = isPlainRecord(fact.value) ? recordRefs(fact.value) : [];
    const narrative = fact.kind === "narrativeCommitment" || (isPlainRecord(fact.value) && fact.value.schema === "zhuwei.narrative-detail/vnext-1");
    const basis = isPlainRecord(fact.value) && (narrative || fact.kind === "localAbsence") ? strings(fact.value.basisRefs) : [];
    add(ref, narrative
      ? "narrativeCommitment" : "fact", fact, fact.subjectRefs, [...fact.subjectRefs, ...valueRefs],
    [...fact.causalParentIds, ...basis, ...pointerRefs, ...(pointer && !definition ? [`invalid-world-fact-pointer:${ref}`] : [])], "fact");
  }
  for (const [holder, records] of Object.entries(state.knowledge)) for (const [id, record] of Object.entries(records)) {
    const ref = `knowledge:${holder}:${id}`;
    const fact = state.canonicalFacts[record.knowledgeRef];
    const pointer = isWorldFactPointer(record.content);
    const required = [
      ...(record.characterId !== holder || record.knowledgeRef !== id ? [`invalid-knowledge-holder:${ref}`] : []),
      ...(pointer && (!fact || !worldFactDefinition(state, fact) || hash(record.content) !== hash(fact.value)) ? [`invalid-knowledge-fact:${ref}`] : []),
      ...(pointer && isPlainRecord(record.content) && text(record.content.definitionRef) ? [record.content.definitionRef] : []),
    ];
    add(ref, "knowledge", { holderRef: holder, record,
      acquisition: { eventRef: record.acquiredByEventId, micros: record.acquiredAtFictionMicros,
        timelineId: null, status: "timelineUnresolved" } }, [holder],
      [...(fact ? [fact.id] : []),
        ...(state.campaignRuntime.sourceClaims[record.knowledgeRef] ? [`continuity:sourceClaims:${record.knowledgeRef}`] : []),
        ...record.provenanceChain.filter(id => state.canonicalFacts[id] !== undefined)], required, "knowledge", holder);
  }
  const kinds: Readonly<Record<string, StoryContextMaterial["kind"]>> = {
    relationships: "relationship", promises: "promise", debts: "promise", npcPlans: "plan", factionPlans: "plan",
    activities: "plan", factions: "relationship", sourceClaims: "fact", conversationThreads: "fact",
    chapters: "anchor", stories: "plan", endingCandidates: "plan", epilogues: "fact", sceneQuestions: "plan",
  };
  for (const [collection, kind] of Object.entries(kinds)) {
    const entries = (state.campaignRuntime as unknown as Record<string, unknown>)[collection];
    if (!isPlainRecord(entries)) continue;
    for (const [id, value] of Object.entries(entries)) {
      if (!isPlainRecord(value)) continue;
      const ref = `continuity:${collection}:${id}`;
      aliases.set(id, [...(aliases.get(id) ?? []), ref]);
      const actor = [value.actorRef, value.npcId, value.characterId].find(text);
      const refs = recordRefs(value).map(ref => actor && state.knowledge[actor]?.[ref] ? `knowledge:${actor}:${ref}` : ref);
      add(ref, kind, value, refs, refs,
        [...strings(value.basisFactIds), ...strings(value.basisFactRefs)], `continuity:${collection}`);
    }
  }
  const items = state.campaignRuntime.itemSystem;
  for (const [ref, item] of Object.entries(items.entries)) add(ref, "definition", item,
    [item.holderRef, item.sceneRef].filter(text), [], [item.definitionRef], "item");
  for (const [ref, definition] of Object.entries(items.definitions)) addCatalogDefinition(ref, definition, "itemDefinition");
  for (const [ref, definition] of Object.entries(state.combatRuntime.definitions)) addCatalogDefinition(ref, definition, "abilityDefinition");
  for (const [ref, entity] of Object.entries(state.combatRuntime.entities)) {
    const source = directory.get(ref);
    if (source) source.required = [...source.required, ...strings(entity.abilityRefs),
      ...(text(entity.mechanicalDefinitionRef) ? [entity.mechanicalDefinitionRef] : [])];
  }
  // Stored continuity records sometimes name their own collection IDs rather
  // than the context's qualified refs. Resolve only an exact, unique alias;
  // same text in multiple domains is never guessed or matched by substring.
  const normalize = (ref: string): string => directory.has(ref) ? ref : aliases.get(ref)?.length === 1 ? aliases.get(ref)![0]! : ref;
  for (const source of directory.values()) {
    source.subjects = sorted(source.subjects.map(normalize));
    source.links = sorted(source.links.map(normalize));
    source.required = sorted(source.required.map(normalize));
  }
  return directory;
}

function catalogDefinitionHash(ref: string, value: unknown): StoryHash {
  if (!isPlainRecord(value) || value.definitionId !== ref) return fail(`authority:invalid-definition:${ref}`);
  if (["compilerProfile", "compiledHash", "mechanicGraph", "referenceClosure"].some(key => Object.hasOwn(value, key))) {
    if (!isRegisteredAbilityRecord(value)) return fail(`authority:invalid-compiled-definition:${ref}`);
    return hash({ definitionId: ref, definitionHash: value.definitionHash, compilerProfile: value.compilerProfile,
      compiledHash: value.compiledHash, referenceClosure: value.referenceClosure });
  }
  // Mechanical templates, semantic definitions and item definitions already
  // use the same canonical record representation in their authority indexes.
  return hash(value);
}

/** These fields are declared identity/reference slots in the stored domain
 * records. Intentions, labels, descriptive text and future trace prose are
 * deliberately not traversed. Future traceRef is not evidence of existence. */
function recordRefs(value: Record<string, unknown>): string[] {
  const scalar = ["sceneId", "sceneRef", "sourceSceneId", "sourceSceneRef", "destinationSceneRef",
    "characterId", "actorRef", "actorCharacterId", "npcId", "npcRef", "npcCharacterId", "decisionNpcId",
    "promisorId", "promiseeId", "debtorId", "creditorId", "speakerId", "subjectRef", "objectRef",
    "holderRef", "definitionRef", "semanticDefinitionRef", "visibilityFactId", "materializedRef", "commitmentRef",
    "factionRef", "promiseId", "promiseRef", "planId", "activityId", "storyId", "chapterId"];
  const arrays = ["subjectIds", "subjectRefs", "memberRefs", "participantRefs", "basisRefs", "basisFactRefs", "basisFactIds",
    "causalParentIds", "sceneIds", "resourceRefs", "premiseRefs"];
  return sorted([...scalar.flatMap(key => text(value[key]) ? [value[key] as string] : []),
    ...arrays.flatMap(key => strings(value[key]))]);
}
