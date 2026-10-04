import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalGeometry,
} from "../rules/profiles/tactical-geometry";
import {
  BLACK_OAK_OPENING_PLACEMENTS_V2,
  BLACK_OAK_TACTICAL_GEOMETRY_V1,
  BLACK_OAK_TACTICAL_GEOMETRY_V2,
  BLACK_OAK_TACTICAL_GEOMETRY_V3,
  BLACK_OAK_TACTICAL_GEOMETRY_V4,
} from "./black-oak-will-tactical";
import {
  BLACK_OAK_SCENE_CONNECTIONS_V4,
  BLACK_OAK_SITE_PLAN_V4,
  type ModuleSceneConnection,
  type ModuleSitePlacement,
} from "./black-oak-will-connections";
import type { TacticalPosition } from "../rules/tactical-projection";
import {
  blackOakWillPremiseCatalog,
  BLACK_OAK_WILL_SOCIAL_MECHANICS_V1,
  type ModulePremiseCatalog,
  type ModuleNpcSocialProfile,
} from "./black-oak-will-social";
import { findModule } from "./index";
import {
  isPinnedModuleVersion,
  isRegisteredModuleRef,
  registeredModuleProfileId,
  type PinnedModuleRef,
  type PinnedModuleVersion,
  type PinnedSha256Ref,
} from "./registry";
import type { ModuleDef, NpcDef, SceneDef } from "./schema";

type Sha256Ref = PinnedSha256Ref;

export type AuthoritativeModuleRef = PinnedModuleRef;

export type AuthoritativeModuleVersion = PinnedModuleVersion;

export type ModuleNpcAnchor = {
  entityId: string;
  sourceNpcId: string;
  name: string;
  publicFace: string;
  goal: string;
  behavioralConstraints: {
    hostileIf: string;
    canBePersuaded: string;
  };
  initialKnowledge: string[];
  declaredUnknowns: string[];
  mechanicalAnchor: string;
  socialMechanics?: ModuleNpcSocialProfile;
  voice: string;
  exampleLines: string[];
  startSceneId: string;
};

export type AuthoritativeStoryBible = {
  contentBoundary: {
    tone: string;
    failureMeans: string;
    bannedPatterns: string[];
  };
  coreTruth: string;
  storyAnchors: {
    chapters: Array<{
      chapterId: string;
      name: string;
      intent: string;
      sceneIds: string[];
    }>;
    locations: Array<{
      sceneId: string;
      chapterId: string;
      name: string;
      location: string;
      publicOpening: string;
      npcIds: string[];
      clueIds: string[];
      conflictAnchor?: string;
      physicalAnchors: unknown[];
      hazardAnchors: unknown[];
      itemAnchors: unknown[];
      tacticalGeometry?: CanonicalTacticalGeometry;
      /** ADR 0087: where module people stand when the scene opens; used only
       * to place them at genesis. Later places are the room's own state. */
      openingPlacements?: Record<string, TacticalPosition>;
    }>;
    clues: Array<{
      clueId: string;
      name: string;
      revealWhen: string;
      publicLayer: string;
      fullLayer: string;
      failureLayer: string;
      nextStepHint: string;
      pointsTo: string;
      check?: { skill: string; dc: number };
    }>;
  };
  importantNpcs: ModuleNpcAnchor[];
  premiseCatalog?: ModulePremiseCatalog;
  openBlanks: string[];
  initialPressures: string[];
  sequelSignals: string[];
};

/** SPEC 0014 §2.1 (ADR 0098): how the scene maps connect and where each lies
 * in one site plan, for Room to read at genesis as it reads the maps. It
 * sits outside the story bible, so no model context carries it. */
export type ModuleTacticalSite = {
  connections: ModuleSceneConnection[];
  sitePlan: Record<string, ModuleSitePlacement>;
};

export type AuthoritativeModuleProfile = {
  moduleId: string;
  moduleVersion: AuthoritativeModuleVersion;
  compatibleRulesetVersion: typeof AUTHORITATIVE_RULESET_VERSION;
  moduleRef: AuthoritativeModuleRef;
  title: string;
  tone: string;
  storyBible: AuthoritativeStoryBible;
  /** Absent before social-resolution-v4. */
  tacticalSite?: ModuleTacticalSite;
};

