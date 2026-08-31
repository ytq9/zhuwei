import type { AuthoritativeModuleProfile } from "../module/authoritative";
import {
  ABILITY_COMPILER_PROFILE,
  ABILITY_COMPILER_PROFILE_DOCUMENT,
  COMBAT_PROFILE,
  COMBAT_PROFILE_DOCUMENT,
  DAMAGE_DEATH_PROFILE,
  DAMAGE_DEATH_PROFILE_DOCUMENT,
  ENVIRONMENT_PROFILE,
  ENVIRONMENT_PROFILE_DOCUMENT,
  GEOMETRY_PROFILE,
  GEOMETRY_PROFILE_DOCUMENT,
  RULESET_PROFILE,
  RULESET_PROFILE_DOCUMENT,
} from "../rules/profiles/manifests";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import { SPELL_DEFINITIONS } from "../rules/spell-catalog";
import {
  buildContextPack,
  type ContextPack,
  type OptionalContextItem,
  type RequiredContext,
} from "./context-pack";
import { KP_FORM_IDS, assertAllowedFormSet, type KpFormId } from "./form-catalog";
import type { KpProposalRequest } from "./authoritative-types";
import {
  createDeterministicPlannerAdapter,
  createDisabledPlannerAdapter,
  requireValidatedModelProfile,
  runContextPlanner,
  type ContextPlannerAdapter,
  type ContextPlannerReceipt,
  type ModelProfileRegistry,
} from "./model-registry";
import {
  authoritativeStaticCorpusReader,
  compileStaticCorpus,
  createD1StaticCorpusAdapter,
  retrieveStaticReferencesFromD1,
  STATIC_CORPUS_PROFILE,
  type AuthoritativeStaticCorpusSource,
  type CompiledStaticCorpus,
  type D1CorpusDatabase,
  type D1StaticCorpusAdapter,
} from "./static-corpus";
import {
  createDeterministicFtsAdapter,
  createStaticRetrievalRequest,
  publicD1QueryTermsForStructuralRefs,
  rehydrateStaticContext,
  retrieveStaticReferences,
  staticSearchTerms,
  type StaticRetrievalHit,
} from "./static-retrieval";
import {
  requiredContextFromKpRequest,
  v3StaticQuerySeed,
} from "./v3-context-runtime";

const PRODUCTION_CONTEXT_PROFILE = Object.freeze({
  profileRef: "kp-v3-production-context-g2-v1",
  profileVersion: "kp-v3-production-context-g2-v1.0.0",
  corpusCompilerProfileRef: STATIC_CORPUS_PROFILE.profileRef,
  retrievalOrder: "structure-alias-d1-fts-authoritative-rehydrate",
  fallback: "deterministic-memory-authoritative-rehydrate",
});

export const V3_PRODUCTION_CONTEXT_PROFILE = PRODUCTION_CONTEXT_PROFILE;

type RetrievalFailureCode =
  | "D1_SYNC_FAILED"
  | "D1_SEARCH_FAILED"
  | "RAG_REHYDRATE_FAILED"
  | "MEMORY_RETRIEVAL_FAILED";

export type V3ProductionRetrievalReceipt = Readonly<{
  profileRef: typeof PRODUCTION_CONTEXT_PROFILE.profileRef;
  retrievalMode: "d1-fts" | "deterministic";
  status: "selected" | "fallback";
  fallbackUsed: boolean;
  failureCode: RetrievalFailureCode | null;
  hitCountBucket: "0" | "1" | "2-4" | "5-8" | "9-16" | "17+";
  selectedReferencesDigest: `sha256:${string}`;
}>;

export type V3ProductionContextResult = Readonly<{
  contextPack: ContextPack;
  orderedFormIds: readonly KpFormId[];
  plannerReceipt: ContextPlannerReceipt;
  retrievalReceipt: V3ProductionRetrievalReceipt;
}>;

export type V3ProductionCorpusOptions = Readonly<{
  /** Extra inputs must cross the same static-only compiler boundary. */
  additionalSources?: readonly AuthoritativeStaticCorpusSource[];
  includeBuiltinAbilities?: boolean;
}>;

