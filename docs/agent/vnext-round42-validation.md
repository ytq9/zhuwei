# vNext round42：v21 真实 Room 修订与恢复结果

2026-09-06，cloudflare / `258caee404e0814405eb497653ee9f00d647b773` 未提交树。调用前冻结 [308个源码文件](vnext-round42-source-manifest.json)，结束后全部 SHA 一致；parser v21。保持round41的三个预声明样例、模型和预算：最多3次真实correction、48,000输入、1,800输出、每次45秒、全批4分钟、¥0.17，首失败停批。

| 样本 | 真实结果 | 稳定性证据 |
| --- | --- | --- |
| worldInteraction | 一次correction修好5个字段并显式确认1处producer表示，Room提交成功 | 驱逐后重复原submission，完整state/events/调用记录快照相等；没有新增Provider调用或重复提交 |
| observe | 模型修好其余字段并确认producer，但漏掉计划中必填的terminal | 完整提案校验以FIELD_MISSING拒绝，PROPOSAL_REPAIR_EXHAUSTED/notCommitted；未追加修订 |
| 保存检定修订后中断、驱逐恢复、仅掷骰一次 | 未调用 | 按首失败停批；该项真实模型证据仍缺，不能借本地替身测试改判 |

两项均使用真实DeepSeek correction及真实本地Room、票据、持久化、Rules与Viewer交接。首稿和缺陷固定合成，旁白是测试替身；不是自然首稿错误分布、正常Cookie/HTTP完整游戏或前后成功率统计。round41的原响应误拒已有同一响应的本地回归；round42第一项证实新真实响应可走完该修订纵切，不能把round41原失败改判成功。

第二项漏修的错误准确位置为`terminal`；已在请求的repairPlan给出`operation:add,value:null`。服务端没有替模型悄悄补齐、重发或增加第三次调用。该样本说明固定计划仍可能被模型漏填；整体结果是**1通过、1失败、1未尝试，稳定性未达标**。这次没有继续调整参数或采样挑成功。

| 样本 | 输入 | 命中/未命中 | 输出 | correction耗时 | 已知费用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| worldInteraction | 3,430 | 0/3,430 | 187 | 1,220ms | ¥0.0059865 |
| observe | 3,405 | 0/3,405 | 174 | 1,308ms | ¥0.0058905 |
| 合计 | 6,835 | 0/6,835 | 361 | — | ¥0.011877 |

按同日已核验官方空闲价以Decimal复算；无新增未知usage。累计round6–42为79 attempts/68 known usage，770,668输入/63,569输出，已知¥1.14065535–1.2547921，另11次未知费用。全部计开发验证，不当作正常整桌游戏均价。

命令 `node --import tsx /tmp/zhuwei-diagnostics-room-live-42.mts --execute`，exit1；Vitest为1通过/1失败/30跳过，第三个匹配测试因bail未运行。测试原文件未改，临时生成副本已清理。日志 `/tmp/zhuwei-diagnostics-room-live-42.log`；原始产物仅 `/tmp/zhuwei-diagnostics-room-live-42-private/`。详见[脱敏证据与SHA](vnext-round42-live-evidence.json)。未部署、push、远端修改或回滚已提交机械结果。
