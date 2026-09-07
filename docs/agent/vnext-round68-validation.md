# round68：类型选择通过，第二轮 JSON 仍失败

2026-09-07，默认 deepseek-v4-flash，parser v34；正常注册、Cookie、新房，无 fixture，初始 0 事件、计划、Activity。与 round66/67 的 scenario 字节一致。320 源文件起止一致，manifest `024c8a81fc85d7eef51a9077c8b4cbc095127a9894fb1d852c7651b5875fd854`。

首轮真实返回 `requestedCapabilities=[social,passTime]`，扁平选择通过。第二轮在 `arguments.decision.steps[0].result.response` 出现 `JSON_SYNTAX / json:string-expected`，offset 1210、line 1、column 1211，实际字符为 `}`。原响应完整保留，第一句 `PROPOSAL_FORM_INVALID / notCommitted` 后按预设停批，后两句未执行。未调用 Rules 或修订，状态精确等于初始，0 事件/Receipt/计划/资源/时间变化，完整 replay 一致。

只读诊断显示并非单一标点错误：原 offset 1208 的尾逗号之外，还有 offset 1232 的额外 `]`。仅在独立诊断副本删除两字符后，同一完整校验器仍拒绝 `social:materialized-knowledge-requires-bundle-producer`，路径 `proposals[0].branches.success.response.basis[1].definitionRef`。改变知识来源或补一个世界事实 producer 会改变原决策，不能借窄修订完成。诊断副本没有提交，不计修复成功，也不把此离线校验计成实际 Rules 拒绝。

格式失败 1、实际 Rules 拒绝 0、已识别叙事矛盾 0、修订/恢复 0。未发布内容不能作为叙事正确率样本。两次调用共 41,507 输入（768 命中、40,739 未命中）、681 输出，usage 完整；空闲价开发费用 **¥0.0642114**。本批仍受 20 calls / ¥5 / 20 分钟、每 HTTP 5 次 / 120 秒约束，没有改话术或模型重采。

最终只读核对还确认：第二轮捕获 schema 与同源生成结果逐字一致；缺失的知识引用在冻结上下文中无精确匹配，另一条 npcContext 指向 nonCitableRefs 目录包装，来源 resolver 返回 unavailable。本人记录和已有知识已加载，playerExpression 类型及玩家原文也存在。因此不能证明只是同一授权引用填错 kind，也不能归因为缺少当面对话来源。私有正文和引用值未复制公开回执。

本轮证明这次首轮选择可用，**没有证明完整填表稳定性提高**。round65 的局部连续成功和 round66–68 的失败均保留。下一步将已有来源简化为冻结目录直接选择，由服务器推导类型和归属；新事实保持显式生产者。不为原失败补造裁决、引用或生产者。

[脱敏证据](vnext-round68-live-evidence.json)；受限原稿及冻结请求保留在 `/tmp/zhuwei-round68-npc-preparation/evidence/`。extract/source-end 均 exit 0。第一次 replay 命令误把 stdout 重定向到脚本自己以独占方式创建的结果路径，报 EEXIST、exit 1；保留这个空重定向文件后，原脚本正常执行、exit 0，精确重放通过。这是本地收尾命令错误，没有 API 或世界副作用。capture28707/game28717 已按身份 SIGTERM，进程和端口均消失，detached 退出码未知。未部署、push 或修改生产数据；完整 Goal 保持 active。
