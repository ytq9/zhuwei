import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
  LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  profileRegistryMatchesCanonicalDocuments,
} from "./manifests";
import type {
  ProfileRef,
  RuntimeProfileManifest,
  RuntimeProfileRejectionCode,
  RuntimeProfileValidation,
} from "./types";

const MANIFEST_KEYS = [
  "manifest",
  "ruleset",
  "eventSchema",
  "abilityCompiler",
  "geometry",
  "triggerOrdering",
  "fictionCombatTime",
  "extensions",
] as const;

const PROFILE_REF_KEYS = ["profileHash", "profileId"] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type RuntimeInterpreterKind = "authoritative-v2";

export type RuntimeInterpreterRegistration = {
  manifest: RuntimeProfileManifest;
  interpreterKind: RuntimeInterpreterKind;
};

export type RuntimeProfileRegistry = {
  readonly registrations: readonly RuntimeInterpreterRegistration[];
  readonly defaultManifest: RuntimeProfileManifest;
  readonly conformanceCheck?: () => boolean;
};

export type RuntimeProfileResolution =
  | {
      ok: true;
      profiles: RuntimeProfileManifest;
      interpreterKind: RuntimeInterpreterKind;
    }
  | {
      ok: false;
      rejection: {
        code: RuntimeProfileRejectionCode;
        message: string;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isProfileRef(value: unknown): value is ProfileRef {
  return isRecord(value)
    && hasExactKeys(value, PROFILE_REF_KEYS)
    && typeof value.profileId === "string"
    && value.profileId.length > 0
    && typeof value.profileHash === "string"
    && SHA256_PATTERN.test(value.profileHash);
}

function rejection(
  code: RuntimeProfileRejectionCode,
  message: string,
): RuntimeProfileResolution {
  return { ok: false, rejection: { code, message } };
}

function isHistoricalProfileId(profileId: string): boolean {
  const normalized = profileId.toLowerCase();
  return normalized.includes("legacy")
    || normalized.includes("preview")
    || profileId === "dnd5e-2014-srd5.1-v1";
}

function containsForbiddenRulesBasis(profileId: string): boolean {
  const normalized = profileId.toLowerCase();
  return normalized.includes("dnd2024")
    || normalized.includes("d&d-2024")
    || normalized.includes("5.5e")
    || normalized.includes("weapon-mastery")
    || normalized.includes("weapon_mastery");
}

function allManifestRefs(profiles: RuntimeProfileManifest): ProfileRef[] {
  return [
    profiles.manifest,
    profiles.ruleset,
    profiles.eventSchema,
    profiles.abilityCompiler,
    profiles.geometry,
    profiles.triggerOrdering,
    profiles.fictionCombatTime,
    ...profiles.extensions,
  ];
}

function manifestShape(value: unknown): RuntimeProfileManifest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    return undefined;
  }
  if (
    !isProfileRef(value.manifest)
    || !isProfileRef(value.ruleset)
    || !isProfileRef(value.eventSchema)
    || !isProfileRef(value.abilityCompiler)
    || !isProfileRef(value.geometry)
    || !isProfileRef(value.triggerOrdering)
    || !isProfileRef(value.fictionCombatTime)
    || !Array.isArray(value.extensions)
    || !value.extensions.every(isProfileRef)
  ) {
    return undefined;
  }
  return value as RuntimeProfileManifest;
}

function refsEqual(left: ProfileRef, right: ProfileRef): boolean {
  return left.profileId === right.profileId && left.profileHash === right.profileHash;
}

function cloneManifest(manifest: RuntimeProfileManifest): RuntimeProfileManifest {
  return structuredClone(manifest) as RuntimeProfileManifest;
}

