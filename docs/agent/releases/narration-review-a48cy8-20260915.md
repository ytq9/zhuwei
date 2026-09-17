# A48CY8 回复审核拒绝及通用诊断发布

2026-09-15，承接同一线上故障处理中的“快速部署”授权。只更新现有 `zhuwei`，未修改 Secrets、创建资源、执行远端 migration 或 Git push。

## 线上原因及证据边界

用户在 A48CY8 输入“去问一下lian，有什么可以帮忙的吗”后，行动已经提交，旁白未送达。页面原来显示“与已经结算的事实不一致”。北京时间 01:51:11 的一次恢复记录为：生成段 `success`，89 ms；审核段 `modelPermanent`、`narrationGrounding`、`modelGroundingReason: unnaturalNarration`，98 ms。对应 rootActionHash 为 `sha256:ddecfd6278fc46d3d8a3500d34e02f62953a1dd2e8c377492f8ba71346258384`。

这次失败是表达审核拒绝，并非耗尽 180 秒。`narrateFrozen → v3Failure → narrationFailure → publicNarrationFailureReason` 把不同审核理由统一成 `NARRATION_GROUNDING_REJECTED`，错误地对玩家宣称已证明事实矛盾。当前 `runNarrationInvocation` 在已完成调用分支直接返回保存响应；普通恢复复用相同正文与审核，因此不能修正已保存的拒绝。真实 RPC 定向用例确认这一行为，恢复不增加模型调用或权威事件。

当前日志没有审核指出的具体原句，不能据此裁定审核是否合理。只读 D1 取得的检查点为 eventSeq 10 / story generation 34，38 个归档分片只包含前一条“检查遗体”的成功旁白，不包含这次交谈。原始私有归档在核对后删除；不把前一条成功审核当作当前失败证据。

第一段 230 秒采样的本地房间哈希计算方式错误，16 个事件均未匹配；这不证明没有请求或没有错误。改用日志序列化器的命名空间哈希后，90 秒有界对照取得上述恢复日志并立即停止。部署前 UI 共执行两次恢复点击，未提交新玩家行动；没有把第一次未捕获的调用数记成零。

## 修复与发布范围

- 上线[通用错误诊断](../receipts/generic-failure-diagnostics-20260915.md)已完成的统一白名单及跨 RPC 原因保留。
- `unnaturalNarration` 单独映射为 `NARRATION_PRESENTATION_REJECTED`，`reviewUncertain` 为 `NARRATION_REVIEW_UNCERTAIN`；Adapter、Room、持久化恢复投影、Table 提示和日志直接消费者保持同一分类。
- 旧的粗分类改为“未通过内容检查”，不再把所有拒绝说成事实矛盾。表达拒绝和无法判断分别说明；提示明确普通恢复会复用已保存的回复与审核结果。
- 没有修改生成或审核 Prompt、判断结果、调用预算、未知调用派发许可、权威事实及恢复合同；旧回复仍需适用的恢复机制才能送达。

## 冻结与验证

从已部署干净源码 `968f0d9489b5cf9d0f7a0781a9c49c7cf07c9ebe` 建立独立 `cloudflare` 候选，仅复制本任务诊断及直接消费者。13 个业务文件的修改前快照均与该发布基线逐字一致。根工作区及其他任务差量未提交、未清理。

冻结源码：`e7705e700f690bea20b769b04d690eb4dfe54249`。Worker version：`3add7649-976d-4002-aec2-1f961d26d29a`。Deployment：`b633915a-ab16-42de-a0f3-4f663a6932fd`，北京时间 2026-09-15 01:59:11.081783 生效，100% 流量。原 Worker 的 D1、ROOMS、AI、ASSETS 和 Secret 名称绑定逐项一致。

| 定向证据 | 结果 |
| --- | --- |
| 七个 Node 文件：旁白 Provider 失败、审核、恢复面板、结构化日志、统一诊断、公开错误日志、Authority 日志 | 57/57 |
| interrupted-publication、multiplayer-publication Worker | 12/12；新增真实 RPC 表达拒绝、持久化错误码与原审核复用，物理调用仍 2 次、事件不变 |
| Provider `an ambiguous 429` 与归档 `backs off` | 4/4，56 未选中 |
| 候选 `npm run typecheck`、`git diff --check`、部署 guard、`npm run build`、`wrangler deploy` | exit 0 |

主工作区新分类用例先红：表达与不确定仍被归并到旧码；修复后通过。面板测试另发现帮助文案缺少“联系维护者”，补齐后通过；冻结候选全部上述 73 项同时通过。并非全项目回归；此前归档扩展 5 项失败和仅 1 项已做基线复现的边界继续见通用诊断回执，未将其记为通过。

构建和上传源码各留 SHA256 清单，1155 个源码文件、112 个构建文件上传前后保持一致；绑定与前版本逐项核对。部署及线上验证的脱敏证据保存在 `.wrangler/diagnose-narration-a48cy8-20260915/`。

部署后无认证页面请求返回 HTTP 200，1.659 秒；浏览器刷新期间第一段 90 秒采样没有房间事件，未据此声称恢复成功。随后认证页面完成加载，明确显示新文案“未通过内容检查，行动结果已保留”和复用审核结果说明。旧持久化粗码在普通读取时不被猜改；下一次正常恢复才能按保存审核的实际理由重新分类。

页面加载后执行一次发布后恢复，并另开最多 90 秒采样，在首个完成事件停止。北京时间 02:04:54，同一 rootActionHash 的生成/审核分别为 96/102 ms；审核仍为 `unnaturalNarration`。新增诊断明确记录 `failureStage: modelResponse`、`failureRetryability: blocked`，恢复汇总为 `NARRATION_PRESENTATION_REJECTED`，确认分类已贯穿线上真实入口。该记录不是旁白发布成功，世界行动仍为 `committed`、旁白仍未送达；没有新增玩家行动或绕过审核。

当前恢复合同依据 SPEC 0016 §8.3 保留冻结正文和一次独立审核，尚无对已拒绝正文的修稿阶段。若允许一次受限修稿与复审，需要先取得修改该条款、实际调用预算及当前房间适用范围的明确决定；此发布没有暗加这类调用。