export type V3ProductionContextPreparerOptions = V3ProductionCorpusOptions & Readonly<{
  moduleProfile: AuthoritativeModuleProfile;
  database?: D1CorpusDatabase;
  registry: ModelProfileRegistry;
  pinnedPrimaryKpProfileRef: string;
  plannerAdapter?: ContextPlannerAdapter;
  allowKpOnly: boolean;
  /** V5-only private dynamic truth continuity; historical workflows omit it. */
  includeDynamicAuthoritativeFacts?: boolean;
  maxUnits?: number;
  retrievalLimit?: number;
}>;

export type V3ProductionContextPreparer = Readonly<{
  profile: typeof PRODUCTION_CONTEXT_PROFILE;
  corpus: CompiledStaticCorpus;
  prepare(
    request: KpProposalRequest,
    allowedFormIds: readonly string[],
  ): Promise<V3ProductionContextResult>;
}>;

type StaticDocument = Readonly<{
  sourceType: AuthoritativeStaticCorpusSource["sourceType"];
  sourceRef: string;
  profileRef: string;
  sensitivity: AuthoritativeStaticCorpusSource["sensitivity"];
  body: unknown;
  aliases?: readonly string[];
  structuralRefs?: readonly string[];
  dependencyRefs?: readonly string[];
}>;

/**
 * Converts only immutable, version-pinned authority into static sources. Room
 * projections, transcripts, tactical snapshots and current knowledge are not
 * accepted by this function and therefore cannot reach the derived index.
 */
export function authoritativeStaticSourcesForModule(
  moduleProfile: AuthoritativeModuleProfile,
  options: V3ProductionCorpusOptions = {},
): readonly AuthoritativeStaticCorpusSource[] {
  assertPinnedModuleProfile(moduleProfile);
  const moduleRef = moduleProfile.moduleRef.profileId;
  const documents: StaticDocument[] = [
    ...rulesDocuments(),
    ...moduleDocuments(moduleProfile),
    ...storyBibleDocuments(moduleProfile),
    ...(options.includeBuiltinAbilities === false ? [] : abilityDocuments()),
    ...enemyDocuments(moduleProfile),
    ...environmentDocuments(moduleProfile),
  ];
  const generated = documents.map((document) => staticSource(document));
  const additional = options.additionalSources ?? [];
  const result = [...generated, ...additional];

  // Compilation is deliberately performed here as validation too. In
  // particular, dynamic sourceKind/ref/fields fail before any D1 call exists.
  compileStaticCorpus(result);
  if (!result.some((source) => source.profileRef === moduleRef)) {
    throw new Error("V3_CONTEXT_MODULE_CORPUS_MISSING");
  }
  return Object.freeze(result.map((source) => Object.freeze({ ...source })));
}

export function compileV3ProductionCorpus(
  moduleProfile: AuthoritativeModuleProfile,
  options: V3ProductionCorpusOptions = {},
): CompiledStaticCorpus {
  return compileStaticCorpus(authoritativeStaticSourcesForModule(moduleProfile, options));
}

/**
 * Creates a request-scoped I/O seam with a pure, in-memory authority copy. No
 * database or model call happens during module evaluation or factory creation.
 */
