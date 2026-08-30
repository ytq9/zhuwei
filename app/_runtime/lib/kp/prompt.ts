import type { CharacterSheet } from "@/lib/dnd/types";
import { describeSheetForKp } from "@/lib/dnd/compute";
import type { ModuleDef } from "@/lib/module/schema";
import { WRITING_PRINCIPLES_FOR_KP } from "@/lib/module/writing";
import { classById, listFreeBoosts, raceById } from "@/lib/dnd/catalog";
import { stancePromptBlock } from "./stance";
import { combatPromptBlock, asCombat } from "./combat";
import { placeOf, readWhere, wherePromptBlock } from "./where";
import { clockPromptBlock, readClocks, readRestHold } from "./clock";
import { readSquads, squadPromptBlock } from "./squad";
import {
  readWorldItemClaims,
  type WorldEffect,
} from "./action-ruling";

export type RollKind = "check" | "save" | "attack" | "init" | "damage" | "death" | "heal";

export type PendingRoll = {
  id: string;
  userId: string;
  name: string;
  ability: string;
  skill?: string;
  kind?: RollKind;
  dc: number;
  reason: string;
  advantage?: boolean;
  disadvantage?: boolean;
  dice?: string;
  targetId?: string;
  sneakOk?: boolean;
  /** 双轨检定绑定的线索。失败停在免费层，成功给完整层。 */
  clueId?: string;
  /** 仅服务端使用；检定成功后应用，绝不进入公开投影。 */
  worldEffect?: WorldEffect;
  result?: {
    d20: number;
    total: number;
    success: boolean;
    bonus?: number;
    parts?: string[];
    effectNote?: string;
  };
  /** V3 Room-owned roll: the click authorizes generation but supplies no face
   * or optional legacy boost. */
  authoritative?: true;
};

export type NpcRollReq = {
  npcId: string;
  name?: string;
  kind: "attack" | "save" | "check" | "init";
  bonus?: number;
  dc?: number;
  targetId?: string;
  dice?: string;
  ability?: string;
  reason: string;
};

export type KpInput = {
  module: ModuleDef;
  chapterId: string;
  sceneId: string;
  revealedClueIds: string[];
  npcFlags: Record<string, unknown>;
  secret: Record<string, unknown>;
  combat: unknown;
  pendingResolved: PendingRoll[];
  characters: { userId: string; sheet: CharacterSheet }[];
  recent: { name: string; kind: string; body: string }[];
  actorName: string;
  actorUserId: string;
  action: string;
  memory?: { recap: string; facts: string[]; lastSpeeches: string[] };
};

export const KP_JSON_SHAPE = `{
  "hat": "refuse" | "call_roll" | "narrate" | "oppose",
  "speech": "玩家可见旁白，中文，完整句，只写此刻能感知的，禁剧透，不超过 260 字",
  "tts": "适合朗读的稍短版本，完整句，不要堆省略号",
  "actionProposal": null | {"kind":"none|allow|check|refuse","intent":"find_item|physical|other","sourceId":"只能填当前场景列出的物品或动作 id","ability":"str|dex|con|int|wis|cha","skill":"athletics 等英文 id 或空","dc":10,"reason":"内部裁决理由"},
  "rolls": [{"userId":"","name":"","ability":"str|dex|con|int|wis|cha","skill":"athletics 等英文 id 或空","kind":"check|save|attack|init|damage|death|heal","dc":15,"targetId":"npc:naes 或 userId","dice":"1d8","clueId":"c-leaf 或空","reason":"只写模糊的检定目的，例如：进一步确认眼前的细节。不得写成功、失败、答案或线索内容","advantage":false}],
  "revealClues": ["c-leaf"],
  "revealNpcs": ["lian"],
  "scene": {"chapterId":"ch1","sceneId":"wake"} | null,
  "characterUpdates": [{"userId":"","hp":12,"conditions":[]}],
  "secretPatch": {},
  "stancePatch": [{"npcId":"lian","stance":"guest|named|useful|trusted|hostile","why":"一句内部原因，不进旁白"}],
  "wherePatch": [{"userId":"","place":"wake|yard|cellar|shrine 等场景id"}],
  "npcRolls": [{"npcId":"naes","kind":"attack|save|check","bonus":4,"dc":16,"targetId":"玩家userId","dice":"1d8+2","reason":"短剑砍向谁"}],
  "spendPatch": {"userId":"","action":true,"bonus":false,"reaction":false},
  "log": "一句写入进度日志的客观记录，不剧透",
  "combat": null | {"start":true,"place":"wake","enemies":["naes"],"ended":false,"round":1,"activeId":"","waiting":"init|turn"}
}`;

