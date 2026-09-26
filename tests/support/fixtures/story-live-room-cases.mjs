// Player language refers only to the registered module's public opening.
// These are intentions, never injected truths or prescribed model outputs.
const LOCAL_INTENT = "今晚我先留在黑橡居酒屋，花些时间协助莉安理清近期日常经营中尚待解决的问题。我到炉边说明来意，请她挑一件今晚值得着手的小事，把经过和牵涉的人告诉我；若有人说法不同，我先分别核对，弄清各自的难处。等知道具体情况后，我再决定如何处理。";
export const STORY_ROOM_PROBE_CASES = Object.freeze([
  Object.freeze({
    caseId: "short-local-conflict", implemented: true,
    text: LOCAL_INTENT,
    expectedScale: "short", expectedConnection: "local", expectedMethod: "conflict",
  }),
  Object.freeze({ caseId: "narration-recovery", implemented: true, text: LOCAL_INTENT,
    expectedScale: "short", expectedConnection: "local",
    fault: "One synthetic reasoning-only generation failure leaves the world untouched with the reply pending (ADR 0026); recovery generation and review use the real provider, then the frozen result commits once. No synthetic success." }),
  Object.freeze({ caseId: "daily-investigation", implemented: true, dailyGroup: "investigation",
    text: "我仔细观察遗体口边露出的那片叶梗，想辨认它的颜色、形状和是否有新鲜折断痕迹，不移动遗体或叶片。" }),
  Object.freeze({ caseId: "daily-witnessed", implemented: true, dailyGroup: "witness",
    text: "我当着莉安的面，把遗体嘴里那片黑橡叶取出来，凑到烛光下翻看。",
    nextText: "你好，莉安。",
    initialFixture: "Registered module opening; Lian is present in the wake scene. Step 2 does not mention the leaf." }),
  // SPEC 0001 §14: Lian keeps what was said aloud or what she noticed, never
  // the thought or the "unnoticed" framing in the player's input.
  Object.freeze({ caseId: "daily-spoken-intent", implemented: true, dailyGroup: "listener",
    text: "我问莉安她父亲生前是做什么的，心里盘算着先摸清她的底细。",
    listenerForbidden: ["盘算", "摸清她的底细"], listenerRequired: [] }),
  Object.freeze({ caseId: "daily-hidden-act", implemented: true, dailyGroup: "listener",
    text: "我装作替赫斯整理衣领，趁莉安不注意把他嘴里那片黑橡叶顺进袖子里，同时问她：“你父亲生前常来守灵厅吗？”",
    listenerForbidden: ["装作", "趁莉安不注意"], listenerRequired: ["你父亲生前常来守灵厅吗"] }),
  // SPEC 0006 §7: Lian promises to go and look; the next request's NPC work
  // takes her out of the hall for real, before the player's own act.
  Object.freeze({ caseId: "daily-npc-leaves", implemented: true, dailyGroup: "npcMove",
    // Lian first asks a stranger's name and purpose (round138 run 1), so the
    // request comes with them.
    text: "我叫原团旅人，是来守灵的外乡人，也想弄清赫斯是怎么死的。莉安，能帮我去后院看看酒窖门上的钉子是谁钉的吗？看完回来告诉我。",
    nextText: "我在炉边坐下，喝口热汤。",
    initialFixture: "Registered module opening; Lian is present in the wake scene." }),
  Object.freeze({ caseId: "daily-items", implemented: true, dailyGroup: "items",
    text: "我捡起脚边那瓶治疗药水，收进自己的背包。",
    nextText: "我取出刚才捡起的那瓶治疗药水，喝掉它来治疗自己的伤势。",
    initialFixture: "One publicly visible unowned SRD healing potion in the starting scene; actor begins with 1 HP." }),
  Object.freeze({ caseId: "daily-spell", implemented: true, dailyGroup: "spell",
    text: "我对自己施放一环疗伤术，治疗自己的伤势。",
    initialFixture: "A compiled level-3 cleric with the real cure catalog spell, available slots and 1 HP; no spell effects are injected." }),
  Object.freeze({ caseId: "daily-combat", implemented: true, dailyGroup: "combat",
    text: "我拔出长剑，冲向莉安并挥剑攻击她。" }),
  Object.freeze({ caseId: "daily-multiplayer", implemented: true, dailyGroup: "multiplayer",
    text: "我在心里回想自己刚到这里时已经知道的事情，不说话，也不向别人分享。",
    initialFixture: "Two authenticated players in the same initial scene; owner alone requests a private knowledge review." }),
  Object.freeze({ caseId: "new-npc-investigation", implemented: false,
    extension: "Add a distinct natural player intention and acceptance of a genuinely authored new NPC through Rules, its knowledge, Viewer projection and retry." }),
  Object.freeze({ caseId: "long-personal", implemented: false,
    extension: "Add a natural personal goal grounded in an ordinary initial character, then accept a complete long preparation, stages and persistent consequences." }),
]);

// A two-step case whose second request first runs an NPC's promised work
// needs more than ten calls; the per-batch budget still bounds the total.
export const STORY_ROOM_PROBE_LIMITS = Object.freeze({
  maxCalls: 16, maxInputTokens: 960_000, maxOutputTokens: 64_000, callTimeoutMs: 45_000,
});
