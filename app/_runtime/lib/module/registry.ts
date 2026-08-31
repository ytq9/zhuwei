export type PinnedSha256Ref = `sha256:${string}`;

export type PinnedModuleRef = {
  profileId: string;
  profileHash: PinnedSha256Ref;
};

export type PinnedModuleVersion = "social-resolution-v1";

const MODULE_REFS: Readonly<Record<string, PinnedModuleRef>> = Object.freeze({
  "black-oak-will@social-resolution-v1": Object.freeze({
    profileId: "module:black-oak-will:social-resolution-v1",
    profileHash: "sha256:e04a553deb9808df6dc614e813fa503c6ff659cae2570e738969ac0e70fbc272",
  }),
});

export function pinnedModuleRef(
  moduleId: string,
  moduleVersion: string,
): PinnedModuleRef | undefined {
  const value = MODULE_REFS[`${moduleId}@${moduleVersion}`];
  return value === undefined ? undefined : structuredClone(value);
}

export function isPinnedModuleVersion(value: string): value is PinnedModuleVersion {
  return value === "social-resolution-v1";
}
