---
kind: part
part_of: "0010"
title: "SPEC 0010 分册：投递、权威状态与验收"
clauses: "8-18"
---
# SPEC 0010 分册：投递、权威状态与验收

本文件是 [SPEC 0010](./0010-observer-specific-presentation.md) 的 §8–§18，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 8. DeliveryFrame 单槽协议

### 8.1 帧结构

每个 DeliveryFrame 至少绑定：

- `deliveryId`；
- `roomId` 与 ViewerKey；
- 权威 `receiptId`、`eventRange` 和 `activeBranchId`；
- `projectionHash`；
- `presentationPolicyVersion` 与 `narrationPolicyVersion`；
- 当前回应的文本载荷；
- 可选的同内容语音呈现元数据；
- 创建时间和幂等载荷哈希；
- `unacknowledged` 状态。

DeliveryFrame 不能携带 KP 全知上下文、未投影事实、其他 ViewerKey 的文本、原始 Prompt 或未选候选。

### 8.2 产生顺序

新旁白策略的当前回应按以下顺序产生：

1. Room DO 保存尚未生效的机械候选、固定骰面和私有准备身份；
2. `project` 为候选结果中的每个合法 ViewerKey 冻结专属材料；
3. KP 在 DO 事务外生成自然语言正文并独立审核，遵守 SPEC 0016 §8.3 的有界修稿；
4. 全部受众回复就绪后，Room Action Module 使用内部幂等 capability 请求发布；
5. Room DO 复核相关依赖、控制权、分支、冻结受众与精确正文，在同一事务保存世界变化、Receipt 和每个 ViewerKey 的专属投递槽；
6. 页面经 `observe(viewer)` 取得已提交 Read Model 和自己的帧，实际呈现后显式 ACK。

终局失败取消尚未交付的候选，不消耗该候选的资源或虚构时间，不向任何受众泄露候选结果。已在旧流程提交的世界结果及新流程已保存的回复不因网络失败回滚；恢复复用原绑定和正文，不重掷、不重复扣资源、不扩大 Audience。历史错误仍走授权更正，不能静默倒写事件。
### 8.3 刷新、轮询、断线和重启恢复

同一 ViewerKey 在 ACK 前的所有合法读取必须返回相同 `deliveryId`、相同正文和相同载荷哈希。刷新、重复轮询、浏览器多标签、网络响应丢失、断线重连和 Worker/DO 重启不能生成新帧或重复世界结果。

客户端可以携带最后见到的 `deliveryId`，但服务端以 Room DO 当前槽为准。客户端缓存不能恢复已经被服务端 ACK、覆盖、撤销或失效的正文。

现实经过时间不自动 ACK、不产生 `pass`、不推进虚构时间。单槽容量而非完整消息队列是可靠送达的边界：只要该帧仍是相应 ViewerKey 的当前未确认回应且权限未撤销，断线者可以恢复它；系统不承诺恢复被后来回应覆盖的旧叙述。

### 8.4 ACK

ACK 必须携带当前 `deliveryId`，并由可信会话重新鉴权。只有对应 ViewerKey 可以确认。

首次有效 ACK 原子完成：

- 把当前槽标记为已确认；
- 把已呈现文本追加到该 ViewerKey 的亲历记录；
- 删除或使当前槽中的正文、音频载荷和逐字转写不可读取；
- 保留最小化的非内容 tombstone、载荷哈希和幂等 Receipt，以回答重复 ACK；
- 不改变 WorldState、角色知识、待决输入、控制权或虚构时间。

同一 ACK 重试返回原 ACK Receipt，但不返回正文。错误 `deliveryId`、其他 ViewerKey 或已被新帧覆盖的 ID 只能得到统一脱敏结果，不能泄露曾经存在什么内容。

ACK 表示产品已经向该 principal 的 ViewerKey 呈现当前回应。一个设备 ACK 后，同一 ViewerKey 的其他设备不能再把它作为当前 DeliveryFrame 取得，但可以通过该 ViewerKey 的亲历记录查看已呈现文本。

### 8.5 新回应覆盖旧回应

向同一 ViewerKey 发布新的合法 DeliveryFrame 时，Room DO 必须在同一原子写入中：

1. 把旧帧已呈现文本追加到该 ViewerKey 的亲历记录，并使旧 `deliveryId`、音频载荷和当前槽正文不可再取；
2. 保留不含内容的 superseded tombstone；
3. 把唯一槽替换为新 `deliveryId`；
4. 不删除旧帧所对应的结构化事实、知识、Receipt 或更正记录。

没有进入新回应 AudienceSnapshot 的 ViewerKey 不会因该回应获得新帧；其原有当前帧可以继续存在，直到 ACK、收到自己的新回应、权限撤销或安全失效。