export function createV3ProductionContextPreparer(
  options: V3ProductionContextPreparerOptions,
): V3ProductionContextPreparer {
  requireValidatedModelProfile(options.registry, options.pinnedPrimaryKpProfileRef, "primary-kp");
  const corpus = compileV3ProductionCorpus(options.moduleProfile, options);
  const planner = options.plannerAdapter ?? createDisabledPlannerAdapter();
  const deterministicPlanner = createDeterministicPlannerAdapter();
  const allowedProfiles = allowedProfilesForModule(options.moduleProfile, corpus);
  // D1 sees one corpus/profile-derived cover query for this immutable module
  // configuration. Request-local scene, loadout, knowledge, intent, aliases,
  // and Planner selections are merged only inside Worker memory; otherwise
  // the choice of individually public terms would still disclose active Room
  // state through the query seam.
  const publicD1QueryTerms = publicD1QueryTermsForStructuralRefs(
    corpus.index,
    allowedProfiles,
  );
  const d1 = options.database === undefined
    ? undefined
    : createD1StaticCorpusAdapter(options.database, {
        allowedProfileRefs: allowedProfiles,
        allowKpOnly: options.allowKpOnly,
      });
  const maxUnits = options.maxUnits ?? 64_000;
  const retrievalLimit = options.retrievalLimit ?? 12;
  if (!Number.isInteger(maxUnits) || maxUnits <= 0) throw new Error("V3_CONTEXT_BUDGET_INVALID");
  if (!Number.isInteger(retrievalLimit) || retrievalLimit < 1 || retrievalLimit > 32) {
    throw new Error("V3_CONTEXT_RETRIEVAL_LIMIT_INVALID");
  }

  let synchronizedCorpusHash: string | undefined;
  let synchronization: Promise<void> | undefined;
  const synchronize = async (): Promise<void> => {
    if (d1 === undefined || synchronizedCorpusHash === corpus.corpusHash) return;
    if (synchronization === undefined) {
      synchronization = (async () => {
        try {
          if (await d1.isCurrent(corpus)) {
            synchronizedCorpusHash = corpus.corpusHash;
            return;
          }
        } catch {
          // Schema ownership stays with db/schema.ts and ordered Drizzle
          // migrations. The caller records D1_SYNC_FAILED and falls back to
          // deterministic retrieval when the deployed schema is unavailable.
        }
        await d1.upsert(corpus);
        synchronizedCorpusHash = corpus.corpusHash;
      })().finally(() => {
        synchronization = undefined;
      });
    }
    await synchronization;
  };

  return Object.freeze({
    profile: PRODUCTION_CONTEXT_PROFILE,
    corpus,
    async prepare(
      request: KpProposalRequest,
      rawAllowedFormIds: readonly string[],
    ): Promise<V3ProductionContextResult> {
      const allowedFormIds = checkedFormIds(rawAllowedFormIds);
      // This is the non-degradable authority boundary. An insufficient Room
      // projection still fails explicitly before Planner or retrieval runs.
      const required = requiredContextFromKpRequest(request, {
        includeDynamicAuthoritativeFacts: options.includeDynamicAuthoritativeFacts,
      });
      const querySeed = v3StaticQuerySeed(request);
      const plannerRun = await runContextPlanner({
        registry: options.registry,
        pinnedPrimaryKpProfileRef: options.pinnedPrimaryKpProfileRef,
        adapter: planner,
        deterministicFallback: deterministicPlanner,
        plannerInput: {
          rootActionRef: request.rootActionId,
          allowedFormIds,
          structuralRefs: querySeed.structuralRefs,
          baseQueryTerms: staticSearchTerms(querySeed.queryText).slice(0, 12),
        },
      });
      const retrievalRequest = createStaticRetrievalRequest({
        structuralRefs: querySeed.structuralRefs,
        exactAliases: exactAliasesInText(corpus, querySeed.queryText),
        queryText: querySeed.queryText,
        plannerQueryTerms: plannerRun.suggestion.queryTerms,
        publicD1QueryTerms,
        limit: retrievalLimit,
      });
      const retrieved = await retrieveWithFallback({
        corpus,
        d1,
        synchronize,
        request: retrievalRequest,
        allowedProfiles,
        allowKpOnly: options.allowKpOnly,
      });
      const contextPack = buildContextPack({
        required,
        retrieved: retrieved.chunks,
        optional: productionOptionalContext(options.moduleProfile, required),
        maxUnits,
      });
      return Object.freeze({
        contextPack,
        orderedFormIds: plannerRun.suggestion.orderedFormIds,
        plannerReceipt: await safePlannerReceipt(
          plannerRun.receipt,
          plannerRun.suggestion.orderedFormIds,
          plannerRun.suggestion.queryTerms.length,
        ),
        retrievalReceipt: await retrievalReceipt(retrieved.hits, retrieved.mode, retrieved.failureCode),
      });
    },
  });
}

