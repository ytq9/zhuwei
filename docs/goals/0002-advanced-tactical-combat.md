# Goal 0002：高级战术战斗（待继续）

状态：**待继续（PENDING）**
建立日期：2026-08-28
前置里程碑：Goal 0001 的线上最小战术地图回执 `MILESTONE_1_COMPLETE`
权威规格：`docs/specs/0001-llm-kp-responsibility-contract.md`，本 Goal 不修改、不替代、不缩小该规格。

## 一、目标

在 Milestone 1 的 Viewer-only 二维查看界面与 authoritative-v2 状态权威之上，继续完成高级移动、三维空间、区域预览、环境连锁和持续区域机械。所有新机械仍穿过唯一 `Room Action → step → Room DO → project → replay` 链；客户端只提交意图与闭合选择，不提交实际命中集合、骰面、WorldState patch 或机械结果。

本文件是后续恢复合同，不授权当前 Milestone 1 继续实现这些延期项。Milestone 1 部署后应立即停止，由新的明确执行请求恢复本 Goal。

## 二、恢复协议

后续执行开始时：

1. 完整读取根目录 `AGENTS.md`、`CONTEXT.md`、SPEC 0001、本文件和 `docs/refactor-log.md`，再检查 `git status`、`git diff`、未跟踪文件、当前分支与远端 SHA。
2. 保留 Milestone 1 及此前全部高级战斗修改；禁止 reset、clean、强制 checkout、重新克隆或覆盖既有工作。
3. 先复跑本文件列出的现有 GREEN/RED，再从第一个实际违反不变量的位置继续；不得根据旧日志猜测当前源码状态。
4. 每次只读取当前切片直接需要的代码、文档与 Skill。根因沿“输入 → 权限/状态 → Rules → 持久化 → Viewer 投影”定位。
5. 持续更新 `docs/refactor-log.md`，记录命令、退出码、失败因果链、修改、证据和剩余条件。

恢复时必须先验证：

- 分支仍为 `cloudflare`；远端 `main` 基线仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`，或明确记录上游经用户批准后的新基线。
- SPEC 0001 SHA-256 仍为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`，除非用户另行明确批准修改规格。
- 本交接时 tactical Module pin 为 `sha256:df49e12260b590d339961c2a19b3ddc5f59741d2a8521d4d97dbf151d9177947`；以恢复时 registry、生成 hash 与 Module 测试三方一致为准。

## 三、已完成基础（不是本 Goal 的完整完成证据）

- authoritative-v2 已有版本化真实场景 geometry、稳定出生点、Viewer-filtered TacticalProjection、spatial revision、真实桌 Adapter 与二维 SVG/文字读数。
- 公开 movement exact action、两段 waypoint、`MovementSegmentCommitted`、幂等、archive/fresh DO，以及超速/公开与隐藏障碍/坏起点/stale revision 已有真实 Room 证据；当前 movement tracer 为 **3 passed / 2 skipped**。
- 5e 2014 的区域 Geometry 底座已有 sphere/cylinder/cube/cone/line、边界、墙前冻结与 straight/aroundCorners 单元证据。
- portal open/closed/destroyed 与 stone seat intact/damaged/destroyed/rubble 已通过真实 Room attack、随机、事件、投影、隐私和 archive/replay；相关三文件主复核为 **15/15**。
- 真实 SRD 2014 `fog` 已从 Ranger 静态卡编译到受控 AbilityDefinition；定义测试 GREEN。
- 这些结果只证明可复用底座。没有下文对应的端到端证据时，不得把延期能力写成完成。

## 四、延期能力、已知缺口与恢复入口

### 4.1 精确掩护与地图交互

当前程度：**部分完成**。

- 已有：`tests/combat-mechanics-v2.test.mjs` G10 覆盖 hard-cover 阈值与 soft-only 上限；TacticalProjection/地图能显示 `none/half/threeQuarters/full` 标签；门和残骸状态能改变公开 cover 字段。
- 缺口：projector 仍无真实 cover preview；没有真实 Room 证明门/残骸变化会改变下一次攻击或区域结算的 cover 机械结果。
- 恢复入口：`rules/profiles/combat-geometry.ts::coverLevel`、`rules/v2/combat-actions.ts::targetCover`、`rules/v2/projector.ts::projectTacticalScene`、`rules/tactical-projection.ts`、`components/tactical-map.tsx`。

完成标准：

- [ ] 真实 Room 分别产生 none、half、threeQuarters、full，攻击冻结结果与 replay 一致。
- [ ] 同一门/残骸状态变化能改变一次后续真实机械结果，而不只是标签。
- [ ] 公开 preview 只含 Viewer 已知 cover/blocker，客户端不重算 cover。

### 4.2 elevation、飞行、攀爬、坠落与三维路径

