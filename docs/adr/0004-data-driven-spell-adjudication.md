# 法术由版本化定义编译为确定性事件

- 状态：部分被 ADR-0006 细化
- 规则集：D&D 5e 2014 / SRD 5.1

## 背景

三级人物卡原先只保存法术 id 和中文描述。v2 `castSpell` 只扣法术位并为神导术、祝福术写入裸字符串，无法权威判断目标、距离、法术攻击、豁免、伤害、治疗、专注与持续状态。把每个法术分别写进页面、服务端或 AI 提示会形成多套裁决路径，也无法可靠回放。

## 决策

所有人物卡法术必须在版本化 `SpellDefinition` 目录中声明施法时间、范围/区域、目标约束、攻击或豁免、骰式、持续时间和效果标签。人物卡展示与规则内核读取同一目录；中文长描述只负责解释，不决定数值。

法术定义仍由版本化目录提供机械事实，但玩家入口统一提交自然语言意图或由界面形成的等价结构化意图；界面选择不是第二条裁决路径。KP 可以在已固化事实内提出施法目标、方式与叙事结果，Rules Module 用同一 `step` 验证法术位、行动经济、距离、目标、攻击、豁免、伤害、治疗、专注与持续时间。Room Durable Object 先固化所有参数，再产生唯一权威骰面并原子提交事件；玩家只能从同一 `project(viewer)` 得到结果。

## 后果

新增法术需要新增一条定义并通过目录完备性测试，不需要在页面、服务端或 Prompt 复制公式。骰面只在 Room DO 内生成，事件回放保持确定性。专注替换、持续时间、来源与目标成为可审计事实；区域法术保留形状、尺寸和战斗位置锚点。未来扩展更高等级或新模组时仍须创建新的规则集版本，不能把 2024/5.5e 定义混入现有房间。

## 验收场景

1. 人物卡只可选择绑定 Profile 目录中的法术；未知法术、非法目标、距离、行动经济或法术位消耗在 Rules 层拒绝。
2. 攻击、豁免、伤害、治疗、专注、区域与持续效果由同一版本化定义编译并回放，页面和 KP 不复制公式。
3. 施法需要随机时只生成冻结参数对应的随机请求；重试或恢复不会重掷，且 2024/5.5e 定义不能混入 2014 房间。

## 实现映射

- Profile 与目录：`app/_runtime/lib/rules/profiles/canonical.ts`、`app/_runtime/lib/rules/profiles/ability-compiler.ts`
- 角色能力与战斗：`app/_runtime/lib/rules/v2/character-abilities.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`
- 几何与时间：`app/_runtime/lib/rules/profiles/combat-geometry.ts`、`app/_runtime/lib/rules/profiles/fiction-time.ts`
- 验收：`tests/ability-profile-v2.test.mjs`、`tests/combat-mechanics-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`