export type ModuleInitializationFixture = {
  knowledgeRef: string;
  holderEntityId: string;
  holderName: string;
  sceneId: string;
  content: string;
  sourceKind: "moduleAnchor";
};

export const SOCIAL_RESOLUTION_MODULE_VERSION = "social-resolution-v1" as const;
/** ADR 0087: the same module with the wake's opening places on its map. */
export const OPENING_PLACEMENT_MODULE_VERSION = "social-resolution-v2" as const;
/** SPEC 0014 §4 (ADR 0098): v2 with the terrain its maps record. */
export const TERRAIN_MODULE_VERSION = "social-resolution-v3" as const;
/** SPEC 0014 §2.1 (ADR 0098): v3 with every map completed from the module
 * text, a door on both sides of every module connection, and the maps in
 * one site plan. */
export const CONNECTED_SITE_MODULE_VERSION = "social-resolution-v4" as const;
/** The version a new room is created with; a room keeps its own after that. */
export const CURRENT_AUTHORITATIVE_MODULE_VERSION = CONNECTED_SITE_MODULE_VERSION;
const CURRENT_MODULE_VERSION = CURRENT_AUTHORITATIVE_MODULE_VERSION;

/** Every version carries the structured social mechanics and tactical scenes. */
export function isSocialResolutionModuleVersion(value: unknown): boolean {
  return value === SOCIAL_RESOLUTION_MODULE_VERSION || value === OPENING_PLACEMENT_MODULE_VERSION
    || value === TERRAIN_MODULE_VERSION || value === CONNECTED_SITE_MODULE_VERSION;
}

/** Each version's maps; v3 and v4 keep v2's opening places. */
const BLACK_OAK_TACTICAL_GEOMETRY: Readonly<Record<string, Readonly<Record<string, CanonicalTacticalGeometry>>>> = {
  [SOCIAL_RESOLUTION_MODULE_VERSION]: BLACK_OAK_TACTICAL_GEOMETRY_V1,
  [OPENING_PLACEMENT_MODULE_VERSION]: BLACK_OAK_TACTICAL_GEOMETRY_V2,
  [TERRAIN_MODULE_VERSION]: BLACK_OAK_TACTICAL_GEOMETRY_V3,
  [CONNECTED_SITE_MODULE_VERSION]: BLACK_OAK_TACTICAL_GEOMETRY_V4,
};