当前程度：**部分完成**。

- 已有：范围/区域/障碍已使用三维 position 与 footprint；地图能读取 elevation/height。
- 缺口：movement tracer 的高程项仍 skip；Module 没有版本化支撑面/楼梯路线；没有 climb/fly/fall action/event 闭环。
- 恢复入口：`black-oak-will-tactical.ts`、`profiles/tactical-geometry.ts`、`profiles/combat-geometry.ts::analyzeCombatMovement`、Room movement action/DO、`tests/tactical-movement-room-v2.test.ts` 高程项。

完成标准：

- [ ] Module 固化至少一条可行走升降路线与支撑面，任意 elevation patch 被拒绝。
- [ ] walk、climb、fly、fall 各有闭合输入和至少一个合法/非法真实 Room 结果。
- [ ] 三维距离、资源或坠落伤害进入 typed event，并在驱逐、archive、project、replay 后等价。

### 4.3 多 waypoint、强制移动、传送与移动中途反应

当前程度：**部分完成**。

- 已有：movement tracer 3 passed / 2 skipped；两段直角路径提交两个有序 segment；速度、公开/隐藏障碍、坏起点、stale revision 无写入且秘密安全。Rules G14/B53 已有反应前缀与私有 OA Pending 底座。
- 缺口：专用玩家 Room OA tracer 仍 skip；强制移动/传送没有 authoritative-v2 action/event 闭环；地图无移动输入。
- 恢复入口：movement tracer 最后一项；`rules/v2/combat-actions.ts::{moveCombatant,continueMovement,resolveOpportunityAndMovement}`；Room action/DO。

完成标准：

- [ ] 多 waypoint、强制移动、传送分别通过真实 Room→Rules，不复用 Legacy 写路径。
- [ ] 每个移动反应只提交已走前缀，未走段没有事件。
- [ ] 正确认证 controller 可在驱逐后继续 Pending，结果 replay/project 等价。

### 4.4 五类区域交互式预览

当前程度：**Rules 底座已验证，端到端未实现**。

- 已有：sphere、cylinder、cube、cone、line 的目标集合、边界、传播与墙前冻结单元证据。
- 历史 RED 与当前安全状态：闭合 fog ability 曾在 RoomAction 以 unsupported kind 失败；Milestone 1 已把它收口为明确的 `tacticalMapAbilityDeferred`，forged `targetIds/affectedEntityIds/zone/state` 仍安全拒绝，KP 调用为 0，前后权威投影不变。这不是区域能力实现，只是避免虚假成功的安全延期。
- 缺口：projector `preview:null`，实际桌没有区域控件。
- 恢复入口：`combat-geometry.ts::{canonicalAreaShape,entitiesAffectedByArea,freezeAreaOrigin}`、`combat-actions.ts::areaTargets`、Room action/authority/DO、projector、TacticalMap、zone tracer。

完成标准：

- [ ] 五类形状都从闭合 origin/direction 输入进入真实 Room。
- [ ] preview 只显示 Viewer 已知结果，提交时从最新完整 WorldState 重算。
- [ ] 客户端提供 `targetIds` 或 `affectedEntityIds` 时始终 fail closed。
- [ ] 实际集合被 typed event 冻结并可 replay，UI 不显示虚假精确成功。

### 4.5 隐藏实体的区域结算与 preview 非干扰

当前程度：**基础隐私已验证，专项未实现**。

- 已有：隐藏墙/实体猜测目标公开错误同形；秘密非空间变化不改变 viewer-safe revision；movement 公开/隐藏障碍失败同形。
- 缺口：`areaTargets()` 在 Geometry 前先按 hostile candidates 过滤，不能按定义纳入施法者、盟友、中立、隐藏实体和环境要素；没有 paired-world preview 证据。
- 恢复入口：`combat-actions.ts::areaTargets`、projector、tactical projection、`privacy-bypass-v2.test.mjs` 与后续 TM06 tracer。

完成标准：

- [ ] 两份 Player Projection 逐字相同、只在隐藏实体/障碍不同的 WorldState 产生字节相同 preview 与公开错误。
- [ ] 实际提交仍按完整权威状态纳入隐藏目标，公开事件/投影不泄露身份或数量。

### 4.6 可破坏物材料、残骸、坍塌与环境连锁

当前程度：**耐久与残骸较强部分完成；材料/连锁未实现**。

- 已有：真实 warhammer、Room randomness、turn grant、range/path、durability、AC、threshold、immunity、rubble、幂等与 archive/fresh DO。
- 缺口：没有材料模型、坍塌关系或环境连锁事件；尚未由后续移动/攻击/区域证明 rubble/door 状态确实改变机械。
- 恢复入口：`profiles/tactical-geometry.ts`、tactical Module、`rules/v2/environment.ts`、`combat-actions.ts::{invokeEnvironmentAbility,resolveEnvironmentAbilityRandomness}`、destruction/portal tests。