function productionOptionalContext(
  profile: AuthoritativeModuleProfile,
  required: RequiredContext,
): readonly OptionalContextItem[] {
  const items: OptionalContextItem[] = [{
    ref: `optional:theme:${profile.moduleRef.profileId}`,
    kind: "theme",
    body: profile.tone.slice(0, 1_000),
    priority: 30,
  }];
  const relevantNpcRefs = new Set(required.npcViews.map((entry) => entry.npcRef));
  for (const npc of profile.storyBible.importantNpcs
    .filter((entry) => relevantNpcRefs.has(entry.entityId))
    .sort((left, right) => left.entityId.localeCompare(right.entityId))
    .slice(0, 6)) {
    items.push({
      ref: `optional:voice:${profile.moduleRef.profileId}:${npc.entityId}`,
      kind: "voice",
      body: JSON.stringify({
        npcRef: npc.entityId,
        voice: npc.voice,
        exampleLines: npc.exampleLines.slice(0, 3),
      }),
      priority: 40,
    });
  }
  const sceneRef = typeof required.sceneDynamics.sceneRef === "string"
    ? required.sceneDynamics.sceneRef
    : undefined;
  const location = sceneRef === undefined
    ? undefined
    : profile.storyBible.storyAnchors.locations.find((entry) => entry.sceneId === sceneRef);
  if (location !== undefined) {
    items.push({
      ref: `optional:scene-index:${profile.moduleRef.profileId}:${location.sceneId}`,
      kind: "lightweight-index",
      body: JSON.stringify({
        sceneRef: location.sceneId,
        chapterRef: location.chapterId,
        name: location.name,
        location: location.location,
      }),
      priority: 20,
    });
    items.push({
      ref: `optional:scene-background:${profile.moduleRef.profileId}:${location.sceneId}`,
      kind: "secondary-background",
      body: location.publicOpening.slice(0, 1_200),
      priority: 10,
    });
  }
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function rulesDocuments(): StaticDocument[] {
  return [
    {
      sourceType: "srd",
      sourceRef: `srd:${RULESET_PROFILE.profileId}`,
      profileRef: RULESET_PROFILE.profileId,
      sensitivity: "public",
      body: RULESET_PROFILE_DOCUMENT,
      aliases: ["SRD 5.1", "D&D 5e 2014", "2014规则", "规则"],
      structuralRefs: [RULESET_PROFILE.profileId, "rules:srd5.1-2014"],
    },
    {
      sourceType: "srd",
      sourceRef: `srd:${COMBAT_PROFILE.profileId}`,
      profileRef: COMBAT_PROFILE.profileId,
      sensitivity: "public",
      body: COMBAT_PROFILE_DOCUMENT,
      aliases: ["战斗", "回合", "攻击", "伤害"],
      structuralRefs: [RULESET_PROFILE.profileId, COMBAT_PROFILE.profileId, "rules:combat"],
    },
    {
      sourceType: "srd",
      sourceRef: `srd:${DAMAGE_DEATH_PROFILE.profileId}`,
      profileRef: DAMAGE_DEATH_PROFILE.profileId,
      sensitivity: "public",
      body: DAMAGE_DEATH_PROFILE_DOCUMENT,
      aliases: ["伤害", "死亡", "生命值", "临时生命值"],
      structuralRefs: [RULESET_PROFILE.profileId, DAMAGE_DEATH_PROFILE.profileId, "rules:damage-death"],
    },
    {
      sourceType: "srd",
      sourceRef: `srd:${GEOMETRY_PROFILE.profileId}`,
      profileRef: GEOMETRY_PROFILE.profileId,
      sensitivity: "public",
      body: GEOMETRY_PROFILE_DOCUMENT,
      aliases: ["距离", "范围", "掩护", "区域"],
      structuralRefs: [RULESET_PROFILE.profileId, GEOMETRY_PROFILE.profileId, "rules:geometry"],
    },
  ];
}

function moduleDocuments(profile: AuthoritativeModuleProfile): StaticDocument[] {
  const moduleRef = profile.moduleRef.profileId;
  const documents: StaticDocument[] = [{
    sourceType: "module",
    sourceRef: `${moduleRef}:catalog`,
    profileRef: moduleRef,
    sensitivity: "public",
    body: { title: profile.title, tone: profile.tone, moduleRef: profile.moduleRef },
    aliases: [profile.title, profile.moduleId],
    structuralRefs: [moduleRef, `module:${profile.moduleId}`],
  }];
  for (const location of profile.storyBible.storyAnchors.locations) {
    documents.push({
      sourceType: "module",
      sourceRef: `${moduleRef}:scene:${location.sceneId}`,
      profileRef: moduleRef,
      sensitivity: "public",
      body: {
        sceneId: location.sceneId,
        chapterId: location.chapterId,
        name: location.name,
        location: location.location,
        publicOpening: location.publicOpening,
      },
      aliases: [location.name, location.location, location.sceneId],
      structuralRefs: [
        location.sceneId,
        `scene:${location.sceneId}`,
        `chapter:${location.chapterId}`,
      ],
      dependencyRefs: [moduleRef],
    });
  }
  return documents;
}

function storyBibleDocuments(profile: AuthoritativeModuleProfile): StaticDocument[] {
  const moduleRef = profile.moduleRef.profileId;
  const bibleRef = `${moduleRef}:story-bible`;
  const documents: StaticDocument[] = [{
    sourceType: "story-bible",
    sourceRef: `${bibleRef}:core-truth`,
    profileRef: moduleRef,
    sensitivity: "kp-only",
    body: profile.storyBible.coreTruth,
    aliases: [profile.title, "核心真相", "幕后真相"],
    structuralRefs: [bibleRef, `${moduleRef}:core-truth`, "core-truth"],
    dependencyRefs: [moduleRef],
  }, {
    sourceType: "story-bible",
    sourceRef: `${bibleRef}:constraints`,
    profileRef: moduleRef,
    sensitivity: "kp-only",
    body: {
      contentBoundary: profile.storyBible.contentBoundary,
      openBlanks: profile.storyBible.openBlanks,
      ...(profile.storyBible.premiseCatalog === undefined
        ? {}
        : { premiseCatalog: profile.storyBible.premiseCatalog }),
      initialPressures: profile.storyBible.initialPressures,
      sequelSignals: profile.storyBible.sequelSignals,
    },
    aliases: [profile.title, "内容边界", "开放留白", "压力"],
    structuralRefs: [bibleRef, `${moduleRef}:story-anchors`],
    dependencyRefs: [moduleRef],
  }];
  for (const clue of profile.storyBible.storyAnchors.clues) {
    documents.push({
      sourceType: "story-bible",
      sourceRef: `${bibleRef}:clue:${clue.clueId}`,
      profileRef: moduleRef,
      sensitivity: "kp-only",
      body: clue,
      aliases: [clue.name, clue.clueId],
      structuralRefs: [bibleRef, clue.clueId, `clue:${clue.clueId}`, clue.pointsTo],
      dependencyRefs: [moduleRef, `${bibleRef}:core-truth`],
    });
  }
  return documents;
}

function abilityDocuments(): StaticDocument[] {
  const documents: StaticDocument[] = [{
    sourceType: "ability",
    sourceRef: `ability-profile:${ABILITY_COMPILER_PROFILE.profileId}`,
    profileRef: ABILITY_COMPILER_PROFILE.profileId,
    sensitivity: "public",
    body: ABILITY_COMPILER_PROFILE_DOCUMENT,
    aliases: ["能力", "法术", "能力编译"],
    structuralRefs: [ABILITY_COMPILER_PROFILE.profileId, RULESET_PROFILE.profileId],
  }];
  for (const [abilityId, definition] of Object.entries(SPELL_DEFINITIONS)) {
    documents.push({
      sourceType: "ability",
      sourceRef: `ability:${ABILITY_COMPILER_PROFILE.profileId}:${abilityId}`,
      profileRef: ABILITY_COMPILER_PROFILE.profileId,
      sensitivity: "public",
      body: definition,
      aliases: [abilityId],
      structuralRefs: [ABILITY_COMPILER_PROFILE.profileId, `ability:${abilityId}`, `spell:${abilityId}`],
      dependencyRefs: [RULESET_PROFILE.profileId, ABILITY_COMPILER_PROFILE.profileId],
    });
  }
  return documents;
}

function enemyDocuments(profile: AuthoritativeModuleProfile): StaticDocument[] {
  const moduleRef = profile.moduleRef.profileId;
  return profile.storyBible.importantNpcs.map((npc) => ({
    sourceType: "enemy" as const,
    sourceRef: `${moduleRef}:enemy:${npc.sourceNpcId}`,
    profileRef: moduleRef,
    sensitivity: "kp-only" as const,
    body: {
      entityId: npc.entityId,
      sourceNpcId: npc.sourceNpcId,
      name: npc.name,
      publicFace: npc.publicFace,
      goal: npc.goal,
      behavioralConstraints: npc.behavioralConstraints,
      declaredUnknowns: npc.declaredUnknowns,
      mechanicalAnchor: npc.mechanicalAnchor,
      startSceneId: npc.startSceneId,
    },
    aliases: [npc.name, npc.sourceNpcId],
    structuralRefs: [
      npc.entityId,
      `npc:${npc.sourceNpcId}`,
      `enemy:${npc.sourceNpcId}`,
      npc.startSceneId,
      `scene:${npc.startSceneId}`,
    ],
    dependencyRefs: [moduleRef],
  }));
}

function environmentDocuments(profile: AuthoritativeModuleProfile): StaticDocument[] {
  const moduleRef = profile.moduleRef.profileId;
  const documents: StaticDocument[] = [{
    sourceType: "environment",
    sourceRef: `environment-profile:${ENVIRONMENT_PROFILE.profileId}`,
    profileRef: ENVIRONMENT_PROFILE.profileId,
    sensitivity: "public",
    body: ENVIRONMENT_PROFILE_DOCUMENT,
    aliases: ["环境", "可破坏物体", "区域危害", "残骸"],
    structuralRefs: [ENVIRONMENT_PROFILE.profileId, GEOMETRY_PROFILE.profileId, "rules:environment"],
    dependencyRefs: [RULESET_PROFILE.profileId, GEOMETRY_PROFILE.profileId],
  }];
  for (const location of profile.storyBible.storyAnchors.locations) {
    const aliases = environmentAliases(location);
    documents.push({
      sourceType: "environment",
      sourceRef: `${moduleRef}:environment:${location.sceneId}`,
      profileRef: moduleRef,
      sensitivity: "kp-only",
      body: {
        sceneId: location.sceneId,
        physicalAnchors: location.physicalAnchors,
        hazardAnchors: location.hazardAnchors,
        itemAnchors: location.itemAnchors,
        tacticalGeometry: location.tacticalGeometry ?? null,
      },
      aliases,
      structuralRefs: [
        location.sceneId,
        `scene:${location.sceneId}`,
        ...environmentRefs(location),
      ],
      dependencyRefs: [moduleRef, GEOMETRY_PROFILE.profileId, ENVIRONMENT_PROFILE.profileId],
    });
  }
  return documents;
}

function staticSource(document: StaticDocument): AuthoritativeStaticCorpusSource {
  return Object.freeze({
    sourceKind: "static" as const,
    sourceType: document.sourceType,
    sourceRef: canonicalRef(document.sourceRef),
    profileRef: canonicalRef(document.profileRef),
    sensitivity: document.sensitivity,
    body: typeof document.body === "string" ? document.body : canonicalJson(document.body),
    aliases: Object.freeze(uniqueStrings(document.aliases ?? [])),
    structuralRefs: Object.freeze(uniqueStrings(document.structuralRefs ?? []).map(canonicalRef)),
    dependencyRefs: Object.freeze(uniqueStrings(document.dependencyRefs ?? []).map(canonicalRef)),
  });
}

function assertPinnedModuleProfile(profile: AuthoritativeModuleProfile): void {
  if (profile.compatibleRulesetVersion !== AUTHORITATIVE_RULESET_VERSION
    || profile.moduleRef.profileId !== `module:${profile.moduleId}:${profile.moduleVersion}`
    || !/^sha256:[0-9a-f]{64}$/u.test(profile.moduleRef.profileHash)
    || typeof profile.storyBible?.coreTruth !== "string"
    || profile.storyBible.coreTruth.trim().length === 0) {
    throw new Error("V3_CONTEXT_MODULE_PROFILE_INVALID");
  }
}

function allowedProfilesForModule(
  moduleProfile: AuthoritativeModuleProfile,
  corpus: CompiledStaticCorpus,
): readonly string[] {
  const permitted = new Set([
    moduleProfile.moduleRef.profileId,
    RULESET_PROFILE.profileId,
    COMBAT_PROFILE.profileId,
    DAMAGE_DEATH_PROFILE.profileId,
    GEOMETRY_PROFILE.profileId,
    ABILITY_COMPILER_PROFILE.profileId,
    ENVIRONMENT_PROFILE.profileId,
  ]);
  return Object.freeze([...new Set(corpus.chunks
    .map((chunk) => chunk.profileRef)
    .filter((profileRef) => permitted.has(profileRef)))].sort());
}

function checkedFormIds(values: readonly string[]): readonly KpFormId[] {
  if (!Array.isArray(values)
    || values.some((value) => !(KP_FORM_IDS as readonly string[]).includes(value))) {
    throw new Error("V3_CONTEXT_FORM_ALLOWLIST_INVALID");
  }
  const result = [...values] as KpFormId[];
  assertAllowedFormSet(result);
  return Object.freeze(result);
}

function exactAliasesInText(corpus: CompiledStaticCorpus, text: string): readonly string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  return Object.freeze(Object.keys(corpus.index.aliasRefs)
    .filter((alias) => normalized.includes(alias))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, 24));
}

