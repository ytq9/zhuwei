# vNext round44：真实计划确认修订与Room恢复

2026-09-06，cloudflare / `258caee404e0814405eb497653ee9f00d647b773` 未提交树，parser v22。调用前冻结[251个运行时和直接测试文件](vnext-round44-source-manifest.json)，结束后全部SHA一致。随后集成地点能力，因此该清单只标识本批实际源码，不代表后续整合树。

保持round42三个预声明样本与预算：最多3次真实correction、48,000输入、1,800输出、每次45秒、全批4分钟、¥0.17，首失败停批。新协议要求模型明确返回 `confirm:server-plan`，只填写获准自由摘要；固定修改由已重证的同源计划执行。旧changes-only响应仍拒绝，没有清洗或改判round42失败。

| 样本 | 真实结果 | 恢复证据 |
| --- | --- | --- |
| worldInteraction | 一次确认执行5处固定填表修复及1处producer表示确认，完整重验后提交 | 驱逐后同submission的完整state/events/invocations快照相等，无新Provider调用 |
| observe | 一次确认完整执行计划，包含此前漏填的terminal，完整重验后提交 | 驱逐后重复请求无新调用、无重复提交 |
| check | 保存真实correction后故意中断，此时未提交且draws=0；驱逐恢复后提交 | 复用保存响应，无新Provider调用；draws=1；再次驱逐与重复submission仍draws=1且快照相等 |

三次原始模型响应均为 `{"confirm":"server-plan","summaries":[]}`，没有自由摘要。测试走真实本地Room、持久化票据、Rules与Viewer交接；首稿/缺陷与旁白为确定性替身。因此结果为**真实修订纵切3/3通过**，不是自然错误发生率、统计成功率提升、正常Cookie/HTTP完整游玩或双人20+连续行动通过。检定使用可计数的测试随机源证明只调用一次，不把固定骰面当真实随机分布。

| 样本 | 输入 | 命中/未命中 | 输出 | 耗时 | 费用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| worldInteraction | 2,437 | 0/2,437 | 60 | 614ms | ¥0.0039255 |
| observe | 2,410 | 0/2,410 | 60 | 679ms | ¥0.003885 |
| check恢复 | 2,001 | 768/1,233 | 60 | 665ms | ¥0.0021579 |
| 合计 | 6,848 | 768/6,080 | 180 | — | ¥0.0099684 |

按同日已核验官方空闲价Decimal复算，全部usage已知。合并round43后，累计round6–44为83 attempts/72 known usage，782,244输入/64,251输出，已知¥1.15774755–1.2718843，另11次未知费用；全部计开发验证。

命令 `node --import tsx /tmp/zhuwei-diagnostics-room-live-44.mts --execute`，exit0；Vitest为3通过/31跳过。日志 `/tmp/zhuwei-diagnostics-room-live-44.log`，原始产物 `/tmp/zhuwei-diagnostics-room-live-44-private/`，生成测试已清理，原测试文件未改。[脱敏证据](vnext-round44-live-evidence.json)。没有部署、push或远端修改；[round43旁白失败](vnext-round43-validation.md)仍是完整真实主链阻断。
