type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StableSubmissionResult = {
  ok?: boolean;
  retryable?: boolean;
};

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Submission payload numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : canonicalValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  throw new TypeError("Submission payload must be canonical JSON.");
}

async function submissionFingerprint(value: unknown): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(canonicalValue(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cachedSubmission(
  storage: StorageLike | undefined,
  key: string,
  fingerprint: string,
): string | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { fingerprint?: unknown; submissionId?: unknown };
    return parsed.fingerprint === fingerprint && typeof parsed.submissionId === "string"
      ? parsed.submissionId
      : undefined;
  } catch {
    return undefined;
  }
}

function saveSubmission(
  storage: StorageLike | undefined,
  key: string,
  fingerprint: string,
  submissionId: string,
) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ fingerprint, submissionId }));
  } catch {
    // A browser may disable session storage; the current request still has a valid id.
  }
}

function clearSubmission(storage: StorageLike | undefined, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort and never changes the Room outcome.
  }
}

export async function callWithStableSubmission<
  Result extends StableSubmissionResult,
>(input: {
  command: string;
  data: Record<string, unknown>;
  storage?: StorageLike;
  createSubmissionId?: () => string;
  invoke(payload: Record<string, unknown> & { submissionId: string }): Promise<Result>;
}): Promise<Result> {
  const code = typeof input.data.code === "string" ? input.data.code.trim() : "";
  if (!code || !input.command) throw new TypeError("Stable table submissions require a room and command.");
  const { submissionId: requestedSubmissionId, ...payload } = input.data;
  const fingerprint = await submissionFingerprint({ command: input.command, payload });
  const key = `zhuwei:v2-submission:${code}:${input.command}:${fingerprint}`;
  const requested = typeof requestedSubmissionId === "string" && requestedSubmissionId.trim()
    ? requestedSubmissionId.trim()
    : undefined;
  const submissionId =
    requested ??
    cachedSubmission(input.storage, key, fingerprint) ??
    (input.createSubmissionId ?? (() => crypto.randomUUID()))();
  saveSubmission(input.storage, key, fingerprint, submissionId);

  const result = await input.invoke({ ...payload, submissionId });
  if (result.retryable !== true) clearSubmission(input.storage, key);
  return result;
}
