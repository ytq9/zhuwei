# round125：冻结内容不再随房间增长之后的真实调用

2026-09-25。用例 `daily-spoken-intent`，行动文本与 [round124](./vnext-round124-validation.md) 相同。调用上限 10，真实 HTTP 路径，`deepseek-v4-flash`，源码 `66abdbf`。未部署、未 push、未做远端 migration、未改 Secrets。工作区里另一个会话未提交的改动只涉及非 DeepSeek 模型的传输方言，不经过本用例。

## 这一批验证什么

round124 之后的提交：

- `d8f6280`（[ADR 0049](../../adr/0049-an-npc-decision-view-has-its-own-ceiling.md)）：NPC 决策视图有自己的大小上限。
- `590500e`（[ADR 0050](../../adr/0050-an-npc-decision-view-carries-its-latest-rounds.md)）：NPC 决策视图只带最近六轮的原话、对话和所见，规则按视图版本核对。
- `5e30f55`：行动者未读的记忆不能再用裸引用引用。
- `a94e1b8`（[ADR 0051](../../adr/0051-unread-memories-are-read-when-named.md)）：未读的记忆不冻结，按编号调取时由房间读取。
- `e69554a`（[ADR 0052](../../adr/0052-a-vnext-action-keeps-its-projection-by-identity.md)）：vNext 行动只存投影的身份。
- `66abdbf`（[ADR 0053](../../adr/0053-a-perception-is-frozen-with-its-memory.md)）：感知事实跟着观察者的记忆冻结。

这一批确认新的冻结方式、新版 NPC 视图和规则核对在真实调用里能走通。它是新开的房间，没有对话历史。

## 结果

4 次调用，58,338 输入 / 1,482 输出 token，通过。

| 调用 | 用途 | 输入 | 缓存命中 | 输出 |
| --- | --- | --- | --- | --- |
| 1 | 选择：social，补选莉安的视图 | 22,030 | 512 | 75 |
| 2 | 填写 | 30,750 | 14,848 | 1,230 |
| 3–4 | 旁白生成与审核（pass） | 2,776 + 2,782 | 768 + 640 | 125 + 52 |

- 裁决：威吓检定，魅力，DC 15，没有修订。莉安先问来人是不是官面上派来的、今晚是来守灵还是办事，答完才肯说，并提醒他听见唱歌别接。旁白审核通过。
- 交谈事件里存的是 vnext-2 的 NPC 视图。
- 准备数据这一行 97,588 字节，投影只剩类型、视角、状态版本、分支和 hash。

## 没有覆盖的

- 按编号调取：这一批模型没有请求编号，房间调取没有触发。调取的完整路径（房间读取、核对、存储、填写请求、归档导出与恢复）由房间级测试覆盖。
- 超过六轮的长对话：要在有历史的房间里看，本地预览那一桌可以接着测。
- NPC 自主行动的请求仍冻结这个 NPC 的全部记忆正文。

私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-YLJNwW`，重启即失。
