# ZW-mu5gokct：旁白修稿复审未通过结构校验

2026-09-17，用户提供故障编号 `ZW-mu5gokct-0f4dfeb862314ce4908195dca024192f`，请求时间 `2026-09-17T11:43:51.053Z`。本轮只读定位并验证现有恢复边界，没有修改业务源码、部署或发送游戏/模型请求。

## 线上事实

`npm run diagnose -- --reference ZW-mu5gokct-0f4dfeb862314ce4908195dca024192f --out .wrangler/incident-mu5gokct/diagnostic.json` exit 0，返回 `found`。下列均为北京时间：

| 时间 | 阶段 | 结果 |
| --- | --- | --- |
| 19:43:51.464 | HTTP 开始 | 已匹配本次请求编号 |
| 19:44:01.661 | `narrationRecovery` | 生成成功，1380 ms，输出 52 tokens |
| 19:44:04.601 | `narrationRecoveryReview` | `narrationGrounding / missingClaimFacts`，2940 ms，审核认为遗漏必述事实 |
| 19:44:06.516 | `narrationRecoveryGroundingRepair` | 修稿生成成功，1915 ms，输出 125 tokens |
| 19:44:09.775 | `narrationRecoveryRepairReview` | `narrationSchema`，3259 ms，修稿的审核响应未通过结构校验 |
| 19:44:09.925 | HTTP 完成 | `committed / NARRATION_BODY_INVALID`，18700 ms，`blocked` |

按本次 requestHash 和 rootActionHash 查询此前 24 小时的有界关联窗口，初始 6 条、关联 5 条，去重 7 条，无截断。平台事件为 `outcome: ok`、CPU 99 ms、wall time 18707 ms；无 CPU/内存超限或请求取消信号。版本为昨日已部署的 `86045f87-30d1-4e7f-b0e3-5ea5528b9806`。这是已提交行动的旁白恢复，没有此次提案阶段或 45 秒超时证据。

HTTP 汇总中的 `failureStage: modelRequest` 不够细；以该请求内末次模型记录的 `modelResponse / narrationSchema / narrationRecoveryRepairReview` 定位失败阶段。不能将公开 `NARRATION_BODY_INVALID` 解读为已证实修稿正文错误：失败的是复审响应的解码或结构/绑定/定位/一致性校验。

## 本地核对

实际相关源码和两个目标测试文件均与上述部署快照逐字一致。

- `npx tsx --test tests/kp/narration/publication-repair.test.mjs`：7/7，通过正常修稿发布、损坏/矛盾报告拒绝及复审失败停止等路径。
- `npx vitest run tests/kp/narration/interrupted-publication.room.test.ts -t 'resumes repairAfterFinal|resumes repairRefused'`：2/2，验证真实本地 Room 的已保存复审恢复、拒绝后的 `canRetry: false`、重复恢复不新增第五次调用及权威事件不变。
- 忽略目录中的合成脚本 `node --import tsx .wrangler/incident-mu5gokct/reproduce-review-failure.mjs` exit 0。真实 Adapter 在“首审 RESULT_OMITTED → 修稿 → 复审正文绑定错误/缺字段/问题定位错误”三个样例均返回相同的末阶段 `narrationSchema`，四次调用后停止。样例证明错误分类和有界停止，不能用于认定线上实际是哪一个字段错误。

这与 [SPEC 0016 §8.3](../../specs/0016-part-c-compound-actions-and-claims.md#83-narrationgrounding-与重试)及 [ADR 0024](../../adr/0024-narration-publication-and-bounded-repair.md)一致：一次修稿、一次复审，损坏报告不发布、不无限重采样、不重复结算。当前证据没有复现程序违反这些边界，不能据此放宽校验或重置调用账本。

## 尚未取得的证据

普通日志有意不保存原稿、审核理由和私有报告。只读 D1 检查点查询（limit 10，读取 9 行、写入 0 行）取得 3 个检查点，最新仍为 A48CY8 的北京时间 2026-09-15 01:21:42.845；均早于本次恢复，不能从它们取得这次复审报告。没有读取归档秘密正文，也没有用旧归档覆盖活跃房间。

尚未读取活跃 Room 私有调用账本的第四阶段原始响应，故未能离线重放原报告，不能区分具体字段/引用错误与程序误判。下一项有效检查是取得目标 Room 的这份已保存响应及原冻结请求，并在相同部署源码上离线校验；再次付费生成不能回答原报告为何被拒绝。用户页面是否仍显示无效重试按钮尚未确认，不能把本地投影测试等同于线上 UI 验收。

脱敏日志、只读检查点元数据、源码指纹、合成脚本和定向测试输出保存在本地忽略目录 `.wrangler/incident-mu5gokct/`。未做完整项目回归、远端写入、资源修改或 Git push；本轮结论是失败阶段已定位、原始报告细因尚待验证，不是故障已修复。