async function retrieveWithFallback(input: Readonly<{
  corpus: CompiledStaticCorpus;
  d1: D1StaticCorpusAdapter | undefined;
  synchronize: () => Promise<void>;
  request: ReturnType<typeof createStaticRetrievalRequest>;
  allowedProfiles: readonly string[];
  allowKpOnly: boolean;
}>): Promise<Readonly<{
  chunks: ReturnType<typeof rehydrateStaticContext>;
  hits: readonly StaticRetrievalHit[];
  mode: "d1-fts" | "deterministic";
  failureCode: RetrievalFailureCode | null;
}>> {
  let hits: readonly StaticRetrievalHit[] | undefined;
  let failureCode: RetrievalFailureCode | null = null;
  if (input.d1 !== undefined) {
    try {
      await input.synchronize();
    } catch {
      failureCode = "D1_SYNC_FAILED";
    }
    if (failureCode === null) {
      try {
        hits = await retrieveStaticReferencesFromD1(input.corpus.index, input.request, input.d1);
      } catch {
        failureCode = "D1_SEARCH_FAILED";
      }
    }
  }

  let mode: "d1-fts" | "deterministic" = hits === undefined ? "deterministic" : "d1-fts";
  if (hits === undefined) {
    hits = deterministicHits(input.corpus, input.request);
  }
  let permittedHits = permittedRetrievalHits(hits, input.allowedProfiles, input.allowKpOnly);
  try {
    const chunks = rehydrateStaticContext(
      permittedHits,
      authoritativeStaticCorpusReader(input.corpus),
      { allowedProfileRefs: input.allowedProfiles, allowKpOnly: input.allowKpOnly },
    );
    return Object.freeze({ chunks, hits: permittedHits, mode, failureCode });
  } catch {
    failureCode = "RAG_REHYDRATE_FAILED";
    mode = "deterministic";
  }

  try {
    permittedHits = permittedRetrievalHits(
      deterministicHits(input.corpus, input.request),
      input.allowedProfiles,
      input.allowKpOnly,
    );
    const chunks = rehydrateStaticContext(
      permittedHits,
      authoritativeStaticCorpusReader(input.corpus),
      { allowedProfileRefs: input.allowedProfiles, allowKpOnly: input.allowKpOnly },
    );
    return Object.freeze({ chunks, hits: permittedHits, mode, failureCode });
  } catch {
    // RequiredContext is already complete and must not be discarded merely
    // because a derived retrieval layer is unavailable.
    return Object.freeze({
      chunks: Object.freeze([]),
      hits: Object.freeze([]),
      mode: "deterministic" as const,
      failureCode: "MEMORY_RETRIEVAL_FAILED" as const,
    });
  }
}

