# round147：隐蔽检定不能挂在与主要察觉者的对话上，以及 witnessed 用例的见证缺失

2026-09-28。`tools/run-story-room-probe.mjs --live`，每次运行一个新房间，真实 HTTP 路径，`deepseek-v4-flash`。在主工作区运行（另一个会话未提交的 OpenAI 提供方改动不在 DeepSeek 路径上）。每批不超过 20 次调用，遇到第一个技术失败即停。用户的条件是本批通过则推送并部署；**hidden-act 通过，witnessed 两次都没通过，未推送、未部署**，没有远端 migration 或 Secrets 修改。

## 这批验证什么

自上次部署（`8239c42`）以来的本地提交：`b92947a`/`5eca1dd`（降低期拒绝定位到字段并给出可选值）、`5b39d8d`（指引 v63：observe 只用于查看本身就是一步的行动）、`fa3491b`（空补选按无新增处理）、`bb369f0`（[ADR 0066](../../adr/0066-the-step-under-a-concealed-check-is-the-hidden-act-not-the-talk-with-its-observer.md)：隐蔽检定不能挂在与主要察觉者的对话上）；批中途加 `35f6d99`（误标为 effect 的感知条目按感知拒绝并指明 recordKind；补全拒绝定位到 definitionRef）。

## 结果

| 批 | 源码 | 用例 | 调用 | 输入（缓存命中）/ 输出 token | 结果 |
| --- | --- | --- | --- | --- | --- |
| 147-1 | `bb369f0` | daily-hidden-act 原文 | 5 | 128,839（67,584）/ 2,981 | **通过**。首轮选 observe、worldInteraction、completeObject、social、inventoryOperation（observe、completeObject 没用上）；没有补选；填写 concealedCheck（巧手）挂在 worldInteraction 上，库存操作与问话各一步，主要对象莉安（默认未特别注意，DC 11），奈斯、瓦罗各引用 2 条记录；一轮修正（分支里多写了服务端字段 `opportunities`，带路径）；骰 13+2=15 无人察觉，叶子进袖（`InventoryOperationApplied`），莉安记下问话，旁白一轮复核通过 |
| 147-2 | `bb369f0` | daily-witnessed（当着莉安取叶、凑到烛光下翻看） | 8 | 259,000（180,992）/ 2,605 | **失败（莉安没有记录）**。首轮选 materializeObject、inventoryOperation、observe，补选加 completeObject、worldInteraction；填写里模型**为莉安写了见证**，但放在 worldInteraction 分支里且 `recordKind` 标成 `effects`；`world-effect-contract` 只列出五种 effect 形状，模型的修正把整条删掉，改成行动者看莉安的证据；随后 `steps.npcRecall` 未知分组、`object-completion:visible-existing-scene-object-required`（无路径）各一轮；提交时莉安一无所有。→ `35f6d99` |
| 147-3 | `35f6d99` | 同上 | 4 | 65,112（22,144）/ 1,424 | **失败（莉安没有记录）**。首轮选 completeObject、observe、inventoryOperation；填写 directSuccess，inventoryOperation + observe，三条证据都只给行动者，没有为莉安写任何条目；提交并发布旁白，断言失败 |

三次运行合计 17 次调用，452,951 输入（缓存命中 270,720）/ 7,010 输出 token。剩余预算不够再跑。

## 结论

- hidden-act 这次的填写结构正确（检定挂 worldInteraction，库存操作独立），ADR 0066 的拒绝没有被触发，v63 也没有让模型少选 observe。
- witnessed 用例连续三次（146-2、147-2、147-3）没有给在场的莉安留下记录。取叶是 inventoryOperation，没有结果字段；见证只能写在 worldInteraction 分支或 observe 的 sensoryEvidence 里，模型要么不写，要么写错 recordKind 后被删。round107 是同样的失败，round108 通过靠的是模型在 observe 里写了那一条。这个机制依赖模型每次都想到给旁观者写见证，不稳。
- 三次 witnessed 失败发生在 v63 之后；填写轮提示词没变，选择轮只改了 observe 那两句。查不出因果，也排除不了。
- 147-2 暴露的两条诊断已修（`35f6d99`），147-3 没有再出现它们，但模型也没再写见证。

## 没有覆盖的

- hidden-act 只有一次样本；witnessed 0/2。
- 「在场 NPC 自动持有对公开库存操作的见证」是否应由 Rules 从事件推导而不靠模型书写，本批没有决定。

私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-{nhvH03,vmNEYm,cCaJRB}`，重启即失。
