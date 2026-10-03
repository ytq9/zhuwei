export type PinnedSha256Ref = `sha256:${string}`;

export type PinnedModuleRef = {
  profileId: string;
  profileHash: PinnedSha256Ref;
};

export type PinnedModuleVersion = "social-resolution-v1" | "social-resolution-v2";

/** The versions a room can be created with. A room knows its module by the
 * version's profile id; the content is not pinned by a hash (ADR 0088).
 * social-resolution-v2 sets out the wake's opening places, stairs and
 * counter (ADR 0087); rooms created earlier keep v1. */
const MODULE_VERSIONS: Readonly<Record<string, readonly PinnedModuleVersion[]>> = Object.freeze({
  "black-oak-will": Object.freeze(["social-resolution-v1", "social-resolution-v2"] as const),
});

export function registeredModuleProfileId(moduleId: string, moduleVersion: string): string | undefined {
  return MODULE_VERSIONS[moduleId]?.some(version => version === moduleVersion)
    ? `module:${moduleId}:${moduleVersion}` : undefined;
}

export function isPinnedModuleVersion(value: string): value is PinnedModuleVersion {
  return value === "social-resolution-v1" || value === "social-resolution-v2";
}

/** Whether `ref` names a registered version of the module. */
export function isRegisteredModuleRef(moduleId: string, ref: unknown): boolean {
  return typeof ref === "object" && ref !== null && !Array.isArray(ref)
    && (MODULE_VERSIONS[moduleId] ?? []).some(version =>
      (ref as Record<string, unknown>).profileId === `module:${moduleId}:${version}`);
}