function immutableManifest(manifest: RuntimeProfileManifest): RuntimeProfileManifest {
  const cloned = cloneManifest(manifest);
  Object.freeze(cloned.manifest);
  Object.freeze(cloned.ruleset);
  Object.freeze(cloned.eventSchema);
  Object.freeze(cloned.abilityCompiler);
  Object.freeze(cloned.geometry);
  Object.freeze(cloned.triggerOrdering);
  Object.freeze(cloned.fictionCombatTime);
  cloned.extensions.forEach((extension) => Object.freeze(extension));
  Object.freeze(cloned.extensions);
  return Object.freeze(cloned);
}

/**
 * Builds an immutable-by-copy registry. Registration is deployment wiring, not
 * a fourth adjudication interface: callers still interact only through
 * step/project/replay, while each manifest resolves to an explicit interpreter.
 */
export function createRuntimeProfileRegistry(config: {
  registrations: readonly RuntimeInterpreterRegistration[];
  defaultManifest: ProfileRef;
  conformanceCheck?: () => boolean;
}): RuntimeProfileRegistry {
  if (config.registrations.length === 0) {
    throw new TypeError("Runtime Profile Registry requires at least one interpreter registration.");
  }

  const registrations = config.registrations.map((registration) => {
    if (registration.interpreterKind !== "authoritative-v2") {
      throw new TypeError("Registered runtime manifest references an unavailable interpreter.");
    }
    const manifest = manifestShape(registration.manifest);
    if (manifest === undefined) {
      throw new TypeError("Registered runtime manifest is malformed.");
    }
    const refs = allManifestRefs(manifest);
    if (new Set(refs.map(({ profileId }) => profileId)).size !== refs.length) {
      throw new TypeError("Registered runtime manifest contains duplicate ProfileRefs.");
    }
    if (refs.some(({ profileId }) =>
      isHistoricalProfileId(profileId) || containsForbiddenRulesBasis(profileId))) {
      throw new TypeError("Historical, D&D 2024, and 5.5e profiles require another explicit adapter.");
    }
    return {
      manifest: immutableManifest(manifest),
      interpreterKind: registration.interpreterKind,
    } satisfies RuntimeInterpreterRegistration;
  });

  const manifestIds = registrations.map(({ manifest }) => manifest.manifest.profileId);
  if (new Set(manifestIds).size !== manifestIds.length) {
    throw new TypeError("A runtime manifest profileId can be registered only once.");
  }

  const hashesByProfileId = new Map<string, string>();
  for (const { manifest } of registrations) {
    for (const ref of allManifestRefs(manifest)) {
      const existing = hashesByProfileId.get(ref.profileId);
      if (existing !== undefined && existing !== ref.profileHash) {
        throw new TypeError(`Profile ${ref.profileId} is registered with more than one hash.`);
      }
      hashesByProfileId.set(ref.profileId, ref.profileHash);
    }
  }

  const defaultRegistration = registrations.find(({ manifest }) =>
    refsEqual(manifest.manifest, config.defaultManifest));
  if (defaultRegistration === undefined) {
    throw new TypeError("The default runtime manifest must name an exact registered manifest.");
  }

  return Object.freeze({
    registrations: Object.freeze(registrations.map((registration) => Object.freeze(registration))),
    defaultManifest: immutableManifest(defaultRegistration.manifest),
    ...(config.conformanceCheck === undefined
      ? {}
      : { conformanceCheck: config.conformanceCheck }),
  });
}

export const PRODUCTION_RUNTIME_PROFILE_REGISTRY = createRuntimeProfileRegistry({
  registrations: [
    {
      manifest: CURRENT_RUNTIME_PROFILE_MANIFEST,
      interpreterKind: "authoritative-v2",
    },
    {
      manifest: LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
      interpreterKind: "authoritative-v2",
    },
    {
      manifest: ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
      interpreterKind: "authoritative-v2",
    },
    {
      manifest: ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
      interpreterKind: "authoritative-v2",
    },
  ],
  defaultManifest: CURRENT_RUNTIME_PROFILE_MANIFEST.manifest,
  conformanceCheck: profileRegistryMatchesCanonicalDocuments,
});