function deterministicHits(
  corpus: CompiledStaticCorpus,
  request: ReturnType<typeof createStaticRetrievalRequest>,
): readonly StaticRetrievalHit[] {
  return retrieveStaticReferences(corpus.index, request, createDeterministicFtsAdapter(corpus.index));
}

function permittedRetrievalHits(
  hits: readonly StaticRetrievalHit[],
  allowedProfiles: readonly string[],
  allowKpOnly: boolean,
): readonly StaticRetrievalHit[] {
  const profiles = new Set(allowedProfiles);
  return Object.freeze(hits.filter((hit) =>
    profiles.has(hit.profileRef) && (allowKpOnly || hit.sensitivity !== "kp-only")));
}

async function retrievalReceipt(
  hits: readonly StaticRetrievalHit[],
  mode: "d1-fts" | "deterministic",
  failureCode: RetrievalFailureCode | null,
): Promise<V3ProductionRetrievalReceipt> {
  const coordinates = hits.map((hit) => ({
    sourceRef: hit.sourceRef,
    sourceHash: hit.sourceHash,
    sourceSpan: hit.sourceSpan,
    profileRef: hit.profileRef,
    sensitivity: hit.sensitivity,
  }));
  return Object.freeze({
    profileRef: PRODUCTION_CONTEXT_PROFILE.profileRef,
    retrievalMode: mode,
    status: failureCode === null ? "selected" : "fallback",
    fallbackUsed: failureCode !== null,
    failureCode,
    hitCountBucket: countBucket(hits.length),
    selectedReferencesDigest: await sha256(canonicalJson(coordinates)),
  });
}

