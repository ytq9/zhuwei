import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";

export type PinnedSha256Ref = `sha256:${string}`;

export type PinnedModuleRef = {
  profileId: string;
  profileHash: PinnedSha256Ref;
};

export type PinnedModuleVersion = "legacy-anchor-v1" | "legacy-anchor-v2" | "tactical-map-v1";

export type PinnedModuleMigrationDescriptor = {
  moduleId: string;
  fromModuleRef: PinnedModuleRef;
  toModuleRef: PinnedModuleRef;
  compatibleRulesetVersion: typeof AUTHORITATIVE_RULESET_VERSION;
  migrationRef: PinnedModuleRef;
  chapterBoundaryOnly: true;
  mappingPolicy: "preserveAuthoritativeRoomState";
  preservedState: string[];
};

const MODULE_REFS: Readonly<Record<string, PinnedModuleRef>> = Object.freeze({
  "black-oak-will@legacy-anchor-v1": Object.freeze({
    profileId: "module:black-oak-will:legacy-anchor-v1",
    profileHash: "sha256:198ad1c122a84abffc881cfb4b0c5f6bcb32cd2411acb07aceb33163694b37f9",
  }),
  "black-oak-will@legacy-anchor-v2": Object.freeze({
    profileId: "module:black-oak-will:legacy-anchor-v2",
    profileHash: "sha256:283e0b6dfd7bab0a27895e741b9b56a2c536ba02ef922d4a35ebe43227ce0a03",
  }),
  "black-oak-will@tactical-map-v1": Object.freeze({
    profileId: "module:black-oak-will:tactical-map-v1",
    profileHash: "sha256:df49e12260b590d339961c2a19b3ddc5f59741d2a8521d4d97dbf151d9177947",
  }),
});

const PRESERVED_MODULE_MIGRATION_STATE = Object.freeze([
  "activities",
  "artifacts",
  "canonicalFacts",
  "corrections",
  "debts",
  "dynamicDefinitions",
  "factionPlans",
  "knowledge",
  "npcPlans",
  "promises",
  "relationships",
  "threats",
]);

const MODULE_MIGRATIONS: Readonly<Record<string, PinnedModuleMigrationDescriptor>> = Object.freeze({
  "black-oak-will@legacy-anchor-v1->legacy-anchor-v2": Object.freeze({
    moduleId: "black-oak-will",
    fromModuleRef: MODULE_REFS["black-oak-will@legacy-anchor-v1"],
    toModuleRef: MODULE_REFS["black-oak-will@legacy-anchor-v2"],
    compatibleRulesetVersion: AUTHORITATIVE_RULESET_VERSION,
    migrationRef: Object.freeze({
      profileId: "module-migration:black-oak-will:legacy-anchor-v1-to-legacy-anchor-v2",
      profileHash: "sha256:447f943f76ccb536cd8e1cee7f08cf058ddead6c5fa2b3eed7af4d1596a47c4d",
    }),
    chapterBoundaryOnly: true,
    mappingPolicy: "preserveAuthoritativeRoomState",
    preservedState: [...PRESERVED_MODULE_MIGRATION_STATE],
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isPinnedRefShape(value: unknown): value is PinnedModuleRef {
  return isRecord(value)
    && hasExactKeys(value, ["profileHash", "profileId"])
    && typeof value.profileId === "string"
    && value.profileId.length > 0
    && typeof value.profileHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.profileHash);
}

function sameRef(left: PinnedModuleRef, right: PinnedModuleRef): boolean {
  return left.profileId === right.profileId && left.profileHash === right.profileHash;
}

function sameDescriptor(
  candidate: PinnedModuleMigrationDescriptor,
  pinned: PinnedModuleMigrationDescriptor,
): boolean {
  return candidate.moduleId === pinned.moduleId
    && sameRef(candidate.fromModuleRef, pinned.fromModuleRef)
    && sameRef(candidate.toModuleRef, pinned.toModuleRef)
    && candidate.compatibleRulesetVersion === pinned.compatibleRulesetVersion
    && sameRef(candidate.migrationRef, pinned.migrationRef)
    && candidate.chapterBoundaryOnly === pinned.chapterBoundaryOnly
    && candidate.mappingPolicy === pinned.mappingPolicy
    && candidate.preservedState.length === pinned.preservedState.length
    && candidate.preservedState.every((entry, index) => entry === pinned.preservedState[index]);
}

function descriptorShape(value: unknown): PinnedModuleMigrationDescriptor | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "chapterBoundaryOnly",
      "compatibleRulesetVersion",
      "fromModuleRef",
      "mappingPolicy",
      "migrationRef",
      "moduleId",
      "preservedState",
      "toModuleRef",
    ])
    || typeof value.moduleId !== "string"
    || value.moduleId.length === 0
    || !isPinnedRefShape(value.fromModuleRef)
    || !isPinnedRefShape(value.toModuleRef)
    || !isPinnedRefShape(value.migrationRef)
    || value.compatibleRulesetVersion !== AUTHORITATIVE_RULESET_VERSION
    || value.chapterBoundaryOnly !== true
    || value.mappingPolicy !== "preserveAuthoritativeRoomState"
    || !Array.isArray(value.preservedState)
    || !value.preservedState.every((entry) => typeof entry === "string" && entry.length > 0)
  ) return undefined;
  return value as PinnedModuleMigrationDescriptor;
}

export function pinnedModuleRef(
  moduleId: string,
  moduleVersion: string,
): PinnedModuleRef | undefined {
  const value = MODULE_REFS[`${moduleId}@${moduleVersion}`];
  return value === undefined ? undefined : structuredClone(value);
}

export function isPinnedModuleVersion(value: string): value is PinnedModuleVersion {
  return value === "legacy-anchor-v1"
    || value === "legacy-anchor-v2"
    || value === "tactical-map-v1";
}

export function pinnedModuleMigrationDescriptor(
  moduleId: string,
  fromVersion: string,
  toVersion: string,
): PinnedModuleMigrationDescriptor | undefined {
  const value = MODULE_MIGRATIONS[`${moduleId}@${fromVersion}->${toVersion}`];
  return value === undefined ? undefined : structuredClone(value);
}

/** Resolves only an exact, fully pinned descriptor; no caller hash can self-certify. */
export function resolvePinnedModuleMigrationDescriptor(
  value: unknown,
): PinnedModuleMigrationDescriptor | undefined {
  const candidate = descriptorShape(value);
  if (candidate === undefined) return undefined;
  const pinned = Object.values(MODULE_MIGRATIONS).find((entry) => sameDescriptor(candidate, entry));
  return pinned === undefined ? undefined : structuredClone(pinned);
}
