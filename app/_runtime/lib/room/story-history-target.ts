import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import type { RuntimeGenesis, RuntimeProfileManifest } from "../rules";
import type { TrustedPrincipalContext } from "./authority-types";
import type { InitializeHistoricalAuthoritativeInput, InitializeHistoricalAuthoritativeResult } from "./story-history-api-types";
import { storyHistoricalTargetRoomId, storyRoomIdentityIds } from "./story-history-identity";

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isPlainRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** The entire trusted initialization request names its epoch. An initialized
 * target can therefore prove an exact retry without consulting an expired
 * source token, or trusting a caller-supplied request hash on its own. */
export function storyHistoricalInitializationBinding(context: TrustedPrincipalContext,
  input: InitializeHistoricalAuthoritativeInput) {
  if (!exact(context, ["principal"]) || !exact(context.principal, ["id", "sessionVersion"])
    || !text(context.principal.id) || !Number.isSafeInteger(context.principal.sessionVersion)
    || Number(context.principal.sessionVersion) < 1
    || !exact(input, ["targetRoomId", "submissionId", "requestHash", "source", "character"])
    || !text(input.submissionId) || !/^sha256:[0-9a-f]{64}$/.test(input.requestHash)
    || !exact(input.source, ["roomId", "startToken"]) || !text(input.source.roomId) || !text(input.source.startToken)
    || input.source.roomId === input.targetRoomId
    || !exact(input.character, ["characterId", "controllerPrincipalId", "staticCard"])
    || input.character.controllerPrincipalId !== context.principal.id || !isPlainRecord(input.character.staticCard)) return undefined;
  const roomId = storyHistoricalTargetRoomId(context.principal.id, input.submissionId);
  const ids = storyRoomIdentityIds(roomId, context.principal.id);
  if (input.targetRoomId !== roomId || input.character.characterId !== ids.characterId) return undefined;
  try {
    const digest = canonicalHash({ domain: "zhuwei.story-historical-initialization/v1", context, input }).slice("sha256:".length);
    return { roomId, ...ids, runtimeEpochId: `runtime-epoch:history:${digest}`, activeBranchId: `branch:history:${digest}` };
  } catch { return undefined; }
}

export type StoryHistoricalInitializationBinding = NonNullable<ReturnType<typeof storyHistoricalInitializationBinding>>;

/** Both first completion and replay expose this same minimal receipt. */
export function storyHistoricalInitializationReceipt(input: InitializeHistoricalAuthoritativeInput,
  binding: StoryHistoricalInitializationBinding, genesis: RuntimeGenesis,
  profiles: RuntimeProfileManifest): InitializeHistoricalAuthoritativeResult {
  const origin = genesis.historicalOrigin;
  if (!origin || genesis.roomId !== binding.roomId || genesis.runtimeEpochId !== binding.runtimeEpochId
    || genesis.initialState.activeBranchId !== binding.activeBranchId
    || origin.identity.characterId !== binding.characterId || origin.identity.seatId !== binding.seatId
    || origin.identity.principalId !== input.character.controllerPrincipalId
    || origin.source.roomId !== input.source.roomId) return { kind: "rejected", code: "STORY_HISTORY_IDENTITY_CONFLICT" };
  return { kind: "initialized", roomId: binding.roomId, requestHash: input.requestHash,
    runtimeEpochId: genesis.runtimeEpochId, genesisHash: genesis.genesisHash,
    moduleRef: structuredClone(genesis.moduleRef), runtimeProfiles: structuredClone(profiles),
    characterId: binding.characterId, seatId: binding.seatId };
}
