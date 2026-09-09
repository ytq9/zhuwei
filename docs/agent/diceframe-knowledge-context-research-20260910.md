# DiceFrame 角色知识上下文与烛帷长度来源（2026-09-10）

## 范围与结论

DiceFrame 源码固定为 `3f5bb016e5aef14dd056ad33ec67b6d11df0311a`；烛帷当前源码读取基线为 `9d6e4b1dcd24e2f0c76e55be084bb643fc305d9f`。另重新统计了 round100 已保存的真实请求，原批次基线是 `20a1545`。本次没有发起模型调用、重新跑测试、修改运行时或核验线上版本。

DiceFrame 主要通过“先匹配少量条目、召回少量旧记忆、滚动摘要、分区字符预算”控制上下文。它的主 GM、角色桌外问答和 NPC 视角不能混为一谈；其主回合没有采用烛帷这种逐 NPC 冻结知识正文的同等接口。长度差异也不能直接证明记忆质量或权限保证相同。

## 1. 主 GM 普通回合

- 回合入口取玩家行动文本，调用世界书 matcher；matcher 支持关键词、别名式关键词、递归触发、常量条目、概率和分组等。这里先找候选，再由上下文构造器装入条目，并非每轮装整个世界书。[D1][D2]
- 世界书段主要是 `[类型][可见性提示] 名称: 正文`。主 GM 能处理秘密；`visible_to` 在该构造段表现为“仅某角色可见”的文字提示，不能把这一段说成逐角色隔离上下文。[D3]
- 长期记忆查询使用“当前玩家消息＋最近三轮 GM 文字”，从本局 memory_namespace 召回最多 8 条。可选向量召回与文本召回合并、去重后取上限。这是该次主 GM 的全局召回上限，不是每名 NPC 分别 8 条。[D4][D5]
- 历史构造优先保留最近 5 轮完整内容，再加入旧关键轮与精简旧轮；精简旧轮的 GM 文字取前 80 字符。最终总长收缩仍可能删除旧轮，不能声称最近 5 轮在任何预算下都有绝对保证。[D6]
- 摘要机制默认按 10 轮间隔判断是否更新，将旧摘要和新日志滚动合并；它辅助记忆，不是逐角色知识原文的机械证明。[D7]

## 2. 角色桌外问答

`build_player_safe_context` 专门服务只读“问 GM/KP”，不代表普通行动主链：[D8]

1. 先过滤世界书，只接受公开条目或明确授权给当前角色的条目。缺失/空的 `visible_to` 按 GM-only 处理。[D9]
2. 排除全局长期记忆召回、GM 运行时材料、NPC 内部信息和其他玩家完整角色卡。
3. 加入公开经历/事实/历史、当前角色自己的允许状态；私人问答另加入该角色 `private_log`。
4. 全队公开回答使用更窄的公开材料，不带该角色私人日志。
5. 私人日志按记录顺序拼接后截取字符预算；这不是按当前问题语义挑选最相关私人记忆的检索器。

因此可借鉴的是“先按用途与授权限定来源”，不能将桌外问答的窄上下文当作同等复杂行动裁决的性能证据。

## 3. 实际预算单位与取舍

代码命名和注释有 TokenBudget，但实际分配主要按字符：fallback 为 48,000 字符，名称匹配 DeepSeek 的预设为 48,640 字符，可被环境配置覆盖。这些是项目自己写的预算，不是供应商真实上下文窗口声明。[D10]

| 普通主 GM 段落 | 总字符预算比例 |
| --- | --- |
| system 预留 | 20% |
| 游戏状态 | 12% |
| 世界书 | 20% |
| 摘要 | 8% |
| 长期记忆 | 6% |
| 历史最低预留 | 22% |

另有已确认事项、经济结果等小段和最终收缩。以 48,640 字符预设为例，世界书约 9,728 字符、长期记忆约 2,918 字符；都不是 token 数。[D10]

世界书放不下会跳过条目；记忆和其他段落会截断；背包超预算先只列最近条目，状态文本仍有最后截断；召回失败可继续无长期记忆上下文。这些做法帮助控制输入，但不能直接移植为烛帷决定性上下文的丢弃政策。[D3][D4][D10]

