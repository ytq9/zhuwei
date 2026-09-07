# Round 57：四步真实连续行动及自然格式恢复通过

2026-09-07。新房、正常登录/Cookie HTTP，原四句未修改；parser v27，结果填写改为同源 entries 列表。312 文件起止 SHA 完全一致，清单 SHA `5b526a76e9ff9873e662d7e84fbc9c17e575c3775ad3d75c323cefcc60ef1827`。没有注入首稿或修订响应，没有切换模型、改词重采或增加预算。

| 行动 | 真实结果 |
| --- | --- |
| 从背包取出一根火把，放在身旁 | committed/published，库存 10→9；自然 JSON 根尾错误经一次确认恢复 |
| 拾起刚才的火把，收回背包 | committed/published，库存 9→10 |
| 用麻绳和餐具做可拆拉绳警铃，手动测试 | committed/published；两件原物进入组装占用，公开 visibleAssemblies 存在警铃；实际感知记录来自 entries，未创建新 ItemDefinition/Ability |
| 拆开警铃，收回能恢复的原件 | committed/published；引用上一轮公开的 assemblyRef，两件原物各 1 归还，完整公开库存与开局精确相同，active 组装列表为空 |

四次重复 submission 均保持原 Receipt、Delivery 和机械状态，调用数分别保持 4→4、7→7、10→10、13→13。持久化有四份 Receipt、8 条事件：两条 InventoryOperationApplied、两条 ItemAssemblyChanged，以及组装测试的 CanonicalFactDeclared、SensoryEvidenceAcquired、WorldInteractionResolved、AtomicWorldInteractionStepsResolved。实际状态与完整 Rules replay 精确一致；HP、资源、虚构时间和 ItemDefinition 集合未变。

第一步的真实首稿多写外层结束符：`JSON_SYNTAX / json:object-delimiter-expected`，offset 547、line 1、column 548。所有根成员完整，原稿 SHA `c2d62f9c20fd12bcf04845a9ae5e0842f110628d315300f3cb298c69c99824c1` 原样进入持久 repair ticket。原 contextHash 相同，allowedPaths=[]、repairPlan=[]；真实 correction 为 `{"confirm":"server-plan","summaries":[]}`。最终提交的 operation 与原冻结 draft 完全相同，无重掷或重复消耗。此次自然格式恢复经过正常 Room 提交与发布，不再只是离线或独立 correction 探针。

分类：首稿 JSON 语法失败 1，恢复 1；Form 失败 0、Rules 拒绝 0、本批观察到的已发布叙事矛盾 0；最终四步全部发布。首次提案 3/4 无需恢复、最终 4/4 通过只是本批计数，不是统计稳定性结论。

预设预算与 round56 相同：4 行动、20 调用、1,160,000 输入、163,840 输出、20 分钟、每 HTTP 120 秒及 5 calls、¥5（官方峰值价 token 上界 ¥4.95456）。实际 `response.model=deepseek-v4-flash`，13 调用（4 首提案、1 correction、4 旁白、4 审核），172,262 输入（命中 37,888 / 未命中 134,374）、3,192 输出。按逐响应时间的官方空闲价估算 **¥0.2178194**；输出已包含 reasoning，不重复计费，不代表账户账单。

服务 90473、捕获 90439 受控 TERM，均退出 143；extract/source-end/replay 全部退出 0，端口 4320/4321 已空。[完整脱敏证据](vnext-round57-live-evidence.json)，私有原始材料位于 `/tmp/zhuwei-vnext-round57-*`。round56 的失败结论保留。

未覆盖：真实不可恢复组件、整件搬运/他人取得/耗时与战斗组装、DO 驱逐恢复、20+ 双人连续链与长期 SLO。已继续 Goal 中已有 ActorPlan 的到期调用与结算；其隔离本地进展不替代真实 NPC API 验证。未部署、push 或修改已批准规格。
