import { canonicalSha256 } from "../rules/profiles/canonical";
import type { FrozenRenderableClaims } from "../rules/authority-read";

export const NARRATION_CONTEXT_SCHEMA = "zhuwei.frozen-narration-context/v1" as const;

export type NarrationExpressionMaterial = Readonly<{
  viewer: Readonly<{ characterRef: string; name: string }>;
  actor: Readonly<{ characterRef: string; name: string }> | null;
  /** The viewer's own declared intent, never proof that its world assertions are true. */
  actorIntent: string | null;
  scene: Readonly<{ name: string; tone: string }> | null;
  characters: readonly Readonly<{ characterRef: string; name: string; voice: string; attitude: string | null }>[];
  /** Historical commitments, not evidence that an object's old state still holds. */
  establishedDetails: readonly Readonly<{ detailRef: string; description: string }>[];
  /** Already witnessed utterances, selected by relevance. No ambient history lookup on retry. */
  recentDialogue: readonly Readonly<{ kind: "player" | "kp" | "npc"; speakerRef: string | null; speakerName: string; body: string }>[];
}>;

export type FrozenNarrationContext = Readonly<{
  schema: typeof NARRATION_CONTEXT_SCHEMA;
  rootActionId: string;
  receiptId: string;
  viewerKey: string;
  projectionHash: string;
  claimsHash: string;
  expression: NarrationExpressionMaterial;
  contextHash: string;
}>;

/** The caller supplies only the already-authorized projection and dialogue.
 * This snapshot is saved with the Delivery, never rebuilt during recovery. */
export function freezeNarrationContext(
  claims: FrozenRenderableClaims,
  expression: NarrationExpressionMaterial,
): FrozenNarrationContext {
  if (!expressionConform(expression)) throw new TypeError("NARRATION_EXPRESSION_INVALID");
  const core = {
    schema: NARRATION_CONTEXT_SCHEMA,
    rootActionId: claims.rootActionId,
    receiptId: claims.receiptId,
    viewerKey: claims.viewerKey,
    projectionHash: claims.projectionHash,
    claimsHash: claims.claimsHash,
    expression: structuredClone(expression),
  };
  return deepFreeze({ ...core, contextHash: canonicalSha256(core) });
}

export function frozenNarrationContextConform(
  value: unknown,
  claims: FrozenRenderableClaims,
): value is FrozenNarrationContext {
  if (!record(value) || !keys(value, ["schema", "rootActionId", "receiptId", "viewerKey", "projectionHash", "claimsHash", "expression", "contextHash"])
    || value.schema !== NARRATION_CONTEXT_SCHEMA || !expressionConform(value.expression)
    || value.rootActionId !== claims.rootActionId || value.receiptId !== claims.receiptId
    || value.viewerKey !== claims.viewerKey || value.projectionHash !== claims.projectionHash
    || value.claimsHash !== claims.claimsHash) return false;
  const { contextHash, ...core } = value;
  return contextHash === canonicalSha256(core);
}

function expressionConform(value: unknown): value is NarrationExpressionMaterial {
  if (!record(value) || !keys(value, ["viewer", "actor", "actorIntent", "scene", "characters", "recentDialogue", "establishedDetails"])) return false;
  const person = (value: unknown): boolean => record(value) && keys(value, ["characterRef", "name"])
    && text(value.characterRef) && text(value.name);
  return person(value.viewer) && (value.actor === null || person(value.actor))
    && (value.actorIntent === null || text(value.actorIntent))
    && (value.actorIntent === null || (record(value.actor) && record(value.viewer) && value.actor.characterRef === value.viewer.characterRef))
    && (value.scene === null || (record(value.scene) && keys(value.scene, ["name", "tone"]) && text(value.scene.name) && typeof value.scene.tone === "string"))
    && Array.isArray(value.characters) && value.characters.every(entry => record(entry)
      && keys(entry, ["characterRef", "name", "voice", "attitude"]) && text(entry.characterRef) && text(entry.name)
      && text(entry.voice) && (entry.attitude === null || text(entry.attitude)))
    && new Set(value.characters.map(entry => entry.characterRef)).size === value.characters.length
    && Array.isArray(value.establishedDetails) && value.establishedDetails.every(entry => record(entry)
      && keys(entry, ["detailRef", "description"]) && text(entry.detailRef) && text(entry.description))
    && Array.isArray(value.recentDialogue) && value.recentDialogue.every(entry => record(entry)
      && keys(entry, ["kind", "speakerRef", "speakerName", "body"]) && ["player", "kp", "npc"].includes(String(entry.kind))
      && (entry.speakerRef === null || text(entry.speakerRef)) && text(entry.speakerName) && text(entry.body));
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() === value && value.length > 0; }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
