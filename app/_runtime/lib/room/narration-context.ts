import { freezeNarrationContext, type NarrationExpressionMaterial } from "../kp/narration-context";
import type { FrozenRenderableClaims } from "../rules/authority-read";
import type { SafeReadModel } from "../rules/v2/model";

/** Only already projected records enter this seam. No WorldState/Story Bible access. */
export function roomNarrationContext(input: {
  claims: FrozenRenderableClaims;
  projection: SafeReadModel;
  actorCharacterId: string;
  actorMessage?: { characterId: string; body: string };
  experiencedTranscript: unknown;
}) {
  const { claims, projection, actorCharacterId } = input;
  const viewerRef = projection.viewer.subjectId;
  const references = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") references.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) Object.values(value).forEach(visit);
  };
  claims.claims.forEach(visit);
  const names = new Map<string, string>();
  for (const claim of claims.claims) for (const [ref, name] of Object.entries(claim.displayNames ?? {})) names.set(ref, name);
  for (const [ref, entity] of Object.entries(projection.entities ?? {})) if (text(entity.name)) names.set(ref, entity.name);
  names.set(viewerRef, projection.controlledCharacter.name ?? "你");
  const actorName = names.get(actorCharacterId);
  const characters = (projection.publicExpression?.characters ?? []).filter(entry => references.has(entry.characterRef));
  const relevantSpeakers = new Set(claims.claims.flatMap(claim => claim.kind === "sourceClaim" ? [claim.speakerRef] : []));
  const recentDialogue: Array<NarrationExpressionMaterial["recentDialogue"][number]> = [];
  const relevantClaims = new Set(references);
  for (const thread of projection.conversationThreads ?? []) {
    if ([thread.threadRef, thread.claimRef, thread.responseClaimRef].some(ref => typeof ref === "string" && references.has(ref))) {
      for (const ref of [thread.claimRef, thread.responseClaimRef]) if (typeof ref === "string") relevantClaims.add(ref);
    }
  }
  // Complete utterances in the referenced conversation are decisive continuity, never truncated.
  // Explicitly select heard content; sourceBasis/motive must never cross this seam.
  for (const claim of projection.sourceClaims ?? []) {
    if (!text(claim.speakerId) || !relevantClaims.has(String(claim.claimId)) || !text(claim.semanticContent)) continue;
    recentDialogue.push({ kind: claim.speakerId === viewerRef ? "player" : "npc", speakerRef: claim.speakerId,
      speakerName: names.get(claim.speakerId) ?? "该说话者", body: claim.semanticContent.trim() });
  }
  // Recent rhythm is optional style, not the authoritative history/continuity store.
  const transcript = record(input.experiencedTranscript) && Array.isArray(input.experiencedTranscript.messages)
    ? input.experiencedTranscript.messages : [];
  for (const row of transcript.slice(-4)) {
    if (!record(row) || !["player", "kp", "npc"].includes(String(row.kind)) || !text(row.body) || !text(row.speakerName)) continue;
    // A composite KP opening has no speaker/thread binding. It is not related
    // dialogue for an inventory or mechanical result; never match by names.
    if (!text(row.speakerCharacterId) || !relevantSpeakers.has(row.speakerCharacterId)) continue;
    const body = row.body.trim();
    const speakerRef = text(row.speakerCharacterId) ? row.speakerCharacterId : null;
    if (!recentDialogue.some(entry => entry.speakerRef === speakerRef && entry.body === body)) {
      recentDialogue.push({ kind: row.kind as "player" | "kp" | "npc", speakerRef, speakerName: row.speakerName.trim(), body });
    }
  }
  const establishedDetails = projection.visibleFacts.flatMap(fact => fact.kind === "narrativeCommitment" && record(fact.value)
    && (fact.value.sceneRef === projection.controlledCharacter.sceneId || references.has(fact.id)) && text(fact.value.description)
    ? [{ detailRef: fact.id, description: fact.value.description.trim() }] : []);
  return freezeNarrationContext(claims, {
    viewer: { characterRef: viewerRef, name: names.get(viewerRef)! },
    actor: actorName === undefined ? null : { characterRef: actorCharacterId, name: actorName },
    actorIntent: actorCharacterId === viewerRef && input.actorMessage?.characterId === viewerRef && text(input.actorMessage.body)
      ? input.actorMessage.body.trim() : null,
    scene: projection.publicExpression?.scene ?? null,
    characters, recentDialogue, establishedDetails,
  });
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
