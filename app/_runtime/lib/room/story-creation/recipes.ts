import type { StoryCreationPorts, StoryRecipe, StoryRequest, StoryFailureCode } from "./contracts";

const METHOD_RECIPES = [
  {
    id: "story.method.local-conflict", dimension: "method" as const,
    instructions: "创作地方利益冲突。写清至少两方的具体目标、可支配资源、顾虑及冲突为何此时发生；参与者可以妥协、拒绝或改变方法。提供可谈判的条件与相称成本，但不预定交易必须成立。让玩家能理解各方利害，保留未列出的第三种合理办法。无人介入时各方只准备尝试下一步，不预写成功。",
    requiredMaterialKinds: ["anchor", "location"] as const,
    requiredCapabilities: [],
    reviewCriteria: ["各方目标与具体资源足以解释冲突", "不同选择可以改变局势且允许第三种办法", "妥协与离开的成本来自世界因果"],
    excludes: ["story.method.archive-investigation"],
  },
  {
    id: "story.method.archive-investigation", dimension: "method" as const,
    instructions: "创作围绕档案、记录与人物证词的调查。固定真实发生的核心情况，将文献声称、证词、实际事实与推断分开。每项推进所必需的结论至少有两个独立来源，解释来源为何独立，以及基础观察、合理接近和检定失败后还能做什么。文献和证词可以有偏见但必须有来源、时间与可证伪途径。提前找到真相即可收束，不强迫按场景顺序调查。",
    requiredMaterialKinds: ["anchor", "location"] as const,
    requiredCapabilities: [],
    reviewCriteria: ["关键结论有可取得的独立来源", "主张与真相区分且可以交叉验证", "失败不形成唯一检定墙且提前解决允许收束"],
    excludes: ["story.method.local-conflict"],
  },
];

/** Hash the complete immutable recipe content. A version label alone must not
 * let a running job silently adopt different writing instructions. */
export function createStoryRecipes(hash: StoryCreationPorts["hash"]): readonly StoryRecipe[] {
  const definitions = [
    ...METHOD_RECIPES,
    {
      id: "story.scale.long", dimension: "scale" as const,
      instructions: "准备完整长篇：现在就交代核心起因、决定性真相、持续人物关系、发展条件和全部收束边界。至少两个具有不同问题与阶段成果的阶段，各自可停、可继续；后续扩写只能补充尚无因果作用的细节。阶段不是强制路线，玩家合理提前解决时直接承认成果。多人均有决定空间，不替角色选人生目标。",
      requiredMaterialKinds: ["anchor"] as const, requiredCapabilities: [],
      reviewCriteria: ["所有阶段有独立问题、成果、停止点与续接依据", "核心局势与收束已完整且不靠未来补写真相"], excludes: [],
    },
    {
      id: "story.focus.new-participant", dimension: "focus" as const,
      instructions: "可以创造有成立参与理由的新 NPC。为新人物提供完整可执行定义、目标、资源、知识来源与角色声口，复用既有人物稳定身份，不为绕过既有约束复制同名人物。新人物知识只来自明确起始或世界内依据。",
      requiredMaterialKinds: ["definition"] as const, requiredCapabilities: ["materializeNpc"],
      reviewCriteria: ["新人物有完整定义且不是既有人物副本", "初始知识有独立合法来源"], excludes: [],
    },
  ];
  return Object.freeze(definitions.map(({ id, ...body }) => {
    const content = { id, version: "1", ...body };
    return Object.freeze({ ref: Object.freeze({ id, version: "1", hash: hash(content) }),
      ...body, requiredMaterialKinds: Object.freeze([...body.requiredMaterialKinds]),
      requiredCapabilities: Object.freeze([...body.requiredCapabilities]),
      reviewCriteria: Object.freeze([...body.reviewCriteria]), excludes: Object.freeze([...body.excludes]) });
  }));
}

export function selectStoryRecipes(request: StoryRequest, ports: StoryCreationPorts):
  { kind: "selected"; recipes: readonly StoryRecipe[] } | { kind: "rejected"; code: StoryFailureCode } {
  const selected: StoryRecipe[] = [];
  for (const ref of request.recipeRefs) {
    const matches = ports.recipes.filter(recipe => recipe.ref.id === ref.id && recipe.ref.version === ref.version && recipe.ref.hash === ref.hash);
    if (matches.length !== 1) return { kind: "rejected", code: "STORY_RECIPE_UNAVAILABLE" };
    const recipe = matches[0]!;
    const { ref: bound, ...body } = recipe;
    if (ports.hash({ id: bound.id, version: bound.version, ...body }) !== bound.hash
      || !recipe.instructions.trim() || !recipe.reviewCriteria.length
      || recipe.reviewCriteria.some(criterion => !criterion.trim())
      || new Set(recipe.reviewCriteria).size !== recipe.reviewCriteria.length) {
      return { kind: "rejected", code: "STORY_RECIPE_UNAVAILABLE" };
    }
    selected.push(recipe);
  }
  const ids = new Set(selected.map(recipe => recipe.ref.id));
  if (ids.size !== selected.length || selected.filter(recipe => recipe.dimension === "method").length !== 1
    || selected.filter(recipe => recipe.dimension === "scale").length > 1
    || selected.filter(recipe => recipe.dimension === "connection").length > 1
    || selected.some(recipe => recipe.excludes.some(id => ids.has(id)))
    || (ids.has("story.scale.long") && request.scale !== "long")) {
    return { kind: "rejected", code: "STORY_RECIPE_CONFLICT" };
  }
  return { kind: "selected", recipes: Object.freeze(selected) };
}