/** Each version's connections and site plan, from v4 on. */
const BLACK_OAK_TACTICAL_SITE: Readonly<Record<string, Readonly<{
  connections: readonly ModuleSceneConnection[];
  sitePlan: Readonly<Record<string, ModuleSitePlacement>>;
}>>> = {
  [CONNECTED_SITE_MODULE_VERSION]: { connections: BLACK_OAK_SCENE_CONNECTIONS_V4, sitePlan: BLACK_OAK_SITE_PLAN_V4 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Module profiles support finite JSON only.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError("Module profiles support JSON values only.");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

async function sha256(value: unknown): Promise<Sha256Ref> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function npcStartScene(mod: ModuleDef, npc: NpcDef): string {
  return mod.chapters
    .flatMap((chapter) => chapter.scenes)
    .find((scene) => scene.npcs.includes(npc.id))?.id
    ?? mod.chapters[0]?.scenes[0]?.id
    ?? "module-entry";
}

function npcEntityId(mod: ModuleDef, npc: NpcDef): string {
  return `npc:${mod.id}:${npc.id}`;
}

function locationAnchor(
  mod: ModuleDef,
  scene: SceneDef,
  chapterId: string,
  moduleVersion: AuthoritativeModuleVersion,
) {
  const tacticalGeometry = isSocialResolutionModuleVersion(moduleVersion)
    && mod.id === "black-oak-will"
    ? BLACK_OAK_TACTICAL_GEOMETRY[moduleVersion]?.[scene.id]
    : undefined;
  const openingPlacements = (moduleVersion === OPENING_PLACEMENT_MODULE_VERSION || moduleVersion === TERRAIN_MODULE_VERSION
    || moduleVersion === CONNECTED_SITE_MODULE_VERSION)
    && mod.id === "black-oak-will"
    ? BLACK_OAK_OPENING_PLACEMENTS_V2[scene.id] : undefined;
  if (isSocialResolutionModuleVersion(moduleVersion)
    && (tacticalGeometry === undefined || !isCanonicalTacticalGeometry(tacticalGeometry))) {
    throw new TypeError(`Tactical module scene lacks canonical geometry: ${mod.id}:${scene.id}`);
  }
  return {
    sceneId: scene.id,
    chapterId,
    name: scene.name,
    location: scene.location,
    publicOpening: scene.boxedText,
    npcIds: [...scene.npcs].sort(),
    clueIds: [...scene.clues].sort(),
    ...(scene.defaultConflict === undefined ? {} : { conflictAnchor: scene.defaultConflict }),
    physicalAnchors: structuredClone(scene.physicalChallenges ?? []),
    hazardAnchors: structuredClone(scene.hazards ?? []),
    itemAnchors: structuredClone(scene.environmentItems ?? []),
    ...(tacticalGeometry === undefined
      ? {}
      : { tacticalGeometry: structuredClone(tacticalGeometry) }),
    ...(openingPlacements === undefined ? {} : { openingPlacements: structuredClone(openingPlacements) as Record<string, TacticalPosition> }),
  };
}

function storyBible(
  mod: ModuleDef,
  moduleVersion: AuthoritativeModuleVersion,
): AuthoritativeStoryBible {
  const importantNpcs = mod.npcs.map((npc) => {
    const socialMechanics = isSocialResolutionModuleVersion(moduleVersion)
      && mod.id === "black-oak-will"
      ? BLACK_OAK_WILL_SOCIAL_MECHANICS_V1[npc.id]
      : undefined;
    if (isSocialResolutionModuleVersion(moduleVersion) && socialMechanics === undefined) {
      throw new TypeError(`Social module NPC lacks structured mechanics: ${mod.id}:${npc.id}`);
    }
    return {
      entityId: npcEntityId(mod, npc),
      sourceNpcId: npc.id,
      name: npc.name,
      publicFace: npc.publicFace,
      goal: npc.goal,
      behavioralConstraints: {
        hostileIf: npc.hostileIf,
        canBePersuaded: npc.canBePersuaded,
      },
      initialKnowledge: [...npc.knows],
      declaredUnknowns: [...npc.doesNotKnow],
      mechanicalAnchor: npc.stats,
      ...(socialMechanics === undefined
        ? {}
        : { socialMechanics: structuredClone(socialMechanics) }),
      voice: npc.voice,
      exampleLines: [...npc.lines],
      startSceneId: npcStartScene(mod, npc),
    };
  });
  return {
    contentBoundary: {
      tone: mod.tone,
      failureMeans: mod.failureMeans,
      bannedPatterns: [...mod.banned],
    },
    coreTruth: mod.truth,
    storyAnchors: {
      chapters: mod.chapters.map((chapter) => ({
        chapterId: chapter.id,
        name: chapter.name,
        intent: chapter.intent,
        sceneIds: chapter.scenes.map((scene) => scene.id),
      })),
      locations: mod.chapters.flatMap((chapter) =>
        chapter.scenes.map((scene) => locationAnchor(mod, scene, chapter.id, moduleVersion))),
      clues: mod.clues.map((clue) => ({
        clueId: clue.id,
        name: clue.name,
        revealWhen: clue.revealWhen,
        publicLayer: clue.talkText,
        fullLayer: clue.playerText,
        failureLayer: clue.failText,
        nextStepHint: clue.hint,
        pointsTo: clue.pointsTo,
        ...(clue.dc === undefined
          ? {}
          : { check: { skill: clue.dc.skill, dc: clue.dc.value } }),
      })),
    },
    importantNpcs,
    ...(isSocialResolutionModuleVersion(moduleVersion) && mod.id === "black-oak-will"
      ? { premiseCatalog: structuredClone(blackOakWillPremiseCatalog(`module:${mod.id}:${moduleVersion}`)) }
      : {}),
    openBlanks: [
      "未登记但因果合理的行动、通路、地点、人物、危险、物品与机会保持开放，由 KP 提案并经权威事务固化。",
      "世界中没有证据或因果要求的内容可以合法为空，不强制生成战斗、线索、奖励或幕后操纵者。",
      "章节与场景只提供故事锚点，不规定唯一顺序、路线、解决办法或结局。",
    ],
    initialPressures: [
      ...mod.chapters.flatMap((chapter) =>
        chapter.scenes.flatMap((scene) =>
          scene.defaultConflict === undefined ? [] : [scene.defaultConflict])),
      ...mod.stallBeats,
      ...mod.triggers.map((trigger) => `${trigger.if} → ${trigger.then}`),
      ...mod.failures.map((failure) => `${failure.if} → ${failure.then}`),
    ],
    sequelSignals: [...mod.sequelHooks],
  };
}

function unsignedProfile(
  mod: ModuleDef,
  moduleVersion: AuthoritativeModuleVersion,
): Omit<AuthoritativeModuleProfile, "moduleRef"> & {
  moduleRef: { profileId: string };
} {
  const site = mod.id === "black-oak-will" ? BLACK_OAK_TACTICAL_SITE[moduleVersion] : undefined;
  return {
    moduleId: mod.id,
    moduleVersion,
    compatibleRulesetVersion: AUTHORITATIVE_RULESET_VERSION,
    moduleRef: { profileId: `module:${mod.id}:${moduleVersion}` },
    title: mod.title,
    tone: mod.tone,
    storyBible: storyBible(mod, moduleVersion),
    ...(site === undefined ? {} : {
      tacticalSite: { connections: structuredClone([...site.connections]), sitePlan: structuredClone({ ...site.sitePlan }) },
    }),
  };
}

function profilePayload(profile: AuthoritativeModuleProfile | ReturnType<typeof unsignedProfile>) {
  return {
    moduleId: profile.moduleId,
    moduleVersion: profile.moduleVersion,
    compatibleRulesetVersion: profile.compatibleRulesetVersion,
    moduleRef: { profileId: profile.moduleRef.profileId },
    title: profile.title,
    tone: profile.tone,
    storyBible: profile.storyBible,
    ...(profile.tacticalSite === undefined ? {} : { tacticalSite: profile.tacticalSite }),
  };
}

export async function authoritativeModuleProfile(
  moduleId: string,
  moduleVersion: string = CURRENT_MODULE_VERSION,
): Promise<AuthoritativeModuleProfile> {
  const mod = findModule(moduleId);
  if (mod === null) throw new Error(`Unknown authoritative module: ${moduleId}`);
  if (!isPinnedModuleVersion(moduleVersion) || registeredModuleProfileId(moduleId, moduleVersion) === undefined) {
    throw new Error(`Unknown authoritative module version: ${moduleId}@${moduleVersion}`);
  }
  const unsigned = unsignedProfile(mod, moduleVersion);
  // The hash describes the content this deploy carries; nothing pins it.
  return { ...unsigned, moduleRef: { profileId: unsigned.moduleRef.profileId, profileHash: await sha256(profilePayload(unsigned)) } };
}

/** The module a room was created with, by its version. The room keeps the
 * ref it stored, so every read and binding of this room names the same ref
 * even after the module's text changed in place. */
export async function authoritativeModuleProfileForRoom(
  moduleId: string,
  roomRef: unknown,
): Promise<AuthoritativeModuleProfile | undefined> {
  if (!isRegisteredModuleRef(moduleId, roomRef)) return undefined;
  const ref = roomRef as AuthoritativeModuleRef;
  if (typeof ref.profileHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(ref.profileHash)) return undefined;
  const profile = await authoritativeModuleProfile(moduleId, ref.profileId.slice(`module:${moduleId}:`.length));
  return { ...profile, moduleRef: { profileId: ref.profileId, profileHash: ref.profileHash } };
}

export function moduleKpProjection(profile: AuthoritativeModuleProfile) {
  return {
    viewer: { kind: "kp" as const },
    moduleRef: structuredClone(profile.moduleRef),
    moduleId: profile.moduleId,
    moduleVersion: profile.moduleVersion,
    compatibleRulesetVersion: profile.compatibleRulesetVersion,
    storyBible: structuredClone(profile.storyBible),
  };
}

export function modulePublicCatalogEntry(profile: AuthoritativeModuleProfile) {
  return {
    moduleId: profile.moduleId,
    moduleVersion: profile.moduleVersion,
    compatibleRulesetVersion: profile.compatibleRulesetVersion,
    moduleRef: structuredClone(profile.moduleRef),
    title: profile.title,
    tone: profile.tone,
  };
}

export function moduleInitializationFixtures(
  profile: AuthoritativeModuleProfile,
): ModuleInitializationFixture[] {
  return profile.storyBible.importantNpcs.flatMap((npc) =>
    npc.initialKnowledge.map((content, index) => ({
      knowledgeRef: `${npc.entityId}:module-knowledge:${String(index + 1).padStart(2, "0")}`,
      holderEntityId: npc.entityId,
      holderName: npc.name,
      sceneId: npc.startSceneId,
      content,
      sourceKind: "moduleAnchor" as const,
    })),
  );
}

export type ModuleAuthorityFactSeed = Readonly<{
  id: string;
  kind: "moduleAnchor" | "modulePremisePolicy" | "modulePremiseArchetype";
  subjectRefs: readonly string[];
  value: unknown;
  visibilityPolicyId: "visibility:room-authority-only";
  source: "moduleAnchor";
}>;

/** Trusted genesis catalog consumed by Rules during replay. Step never loads
 * a mutable current module profile to interpret an existing room. */
export function moduleAuthorityFactSeeds(
  profile: AuthoritativeModuleProfile,
): ModuleAuthorityFactSeed[] {
  const catalog = profile.storyBible.premiseCatalog;
  if (catalog === undefined) return [];
  if (catalog.moduleProfileId !== profile.moduleRef.profileId) {
    throw new TypeError("Module premise catalog is bound to a different profile.");
  }
  const moduleRef = structuredClone(profile.moduleRef);
  const anchorKinds = new Map<string, "coreTruth" | "storyAnchors">([
    [`${profile.moduleRef.profileId}:core-truth`, "coreTruth"],
    [`${profile.moduleRef.profileId}:story-anchors`, "storyAnchors"],
  ]);
  const anchors = [...anchorKinds].map(([id, anchorKind]) => ({
    id,
    kind: "moduleAnchor" as const,
    subjectRefs: [],
    value: {
      schema: "zhuwei.module-anchor/v1",
      moduleRef,
      anchorKind,
    },
    visibilityPolicyId: "visibility:room-authority-only" as const,
    source: "moduleAnchor" as const,
  }));
  const policies = catalog.policies.map((policy) => ({
    id: policy.policyRef,
    kind: "modulePremisePolicy" as const,
    subjectRefs: [],
    value: {
      schema: "zhuwei.module-premise-policy/v1",
      moduleRef,
      policy: structuredClone(policy),
    },
    visibilityPolicyId: "visibility:room-authority-only" as const,
    source: "moduleAnchor" as const,
  }));
  const archetypes = catalog.archetypes.map((archetype) => ({
    id: archetype.archetypeRef,
    kind: "modulePremiseArchetype" as const,
    subjectRefs: [],
    value: {
      schema: "zhuwei.module-premise-archetype/v1",
      moduleRef,
      archetype: structuredClone(archetype),
    },
    visibilityPolicyId: "visibility:room-authority-only" as const,
    source: "moduleAnchor" as const,
  }));
  return [...anchors, ...policies, ...archetypes];
}
