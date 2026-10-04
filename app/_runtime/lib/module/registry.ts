export type PinnedSha256Ref = `sha256:${string}`;

export type PinnedModuleRef = {
  profileId: string;
  profileHash: PinnedSha256Ref;
};

export type PinnedModuleVersion = "social-resolution-v1" | "social-resolution-v2" | "social-resolution-v3"
  | "social-resolution-v4";

/** The versions a room can be created with. A room knows its module by the
 * version's profile id; the content is not pinned by a hash (ADR 0088).
 * social-resolution-v2 sets out the wake's opening places, stairs and
 * counter (ADR 0087); social-resolution-v3 adds terrain: materials, and a
 * ditch and a low wall in the back yard (ADR 0098); social-resolution-v4
 * completes every map from the module text, puts a door on both sides of
 * every module connection and places the maps in one site plan (SPEC 0014
 * §2.1, ADR 0098). Rooms created earlier keep their version. */
const MODULE_VERSIONS: Readonly<Record<string, readonly PinnedModuleVersion[]>> = Object.freeze({
  "black-oak-will": Object.freeze(["social-resolution-v1", "social-resolution-v2", "social-resolution-v3",
    "social-resolution-v4"] as const),
});

export function registeredModuleProfileId(moduleId: string, moduleVersion: string): string | undefined {
  return MODULE_VERSIONS[moduleId]?.some(version => version === moduleVersion)
    ? `module:${moduleId}:${moduleVersion}` : undefined;
}

export function isPinnedModuleVersion(value: string): value is PinnedModuleVersion {
  return value === "social-resolution-v1" || value === "social-resolution-v2" || value === "social-resolution-v3"
    || value === "social-resolution-v4";
}

/** Whether `ref` names a registered version of the module. */
export function isRegisteredModuleRef(moduleId: string, ref: unknown): boolean {
  return typeof ref === "object" && ref !== null && !Array.isArray(ref)
    && (MODULE_VERSIONS[moduleId] ?? []).some(version =>
      (ref as Record<string, unknown>).profileId === `module:${moduleId}:${version}`);
}
