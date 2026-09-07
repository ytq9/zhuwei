# vNext round48：单一事实格与真实语义拒绝

真实批次于2026-09-06 23:55:58（Asia/Shanghai）开始；开发收束于2026-09-07。承接用户“填表不稳定有办法解决吗”：取消要求模型同时填写覆盖证据和覆盖汇总的重复协议。

新 wire 的每个 assertion 都必须填写全部事实键。每格只能填写该事实自己的 evidenceId、同 Claim 的具体 payload ID，或明确的空数组。不存在单独的 `factDisposition`：服务器只汇总模型明确填写的格，不替模型补证据；所有断言均为空的事实才进入原 normalized omission。原完整审核仍检查正文对齐、必述结果、角色、来源归属、操作依据与质量。旧协议、缺格、跨 Claim、越界 ID、重复键和必述事实全空都拒绝。

原型定向7/7通过（`node --import tsx --test /tmp/zhuwei-narration-review-v9/candidate.test.mjs`，exit0，工具输出chunk `4e9835`）；两种结构与最高风险边界共用原gate。四个固定请求的最终strict请求预检为7007/7013/4761/4758，均在12k以内。它们不是模型结果。

真实预算仍为原四例、最多4调用/48,000输入/32,768输出/每次45秒/全批240秒/¥0.44，失败停批，无改词重采。首例2,733ms返回：

| 原文片段 | 原始模型选择 | 核对 |
| --- | --- | --- |
| 你取出一根火把， | actionRealization / grounded，e11/e23 | 选中了实际 release 操作依据 |
| 把它放下， | worldFact / grounded，f0/e0、f1/e1、f2/e2 | 三项必述事实格完整；optional f3 明确为空 |
| 没有点燃。 | worldFact / unsupported | statement保留了“行动者没有点燃”的动作含义，但判定不符合本例预设的普通动作/未执行额外动作边界 |

**完整审核结果仍失败：unsupportedClause。** 新结构在这个真实样本中没有发生旧f2漏证据/重复汇总矛盾，且正确引用操作依据；这只是一例格式与来源选择证据，不是总体成功率、稳定性或完整游玩通过。后三例未调用，未覆盖本批NPC反例。没有改写响应、覆盖unsupported判定、发布正文或启动round47 HTTP链。

本次1调用、6,091输入（512命中、5,579未命中）、393输出，已知空闲标价¥0.0101626。累计round6–48（round47无外部调用）为89尝试/78已知usage、813,682输入/66,315输出，已知¥1.20881015–1.3229469，另11次旧未知费用。全部为开发验收，不作为正常玩家整局均价。

命令 `node --import tsx /tmp/zhuwei-review-candidate-48.mts --execute`，exit1。日志 `/tmp/zhuwei-review-candidate-48.log`，私有原始请求/响应 `/tmp/zhuwei-review-candidate-48-private/`。三个直接产品源及两个候选实现文件在批次前后SHA一致。[原始结果、事实格审计、SHA及费用](vnext-round48-live-evidence.json)。

产品接入仅能把本轮作为结构与传输依据，不能宣称语义审核通过；真实普通行动的否定动作判断仍是待修阻断。没有部署、push、migration、远端资源或秘密修改。

## 开发接入与直接消费者（2026-09-07）

已接入 `narration-vnext.ts` 的直接schema/同源decoder与 `authoritative.ts` 消费者；review v9、policy v7，generation prompt/builder及原 normalized 完整审核逐字保持。操作辅助证据的schema与decoder统一为原操作依据集合，不能夹带人物ID。模型响应没有补填或修订路径。输入上限12k、输出8192、两次调用及原总期限保持。

`provider.ts` 原按共享旧Form profile提前返回普通binding，新的strict review若沿该入口会跳过beta强制结构。现删除这个提前返回，复用原按实际request声明分流的逻辑；普通generation/Form仍走普通端点，单strict review走既有beta binding。新 `tests/kp-narration-transport.test.ts` 使用fake env并完全拦截fetch，经过真实factory和默认profile验证两个端点、恰好2调用及原signal。

最终定向证据：

- `./node_modules/.bin/tsx --test tests/kp-vnext-narration.test.mjs`，36/37、exit1，唯一新增空Claims fixture误以为可进入Adapter；保留既有空Claims拒绝边界后，仅重跑 `--test-name-pattern='an empty fact catalog'`，1/1、exit0。原工具chunk分别 `ff564c` / `829592`，未保存独立stdout；不伪称一次37项全绿。
- `npx vitest run tests/kp-narration-transport.test.ts`，1/1、exit0，日志 `/tmp/zhuwei-kp-narration-transport-vitest.log`，无外部调用。
- `npm run typecheck`，exit0，日志 `/tmp/zhuwei-narration-v9-final-types.log`。
- 原四冻结请求与原型的context、schema含义和参数一致；仅required顺序与原型标签文字有差异。生成prompt/builder和原完整normalizedgate逐字一致。对比脚本及产物在 `/tmp/zhuwei-v9-integration-baseline/`，命令 `python3 compare-source.py`、`node --import tsx compare-requests.mjs` 均exit0。最终输入估算6996/7002/4750/4748。
- 未修改的round48原响应经最终产品decoder仍返回 `unsupportedClause`，没有将失败变成成功；实际生成/review请求分别被现役路由识别为普通/strict，0外部调用。精确SHA和结果在 `/tmp/zhuwei-narration-v9-final-replay.json`。

本轮交付的是结构与传输改进；真实语义误判仍保留为完整主链阻断，未启动连续HTTP测试、未部署或push。密集事实格会随断言和事实数量增长；保留预算拒绝，复杂长正文与长期稳定性尚未实测。