### 8.6 更正和分支变化

DeliveryFrame 必须绑定 `activeBranchId` 和 `projectionHash`。更正使当前未确认帧依据失效时，旧正文立即失去“当前真相”资格，只进入原冻结受众各自的亲历记录；更正后的专属投影生成明确的新帧，不能在旧文字上静默打补丁。

已经 ACK 或覆盖的旧帧不会因更正恢复为当前帧。玩家从当前 Read Model 和新的更正回应了解其有权知道的变化；审计所需的旧事件与结构化更正仍由权威事件保存，D1 事件归档不保存亲历叙述正文。

## 9. “不可回看”的精确定义

对普通玩家，以下 Interface 必须不存在或恒不返回超出其 ViewerKey 亲历记录的旧叙述正文：

- KP 回应分页、滚动聊天记录、全文搜索或按时间范围查询；
- 按旧 `deliveryId`、Receipt、eventSeq、branchId 或 projectionHash 重取正文；
- 从 D1 `room_event_archive`、DO 事件、快照或增量重建旁白；
- 从错误堆栈、候选数量、调试字段、网络缓存或模型任务状态取得正文；
- 从语音录音、TTS 资产、逐字转写、字幕或浏览器重连恢复已 ACK/覆盖内容；
- 通过后来加入 Audience、接管角色、加入队伍或到达地点补取过去回应。

当前帧不可重取不删除正史，也不要求玩家忘记已经看到的内容。玩家可以查看其 ViewerKey 的亲历文本，以及角色仍合法持有的结构化事实与知识；产品不会提供跨观察者全局聊天历史，也不会从事件或知识反向伪造旧 KP 措辞。

## 10. 语音、转写、错误、候选项与日志旁路

### 10.1 玩家语音与转写

玩家语音是提交意图的输入 Adapter，不是公开房间消息。原始音频和转写草稿只向提交 principal 显示，直到其成为已认证意图；它们不能因为语音通道而广播给其他玩家、写入运行日志或成为角色知识。

需要澄清时，转写内容及澄清只投影给相应控制者。语音 Adapter 不能自报 actor、选择机械结果、掷骰或扩大 Audience。

### 10.2 KP 语音与字幕

KP 语音、字幕和逐字转写必须是同一 DeliveryFrame 文本的呈现形式，服从相同 ViewerKey、AudienceSnapshot、单槽、覆盖和 ACK。不得存在独立的音频历史、转写历史或无鉴权媒体 URL。

默认可以由客户端对当前帧文本执行本地语音呈现；若使用服务端音频，访问必须绑定同一 ViewerKey 和当前 `deliveryId`，且不得为此新增持久化资源。帧 ACK、覆盖或失效后，相应服务端音频同样不可取得。

### 10.3 错误和候选项

错误、合法动作、目标候选、反应窗口和待决选项必须先经统一 projector。无权观察者不能从“目标不存在”、错误种类、候选数量、响应长度、隐藏 ID、窗口是否存在或重试差异推断秘密。

对无权、不存在、已关闭和已覆盖的秘密引用，应返回在产品上不可区分的脱敏拒绝；内部诊断可以引用秘密原因，但不得进入普通客户端或 Runtime 日志。

### 10.4 日志和可观测性

玩家可见活动日志属于 Read Model，必须经统一 projector，且不能包含旧 KP 旁白。

Runtime telemetry 不是第二个领域内容 projector。它只能记录固定白名单中的非内容元数据，例如脱敏请求类型、结果分类、耗时桶、状态码、规则/策略版本、哈希和关联 ID；不得记录 Cookie、Token、Prompt、自然语言意图、DeliveryFrame 正文、音频、转写、模组真相、未公开线索、内部 flags、候选定义、私人窗口内容或 KP/NPC 秘密投影。

D1 可重建归档可以保存重建正史所需的版本化结构化事件，但不保存 DeliveryFrame、模型输出、语音或逐字转写，并且不能向玩家提供原始读取入口。

## 11. 权威状态、Receipt 与版本

Room DO 是以下活跃数据的唯一权威：

- AudienceSnapshot 及其提交绑定；
- 每个 ViewerKey 的唯一 DeliveryFrame 槽；
- ACK/superseded tombstone 和投递幂等 Receipt；
- 当前角色控制权、观察资格所依赖的世界状态和结构化知识。

DeliveryFrame 不是 WorldEvent，不能参与机械回放，也不能成为世界状态的恢复依据。普通 Worker/DO 实例重启必须从同一 Durable Object 存储恢复当前槽；若发生需要从 D1 事件归档重建整个 DO 的灾难性存储丢失，只重建结构化世界和知识，投递槽为空，不能从 Prompt 或事件生成旧消息历史。需要向玩家说明重建后的当前状态时，必须基于新的当前投影发布新 deliveryId，而不是伪造丢失的旧帧。

