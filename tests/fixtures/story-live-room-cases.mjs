// Player language refers only to the registered module's public opening.
// These are intentions, never injected truths or prescribed model outputs.
export const STORY_ROOM_PROBE_CASES = Object.freeze([
  Object.freeze({
    caseId: "short-local-conflict", implemented: true,
    text: "今晚我先留在黑橡居酒屋，花些时间协助莉安理清近期日常经营中尚待解决的问题。我到炉边说明来意，请她挑一件今晚值得着手的小事，把经过和牵涉的人告诉我；若有人说法不同，我先分别核对，弄清各自的难处。等知道具体情况后，我再决定如何处理。",
    expectedScale: "short", expectedConnection: "local", expectedMethod: "conflict",
  }),
  Object.freeze({ caseId: "new-npc-investigation", implemented: false,
    extension: "Add a distinct natural player intention and acceptance of a genuinely authored new NPC through Rules, its knowledge, Viewer projection and retry." }),
  Object.freeze({ caseId: "long-personal", implemented: false,
    extension: "Add a natural personal goal grounded in an ordinary initial character, then accept a complete long preparation, stages and persistent consequences." }),
]);

export const STORY_ROOM_PROBE_LIMITS = Object.freeze({
  maxCalls: 10, maxInputTokens: 960_000, maxOutputTokens: 64_000, callTimeoutMs: 45_000,
});