/** Exact manifest-to-interpreter dispatch; there is deliberately no latest fallback. */
export function resolveRuntimeProfileManifest(
  registry: RuntimeProfileRegistry,
  value: unknown,
): RuntimeProfileResolution {
  if (registry.conformanceCheck !== undefined && !registry.conformanceCheck()) {
    return rejection(
      "profileRegistryConformanceFailure",
      "The deployed Profile Registry does not match its canonical SPEC 0013 documents.",
    );
  }

  const profiles = manifestShape(value);
  if (profiles === undefined) {
    return rejection(
      "invalidRuntimeManifest",
      "Runtime manifest must contain every required ProfileRef exactly once.",
    );
  }

  const actualRefs = allManifestRefs(profiles);
  if (new Set(actualRefs.map(({ profileId }) => profileId)).size !== actualRefs.length) {
    return rejection(
      "invalidRuntimeManifest",
      "Runtime manifest contains a duplicate ProfileRef.",
    );
  }
  if (actualRefs.some(({ profileId }) => isHistoricalProfileId(profileId))) {
    return rejection(
      "unsupportedHistoricalProfile",
      "This runtime has no explicit adapter for the requested historical Profile manifest.",
    );
  }
  if (actualRefs.some(({ profileId }) => containsForbiddenRulesBasis(profileId))) {
    return rejection(
      "unsupportedProfile",
      "D&D 2024, 5.5e, and Weapon Mastery profiles are not registered by this runtime.",
    );
  }

  const sameManifestId = registry.registrations.find(({ manifest }) =>
    manifest.manifest.profileId === profiles.manifest.profileId);
  if (sameManifestId === undefined) {
    return rejection(
      "unsupportedProfile",
      `No exact adapter is registered for Profile ${profiles.manifest.profileId}.`,
    );
  }
  if (sameManifestId.manifest.manifest.profileHash !== profiles.manifest.profileHash) {
    return rejection(
      "profileIntegrityMismatch",
      `Profile ${profiles.manifest.profileId} does not match its registered canonical hash.`,
    );
  }

  const expectedRefs = allManifestRefs(sameManifestId.manifest);
  if (actualRefs.length !== expectedRefs.length) {
    return rejection(
      "invalidRuntimeManifest",
      "Runtime manifest does not contain the exact registered extension closure.",
    );
  }
  const knownProfileIds = new Set(
    registry.registrations.flatMap(({ manifest }) =>
      allManifestRefs(manifest).map(({ profileId }) => profileId)),
  );
  for (let index = 0; index < expectedRefs.length; index += 1) {
    const expected = expectedRefs[index];
    const actual = actualRefs[index];
    if (actual.profileId !== expected.profileId) {
      return rejection(
        knownProfileIds.has(actual.profileId) ? "invalidRuntimeManifest" : "unsupportedProfile",
        knownProfileIds.has(actual.profileId)
          ? `Profile ${actual.profileId} appears in the wrong manifest slot.`
          : `No exact adapter is registered for Profile ${actual.profileId}.`,
      );
    }
    if (actual.profileHash !== expected.profileHash) {
      return rejection(
        "profileIntegrityMismatch",
        `Profile ${actual.profileId} does not match its registered canonical hash.`,
      );
    }
  }

  return {
    ok: true,
    profiles: cloneManifest(sameManifestId.manifest),
    interpreterKind: sameManifestId.interpreterKind,
  };
}

export function validateRuntimeProfileManifest(
  value: unknown,
  registry: RuntimeProfileRegistry = PRODUCTION_RUNTIME_PROFILE_REGISTRY,
): RuntimeProfileValidation {
  const resolution = resolveRuntimeProfileManifest(registry, value);
  return resolution.ok
    ? { ok: true, profiles: resolution.profiles }
    : resolution;
}
