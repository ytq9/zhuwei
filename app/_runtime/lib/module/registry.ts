export type PinnedSha256Ref = `sha256:${string}`;

export type PinnedModuleRef = {
  profileId: string;
  profileHash: PinnedSha256Ref;
};

export type PinnedModuleVersion = "social-resolution-v1" | "social-resolution-v2";

const MODULE_REFS: Readonly<Record<string, PinnedModuleRef>> = Object.freeze({
  "black-oak-will@social-resolution-v1": Object.freeze({
    profileId: "module:black-oak-will:social-resolution-v1",
    profileHash: "sha256:e04a553deb9808df6dc614e813fa503c6ff659cae2570e738969ac0e70fbc272",
  }),
  // ADR 0087: the wake's opening places and its stairs and counter.
  "black-oak-will@social-resolution-v2": Object.freeze({
    profileId: "module:black-oak-will:social-resolution-v2",
    profileHash: "sha256:3d3628c07ee872d64c881db1647e7f1b9133c0d4d60e2f8788752d2f7f3d69a8",
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
  return value === "social-resolution-v1" || value === "social-resolution-v2";
}

/** Whether `ref` is the pinned profile of any registered version of the
 * module: a room keeps the version it was created with. */
export function isPinnedModuleRef(moduleId: string, ref: unknown): boolean {
  return Object.entries(MODULE_REFS).some(([key, value]) => key.startsWith(`${moduleId}@`)
    && typeof ref === "object" && ref !== null && JSON.stringify(ref) === JSON.stringify(value));
}