## 4. 烛帷当前为什么容易长

当前 [NPC 选择](../../app/_runtime/lib/kp/vnext/context/index.ts) 在没有发现被点名/聚焦 NPC 时，会把所有可见 NPC 纳入 npcDecision；点名 NPC 时才只加载相关 NPC 决策视图，旁观者留可观察记录。

当前 [知识分层](../../app/_runtime/lib/kp/vnext/context/knowledge-relevance.ts) 已有目录/正文分离，但模组或 genesis 来源、与行动者来源相关、scheduled 计划前提，以及最近 24 个虚构小时获得的记录均列第一档；其余按词面相关性。每个持有者设 40 条/64,000 字符保护上限，代码实际循环会在达到上限时停止，不能表述为每条第一档记录无条件完整加载。

这导致开场模组知识天然容易进入，短时间内的多轮对话也容易一直留在优先正文集合。“已经分层”不等于“当前请求已经足够小”。模型呈现还包含角色状态、NPC 决策记录、引用目录、模组约束及工具 schema。[知识模型视图](../../app/_runtime/lib/kp/vnext/proposal-context.ts)

## 5. 重读 round100 原始请求的统计

重新读取本地已有 `round100-private/02.json` 和 `12.json`，只输出长度与分类统计，没有复制私人正文或凭据。与[回执](vnext-round100-validation.md)及[机器证据](vnext-round100-live-evidence.json)一致。

| 指标 | 首句填写请求 | 第三句填写请求 |
| --- | ---: | ---: |
| user 消息字符数（含 requiredContext 包装） | 60,238 | 85,302 |
| NPC 决策快照数 | 1 | 3 |
| 独立 knowledge 条目数 | 8 | 24 |
| NPC 决策快照序列化字符合计 | 5,175 | 19,424 |
| knowledge 条目序列化字符合计 | 6,033 | 16,877 |
| Provider 报告完整请求 prompt tokens | 34,633 | 49,071 |

条目统计使用 Python `json.dumps(ensure_ascii=False, separators=(',', ':'))` 后的字符数；包含各条目的外壳，不是纯知识正文 token。两类条目的增长共 25,093 字符，与整个 user 消息增长 25,064 字符接近，其他段落变化部分抵消。因此，这两类扩载是该样本增长的主要构成。完整请求 token 还包含 system 和工具定义，不能全归到知识上。

这说明相关性选择值得优先改进，不证明长上下文必然造成空对象：该批次记录中既有较大请求成功，也有较小请求返回空对象。

## 6. 适合烛帷的建议，尚未实施

- 先确定本次实际参与和可能行动的人物，再加载其相关知识。未点名需要解析代词、行为对象和情境，不能直接等价为“加载所有在场者的全部决策材料”。
- 保留完整权威知识在服务端。模型先看到当前场景、参与者身份/目标/立场，以及本次问题所需知识正文；其余可以通过受权限限制的简短目录定位，再取原文。
- 模组来源、近期获得本身作为相关性信号，不自动代表每次行动都要整篇加载；影响本次决定的约束和计划前提仍必须齐全。
- 为尚未加载但实际必需的知识提供正式补取通路，补取后冻结，再裁决。摘要或检索片段负责定位，不能取代决定性证据原文。
- 先减少无关人物、无关正文和重复呈现，再考虑额外检索调用及摘要成本；不要将 DiceFrame 的 8 条上限、24 小时改更短或固定截字当作直接答案。
- 效果比较至少分开角色知识、NPC 决策材料、模组框、工具 schema；报告同一场景的输入与实际判定结果，避免只报告某段变短。

本次只做调查与建议；未改变已暂缓的动态召回安排或自动开始实现。

## 来源

[D1]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/commands/round_processor.py#L552-L610
[D2]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/lorebook/matcher.py
[D3]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/context_builder.py#L298-L348
[D4]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/context_builder.py#L458-L477
[D5]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/memory/recall.py#L94-L130
[D6]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/context_builder.py#L122-L235
[D7]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/memory/summarizer.py#L154-L218
[D8]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/context_builder.py#L619-L740
[D9]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/knowledge/visibility.py
[D10]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/context_builder.py#L19-L99
