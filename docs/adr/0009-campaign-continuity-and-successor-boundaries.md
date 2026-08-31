# 长团以章节连续性和角色任期建模

- 状态：已接受（本 Goal 授权）
- 日期：2026-08-26
- 关联规格：SPEC 0005、SPEC 0008、SPEC 0009

## 背景

把房间等同于一场短模组会丢失成长、伤势、关系、承诺和未决威胁，也无法在角色死亡或退役后区分玩家席位与角色身份。

## 决策

`Campaign` 包含版本化 `Chapter`；玩家席位通过 `CharacterTenure` 在一段期间控制一个角色。章节切换原子携带仍成立的物品、伤势、知识、关系、债务、承诺与未决威胁。成长使用 SRD 2014 XP 或由 Table Profile 选择的 milestone，并由玩家确认具体选择后提交。

死亡与退役结束角色任期，不自动复活或删除角色。退役角色可以经事件转为有限知识 NPC。继任角色默认不继承前任私人知识、能力、身份关系或装备；只有可指认的世界内来源（交接、遗嘱、见证、公开档案或实际物品转移）才能逐项提交继承。玩家账户连续性不构成角色知识连续性。

## 后果

Campaign、Chapter、Character 与 CharacterTenure 是不同身份。归档重建和 Viewer 测试必须证明跨章节持续、死亡/退役终止控制以及继任的合法继承边界。

0.4 当前房间只生成并接受 `zhuwei.campaign-continuity-manifest/v2`。更早开发态的 v1 清单随 0.4 前房间一并退役；当前运行时对其稳定拒绝，不保留重算、回放 Adapter 或 fallback。

## 验收场景

1. 章节切换携带被明确标记为延续的伤势、物品、知识、关系、承诺和未决威胁，并保持事件与版本连续性。
2. 死亡或退役立即终止角色任期；原控制者不能继续以普通 Viewer 行动或读取角色私有信息。
3. 继任角色必须逐项引用交接、遗嘱、见证、公开档案或实际转移事件，不能因同一玩家账户自动继承私人知识、能力、关系或装备。
4. XP 或 milestone 只产生可选成长候选，玩家确认选择后才提交机械变化。

## 实现映射

- Campaign 事件与连续性：`app/_runtime/lib/rules/v2/campaign-actions.ts`、`app/_runtime/lib/rules/v2/campaign-events.ts`、`app/_runtime/lib/rules/v2/campaign-continuity.ts`
- 任期与成长：`app/_runtime/lib/rules/v2/character-lifecycle.ts`、`app/_runtime/lib/rules/v2/character-progression.ts`
- Viewer 边界：`app/_runtime/lib/rules/v2/projector.ts`
- 验收：`tests/world-campaign-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`
