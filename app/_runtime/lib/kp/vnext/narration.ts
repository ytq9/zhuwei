import { canonicalSha256 } from "../../rules/profiles/canonical";
import {
  frozenRenderableClaimsConform,
  type FrozenRenderableClaims,
} from "../../rules/v2/claims";
import type { PublicReceipt } from "../../rules/v2/model";

export const VNEXT_NARRATION_MATERIAL_SCHEMA =
  "zhuwei.narration-material/vnext-1" as const;

export type FrozenNarrationReceipt = Readonly<{
  receiptId: string;
  rootActionId: string;
  status: PublicReceipt["status"];
  branchId: string;
  eventRange: Readonly<{
    fromEventSeq: string;
    toEventSeq: string;
  }>;
  rulesetVersion: string;
  eventSchemaVersion: string;
  scopeProofHash: string;
}>;

export type FrozenNarrationMaterial = Readonly<{
  schema: typeof VNEXT_NARRATION_MATERIAL_SCHEMA;
  receipt: FrozenNarrationReceipt;
  viewerKey: string;
  renderableClaims: FrozenRenderableClaims;
  materialHash: `sha256:${string}`;
}>;

/**
 * The only vNext Narration material constructor. Its three arguments are
 * already-frozen transaction evidence; World State, committed deltas and
 * ambient dialogue are deliberately absent from the Interface.
 */
export function buildFrozenNarrationMaterial(
  receipt: PublicReceipt,
  viewerKey: string,
  renderableClaims: FrozenRenderableClaims,
): FrozenNarrationMaterial {
  const frozenReceipt = narrationReceipt(receipt);
  if (typeof viewerKey !== "string" || viewerKey.length === 0 || viewerKey.trim() !== viewerKey) {
    throw new TypeError("NARRATION_VIEWER_KEY_INVALID");
  }
  if (!frozenRenderableClaimsConform(renderableClaims)) {
    throw new TypeError("NARRATION_CLAIMS_INVALID");
  }
  if (renderableClaims.receiptId !== frozenReceipt.receiptId
    || renderableClaims.rootActionId !== frozenReceipt.rootActionId) {
    throw new TypeError("NARRATION_RECEIPT_CLAIMS_MISMATCH");
  }
  if (renderableClaims.viewerKey !== viewerKey) {
    throw new TypeError("NARRATION_VIEWER_CLAIMS_MISMATCH");
  }
  const core = {
    schema: VNEXT_NARRATION_MATERIAL_SCHEMA,
    receipt: frozenReceipt,
    viewerKey,
    renderableClaims: structuredClone(renderableClaims),
  } as const;
  return deepFreeze({
    ...core,
    materialHash: canonicalSha256(core),
  });
}

/** A retry reuses the exact frozen material instead of reading current state. */
export function reuseFrozenNarrationMaterialForRetry(
  material: FrozenNarrationMaterial,
): FrozenNarrationMaterial {
  if (!frozenNarrationMaterialConform(material)) {
    throw new TypeError("NARRATION_MATERIAL_HASH_MISMATCH");
  }
  return material;
}

export function frozenNarrationMaterialConform(value: unknown): value is FrozenNarrationMaterial {
  if (!isRecord(value)
    || value.schema !== VNEXT_NARRATION_MATERIAL_SCHEMA
    || !isRecord(value.receipt)
    || typeof value.viewerKey !== "string"
    || !frozenRenderableClaimsConform(value.renderableClaims)
    || typeof value.materialHash !== "string") return false;
  const core = {
    schema: value.schema,
    receipt: value.receipt,
    viewerKey: value.viewerKey,
    renderableClaims: value.renderableClaims,
  };
  return value.materialHash === canonicalSha256(core);
}

function narrationReceipt(receipt: PublicReceipt): FrozenNarrationReceipt {
  if (!isRecord(receipt)
    || typeof receipt.receiptId !== "string"
    || typeof receipt.rootActionId !== "string"
    || typeof receipt.status !== "string"
    || typeof receipt.branchId !== "string"
    || !isRecord(receipt.eventRange)
    || typeof receipt.eventRange.fromEventSeq !== "string"
    || typeof receipt.eventRange.toEventSeq !== "string"
    || typeof receipt.rulesetVersion !== "string"
    || typeof receipt.eventSchemaVersion !== "string"
    || typeof receipt.scopeProofHash !== "string") {
    throw new TypeError("NARRATION_RECEIPT_INVALID");
  }
  return deepFreeze({
    receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId,
    status: receipt.status,
    branchId: receipt.branchId,
    eventRange: {
      fromEventSeq: receipt.eventRange.fromEventSeq,
      toEventSeq: receipt.eventRange.toEventSeq,
    },
    rulesetVersion: receipt.rulesetVersion,
    eventSchemaVersion: receipt.eventSchemaVersion,
    scopeProofHash: receipt.scopeProofHash,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