`presentationPolicyVersion`、`projectionPolicyVersion` 和 `deliveryProtocolVersion` 必须进入房间版本清单和 DeliveryFrame 绑定。旧房间不得被新 projector 静默扩大可见范围；需要改变旧房间秘密语义时，必须经版本化迁移或可审计更正。安全收窄可以立即使当前帧失效，但不能借机公开新内容。

当前冻结实现把上述统一读取语义固定为 Projection Policy Profile `projection-observer-safe-v1` **1.2.0**，`profileHash = sha256:9312f68960f1c53f79b5c95bfd8c95ab87aec903603796f455a6c1d2d4514d8c`；其完整 Runtime manifest 为 `runtime-srd51-2014-authoritative-v2@sha256:2f7af76e9a7262675210c18528ca9c6bead5c676aecc71113304eaf01f42dbe9`，当前 canonical genesis golden hash 为 `sha256:7e858e340283252d67779ddb1ae773fb5ac5a98d3859fdcef467c58a34935355`。三者是当前 conformance 快照，不是 `latest` 别名；旧房仍按其 genesis 中精确引用选择 Adapter。

新规则版本迁移时不得把旧聊天、线索日志文本或旁白历史导入 DeliveryFrame 槽。Legacy Adapter 只服务明确旧 `ruleset_version`，不能成为新房间的第二投影路径。

## 12. Interface 约束

具体 TypeScript 命名可以变化，但责任语义至少覆盖：

```ts
type ObserverDeliveryOutcome =
  | { kind: "none" }
  | { kind: "current"; frame: DeliveryFrame }
  | { kind: "acknowledged"; deliveryId: string }
  | { kind: "superseded"; deliveryId: string };

observe(viewer: AuthenticatedViewer): Promise<ViewerReadModel>

ackDelivery(input: {
  authenticatedViewer: AuthenticatedViewer;
  deliveryId: string;
  acknowledgementId: string;
}): Promise<AcknowledgementReceipt>
```

`publishDelivery`、AudienceSnapshot 构造和失效操作只属于 Room Action Module 与 Room DO 之间的内部 capability，不是页面 Interface。页面只允许 `observe`、提交意图、回答待决输入和 ACK；不能上传 Audience、projectionHash、叙述正文或授权 ViewerKey。

同一领域事实的外部观察仍只能来自 `project`。`observe` 组合 projector 输出和当前 DeliveryFrame，不自行解释 WorldEvent 或重新计算权限。

## 13. 实现映射

