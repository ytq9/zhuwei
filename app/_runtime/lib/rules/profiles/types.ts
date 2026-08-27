export type Sha256Ref = `sha256:${string}`;

export type ProfileRef = {
  profileId: string;
  profileHash: Sha256Ref;
};

export type RuntimeProfileManifest = {
  manifest: ProfileRef;
  ruleset: ProfileRef;
  eventSchema: ProfileRef;
  abilityCompiler: ProfileRef;
  geometry: ProfileRef;
  triggerOrdering: ProfileRef;
  fictionCombatTime: ProfileRef;
  extensions: ProfileRef[];
};

export type CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1";
  profileKind: string;
  profileId: string;
  semanticVersion: string;
  normativePayload: Readonly<Record<string, unknown>>;
};

export type RuntimeProfileRejectionCode =
  | "invalidRuntimeManifest"
  | "profileIntegrityMismatch"
  | "profileRegistryConformanceFailure"
  | "runtimeProfileMismatch"
  | "unsupportedHistoricalProfile"
  | "unsupportedProfile";

export type RuntimeProfileRejection = {
  code: RuntimeProfileRejectionCode;
  message: string;
};

export type RuntimeProfileValidation =
  | {
      ok: true;
      profiles: RuntimeProfileManifest;
    }
  | {
      ok: false;
      rejection: RuntimeProfileRejection;
    };
