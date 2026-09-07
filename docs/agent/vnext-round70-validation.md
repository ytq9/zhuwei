# Round70：首句 NPC 提案引用失败，连续行动停批

2026-09-07，parser v36，默认 deepseek-v4-flash，经正常注册 Cookie → createRoom → lockCharacter → startGame 完成旅行守卫初态验证；setup 于 2026-09-07T02:24:56.173Z 完成。原定三句连续行动只发送第一句，首次明确失败后停批，后两句未发送，没有改写意图或重采样。

首句原话：`我走到账台旁，向瓦罗点头：“我叫旅行守卫。我想先用半分钟整理一下思路。您若方便，过半分钟轻敲一下账台提醒我，我们再接着谈。”`第一轮仅选择 passTime、social；第二轮 JSON 语法合法，decision.kind 为 directSuccess，但 decision.steps[0].basisRefs[2] 填入 npc-decision:npc:black-oak-will:varo。该 wrapper 在冻结上下文中明确列为 nonCitableRefs，既不属于 viewerEvidenceRefs，也不属于 authorityBasisRefs；NPC 来源候选的10个真实引用也没有该 wrapper。原请求返回 PROPOSAL_REFERENCE_INVALID / notCommitted / notApplicable，在 Rules 前被拒绝，没有窄修订或第三次 Provider 调用。

原始服务端诊断只记录 `REFERENCE_UNAVAILABLE / proposals[].basisRefs[]`。准确的原稿位置及 nonCitable 归属来自对保存的原 arguments 和冻结上下文的另行核对，不把它们伪装成当时完整传出的诊断；不补造缺失的 constraint、expected 或修复权限。原请求和 duplicate 各出现一次相同遥测，计为一次失败，而非两次模型失败。gate1 原样保留 next=stop、category=formatFailure、publicEvidence=[]，复核时间为 2026-09-07T02:27:11.339Z。

response.basis 的三个字符串均来自该 NPC 的来源候选，playerExpression 也采用正确的 kind 结构。这个结果只证明相关字段局部使用了新填写面，整份提案仍未通过。完整原稿包含私有 NPC 动机及未发布台词，仅保留在本机私有 capture/journal；公开机器证据只保留必要结构摘录和原 arguments SHA256 `cc74e33b1269066bdce0ae95c339ad49593fa89576a1f2e5e864dd0f31bcabbf`。没有新旁白，不把草稿中的承诺或台词计作已发布叙事、世界事实、叙事矛盾或成功。

初始与失败后权威 state、events、randomnessBatches 完全相等，公开 controlledCharacter 和 fictionTime 相等。全批0事件、0 Receipt、0 pendingDue、0 deliveryPlans/audiences；旁白消息始终只有既有开场1条。原 submission 重复提交新增0次模型调用，状态、事件、随机 journal、结果与 delivery 均不变；sameReceipt=true 表示两边均没有 Receipt。没有计划形成、主动等待或到期 NPC 决策的执行证据。

两次 capture 的请求/响应与 Room journal 逐项相等；两轮 contextHash 相同，user 正文逐字相同，journal 均 completed，repair_ticket_json 均为空。共2次真实模型调用，实际输入44,025 tokens（缓存命中2,432、未命中41,593），输出548 tokens。按本日已核验官方高峰价分别计算缓存命中、未命中和输出，费用为 **¥0.1299542**（逐次 ¥0.0533728、¥0.0765814）；这是依据实际 usage 与已核价计算，并非供应商账单。保守 meter 不扣缓存优惠时为 ¥0.137007，两者均在本批 ¥5 上限内。

本批计格式失败1，其中引用失败1；JSON语法失败0、提案机械规则拒绝0、明确机械不一致0、已观察叙事矛盾0、窄修订0、Viewer恢复0。引用失败是同一格式失败的细分，不相加；拒绝发生在 Rules 前，零机械不一致和零叙事矛盾不代表完成了未发生的机械或叙事验收。

停批后冻结源码下 replay 的 pinnedProfilesMatch=true、exactState=true，stateVersion=0，事件0。321项源码起止 allEqual=true，分支和 HEAD 未变，初始 manifest 内的 manifestSha256 为 `609b4fad8b6e00b37de61ea7e2f27407ae14b1bc33d00a2e7c83934ce6172318`（清单文件本身的字节 SHA256 另列于机器证据）。本批 game/capture 于 2026-09-07T02:27:11Z 收尾，关闭记录确认当时进程与4320/4321端口消失；detached进程退出码不可取得，不记为 exit 0。该结论仅属于本批收尾时刻，不代表后续串行批次或当前端口状态。

[机器证据](vnext-round70-live-evidence.json)。私有原始 capture、冻结上下文、Room journal 和状态快照位于 `/tmp/zhuwei-round70-npc-preparation/evidence`。完整 NPC 交谈、计划形成、等待、到期执行和三句连续稳定性均未覆盖，不声称模型成功率提高。原批次失败保持不变；本次文档收尾只新增本页与机器回执，没有修改源码/脚本、追加API、运行代码测试、部署或push。
