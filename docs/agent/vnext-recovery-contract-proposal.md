# vNext 私有恢复合同提案

日期：2026-09-06。状态：**主代理已审阅，用户确认待答复**。本文件不修改已裁定 SPEC，不授权实现、远端 migration、Secrets、部署或数据删除。

**拟选方案：在现有 `DB` 保存仅服务端可读的 vNext 恢复包，以完整 checkpoint 为恢复边界；恢复后显式停门，核验后才继续。** Room DO 仍是唯一活跃权威，Rules `step/project/replay`、玩家控制权及逐 Viewer 秘密边界不变。旧 `/v2` 携带 genesis、事件、回执引用和投影哈希，拒绝 pending due/randomness，且恢复不带 Delivery；移除拒绝门本身不能闭合恢复。

## 需批准的最小规格修改

直接冲突来自 [SPEC 0011 §6](../specs/0011-reliability-correction-observability-and-evaluation.md#6-归档与重建) 的“不保存旁白 Delivery Frame”，以及 [§12](../specs/0011-reliability-correction-observability-and-evaluation.md#12-交叉审查) 的“日志白名单、模型 Receipt 与归档均不保存私人叙述/Prompt”。[SPEC 0016 §8.3](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md#83-narrationgrounding-与重试) 要求重试复用完整冻结表达上下文、Claims 和原文本，不能重新 project 当前世界。拟仅替换上述两处：

> **§6 末句：** 对绑定已批准 vNext 完整 Profile 的新房，允许在现有 D1 `DB` 的服务端私有恢复归档中保存恢复所必需的执行阶段、幂等与随机 journal、冻结 Typed Claims、必要表达上下文和已冻结或已发布文本，以及对应投递、发布与 ACK 状态。它们只用于验证后重建空 Room DO，不参与活跃裁决，不作为玩家归档下载或日志内容；不保存 Provider 原始 Prompt、原始请求/响应日志、认证凭据或无关对话历史。其他房间的 Delivery 归档规则不由本条扩展。

> **§12 秘密项：** 日志和模型 Receipt 继续禁止私人叙述及 Prompt；仅 §6 指定的 vNext 私有恢复包可保存必要冻结表达上下文与文本。恢复包须加密保护或执行严格服务端访问控制，导出、读取、恢复仅限受信服务能力；恢复后每次投递重新验证当前可信身份与原冻结 Viewer 绑定。内部哈希不能代替鉴权，任何无权材料不得进入玩家响应、错误或日志。

本提案优先采用现有服务能力隔离与逐 Viewer 重验，不新增外部存储或密钥；如审阅选择应用层加密，新增/变更 Secrets、密钥保管及灾难恢复依赖须另行明确，不能先创建再补授权。原始 Provider 请求不能借“恢复”旁路归档；未完成模型阶段仅可由获准冻结材料与固定版本渲染器重建并核对原 `requestHash`，无法证明一致时保持技术停门。

## 数据与协议闭包

新增版本化私有恢复包，绑定 `roomId / runtimeEpochId / exact Profiles / event head / activeBranchId / recoveryRevision / recoveryHash`。只收录本房恢复所需材料：全部 pending、committed、cancelled due work 的 canonical child root、首次 cause 与冻结 descriptor；相关 submission、continuation、Proposal recovery、请求事件、随机候选原值、授权和缓存结果；原 Receipt、逐 Viewer Claims/表达上下文、发布 generation、slot、水位、tombstone、ACK 及其必要文本依赖。终结状态绑定真实完成/中断事件，不假定所有 completed work 均由本 child root 完成。成员与 pending 鉴权索引仍从 Rules replay 派生。

不包含账号资料、会话凭据、其他房间、无关聊天或 Provider 日志；不迁移已获准退役的旧 0.4 房间，不扩大旧数据删除授权，也不允许自动删除 vNext 新房。保留恢复幂等所需的终结记录；没有另行批准的保留期限时不截断恢复依赖。

当前 [D1 schema](../../db/schema.ts) 没有恢复载荷或 revision。拟在**现有 DB** 增加私有恢复分片表，并给 checkpoint 增加 revision、包 hash 与分片计数；同一事件头下候选、授权、发布或 ACK 的持久事务也递增 revision 并标记归档。全部事件、审计与恢复分片齐全后，在最后一个原子 batch 提升 checkpoint，未完成分片不可恢复。空 DO 先验证事件链、依赖全集、canonical due/randomness 绑定与 Viewer 材料，再单事务导入；缺项或不一致全部拒绝。

## 恢复保证与显式停门

保证只覆盖**已完整落入 checkpoint** 的状态：骰面、提交、文本、ACK 按原值恢复，不重骰、不重复产生后果。D1 异步落后期间，DO 已持久但未归档的后缀在 DO 全损时可能丢失；SPEC 0011 的归档滞后目标不能作为本次实测值，更不表示零丢失。

灾难 restore 成功后进入持久的“待核验恢复”状态：允许受信服务只读核验，暂停玩家写入、自动 due drain、随机抽取及旁白发布；标明 checkpoint 时间/修订与可能未归档后缀。受信恢复流程核对存活证据和恢复范围后才解除，不能把缺失候选当作尚未掷骰、把 null 玩家等待改成自动闹钟，或静默从旧状态继续。无法确认后缀时保持停门；接受回退/丢失须另有用户明确决定。

若用户要求“**所有已确认动作零丢失**”，须改选在关键提交/确认前完成独立持久恢复记录的屏障协议，并覆盖随机候选、提交、发布和 ACK 的各个确认点；单纯在响应后异步追加不足。该选择增加 D1 写入、延迟及跨存储协调，D1 故障会阻止相应确认，需要另行审阅持久屏障与恢复协议，不能把本草案称为已提供该保证。

## 验收与执行边界

| 代表性断点 | 必须成立的结果 |
| --- | --- |
| cause 已提交/due 刚入队；submission 已建；request 等待手势；candidate 已存 | 恢复同一 canonical root、原候选和授权；一次后果，不自动替玩家掷骰 |
| committed 未发布；部分 Viewer 已发布；ACK 前后/slot 覆盖 | 原 Receipt/Claims/上下文/文本；已发布和已 ACK 不复活，失败者只取自身材料 |
| cancelled/其他根已完成；两 timeline；同 timeline 队首等待 | 终结依据一致、不重新入队；原排序与局部等待保持 |
| 缺依赖/篡改 cause、候选、Viewer、epoch；分页失败/驱逐；同 head 新 revision | 原子拒绝或仅恢复完整 checkpoint；旧 flight 不覆盖新状态，不泄漏 |
| DO 全损、存在未知后缀；恢复后重试/闹钟 | 明确停门与恢复范围，未经核验不重新推进 |

用户批准合同后，方可修改直接 SPEC/ADR 与本地实现，按 `db/schema.ts` 生成只增 migration，完成本地 migration/最小写读和上述定向矩阵。**本地 schema 变更不授权远端 migration**；远端迁移须另行明确授权，且应先于依赖它的 Worker 部署。既有 Worker 部署授权不包含 migration、Secrets、push 或新资源；本草案不执行这些操作。仅写草案期间不实现依赖批准的恢复载荷、持久屏障或释放入口。

拟一次确认的范围：批准以上两处 SPEC 窄修改，并按“现有 DB 私有恢复包＋完整 checkpoint＋恢复后显式停门”实施本地方案；不包含零丢失屏障、远端 migration 或新的外部修改。若用户明确选择所有已确认动作零丢失，应先重审屏障方案，不能沿用本方案的保证描述。