本节为非规范附录，已移至 [SPEC 0010 附录](./0010-appendix-decisions-mapping-and-review.md#13)。

## 14. 固定不变量

1. 世界事实和角色知识永久保存在权威事件中；叙述文本不进入正史。
2. 每个 ViewerKey 至多一个未确认 DeliveryFrame。
3. AudienceSnapshot 在结果提交时冻结，后来入场或入席不回补。
4. 只有同一 ViewerKey 的刷新、断线恢复和重启恢复能够取回同一当前帧。
5. ACK、覆盖、权限撤销或安全失效后旧正文不可再取。
6. 新帧覆盖旧文本，不覆盖结构化事实、知识或 Receipt。
7. 个人线索保持私有，直到世界内分享或独立取得；会合、章节切换和角色死亡不自动分享。
8. 分享从提交时向冻结接收者生效，不追溯旧回应。
9. 所有玩家可见领域内容复用同一个 projector。
10. 语音、转写、错误、候选项、增量、日志和重连不能成为秘密旁路。
11. principal、ViewerKey、控制权和 Audience 不能来自请求体自报字段。
12. ACK、断线、现实超时和模型失败都不替角色行动，也不推进虚构时间。

## 15. 验收场景

### O01 私人取得

角色甲单独闻到火药味并收到专属回应。甲的 Read Model 保存相应 SensoryEvidence；角色乙、房主身份下的乙、另一地点玩家、候选项和错误均看不到该证据或回应。

### O02 多个直接观察者

甲乙同时在场并能够看见墙上文字。提交时 AudienceSnapshot 分别包含甲乙 ViewerKey，并为两角色建立各自知识；两人的 DeliveryFrame 可以因背景与能力不同而不同，任何一个 ACK 不影响另一个槽。

### O03 世界内点名分享

甲对乙准确转述个人线索。分享经可信 principal、角色控制权、虚构位置和媒介验证后提交；乙获得带来源的结构化知识，但不能取得甲最初的 KP 旁白或旧 deliveryId。

### O04 主张不等于真相

甲对乙撒谎称门后有宝藏。乙只获得以甲为来源的 SourceClaim，不获得隐藏真相或甲没有表达的感官证据。

### O05 集合范围冻结

甲向“当前全队”展示文献。提交时把当前有资格观察的角色解析为具体接收者；后来加入队伍、后来入席或后来进入地点的角色不获得旧分享和旧回应。

### O06 实物与知识分离

甲把已经读过的遗嘱交给乙，随后遗嘱被毁。实物所有权与销毁状态正确变化；甲乙已经取得的结构化知识仍存在，未在场角色没有自动获得内容。

### O07 刷新与重复轮询

同一 ViewerKey 在 ACK 前连续刷新、轮询和多标签读取，始终取得同一 deliveryId、正文和哈希，只存在一个槽和一次世界结果。

### O08 断线与 Worker 重启

Audience 中的玩家在回应到达前断线，并经历 Worker/DO 重启。恢复后仍取得同一当前 deliveryId；没有重复骰面、资源、事件或叙述帧，虚构时间未推进。

### O09 ACK 后不可回看

玩家 ACK 当前帧后，使用旧 deliveryId、Receipt、eventSeq 或语音字幕均不能把它重新取作当前帧；刷新、重连和另一个设备可以在同一 ViewerKey 的亲历记录中查看已呈现文本。当前结构化世界与角色知识仍可查看。

### O10 新回应覆盖

同一 ViewerKey 尚未 ACK 旧帧时收到新回应。唯一槽原子替换为新 deliveryId；旧正文只进入该 ViewerKey 的亲历记录，不能通过旧 deliveryId 或其他观察者入口取得；旧回应对应的事实、知识和脱敏 Receipt 不丢失。

### O11 虚构缺席与后来到场

乙在另一地点时甲收到回应。乙后来进入现场，只能观察仍存在的当前世界事实并形成新证据；乙不能取得甲的旧旁白、已经消散的声响或旧候选项。

### O12 换席与控制权撤销

甲的 principal 在帧未 ACK 时失去角色控制权，新 principal 接管同一角色。旧 principal 不能再读取槽，新 principal 可以看角色当前结构化知识但不能取得旧 DeliveryFrame。

### O13 语音和转写旁路

玩家用语音提交秘密意图，KP 以语音呈现私人结果。原始音频、草稿转写、输出音频和 TTS 均只向对应 ViewerKey 可用，并随当前帧 ACK/覆盖失效；成功提交的意图文本和成功发布的 KP 文本可以进入该 ViewerKey 的亲历记录，其他玩家和日志无法取得。

### O14 错误与候选侧信道

隐藏敌人、私人反应或秘密出口存在。无权观察者提交猜测 ID、请求候选项或制造错误时，响应与对象不存在的情况产品上不可区分，且日志不记录秘密对象或正文。

### O15 模型失败与叙述重试

世界结果已提交后叙述模型失败。状态停在稳定点；以相同事件范围、分支、ViewerKey、projectionHash 和策略版本重试，只发布一个帧，不改变 Audience、不重复机械或世界事件。

### O16 更正使当前帧失效

未 ACK 帧所依据的结果被可审计更正。旧正文立即退出当前槽并只保留在原冻结受众各自的亲历记录；新活动分支按专属投影产生明确的新帧。旧结构化事件仍可审计，无权观察者看不到旧叙述或秘密更正依据。

### O17 跨章节知识与叙述

个人线索跨章节继续存在于原角色知识中；原 ViewerKey 仍可查看其有界亲历文本，但它不转移给继任 principal，也不成为章节级或房间级聊天历史。继任角色默认没有该知识，直到合法世界内来源或生命周期事件授予。

### O18 完整旁路矩阵

同一秘密回应分别从实时流、轮询、增量、亲历记录、刷新、断线重连、错误、候选项、玩家可见日志、Runtime telemetry、语音、转写、Receipt 和 D1 玩家入口尝试读取。只有冻结 Audience 中相应 ViewerKey 的当前槽或亲历记录可以返回其已成功发布文本；其他 ViewerKey、后来入场者、旧 ID、日志、媒体和 D1 入口均不泄漏。

## 16. 自主裁定记录

本节为非规范附录，已移至 [SPEC 0010 附录](./0010-appendix-decisions-mapping-and-review.md#16)。

## 17. 五项交叉审查

本节为非规范附录，已移至 [SPEC 0010 附录](./0010-appendix-decisions-mapping-and-review.md#17)。

## 18. 实施完成门

本节为非规范附录，已移至 [SPEC 0010 附录](./0010-appendix-decisions-mapping-and-review.md#18)。