完成标准：

- [ ] Module 固化材料、坍塌和连锁定义，客户端不能提交结果 patch。
- [ ] 真实伤害触发一次性耐久/阈值/免疫/残骸/坍塌事件链。
- [ ] 后续移动、LOS、cover 或传播至少一项真实机械随状态改变。
- [ ] 连锁事件 exactly-once，秘密安全，驱逐与 archive/replay 一致。

### 4.7 持续区域创建、传播、中断、到期与 replay

当前程度：**早期部分完成，高级执行路径已安全延期**。

- 已有：真实 `fog` AbilityDefinition GREEN。
- 当前测试事实：`npx vitest run tests/environment-zone-room-v2.test.ts --no-file-parallelism --maxWorkers=1` 为 **2 passed / 3 skipped**。第二项只证明严格输入拒绝与 `tacticalMapAbilityDeferred` 无写入；zone create/project/archive、expiry exactly-once、concentration end 三项仍 skip。
- 待恢复首因：Milestone 1 的 Room Action 分支有意在 Authority 前停止，尚无闭合 ability→Rules→typed zone 路由；projector 仍输出 `knownZones:[]`。
- 恢复入口：`tests/environment-zone-room-v2.test.ts`、`character-abilities.ts`、Room action/authority/DO、`combat-actions.ts::{areaTargets,invokeAbility,endConcentration}`、projector/tactical projection。

完成标准：

- [ ] 闭合 fog ability 直接进入 Rules，typed zone 创建并只向有权 Viewer 投影。
- [ ] 同 submission 只扣一次槽、只创建一次 zone、不增加无关随机请求。
- [ ] fiction-time 到期只结束一次，主动/替换/失败 concentration end 原子结束关联 zone。
- [ ] 重连、驱逐、archive、replay 后 zone 不复制、不复活。

### 4.8 高级动画、点云、3D、物理模拟与视觉润色

当前程度：**未实现；候选表现层**。

- 已有：Viewer-only SVG 2D、网格、实体、feature 状态与文字读数。
- 产品边界：这些表现能力不得进入 Rules 真相、action payload 或 WorldState；不得先于 4.1–4.7 的机械与隐私完成。
- 恢复入口：`app/_runtime/components/tactical-map.tsx` 与独立表现层测试。

这组候选需未来用户明确选择实现范围。未选择的子项保持“待决”，不能写成已验证，也不阻塞 4.1–4.7 的完成。

若未来批准任一子项，其最低标准为：

- [ ] 只消费 TacticalProjection，同一投影产生确定 DOM/快照。
- [ ] 支持 reduced-motion，375px/1440px 无横向溢出。
- [ ] 表现故障不改变机械提交、Receipt 或 replay。

## 五、执行顺序

1. 先用真实 RED 取代 Milestone 1 的安全延期断言，再闭合 4.4/4.7 的 ability→zone 权威纵切；不能把 `tacticalMapAbilityDeferred` 当作实现证据。
2. 再修正 4.5 的 definition-driven candidate set 与 paired-world 隐私证据。
3. 完成 4.3 的 OA/强制移动/传送，再建立 4.2 的版本化高程路线。
4. 用真实后续机械闭合 4.1/4.6 的 cover 与环境连锁。
5. 冻结 TacticalProjection/Profile/Module/manifest hash，跑全量门。
6. 只有未来用户选定后才进入 4.8 表现层。

每一步都先 RED、再最小 GREEN、再相关回归；不能因后续步骤可见而提前扩大当前切片。

## 六、Goal 0002 完成标准

只有以下条件全部取得实际证据，才可把本文件状态从“待继续”改为 COMPLETE：

- [ ] 4.1–4.7 各自的所有复选项均有真实 Room/Rules/Viewer/replay 证据。
- [ ] 所有 active RED 与 skip 均已通过对应实现闭合；没有删除、跳过或弱化测试来取得绿色。
- [ ] TacticalProjection/Profile/Module/manifest hash 在最终源码冻结且 registry、生成值、测试三方一致。
- [ ] `npm run module:check`、`npm run typecheck`、`npm run lint`、`npm test`、`git diff --check` 在同一最终源码退出 0。
- [ ] `docs/refactor-log.md` 记录最终命令、退出码、已知限制和恢复/发布事实，不把未执行项写成已验证。
- [ ] 若该后续 Goal 获得部署授权，部署与推送仍只更新既有 `zhuwei`/`DB`，非 force 推送，并证明远端 `main` 未变。

4.8 只有在未来用户明确选择的子范围内验收；未选择项必须保留为待决，不得冒充完成。
