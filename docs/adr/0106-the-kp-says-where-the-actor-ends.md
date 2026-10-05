# ADR 0106：KP 写明行动者的终点，服务器核对

- 状态：已接受
- 日期：2026-10-05
- 依据：第 167 批真实验证（[回执](../agent/receipts/vnext-round167-validation.md)）。同一份请求每次抽到的写法不同，有两类写法不受任何检查约束：
  - 167-9："去后院"写成不带移动的自由步骤，结果摘要说"站在后院湿泥地上"，人仍在大厅；
  - 167-11："爬下排水沟，再从对面爬上去"只写了 `climb/down`，摘要和旁白说"从对面爬回院面"，人停在沟底。

  提交后，文字与地图不一致，玩家看不出动作没有发生。用户同意先补上这项检查，再重跑爬沟。
- 当前规则：[SPEC 0014 §4](../specs/0014-observer-tactical-map-and-environment.md)（"终点"一条）。

## 决定

1. **裁决写明终点。**
   - directSuccess 写 `successEndsAt`，check 再写 `failureEndsAt`。
   - 线上是一个字符串：
     - 站在平地时，写所在地点的 placeRef；
     - 在沟里或水里，写 `placeRef inside 要素ref`；
     - 在台阶、墙或崖顶上，写 `placeRef onTop 要素ref`。
   - 领域里解成 `{ placeRef, footing, featureRef }`。读不成这三种写法时报 `endsAt:shape-invalid`。
2. **服务器推算终点。**
   - Rules 的 `actorEndNow` 读行动者现在的地点和落脚（`terrainFooting`）。
   - `actorEndAfter` 按顺序应用这一结果实际执行的步骤里的效果。只有这些效果改变终点：
     - `travelTo`（前往）；
     - `climbFeature`（下：沟里或水里为 inside，台阶或墙顶下来回到平地；上：出沟回到平地，或上到顶上；翻过：平地）；
     - `jumpOnto`（顶上）；
     - `jumpOver`（平地）；
     - `fallFrom`（掉进沟里或水里为 inside，从高处掉下为平地）。
   - 走动不改变终点（ADR 0098）。
   - 成功取 `always`、`onSuccess` 两类步骤，以及被检定那一步的成功分支；失败取 `always`、`onFailure` 两类步骤，以及被检定那一步的失败分支。
3. **不一致退回修订。**
   - 每个对不上的结果报一条 `endsAt:steps-leave-the-actor-elsewhere`，写明步骤实际把行动者留在哪。
   - 诊断要求保留玩家的目的、改步骤：
     - 去别处用 goTo；
     - 下沟再从对面出来用 across；
     - 失败落进沟里或水里要加一个绑定 onFailure 的 fall 步骤。
   - 只有行动者确实留在原处时，才连同结果文字一起改。
   - 有其他步骤降级失败时先报那些，等每一步都有效果后再核对。
4. **没写不核对。**
   - 表单把这两个字段列为必填（严格模式要求所有字段），但领域里可以没有：没写的结果不核对。这样现有测试夹具和录下的方案不受影响。
   - 测试辅助 `withAllGroups` 在只核对表单形状时补一个占位地点。
5. **版本。** 指引升为 `zhuwei.proposal-guidance/v95`。尚未冻结的方案按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。

## 影响

- 每个填写请求多约 164 个估算 token：
  - 两个字段出现在 directSuccess、check 及其澄清选项里；
  - 指引多一句。

  按 [ADR 0057](0057-request-size-may-grow-for-a-feature-the-user-was-told-about.md)，已告知用户后接受。
- 对抗和隐蔽检定不带这两个字段：它们改变的是对方的位置，或者不移动行动者。
- 核对只看 KP 写的终点与步骤是否一致，不读结果文字。KP 若写错终点、又让终点与错误的步骤一致，仍然查不出来。
- 本次没有真实调用验证；需要一批编号的真实探针（爬沟重跑）。