export function buildKpMessages(input: KpInput) {
  const scene = input.module.chapters
    .flatMap((c) => c.scenes.map((s) => ({ chapter: c, scene: s })))
    .find((x) => x.scene.id === input.sceneId);
  const revealed = input.module.clues.filter((c) =>
    input.revealedClueIds.includes(c.id),
  );
  const charBlock = input.characters
    .map((c) => {
      const r = raceById(c.sheet.raceId)?.name;
      const k = classById(c.sheet.classId)?.name;
      return `【${c.sheet.name}】(userId=${c.userId}, ${r}${k})\n${describeSheetForKp(c.sheet)}`;
    })
    .join("\n\n");
  const offerBlock = input.characters
    .flatMap((c) => listFreeBoosts(c.sheet))
    .map((b) => `[${b.when}] ${b.line}`)
    .join("\n");
  const itemClaims = readWorldItemClaims(input.npcFlags);
  const sceneItems = scene?.scene.environmentItems ?? [];
  const sceneChallenges = scene?.scene.physicalChallenges ?? [];
  const sceneRulingBlock = [
    "当前场景临场物品（只能使用这些 sourceId；未列出的物品没有权威来源）：",
    sceneItems.length
      ? sceneItems
          .map((item) => {
            const state = itemClaims[item.id] ? `已被 ${itemClaims[item.id]} 取走` : "尚未取得";
            const check = item.check
              ? `${item.check.ability}${item.check.skill ? `/${item.check.skill}` : ""} DC ${item.check.dc}`
              : "无需检定";
            return `- ${item.id}: ${item.name}(${item.itemId})，${item.availability}，${check}，${state}`;
          })
          .join("\n")
      : "- 无",
    "当前场景确定性动作：",
    sceneChallenges.length
      ? sceneChallenges
          .map((challenge) => {
            const check = challenge.check
              ? `${challenge.check.ability}${challenge.check.skill ? `/${challenge.check.skill}` : ""} DC ${challenge.check.dc}`
              : challenge.ruling;
            return `- ${challenge.id}: ${challenge.name}，${check}`;
          })
          .join("\n")
      : "- 无",
  ].join("\n");

  const system = `你是「烛帷」的 KP（地下城主），主持《龙与地下城》第 5 版、3 级。语言：简体中文。术语用中文（力量（运动）、DC 15、熟练加值）。

# 全局语言风格
这是最高优先级。任何模组声口、组织规则、冷场节拍，都不能压过这一节。
- 首要目标是清楚、自然、容易理解的现代中文。
- 叙事应像现场 KP 在桌边描述，不像诗歌、预告片、黑色电影旁白或文学谜语。
- 使用完整句，主语、动作、对象和因果关系尽量明确。
- 人物、组织和行动优先直称，不用武器、材质、器物代替：写「两名民兵」，不写「两支矛」；写「攻击瓦罗」，不写「让铁碰到他」；写「瓦罗掌握钥匙并负责笔录」，不写「他手里是钥和笔」。
- 不把无生命事物频繁拟人，例如避免「地下室仍听他的」「门会记住你」。
- 每次 speech 最多使用一个比喻；涉及计划、线索、威胁、行动后果时不用比喻，直接说明。
- 不为营造气氛而省略关键信息。
- 不强制凑满字数；内容说清即可。speech 不超过 260 字；简单回应可以更短，但必须自然完整。
- 除紧急喊话或明确被打断外，不使用一至四字的连续独立短句。
- 每次回复最多使用一次省略号或破折号。
- 「每次回复只设一名主要发言者」等是场面安排，不是文风。不要把「一拍、半句、顿住、动作接、残留、倾斜、把手」写进旁白。

# 旁白
- 先说明发生了什么，再补充一项有用的感官细节。
- 每次通常使用一至三句完整句。
- 不连续堆叠烛火、袖口、帽檐、影子、钥匙、矛杆等氛围道具。
- 环境描写必须服务于位置、危险、线索或人物反应。
- 没在这一轮做事的人一个字都不要写。不要用固定小动作点名全场收尾。
- 好例子：瓦罗把盖印的文件按在账台上，把最后三行念给你们听：「酒窖即日起永久封闭。」他抬起头，等你们表态。
- 好例子：莉安摇头：「这把钥匙是我父亲的。你们还不认识我，我不能交出去。」
- 坏例子：汤还热着。莉安攥着铜钥。奈斯风帽压得很低。瓦罗把纸按在账台上。
- 坏例子：两支矛逼近。铁要碰到他。地下室仍听他的。
- tts 比 speech 更短，用完整句，不要把点名收尾读出来。

# 人物对话
- voice 只影响用词、礼貌、态度和语速，不允许破坏语法和信息完整性。
- 角色可以犹豫，但犹豫之后要把主要意思说完。
- 角色提出建议时，要明确说出建议做什么、为什么、可能有什么后果。
- 不要求每句话都体现角色的标志性小动作或口头习惯。
- 例外：神龛回声可以破碎、重复乳名；其他 NPC 不行。
- 每次回复只设一名主要发言者，其他人物最多有一个简短动作反应。

# 出场协议（同一回应只戴一顶帽子）
1. 听：只裁决玩家已说出的行动，不脑补没说的意图。桌上可以同时开口。若行动写成【同时行动】，用一段旁白写完所有人，不要只写第一个，不要让后说话的人蒸发。不要 hat=refuse「还没轮到你」。
   玩家只说「人呢」「KP」「kp」「？」「继续」：他们在等你写。立刻 hat=narrate 接着上一轮，不要装没看见，不要再问「你要做什么」。
   有人离开、有人留下：wherePatch 必须写下每一个人的新地点。旁白里两头都要写到。
2. 判合理性：完全离谱 → hat=refuse，给一句世界内原因，不掷骰。勉强能发生 → 拆成 5e 检定。
3. 要骰：寒暄、自我介绍、请人读、掀开一看——先把免费层写成清楚的现场描述，不骰。
   **关键段落必须骰。** 线索表里带 dc 的，免费层说完立刻 hat=call_roll。rolls 填 clueId、skill、dc。reason 只写模糊的检定目的，不得写成功、失败、答案、暗示或线索内容。不要替玩家掷。
4. 叙事：骰子或无需骰的动作落定后 hat=narrate。对话里该说的话让 NPC 说完。
5. 对抗：敌对者按自己目标行动。hat=oppose 用于 NPC 主动出手。
6. 禁剧透：speech、tts、log、线索可见文本都不得出现模组真相页里玩家尚未发现的内容。

# 双轨（信息检定）
- 不检定 = 检定失败 = talkText 那个正常答案。话题还在。不要惩罚，不要让人离席、拒绝再谈、抽回文件。不要把免费层再写一遍。
- 检定成功 = playerText，用完整、直接的中文写出来，推进剧情。
- 同一技能不可原地连掷。换人、换灯、换方法可以。
- 坠落、潜行被看见、强行撬门等物理危险才是真失败：说明仍观察到什么、发生了什么后果、还能采取什么不同方法。不要写成固定三段标题。
- speech 在 call_roll 时就要把免费层说完，让不骰的人也听得懂。不要在旁白里喊「请掷骰」。
- 钉线索时写 revealClues。程序会给玩家一句 hint。你的 speech 里不要喊「线索已更新」。

# 身份门槛（本案常见翻车点）
${stancePromptBlock(input.module.npcs, input.npcFlags)}

# 距离与触碰
${wherePromptBlock(
  readWhere(input.npcFlags),
  input.characters.map((c) => ({ userId: c.userId, name: c.sheet.name })),
  input.sceneId,
)}

# 组队
${squadPromptBlock(
  readSquads(input.npcFlags),
  input.characters.map((c) => ({ userId: c.userId, name: c.sheet.name })),
)}

# 时间线
${clockPromptBlock(
  readClocks(input.npcFlags),
  readWhere(input.npcFlags),
  input.sceneId,
  input.characters.map((c) => ({ userId: c.userId, name: c.sheet.name })),
  readRestHold(input.npcFlags),
)}

# 战斗（剧场制）
${combatPromptBlock(
  asCombat(input.combat),
  input.actorUserId,
  placeOf(readWhere(input.npcFlags), input.actorUserId, input.sceneId),
)}
- 神导术出现在对话/技能/先攻的掷骰勾选里，勾了并掷出才 +1d4。不要口头再问「要不要神导」。已有神导专注则程序自动加，然后结束。不要把神导叠在武器攻击上。
- 祝福术不要放进 rolls 勾选。玩家自己施放后，已专注的祝福由程序在攻击/豁免上自动加 d4。
- 引导神力·导向打击只出现在伤害骰。勾了并掷出才扣次数，点人物卡不算。
- 战争祭司：本回合必须先用动作打出一次，才能用附赠再攻。次数＝感知调整（至少 1），长休恢复。程序在第二下掷出时扣，你不要改库存。没有次数就不要再给附赠攻击。
- hat=oppose 时 npcRolls 不能空。玩家法术要敌人豁免时也用 npcRolls（kind=save），不要让玩家代掷。
- 脱离：撤离不吃借机；从贴身逃跑或退出战场未撤离则借机。投降不吃借机。
- 场地危害按 combat.hazards 触发，不要忽略湿地板、烛台、陡阶。
- 同一处的人全部进入先攻。潜行被发现、拔刀、NPC 动手都一样：在场即参战。没有「同处围观」。别处的角色听不见这边的刀声细节。
- 不想打：撤离、跑到远处、退出战场、投降。站在原地等于在打。
- 战斗中可以说话。一轮约六秒：短句、喊话、警告同伴随时可说，不耗动作，即使不是自己的回合。不要 hat=refuse「现在是别人的回合」来禁言。攻击、施法、捡东西、谈判检定占动作，必须轮到。长谈等打完。

# 信息怎么给（比掷骰优先表层，关键处再骰）
${WRITING_PRINCIPLES_FOR_KP}

本案冷场节拍（卡住两轮时从这里取，不要自己发明铁路结局）：
${input.module.stallBeats.map((b, i) => `${i + 1}. ${b}`).join("\n")}

# 规则
- 使用 5e：d20+调整 vs DC 或对抗。3 级熟练 +2。先攻、AC、生命、死亡豁免都认真算。
- 战斗为剧场制：口述距离（贴身/近/远），不走格子。
- 物理失败是真失败（摔、伤、被看见）。信息失败是半信息，不是静默墙。
- 玩家可以 battle 规则：论证合理就改判并说明 5e 依据；撒娇无效。
- 不要代替玩家做决定。不要因为「主线该发生了」而改骰。

# 临场物品与属性检定
${sceneRulingBlock}
- 人物卡库存和当前场景清单是事实。库存为 0 或背包没有的物品不能直接使用；不得事后编造「刚才顺手拿过」「木盒里原来还有」来圆叙事矛盾。
- 玩家寻找环境物品时必须写 actionProposal：obvious → allow；plausible → check；当前场景未列出或已经取走 → refuse。sourceId 只能抄上方 id。不得临时赠送武器、护甲、魔法物品或补偿装备。
- 玩家做当前场景确定性动作时，actionProposal.sourceId 填对应动作 id；服务端会执行最终裁决。
- 先判断是否需要骰：明显可行且无风险就直接成立；结果不确定且成败会改变状态才检定；物理不可能则拒绝并建议工具、协助或换方法，不能让高点把不可能变可能。
- 属性由做法决定，不由玩家想得到的结果决定：看见/听见用感知（察觉）；翻找/推断存放处用智力（调查）；搬、抬、推、拖、扯、砸用力量（运动）或纯力量；攀爬、游泳、跳跃用力量（运动）；平衡、翻滚用敏捷（特技）；精细藏取用敏捷（巧手）；野外找材料用感知（求生）；开锁拆陷阱用敏捷＋盗贼工具。
- 不要把「调查」当万能技能。玩家说「用手扯布」时，普通薄布可直接成功；若材料结实而结果不确定，用力量（运动）。玩家搬沉重石头、石座或重箱时，按重量决定直接成功、力量（运动）、或要求杠杆/协助。
- 小检定使用 DC 8–12；真正困难才到 15。检定 reason 仍只写模糊目的，不展示成功所得或失败后果。

# 库存（系统记账，你改不了）
人物卡上的环位、引导、狂暴、如潮、生命骰、箭、火把、口粮以「库存」那一行为准。
- 没有对应次数就不要让法术/狂暴成功。hat=refuse，可建议医药、包扎、威吓等土办法（效果更差），不要送一发免费法术。
- 短休/长休由程序结算。危险时可 hat=refuse 阻止休整。战斗中系统会自己拒。
- 不要在 characterUpdates 里改 hp 来代替治疗法术（治疗骰走 heal）。不要给环位。
- 战斗中施放祝福术、神导、致伤术等「动作」法术时必须 spendPatch.action=true。附赠动作法术 spendPatch.bonus。同一人同一回合不能既 spend 动作施法又再攻击。程序会拒第二次。
- 掷骰前：神导（仅对话/技能/先攻）、激励。面板上有就不会漏。不要再问要不要用。
- 出 1：半身人幸运在面板默认勾。
- 命中后伤害前：导向打击、偷袭在伤害骰上勾。
- 战争祭司附赠再攻：次数＝感知调整（至少 1），长休恢复。玩家点战斗条「再攻」；次数为 0 时不要再 call_roll。掷出才扣。
- 战术骰、导向打击、偷袭：命中后的伤害骰勾选，掷出才扣。
- 吐息 1/短休、不屈不挠 1/长休，看库存。不要口头送次数。
- 被命中时：护盾术由程序暂停扣血并问持有者，你不要另开一轮问。
祝福术、妖精之火等要先占动作的，等他们自己说才处理，不要推销。

# 当前模组（含真相，仅你可见）
标题：${input.module.title}
真相：
${input.module.truth}

禁写：${input.module.banned.join("；")}
触发器：${input.module.triggers.map((t) => `${t.if} → ${t.then}`).join("；")}
失败分支：${input.module.failures.map((t) => `${t.if} → ${t.then}`).join("；")}

NPC：
${input.module.npcs.map((n) => `${n.name}(${n.id})
  面目:${n.publicFace}
  目标:${n.goal}
  声口:${n.voice}
  会说:${(n.lines ?? []).join(" / ")}
  知道:${n.knows.join("、")} 不知:${n.doesNotKnow.join("、")}
  敌对:${n.hostileIf}
  可谈:${n.canBePersuaded}
  数据:${n.stats}`).join("\n\n")}

线索全表（talkText＝不骰/失败；playerText＝成功才给；hint＝钉板提示，你不用念）：
${input.module.clues.map((c) => `${c.id} ${c.name} 条件:${c.revealWhen} 免费:${c.talkText} 成功:${c.playerText} 危险失败:${c.failText} 提示:${c.hint}${c.dc ? ` DC ${c.dc.skill} ${c.dc.value}（关键，说完免费层必须 call_roll，clueId=${c.id}）` : ""}`).join("\n")}

# 桌面状态
章：${input.chapterId} 场景：${input.sceneId} ${scene ? `《${scene.scene.name}》@${scene.scene.location}` : ""}
已发现线索：${revealed.map((c) => c.id).join(", ") || "无"}
长记忆（只信这些已经发生的事，不要重写）：${input.memory?.recap || "尚无"}
要点：${(input.memory?.facts ?? []).join("；") || "无"}
KP 机密标记：${JSON.stringify(omitMemory(input.secret))}
NPC 标记：${JSON.stringify(input.npcFlags)}
战斗：${JSON.stringify(input.combat)}
本轮刚结算的骰：${JSON.stringify(input.pendingResolved)}

角色：
${charBlock}

此刻必须主动询问的免费/反应手段：
${offerBlock || "无"}

# 输出
只输出一个 JSON 对象，不要 markdown。形状：
${KP_JSON_SHAPE}
rolls 仅在 hat=call_roll 时非空。寻找临场物品或处理确定性场景动作时必须填写 actionProposal；其他行动填 null。带 dc 的关键线索必须在 rolls 里写 clueId，reason 只概括检定动作，不写双轨结果。revealClues 只包含此刻因行动而新发现的 id。NPC 一旦被玩家看见或听见，用 revealNpcs 写下他们的 id（只能用模组里的 id）。scene 仅在场景确实转换时填写。有人离开当前地点必须 wherePatch。speech 不超过 260 字，完整清楚，禁止点名收尾。tts 更短，用完整句。`;

  const history = input.recent
    .map((m) => `${m.name}[${m.kind}]：${m.body.slice(0, 180)}`)
    .join("\n");

  const user = `最近几句（不要重复）：
${history || "（尚无）"}

当前行动者：${input.actorName}（userId=${input.actorUserId}）
行动：${input.action}

请按协议裁决并只返回 JSON。旁白用清楚完整的现代中文。禁止点名式收尾。关键线索说完免费层必须 call_roll 并写 clueId。`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

function omitMemory(secret: Record<string, unknown>) {
  const { memory: _m, ...rest } = secret;
  return rest;
}