async function safePlannerReceipt(
  receipt: ContextPlannerReceipt,
  orderedFormIds: readonly KpFormId[],
  queryTermCount: number,
): Promise<ContextPlannerReceipt> {
  // The core receipt hashes the complete suggestion, including query text.
  // Production telemetry instead binds only the non-secret output shape.
  return Object.freeze({
    ...receipt,
    suggestionHash: await sha256(canonicalJson({ orderedFormIds, queryTermCount })),
  });
}

function environmentAliases(location: AuthoritativeModuleProfile["storyBible"]["storyAnchors"]["locations"][number]): string[] {
  const aliases = [location.name, location.location, location.sceneId];
  for (const entry of [
    ...records(location.physicalAnchors),
    ...records(location.hazardAnchors),
    ...records(location.itemAnchors),
    ...records(isRecord(location.tacticalGeometry) ? location.tacticalGeometry.obstacles : []),
  ]) {
    for (const key of ["id", "featureId", "name", "label"] as const) {
      if (typeof entry[key] === "string") aliases.push(entry[key]);
    }
    if (Array.isArray(entry.aliases)) {
      aliases.push(...entry.aliases.filter((value): value is string => typeof value === "string"));
    }
  }
  return uniqueStrings(aliases);
}

function environmentRefs(location: AuthoritativeModuleProfile["storyBible"]["storyAnchors"]["locations"][number]): string[] {
  const refs: string[] = [];
  for (const entry of [
    ...records(location.physicalAnchors),
    ...records(location.hazardAnchors),
    ...records(location.itemAnchors),
    ...records(isRecord(location.tacticalGeometry) ? location.tacticalGeometry.obstacles : []),
  ]) {
    for (const key of ["id", "featureId", "definitionId"] as const) {
      if (typeof entry[key] === "string" && entry[key].trim().length > 0) refs.push(entry[key]);
    }
  }
  return uniqueStrings(refs);
}

function countBucket(count: number): V3ProductionRetrievalReceipt["hitCountBucket"] {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 4) return "2-4";
  if (count <= 8) return "5-8";
  if (count <= 16) return "9-16";
  return "17+";
}

function canonicalRef(value: string): string {
  const result = value.normalize("NFKC").trim();
  if (result.length === 0) throw new Error("V3_CONTEXT_STATIC_REF_INVALID");
  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values
    .map((value) => value.normalize("NFKC").trim())
    .filter((value) => value.length > 0))].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return Object.values(value).filter(isRecord);
  return [];
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("V3_CONTEXT_STATIC_VALUE_INVALID");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) throw new Error("V3_CONTEXT_STATIC_VALUE_INVALID");
  return Object.fromEntries(Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => [key, canonicalValue(value[key])]));
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
