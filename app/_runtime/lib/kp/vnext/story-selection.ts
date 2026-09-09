import { canonicalHash, deepFreeze } from "./canonical-json";

/** These select preparation requirements, never a plot, ruling or player
 * commitment. The host derives the goal, authority scope and job identity. */
export const STORY_SELECTION_CATALOG = deepFreeze([
  { id: "storyPreparation", description: "玩家正在追求值得完整展开的新目标，或已有真实因果需要新故事准备时选择。普通询问、拒绝和即时小事正常回应；先复用冻结上下文已有故事，不为闲聊批量写稿。还须各选一个创作方法、规模和联系，以及本次实际行动所需的正常填写类型。准备后自动提供 materializeStory/admitStoryFacts 选择原候选，禁止重新改写已经评审的内容。" },
  { id: "storyMethodConflict", method: "story.method.local-conflict", description: "以人物利益和可改变的冲突为主要玩法。" },
  { id: "storyMethodInvestigation", method: "story.method.archive-investigation", description: "以档案、证词及独立证据交叉验证为主要玩法。" },
  { id: "storyVignette", scale: "vignette", description: "可在一个具体局势内收束的小插曲，仍需完整准备与审查。" },
  { id: "storyShort", scale: "short", description: "多个行动空间组成的完整短篇。" },
  { id: "storyLong", scale: "long", description: "有完整核心、收束边界和多个可停阶段的长篇。" },
  { id: "storyLocal", connection: "local", description: "当地独立冲突，与现有世界事实相接。" },
  { id: "storyMain", connection: "mainStory", description: "与既有主线锚点相关，不改写主线已成立事实。" },
  { id: "storyPersonal", connection: "personal", description: "与角色已表达的关注有关，不替角色决定人生目标。" },
] as const);
export const STORY_SELECTION_IDS: readonly string[] = Object.freeze(STORY_SELECTION_CATALOG.map(entry => entry.id));
export type StorySelection = Readonly<{
  method: "story.method.local-conflict" | "story.method.archive-investigation";
  scale: "vignette" | "short" | "long";
  connection: "local" | "mainStory" | "personal";
}>;
export const STORY_SELECTION_POLICY_HASH = canonicalHash({ version: "zhuwei.story-selection/v1", catalog: STORY_SELECTION_CATALOG });

export function parseStorySelection(requested: readonly string[]): StorySelection | undefined {
  const selected = STORY_SELECTION_CATALOG.filter(entry => requested.includes(entry.id));
  if (selected.length === 0) return undefined;
  const methods = selected.filter(entry => "method" in entry);
  const scales = selected.filter(entry => "scale" in entry);
  const connections = selected.filter(entry => "connection" in entry);
  if (!requested.includes("storyPreparation") || selected.length !== 4
    || methods.length !== 1 || scales.length !== 1 || connections.length !== 1) {
    throw new TypeError("STORY_SELECTION_INVALID");
  }
  return deepFreeze({ method: methods[0]!.method, scale: scales[0]!.scale, connection: connections[0]!.connection });
}
