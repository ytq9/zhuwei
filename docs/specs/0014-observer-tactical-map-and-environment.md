# SPEC 0014：观察者战术地图、权威环境与空间意图

- 状态：**已裁定（用户 Goal 明确批准）**
- 裁定日期：2026-08-27
- 产品：烛帷
- 适用规则：D&D 5e 2014 / SRD 5.1
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0005`、`SPEC 0007`、`SPEC 0010`、`SPEC 0012`、`SPEC 0013`
- 范围：authoritative-v2 的场景几何、环境要素与有限状态、观察者专属战术投影/预览、地图输入、二维 Adapter、同源文字读数和 0.4 当前版本边界

## 1. 继承关系与严格范围

本规格落实用户在 Goal 中明确批准的二维战术地图决定，不修改、缩小或取代冻结的 `SPEC 0001`。地图只展示观察者专属 Player Projection；它不是机械权威、活跃状态、骰源、完整 GM 地图或另一套 Encounter。

本规格不要求点云、写实 3D、通用物理引擎、碎片模拟、流体模拟或结构力学。LLM/KP 仍按 `SPEC 0001` 在故事锚点和已固化事实内决定环境的定性事实及合理变化；Rules 只验证版本化有限状态、空间、资源、骰子、时点和效果，不替 KP 选择世界应当如何损坏或多危险。

## 2. 领域对象

### 2.1 Authoritative Tactical Space

每个可进行战术裁决的 scene 拥有一个版本化权威战术空间，至少包含：

- scene 边界和 Geometry Profile ref/hash；
- 以整数英寸规范化的 `x/y/elevation`；
- 实体 position、footprint、height 和移动方式；
- 环境要素的稳定 ID、几何、状态、可见性与定义引用；
- Encounter、持续区域效果与其时点；
- 空间 scope revision，供提交时重验相关变化。

显示方格、缩放、像素和视觉舍入只属于 Adapter。默认可按 5 尺格吸附及呈现，但它们不得写回 WorldState、改变 Geometry 边界或替代整数英寸/有理数算法。

0.4 authoritative-v2 scene 不允许用空 `obstacles`、合成一维距离或页面坐标冒充最终生产几何。无法从前 0.4 数据确知坐标时直接拒绝进入当前解释器；不猜测迁移，也不保留 Legacy Adapter。

### 2.2 Environment Feature

环境要素具有稳定身份和版本化定义，首版封闭类别至少包括：

- `boundary`：场景边界或不可越界轮廓；
- `barrier`：影响移动、视线、掩护或区域传播的屏障；
- `portal`：门、闸、通路或开口；
- `terrain`：普通、困难、危险或残骸地形；
- `interactable`：可在世界内操作的物件；
- `destructible`：具有已冻结耐久/阈值及状态图的可破坏物；
- `zone`：由环境或能力产生、具有来源和到期条件的持续区域。

定义必须声明规范 geometry、状态图、每个状态对应的 `impassable/opaque/cover/terrain/occupancy/propagation` 等机械语义、可见性策略和允许的转换。调用者不能提交任意字段路径或状态 patch。

### 2.3 Environment State

环境状态是已固化有限状态，例如 `intact | damaged | destroyed`、`open | closed | destroyed`、`normal | burning | frozen | collapsed`。具体状态集合由注册定义固定，不是全局字符串白名单。

KP 可以提出状态或转换及其因果依据；Rules 验证：

1. 要素和定义存在且版本匹配；
2. 当前状态允许该转换；
3. actor、时点、路径、工具、资源和范围合法；
4. 若涉及伤害、豁免或阈值，机械来自 AbilityDefinition/环境定义；
5. 影响目标集合、DC、风险、随机、资源或不可逆后果的条件和阈值在任何权威骰面前冻结；
6. 提交后状态语义立即改变移动、视线、掩护、区域传播、占位或地形，并可 replay。

Rules 不从文本模拟物理，也不在看到骰面后让 KP 改写材质、耐久或状态门槛。

## 3. 唯一事务与事件

所有地图相关变化继续使用：

```text
地图手势或自然语言意图
→ 可信 Room Action Module
→ KP 在专属投影内填写私有 Form，并编译为版本化 CausalActionProgram
→ Rules step 诊断/请求权威随机/确定实际路径与集合
→ Room DO 原子提交 WorldEvent、Receipt、Pending 与 DeliveryPlan
→ project(viewer) 产生 Tactical Projection
→ 地图和文字 Adapter 展示同一投影
```

权威事件必须足以从 genesis 重建，不要求另建地图事件流。现有通用事件可以承载语义，但 archive 至少必须明确表达：

- scene geometry/环境要素建立及定义版本；
- 实体规范位置、占位与实际通过路径；
- portal/barrier/destructible/terrain 的前后有限状态与因果依据；
- Effect/zone 的创建、持续、到期、中断与结束；
- 能力定义、原点、方向、传播模式、实际内部受影响集合及权威骰面引用；
- 事件 schema、Rules/Geometry/Ability/Profile manifest 和 active branch。

D1 仍只保存可重建事件 archive。客户端地图状态、浏览器缓存、D1 静态人物卡、日志和模型 Prompt 均不得保存第二份活跃 geometry 或实际区域集合。

## 4. 移动路径

地图手势只形成 `MapIntent`：有序三维 waypoint、移动方式和定义允许的封闭选择。自然语言或 KP 也可形成相同规范提案。

Rules 按 `SPEC 0012/0013` 在完整权威状态上计算：

- 规范路径和距离；
- 速度账本、移动方式、困难地形与挤入；
- 连续 swept-volume 占位/碰撞；
- elevation/height、攀爬、游泳、飞行、坠落和合法终点；
- 反应、危险、状态变化和每个暂停边界。

只提交已经实际通过的路径前缀。路径后段因隐藏屏障、反应、速度归零或环境变化失效时，不提前写入终点，也不以错误差异泄露隐藏原因；控制权回到正确玩家重新规划。

## 5. 区域能力与环境效果

区域能力的玩家/页面只提交 AbilityDefinition 允许的原点、方向、路径或封闭选项。页面不得提交完整 `targetIds`，也不得自己决定受影响者。

Rules 必须从完整权威空间计算实际集合，按定义关系正确纳入或排除：

- 施法者；
- 盟友与敌人；
- 可受该能力影响的环境要素；
- 玩家不可见但真实位于区域内的隐藏实体；
- 被 clear-path、传播、全掩护、范围或高度排除的实体。

能力的范围、传播、伤害、豁免、持续时间、资源、专注和到期来自版本化 AbilityDefinition/Profile。KP 只可基于骰前已固化环境事实提出合理的环境状态后果；环境状态、持续 zone 与机械效果仍在同一 Root/事件链提交。

## 6. Tactical Projection

`project(viewer)` 是战术呈现的唯一来源。每个 Viewer 的 Player Projection 可包含：

```ts
type TacticalProjection = {
  schema: "zhuwei.tactical-projection/v1";
  scene: { id: string; boundary: Polygon; gridInches: 60 };
  self: TacticalEntity;
  visibleEntities: TacticalEntity[];
  knownFeatures: TacticalFeature[];
  knownZones: TacticalZone[];
  encounter: TacticalEncounterSummary | null;
  preview: TacticalPreview | null;
  textualReadout: TacticalReadout;
  spatialRevision: string;
};
```

该示意只规定职责，不授权页面构造字段。正式 schema 必须是 closed/versioned JSON，按稳定 ordinal/id 排序，并只包含 Viewer 有权知道的：

- 自身与可见实体的 position/footprint/elevation/height/关系/公开状态；
- 已知 boundary、terrain、portal、barrier、interactable、destructible、zone；
- 已知移动阻挡、视线阻挡、半掩护、四分之三掩护、全掩护及区域传播停止点；
- 当前 Encounter 的公开阶段、轮/回合和可观察持续效果；
- 同源文字战术读数和无障碍标签。

隐藏实体、隐藏屏障、秘密门、内部采样、完整实际区域集合、未公开定义和 GM-only 原因不得出现，也不得从列表长度、空数组差异、错误码、响应时长、阴影层或 preview 候选数间接泄露。

两个完整 WorldState 若只在 Viewer 无权知道的隐藏实体或隐藏障碍上不同，而其 Player Projection 相同，则相同 preview query 的公开响应必须规范字节等价；提交仍针对各自完整 WorldState 重算并可得到秘密安全的不同实际后果。

## 7. Tactical Preview

preview 是同一 `project(viewer)` 的可选 closed query，不建立第三个机械 Interface，也不提交状态。Rules 从完整 WorldState 计算后只投影 Viewer 已知的：

- 自伤与已知友军波及；
- 已知范围、原点、方向、路径、距离与高度影响；
- 已知阻挡、掩护、区域墙前落点和传播停止；
- 当前投影能证明的资源/时点/合法性提示。

preview 不公开隐藏目标数量、隐藏障碍或完整实际集合，不冻结未来结果，也不是 Receipt。真正提交必须重新鉴权、比较空间 scope revision，并由 `step` 对最新完整 WorldState 重算。客户端不得把 preview 回传为权威 target list、cover 或 collision 结果。

## 8. 二维地图与文字 Adapter

第一版地图是俯视格子或等价简化二维显示，必须：

- 显示自身、可见单位、占位、已知边界/障碍/门/地形/可互动物/持续区域；
- 以明确标记显示 elevation/height；
- 区分移动阻挡、视线阻挡、半掩护、四分之三掩护、全掩护和区域传播停止；
- 允许选择有序移动 waypoint、区域原点和方向，但不让玩家手工勾选实际区域受影响者；
- 在窄屏和桌面均无横向溢出，键盘/触摸可操作；
- 地图不可用、被隐藏或无图形能力时，仍提供同一 `textualReadout` 的完整可操作路径。

地图组件不得读取完整 WorldState、GM 投影或内部事件，也不得自己计算距离、掩护、碰撞、区域目标、环境状态或 preview。视觉动画和本地 hover 可存在，但不能改变提交载荷以外的机械含义。

## 9. 门、破坏与持续环境验收语义

### 9.1 Portal

同一门/通路至少支持 `open | closed | destroyed`。状态变化提交、投影、replay 后必须一致地改变定义声明的移动、视线、掩护或区域传播；未经观察的秘密门仍不得因 preview 暴露。

### 9.2 Destructible

可破坏物至少支持 `intact → damaged → destroyed` 或定义允许的跳转。耐久、阈值、伤害类型/免疫和 destroyed 后的屏障/占位/残骸地形后果在骰前冻结，并与伤害/资源/随机结果原子提交。

### 9.3 Environment Zone

至少一个 Ability 创建可回放环境状态或持续 zone。它必须记录来源、geometry、开始、持续、到期/中断、专注或其他终止条件；刷新、断线、DO 驱逐和 replay 不能重复创建、漏到期或改变实际集合。

## 10. 0.4 版本与退役边界

- 0.4 只注册精确的当前 authoritative-v2 完整 runtime manifest；前 0.4 规则、场景与归档已经退役，不进入当前 Registry、回放或地图 Adapter。
- 不从旧 distance、scene label、页面像素或空 obstacle 数组猜 authoritative-v2 坐标，也不提供兼容、fallback 或 migration。
- authoritative-v2 genesis 固定 Geometry/Profile/TacticalProjection/EventSchema 的完整 ID/hash。
- 更改坐标精度、碰撞、掩护、传播、采样、环境状态图或投影 schema 必须发布新 Profile/Adapter；届时是否保留当前解释器取决于仍在使用的数据合同和新的明确裁定，不能预留含混回退。

## 11. 验收场景

1. 新 authoritative-v2 scene 由真实 geometry genesis，经事件保存、replay 和 Viewer projection 后规范等价，且不是空 obstacles/一维合成位置。
2. 同一 Room 的不同 Viewer 得到不同但合法的 Tactical Projection；桌面 Adapter 保留位置、占位、Encounter、已知地形和高度。
3. 二维地图显示自身、可见单位、已知障碍、可互动物、地形、持续效果、占位和 elevation/height。
4. 同图明确区分移动/视线阻挡、half/three-quarters/total cover 以及区域被墙阻断或在墙前落点。
5. 玩家提交 ordered path、area origin/direction；页面没有实际区域 target 多选，Rules 在最新 state 重验。
6. 一次区域结算同时覆盖 caster、ally、enemy、hidden entity 与 environment feature 的纳入/排除，公开 preview 只含 Viewer 已知子集。
7. 同一 portal 的 open/closed/destroyed 三态改变至少一种移动、视线、掩护或区域传播结果，并可 replay。
8. destructible 从 intact 到 damaged/destroyed，状态改变屏障/占位或 rubble terrain，并经 Room archive/new DO restore 保持。
9. Ability 创建环境状态或持续 zone，覆盖创建、持续、到期、中断、重连、DO 驱逐和 replay exactly once。
10. 一个 elevation/height 场景真实改变移动、距离、范围或掩护，不只是显示标签。
11. 环境、移动、法术、破坏和持续效果全经 Room Action → `step` → Room DO → `project/replay`，模块护栏拒绝旁路。
12. 两个只含不同隐藏实体/障碍的 state 产生相同 Player Projection；相同 preview 规范字节不可区分，提交内部结果仍正确。
13. 375px 与 1440px 浏览器视觉/DOM 验证无横向溢出，战术标记可辨认，键盘/触摸路径与同源文字 fallback 可操作。
14. 最终冻结源码相关行为测试、`module:check`、`typecheck`、`lint`、`npm test`、`git diff --check` 全部通过。

测试只允许经真实 Room Action/Room Authority、`step/project/replay` 公共 Interface、Viewer projection 和页面/API 操作建立状态；不得直接修改 WorldState、内部事件、骰面、障碍或实际目标集合来伪造成功。

## 12. 实现映射与当前证据状态

| 责任 | 唯一生产映射 | 验收映射 | 当前状态 |
| --- | --- | --- | --- |
| Geometry/Profile | `app/_runtime/lib/rules/profiles/combat-geometry.ts`、Rules v2 state/events/fold | G01–G15、场景 1/4/10 | 现有算法已有定向证据；真实 scene geometry/state/project vertical 待补 |
| 环境定义/状态 | Rules Ability/Definition compiler、CausalActionProgram、campaign events | 场景 7–9/11 | 待实现/验证，禁止 UI patch |
| Tactical Projection/preview | Rules `project(viewer)`、Room observe | 场景 2/4/6/12 | 待实现/验证 |
| 路径/区域提交 | Room Action、Rules `step`、Room DO randomness/continuation | 场景 5/6/10/11 | 机械 helper 有证据；生产 Room/页面纵切待补 |
| Map/text Adapter | authoritative table Read Model、`play-table.tsx` | 场景 2–5/13 | 待实现/浏览器验证 |
| archive/replay/version | Room archive/restore、Rules `replay`、Runtime Registry | 场景 1/7–11/14 | 通用恢复已有证据；战术全状态纵切待补 |

本表中的“现有算法”不代表本规格完成。只有上述 14 个场景在同一冻结源码取得实际证据并回填 `docs/refactor-log.md`、追踪矩阵及最终门后，才可把本规格写成已交付。

## 13. 五项交叉审查

- **跨规格**：`SPEC 0013` 继续拥有数字 Geometry 算法，`SPEC 0012` 拥有战斗移动/区域机械，`SPEC 0005` 拥有事实/因果，`SPEC 0010` 拥有 Viewer 呈现；本规格只把环境状态和地图 Adapter 接入同一链。
- **权限**：principal、控制角色、scene、turn/window 和 ability choice 都来自可信 Room 状态；地图请求体不能扩大控制权或自报 actor/targets。
- **秘密**：完整 geometry/actual targets 只在 Rules/Internal；Player Projection、preview、错误、DOM、ARIA、日志和语音只含同一 Viewer 可知内容。
- **版本**：geometry、environment definition/state graph、projection schema 与 event schema 都由 manifest pin；前 0.4 房间不猜迁移且不进入当前解释器。
- **第二权威**：地图和文字仅消费相同 Tactical Projection；所有变化仍只经 `step`/Room DO，所有观察/回放仍只经 `project/replay`。
