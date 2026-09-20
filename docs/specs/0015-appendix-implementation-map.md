---
kind: annex
role: appendix
title: "SPEC 0015 非规范附录：裁定记录、实现映射与审查"
annex_of: "0015"
---
# SPEC 0015 非规范附录

本文件收录原 SPEC 0015 中不规定产品行为的章节：自主裁定记录、实现映射、交叉审查与完成门。
它们是证据与历史，不是合同；规范条款仍在 [SPEC 0015](./0015-private-form-context-rag-and-narration.md) 正文，编号未变。

<a id="18"></a>

## 18. 实现映射与当前证据状态

| 责任 | 唯一生产映射 | 验收映射 | 当前状态 |
| --- | --- | --- | --- |
| Form Catalog/筛选/Profile | `app/_runtime/lib/kp/form-catalog.ts` + Room `prepare`/action | 十 Form、3–6 张、compound、注入拒绝 | **已实现/定向证据**：Form/环境 Profile/Builder 组合 14/14；完整门依用户豁免未运行，不计通过 |
| Context Pack | `app/_runtime/lib/kp/context-pack.ts`、`v3-context-runtime.ts` + Rules `project` + Room Authority | Required 不可删、NPC 重投影、Narration 缩小 | **已实现/定向证据**：静态 corpus 与 production context 组合 14/14；三交互真实 Provider 接缝 3/3，但完整线上 Context/质量指标仍由用户自测 |
| 静态 RAG/FTS 与灾备 checkpoint | `app/_runtime/lib/kp/{static-retrieval,static-corpus}.ts` + `room/archive.ts`/DO + `db/schema.ts`/D1 Adapter | 中文别名、ref/hash 重读、重建、本地写读；settled checkpoint、prefix/audit、ahead event/genesis conflict 校验、capability-only restore | **已实现/定向证据**：静态 fresh/upgrade/FTS 14/14；Wrangler local `0000–0011` 与 SQLite `0010→0011` 写读通过；archive D1 11/11、真实 reader→fresh DO 1/1、无当前受控 viewer 的 D1→fresh DO 1/1；远端 `0008–0011` 已成功应用且无 pending |
| Proposal/一次修订 | `private-form-policy.ts` + Form validator + Room Action proposal journal | 语义 hash、1+1、无第三次、骰后冻结 | **已实现/定向证据**：窄修订 5/5；Proposal 失败的公开 DTO/确定性故障前端路径在两视口通过，完整 Provider 故障统计与完整门未测 |
| CausalActionProgram | `app/_runtime/lib/kp/causal-action-program.ts` + `rules/profiles/causal-action-interpreter.ts` + Rules `step` | closed/acyclic/bounded、复合拓扑执行、无脚本/patch/事件/骰面 | **已实现/定向证据**：Causal/环境 Rules 组合 8/8 |
| 模型角色/Profile | `app/_runtime/lib/kp/{model-registry,context-planner-policy}.ts` + `room/v3-binding.ts` | 主 KP 固定、Planner disabled/verified、无隐藏切换 | **已实现/定向证据**：角色/Profile 6/6；G3/G4 未达增益，生产绑定只接受 disabled，故无 Planner UI；真实候选验证未执行且不冒充产品证据 |
| Body-only Narration/Grounding | `app/_runtime/lib/kp/narration-v3.ts` + Room Action/DO delivery | exact `{body}`、服务器元数据、显式拒绝 | **已实现/定向证据**：public action/table 21/21 与 Viewer recovery 4/4 覆盖公开裁剪、冻结投影、控制权变化和失败恢复；双视口公开 DTO Narration 重试前端路径通过且不重复 settlement，语音/TTS 仍未覆盖 |
| 双状态/逐受众恢复 | Room Action/DO `action.ts`、`durable-object.ts`、Rules projector、table API/UI | Alice/Bob 独立、提交不回滚、冻结重试 | **已实现/定向证据**：同上 21/21 + 4/4；死亡/退役/transfer/revoke、继任拒绝、恢复态不读取当前世界与不重复机械有责任 seam 证据 |
| 动态环境与人物熟练 | Rules v2/Geometry/Profile/Room/archive/replay + 环境编译器 + character-proficiency Profile | 任意 KP 内容、`state-only` / `area-hazard`、§11 通用动态场景；当前 V5 Expertise/豁免熟练与退役 manifest 隔离 | **0.4 当前映射**：当前 causal/environment 与 Room 定向 runner；旧 workflow-v2/environment-v4 的 57/57、25/25、6/6 和长轨迹 1/1 只作历史审计，不计当前完成数。具体吊灯专项已取消；SPEC 0014 完整战术地图仍未覆盖 |
| Telemetry/错误 | `app/_runtime/lib/room/{action,telemetry}.ts` 与公开 API DTO | 十错误、白名单、故障注入 | **已实现/定向证据**：十个精确公开代码及阶段分类已有 V3 runner；G2 五类故障 5/5 安全回退；部署后 15 秒 exact-version error Tail 为 0，历史日志查询受 OAuth 403 限制，不能冒充完整生产日志证据 |
| 实验/发布 | 离线结构门已按 ADR 0034 随 V5 提案路径删除；live runner/provisioner、生产 seam 长轨迹、浏览器 QA、现有 deploy/smoke guard | §10、§13–15 | **发布事实已建立，质量边界保留**：远端 `0008–0011` 无 pending；源码 `4822d2b` 已部署为 Version `97291f34` / deployment `834c2b79` 100%；双视口前端视觉/DOM 五路径（页面数据全部为公开 DTO）10/10 且额外 Provider action 为 0；独立的唯一三交互实际穿过真实 HTTP/auth/Room/Provider 3/3、live verified，但原命令因 compact receipt evaluator 误判退出 1且未重跑；修复随 `9cc5e3c` 非 force 推送，`main` 未变。完整门依用户豁免未运行，完整 live Provider 指标仍由用户自测 |

上述“已实现/定向证据”和发布事实只按各自明确责任计数，不能拼接成完整线上质量门。远端 migration、双视口浏览器、部署版本、清理与 Git SHA 已有证据；完整门没有运行，三交互原命令不是绿色，Provider 完整指标、语音/TTS 与完整战术地图仍保持未覆盖。
