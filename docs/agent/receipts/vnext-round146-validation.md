# round146：选择阶段的 observe 限定（指引 v63）与空补选

2026-09-28。`tools/run-story-room-probe.mjs --live`，每次运行一个新房间，真实 HTTP 路径，`deepseek-v4-flash`。在主工作区运行（另一个会话未提交的 OpenAI 提供方改动不在 DeepSeek 路径上）。每批不超过 20 次调用，遇到第一个技术失败即停。用户的条件是本批通过则推送并部署；**本批没有通过，未推送、未部署**，没有远端 migration 或 Secrets 修改。

## 这批验证什么

`5b39d8d`（指引 v63）：选择阶段写明 observe 只用于查看、倾听或推断本身就是一步的行动，做别的事时看到、听到的写进那一步的 sensoryEvidence。依据是 64 次有填写的探针运行里选了没用的 64 个类型中 observe 占 37 个，每次多带约 2,100–2,450 token。同一源码还带着 `5eca1dd`（降低期拒绝全部定位到字段）和批中途修的 `fa3491b`（空补选按无新增处理）。

## 结果

| 批 | 源码 | 用例 | 调用 | 输入（缓存命中）/ 输出 token | 结果 |
| --- | --- | --- | --- | --- | --- |
| 146-1a | `5b39d8d` | daily-hidden-act 原文 | 2 | 75,049（22,016）/ 178 | **失败（本项目缺陷，已修）**。首轮选 worldInteraction、inventoryOperation、materializeItem、social，没有 observe；第 2 次调用模型用选择工具发了 `requestedCapabilities: []`——补选工具改成“只填要新增的”之后，没有要新增时它也调了工具。首轮的“至少选一项”检查把空列表判为格式错误，行动以 `PROPOSAL_FORM_INVALID` 结束。`fa3491b`：补选轮的空列表按无新增处理，走再发表单的路径 |
| 146-1b | `fa3491b` | 同上 | 3 | 126,653（37,888）/ 939 | **失败（世界内拒绝）**。首轮选了 `inWorldRefusal` 等 6 类并加载奈斯视图；第 2 次补选 `[]` + 瓦罗视图，按新规则加载了瓦罗；第 3 次提交 `inWorldRefusal`（missingPrerequisite：遗体不近、叶子夹得紧、未经莉安允许）。70 次同用例首轮选择里这是唯一一次选拒绝 |
| 146-1c | `fa3491b` | 同上 | 5 | 218,139（155,776）/ 3,471 | **失败（修正用尽）**。首轮只选 inventoryOperation、social、worldInteraction（没有 observe）并读了一条记忆；填写把隐蔽检定挂在 social 步骤上，另写了一个 social 步骤代替取叶，没有 worldInteraction 和库存操作；三轮修正票都是带路径的结构诊断（缺 relationshipChanges → 补丁弄丢六个必填字段 → 把触觉证据写进 npcPerceives），`PROPOSAL_REPAIR_EXHAUSTED`。历史上把检定挂在 social 上的填写有 13 次 |
| 146-2 | `fa3491b` | daily-witnessed（当着莉安取叶、凑到烛光下翻看） | 4 | 65,293（22,016）/ 1,707 | **失败（莉安没有记录）**。首轮选 inventoryOperation、observe——这里的翻看是真正的观察步骤，v63 没有压掉它；directSuccess，两步都填了，旁白发布并通过复核。但 observe 里的三条感官证据都只写给行动者，没有为在场的莉安写见证，探针断言“莉安持有她所见”失败。与 round107 的失败同形（107 后 `613610e` 已允许 observe 为在场他人写见证，108 通过是因为模型写了那条） |

四次运行合计 14 次调用，485,134 输入（缓存命中 237,696）/ 6,295 输出 token。剩余预算不够再跑一次。

## 结论

- v63 的目标效果有迹象：三次 hidden-act 里两次没选 observe（1a、1c），一次仍选了（1b）；需要观察的 witnessed 用例选了并用了 observe。样本太少，不能下结论。
- 三次模型行为失败（拒绝、检定挂错步骤、没写见证）都是历史上出现过的形态，填写轮提示词 v62→v63 没有变化，选择轮只改了 observe 那两句；查不出与本次改动的因果，也排除不了。
- 空补选是补选工具改描述后的新形态，服务器已按 §7.2 吸收（1b 里同一回复带了瓦罗视图，照常加载）。

## 没有覆盖的

- 没有一次运行同时通过 v63 与其余改动的端到端验收；本批不构成部署依据。
- `5eca1dd` 的降低期定位诊断在本批没有被触发（三次修正票都来自填写校验器）。
- 拒绝那次的前提判断（遗体距离、叶子夹得紧）是模型的世界判断，本批没有排查冻结上下文里的位置事实。

私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-{dtUapE,m1PIQN,xkSczB,XOmet3}`，重启即失。
