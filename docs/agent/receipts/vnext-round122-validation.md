# round122：检定裁决写明检定步骤、上下文放进系统消息后的一批

2026-09-24。用例 `daily-hidden-act`，调用上限 10，真实 HTTP 路径，`deepseek-v4-flash`，源码 `d3ef2cb`。未部署、未 push、未做远端 migration、未改 Secrets。工作区里另一个会话未提交的改动只涉及 GPT-6 Luna 的传输方言，不经过本用例的 DeepSeek 路径。承接 [round120–121](./vnext-round120-validation.md)。

## 本批验证的改动

- `de6649e`（[ADR 0042](../../adr/0042-a-check-names-the-step-it-decides.md)）：检定裁决必填 `checkStep`，写检定决定的那一步的类型。
- `1b8d439`（[ADR 0043](../../adr/0043-the-frozen-context-goes-in-the-system-message.md)）：冻结上下文放进系统消息，排在工具之前；本阶段规则跟在上下文后面，任务是最后一条消息。
- `d3ef2cb`（[ADR 0044](../../adr/0044-what-the-selection-loads-goes-last-in-the-context.md)）：选择阶段加载的条目排在上下文最后。本批选择没有加载 NPC 视图或记忆，这一项没有用到。

## 结果

6 次调用，168,639 输入 / 3,620 输出 token，通过。

| 调用 | 用途 | 输入 | 缓存命中 | 未命中 | 输出 |
| --- | --- | --- | --- | --- | --- |
| 1 | 选择：inventoryOperation、worldInteraction、observe、social | 27,993 | 256 | 27,737 | 96 |
| 2 | 填写（可补选）：模型原样重复了同样四个类型 | 44,137 | 22,016 | 22,121 | 96 |
| 3 | 按原选择重填，不带选择工具 | 43,416 | 43,136 | 280 | 1,680 |
| 4 | 修订（correct_kp_proposal_bundle，整稿替换） | 46,201 | 43,136 | 3,065 | 1,536 |
| 5–6 | 旁白生成与审核（pass） | 3,421 + 3,471 | 768 + 640 | 2,653 + 2,831 | 160 + 52 |

### 缓存

- round121 同一用例 5 次调用：输入 117,089，命中 23,808，未命中 93,281。本批 6 次调用：输入 168,639，命中 109,952，未命中 58,687。
- 填写调用命中 22,016，是读取说明加冻结上下文；填写规则和表单对这个行动是新内容。修订调用命中整条系统消息和填写表单（43,136），只为工单和上一稿付全价。
- 第 2 次调用是多出来的一次，但它让第 3 次几乎全部命中。按第 3 次作为首次填写估算（命中只有说明加上下文），未命中总数约 5.8 万，与实际相近。
- 报告里的费用估计按统一单价计算，不区分缓存，不能用来比较。

### 首稿

- 首稿的 decision 写了 `checkStep: "worldInteraction"`，但 `check` 三组都是空数组；取叶的 worldInteraction 写在 `steps` 里绑 onSuccess，交谈绑 always。模型这次先写 `steps` 后写 `check`，round120、121 的首稿都按表单顺序 decision、check、steps。
- 解码器报 `filling:check-step-required`，路径指向 `check.worldInteraction`。修订一轮把取叶移进 `check`，成功与失败都写全，失败一侧记录莉安看见手伸向叶子。
- 修订稿里交谈仍在 `steps` 绑 always，只写莉安照常回答的一面，与 round120 的形状相同。若检定失败，这份稿会同时写莉安看见动手和莉安照常回答。指引 v43 要求这种情况下交谈才是检定步骤，本批模型没有照做。
- 骰面 15，对 DC 14，成功，莉安没有察觉，所以上面的矛盾没有进入结果。
- 旁白依次写取叶、问话、莉安回答、得手，顺序正确，审核通过。

## 没有覆盖的

- 首稿放对检定步骤：三批里一批放对（round120），两批留空（round121、122）。本批 `checkStep` 被写了，但没有让首稿写出检定行。
- ADR 0044 的条目排序：本批选择没有加载 NPC 视图或记忆，没有测到。
- 本批检定成功，交谈绑 always 的失败一侧没有执行。

私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-VGgyAm`，重启即失。
