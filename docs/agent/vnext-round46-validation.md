# vNext round46：操作依据约束与真实填表失败

2026-09-06，cloudflare / `258caee404e0814405eb497653ee9f00d647b773` 未提交工作树。保留现有改动，不部署、不 push。

原审核只要求合法非空 evidenceId，事务提交和人物 ID 也能单独为普通动作片段背书。现在原 `frozenNarrationEvidenceCatalog` 先复用 `frozenRenderableClaimsConform`，从合法当前 Claim 的 `operation.kind`、`outcomeKind`、`abilityRef` 派生操作依据名单，原完整审核门和模型共用。它不增加机械裁决，不要求动作措辞逐字引用；来源主张继续按有归属的发言审核，NPC 可以说假话。名单只证明有这次操作，不能证明方法、精确位置、照明或长施法完成。

真实批次保持 round45 的四个冻结正文及授权材料，使用新的操作依据约束。预设最多4调用、48,000输入、32,768输出、单次45秒、整批240秒、¥0.44；首失败停止。请求预检通过，均在12k以内。

首例“你取出一根火把，把它放下，没有点燃。”在2,448ms返回，原完整门以 `ModelOutputValidationError` 拒绝。原响应的 `factDisposition.f2` 为 `covered`，但全部断言的 `coverageEvidence` 只有 f0/f1，没有 f2；声明与证据关系自相矛盾。模型未生成独立 actionRealization，因此此例不能证明它已正确使用新的操作依据名单。后三例均未调用，准备的 round47 正常 HTTP 工具未启用。

结论：**真实首例失败，完整链路稳定性未通过，临时 strict wire 未采用。** 没有重采样、清洗输出、补造缺失证据或修改旧失败。该失败定位到重复填写的覆盖关系，下一改动应消除可由明确选择计算的重复表，而非再让模型维持两份一致声明。

本次1调用，6,571输入（256命中、6,315未命中）、321输出。按当日已核验空闲标价复算¥0.0109298，usage完整。累计 round6–46：88次尝试、77次已知usage、807,591输入、65,922输出，已知¥1.19864755–1.3127843，另11次旧未知费用；全部为开发验收。

命令 `node --import tsx /tmp/zhuwei-review-candidate-46.mts --execute`，exit1。日志 `/tmp/zhuwei-review-candidate-46.log`；原始请求/响应在 `/tmp/zhuwei-review-candidate-46-private/`。批次前后3个直接产品文件 SHA 一致；其后仅推进证据目录 schema/policy 标识至 v2/v6 并显式记录操作依据绑定，所以批次清单只标识当时源码。[脱敏原始结果、SHA和费用](vnext-round46-live-evidence.json)。
