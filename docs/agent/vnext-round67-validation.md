# round67：同原 NPC 话术再次首轮格式拒绝

2026-09-07，正常注册/Cookie 新房，默认 deepseek-v4-flash，parser v33。已加载类型选择修复与持续施法 Rules/Room 接缝均在本批源码中；320 文件起止一致，manifest `a2f7375f3d9fe992155e8ef44de4523bf3aaeac9a070a449c44dd88985226b4a`。无 fixture，初始 0 事件/计划/Activity，公开瓦罗在场。

与 round66 相同自然请求及预算。模型首轮没有请求 schema，而是返回 `decision.kind=social`，只含 intent/method/basisRefs；这既不在首轮允许的决定中，也没有可执行裁决或结果。原 JSON 语法完整，准确诊断为 `VALUE_INVALID / filling:decision-kind`，`arguments.decision.kind`，actual 为 social。响应来自声明 strict 的真实工具调用；不可补造裁决、把该草稿静默转换成查询，或继续重采。

第一步 `PROPOSAL_FORM_INVALID / notCommitted` 后停批。格式失败 1、Rules 拒绝 0、已识别叙事矛盾 0、修订 0、恢复 0；后两句未执行，未形成计划属于未到达裁决的技术中断。状态精确等于初始，0 事件/Receipt/计划/Activity/时间/资源变化，完整 replay 一致。

本批 1 次调用、19931 输入（768 命中/19163 未命中）、185 输出，usage 完整，空闲价开发费用 **¥0.0296154**。原预算 20 calls/¥5/20 分钟、每 HTTP 5 次/120 秒保持。官方价格在北京时间 08:01:13 重新获取，HTML SHA 与先前已检查页面一致。

本地定向通过仍未保证首轮真实填写稳定。随后只读核对了真实冻结 Prompt、schema 与 beta 路由：唯一 system/user 使用当前协议，未发现旧填写协议；响应 `finish_reason=tool_calls`，185 输出 tokens，排除 4000 上限截断。首轮 system 明确要求先选 schema，但通用 authority 和工具 decision 描述仍讲完整裁决与 check 成败，存在阶段竞争信息。此证据不能证明它导致了此次失败。

用捕获请求注入无网络 fetch 重建现役 strict binding，选中 `/beta/chat/completions`，转换后 body 与 capture 一致；重建 offer requestHash 也精确一致。Capture 没有记录目标 URL，路由结论属于源码与离线重建证据，不冒称网络抓包。未发现旧 schema、普通 endpoint fallback 或 strict 降级，不能推断供应商内部原因。

下一步以扁平纯类型选择入口作有界真实对照，第二轮才填写所选完整表单，复用同一冻结上下文及现有校验器。普通小表单保持最多两次，复杂家族最多三次且至多一次窄修订，HTTP 总上限五次不变。尚未把新方案标作成功，round65 的原三句通过、round66 和本批失败均独立保留；原稿不会改成 schema 查询。

[脱敏证据](vnext-round67-live-evidence.json)；受限原稿、冻结请求、journal、状态及日志在 `/tmp/zhuwei-round67-npc-preparation/evidence/`。extract/replay/source-end 均 exit 0；capture24080/game24088 按身份 SIGTERM，进程及4320/4321端口消失，detached 退出码未知。未部署、push 或修改生产数据；完整 Goal 保持 active。
