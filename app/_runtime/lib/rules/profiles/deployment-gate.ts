import type { ProfileRef, RuntimeProfileManifest } from "./types";

const PROFILE_REF_KEYS = ["profileHash", "profileId"] as const;
const MANIFEST_KEYS = [
  "abilityCompiler",
  "eventSchema",
  "extensions",
  "fictionCombatTime",
  "geometry",
  "manifest",
  "ruleset",
  "triggerOrdering",
] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type RuntimeProfileReferenceRow = {
  source: "activeRoom" | "recoverableArchive";
  roomId: string;
  rulesetVersion: string;
  runtimeEpochId: string | null;
  genesisJson: string | null;
};

export type RuntimeProfileReferenceGateResult =
  | {
      ok: true;
      referencedManifestRefs: ProfileRef[];
      roomCount: number;
    }
  | {
      ok: false;
      code: "activeRoomProfileReferenceMissing" | "invalidProfileReference";
      roomIds: string[];
    }
  | {
      ok: false;
      code: "referencedAdapterMissing";
      missingManifestRefs: ProfileRef[];
      roomIds: string[];
    };

export const RUNTIME_PROFILE_REFERENCE_SCAN_SQL = `
SELECT
  'activeRoom' AS source,
  r.id AS room_id,
  r.ruleset_version,
  r.runtime_epoch_id,
  g.genesis_json
FROM rooms AS r
LEFT JOIN authoritative_room_genesis_archive AS g
  ON g.room_id = r.id AND g.runtime_epoch_id = r.runtime_epoch_id
WHERE r.ruleset_version LIKE '%authoritative%'
UNION ALL
SELECT
  'recoverableArchive' AS source,
  g.room_id,
  COALESCE(r.ruleset_version, 'archived-authoritative') AS ruleset_version,
  g.runtime_epoch_id,
  g.genesis_json
FROM authoritative_room_genesis_archive AS g
LEFT JOIN rooms AS r ON r.id = g.room_id
ORDER BY room_id, runtime_epoch_id, source
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function profileRef(value: unknown): ProfileRef | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, PROFILE_REF_KEYS)
    || typeof value.profileId !== "string"
    || value.profileId.length === 0
    || typeof value.profileHash !== "string"
    || !SHA256_PATTERN.test(value.profileHash)
  ) return undefined;
  return { profileId: value.profileId, profileHash: value.profileHash as `sha256:${string}` };
}

function manifest(value: unknown): RuntimeProfileManifest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) return undefined;
  const manifestRef = profileRef(value.manifest);
  const ruleset = profileRef(value.ruleset);
  const eventSchema = profileRef(value.eventSchema);
  const abilityCompiler = profileRef(value.abilityCompiler);
  const geometry = profileRef(value.geometry);
  const triggerOrdering = profileRef(value.triggerOrdering);
  const fictionCombatTime = profileRef(value.fictionCombatTime);
  const extensions = Array.isArray(value.extensions)
    ? value.extensions.map(profileRef)
    : [];
  if (
    manifestRef === undefined
    || ruleset === undefined
    || eventSchema === undefined
    || abilityCompiler === undefined
    || geometry === undefined
    || triggerOrdering === undefined
    || fictionCombatTime === undefined
    || !Array.isArray(value.extensions)
    || extensions.some((entry) => entry === undefined)
  ) return undefined;
  const refs = [
    manifestRef,
    ruleset,
    eventSchema,
    abilityCompiler,
    geometry,
    triggerOrdering,
    fictionCombatTime,
    ...(extensions as ProfileRef[]),
  ];
  if (new Set(refs.map(({ profileId }) => profileId)).size !== refs.length) return undefined;
  return {
    manifest: manifestRef,
    ruleset,
    eventSchema,
    abilityCompiler,
    geometry,
    triggerOrdering,
    fictionCombatTime,
    extensions: extensions as ProfileRef[],
  };
}

function manifestIdentity(value: RuntimeProfileManifest): string {
  return JSON.stringify({
    manifest: value.manifest,
    ruleset: value.ruleset,
    eventSchema: value.eventSchema,
    abilityCompiler: value.abilityCompiler,
    geometry: value.geometry,
    triggerOrdering: value.triggerOrdering,
    fictionCombatTime: value.fictionCombatTime,
    extensions: value.extensions,
  });
}

function manifestRefIdentity(value: ProfileRef): string {
  return `${value.profileId}\u001f${value.profileHash}`;
}

function sortRefs(values: Iterable<ProfileRef>): ProfileRef[] {
  return [...values]
    .map((value) => structuredClone(value))
    .sort((left, right) => left.profileId.localeCompare(right.profileId)
      || left.profileHash.localeCompare(right.profileHash));
}

function isAuthoritativeRuleset(rulesetVersion: string): boolean {
  return rulesetVersion.includes("authoritative");
}

/** Normalizes Wrangler D1 `--json` output without accepting arbitrary fields. */
export function runtimeProfileReferenceRowsFromD1(value: unknown): RuntimeProfileReferenceRow[] {
  let rawRows: unknown[];
  if (Array.isArray(value) && value.length === 0) {
    rawRows = [];
  } else if (
    Array.isArray(value)
    && value.every((container) =>
      isRecord(container) && (Array.isArray(container.results) || Array.isArray(container.result)))
  ) {
    rawRows = value.flatMap((container) => {
      const record = container as Record<string, unknown>;
      return (Array.isArray(record.results) ? record.results : record.result) as unknown[];
    });
  } else if (Array.isArray(value) && value.every(isRecord)) {
    rawRows = value;
  } else if (isRecord(value) && (Array.isArray(value.results) || Array.isArray(value.result))) {
    rawRows = (Array.isArray(value.results) ? value.results : value.result) as unknown[];
  } else {
    throw new TypeError("D1 Profile reference scan output has an unknown envelope.");
  }
  const rows: RuntimeProfileReferenceRow[] = [];
  for (const raw of rawRows) {
    if (!isRecord(raw)) throw new TypeError("D1 Profile reference scan returned a non-row value.");
    const source = raw.source;
    const roomId = raw.room_id ?? raw.roomId;
    const rulesetVersion = raw.ruleset_version ?? raw.rulesetVersion;
    const runtimeEpochId = raw.runtime_epoch_id ?? raw.runtimeEpochId;
    const genesisJson = raw.genesis_json ?? raw.genesisJson;
    if (
      !["activeRoom", "recoverableArchive"].includes(String(source))
      || typeof roomId !== "string"
      || roomId.length === 0
      || typeof rulesetVersion !== "string"
      || !(runtimeEpochId === null || typeof runtimeEpochId === "string")
      || !(genesisJson === null || typeof genesisJson === "string")
    ) throw new TypeError("D1 Profile reference scan row has a malformed closed shape.");
    rows.push({
      source: source as RuntimeProfileReferenceRow["source"],
      roomId,
      rulesetVersion,
      runtimeEpochId,
      genesisJson,
    });
  }
  return rows;
}

/**
 * Read-only deployment gate for SPEC 0013 P06. The rows come from one D1
 * snapshot query over active rooms and every recoverable genesis archive.
 * This function never supplies a latest/default fallback and never mutates a
 * genesis; it only proves that the exact referenced manifest closure remains
 * wired into the proposed deployment.
 */
export function evaluateRuntimeProfileReferenceGate(
  rows: readonly RuntimeProfileReferenceRow[],
  registeredManifests: readonly RuntimeProfileManifest[],
): RuntimeProfileReferenceGateResult {
  const registeredByIdentity = new Map<string, RuntimeProfileManifest>();
  for (const candidate of registeredManifests) {
    const normalized = manifest(candidate);
    if (normalized === undefined) {
      throw new TypeError("The proposed deployment contains a malformed runtime manifest Adapter.");
    }
    const refKey = manifestRefIdentity(normalized.manifest);
    const existing = registeredByIdentity.get(refKey);
    if (existing !== undefined && manifestIdentity(existing) !== manifestIdentity(normalized)) {
      throw new TypeError("One registered runtime manifest reference names two different closures.");
    }
    registeredByIdentity.set(refKey, normalized);
  }

  const relevantRows = rows.filter((row) =>
    row.source === "recoverableArchive" || isAuthoritativeRuleset(row.rulesetVersion));
  const missingActive = relevantRows
    .filter((row) => row.source === "activeRoom" && row.genesisJson === null)
    .map(({ roomId }) => roomId)
    .sort();
  if (missingActive.length > 0) {
    return {
      ok: false,
      code: "activeRoomProfileReferenceMissing",
      roomIds: [...new Set(missingActive)],
    };
  }

  const malformedRoomIds: string[] = [];
  const references: Array<{
    roomId: string;
    manifest: RuntimeProfileManifest;
  }> = [];
  for (const row of relevantRows) {
    if (
      !["activeRoom", "recoverableArchive"].includes(row.source)
      || typeof row.roomId !== "string"
      || row.roomId.length === 0
      || typeof row.runtimeEpochId !== "string"
      || row.runtimeEpochId.length === 0
      || typeof row.genesisJson !== "string"
    ) {
      malformedRoomIds.push(row.roomId);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(row.genesisJson);
      const profiles = isRecord(parsed) ? manifest(parsed.profiles) : undefined;
      if (
        !isRecord(parsed)
        || parsed.kind !== "roomGenesis"
        || parsed.roomId !== row.roomId
        || parsed.runtimeEpochId !== row.runtimeEpochId
        || profiles === undefined
      ) {
        malformedRoomIds.push(row.roomId);
        continue;
      }
      references.push({ roomId: row.roomId, manifest: profiles });
    } catch {
      malformedRoomIds.push(row.roomId);
    }
  }
  if (malformedRoomIds.length > 0) {
    return {
      ok: false,
      code: "invalidProfileReference",
      roomIds: [...new Set(malformedRoomIds)].sort(),
    };
  }

  const missing = references.filter(({ manifest: referenced }) => {
    const registered = registeredByIdentity.get(manifestRefIdentity(referenced.manifest));
    return registered === undefined
      || manifestIdentity(registered) !== manifestIdentity(referenced);
  });
  if (missing.length > 0) {
    const missingByRef = new Map<string, ProfileRef>();
    for (const { manifest: referenced } of missing) {
      missingByRef.set(manifestRefIdentity(referenced.manifest), referenced.manifest);
    }
    return {
      ok: false,
      code: "referencedAdapterMissing",
      missingManifestRefs: sortRefs(missingByRef.values()),
      roomIds: [...new Set(missing.map(({ roomId }) => roomId))].sort(),
    };
  }

  const referencedByRef = new Map<string, ProfileRef>();
  for (const { manifest: referenced } of references) {
    referencedByRef.set(manifestRefIdentity(referenced.manifest), referenced.manifest);
  }
  return {
    ok: true,
    referencedManifestRefs: sortRefs(referencedByRef.values()),
    roomCount: references.length,
  };
}
