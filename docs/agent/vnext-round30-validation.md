# round30：真实 strict 工具输出的嵌套 JSON 失败

日期：2026-09-06。完整 vNext Goal 恢复后，在 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 及保留的未提交树上运行新批；未复用 round29 房间、会话或捕获，也没有部署、push 或远端数据修改。

## 实际批次

正常 Cookie 注册 → 开房 → 建卡 → 开团 → 开场 ACK 无模型调用。首次自然 NPC 意图与 round29 同类：表达慰问并询问对方手中物件的来源，允许对方不回答。只发出一次 `deepseek-v4-flash` Proposal：31,796 输入（hit 1,920 / miss 29,876）、895 输出，8,172ms，按当时官方空闲价 ¥0.0489375。

预设上限为 2 行动、10 次真实调用、580,000 输入、81,920 输出、10 分钟及最高价格 ¥2.50；每 HTTP 请求最多 5 次，所有可能调用模型的游戏写请求先检查剩余额度。首个明确失败停批，未执行第二行动、旁白或 duplicate。capture/server 已停止，现场 4320/4321 无监听。

工具请求确有 `strict:true`；原捕获请求与调用时源码生成的完整请求 canonical 相等。此证据仅证明请求内容相同，不能证明 Provider 实际执行了严格生成约束。调用期间 [301 文件源码清单](vnext-round30-source-manifest.json) 不变，manifest hash `8917503e03372576bfd81082ce01b10ff9e9d319dea3b8f143c97b02de972d1f`。官方价格页 hash `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`，周日空闲价；[脱敏证据](vnext-round30-live-evidence.json) 保存预算和 usage。

## 精确失败与机械边界

原 parser 返回 `JSON_SYNTAX / json:object-delimiter-expected`，位置 `proposals[0].branches.success`、UTF-16 offset 1683、line 1 / column 1684。公开结果为 `notCommitted / PROPOSAL_FORM_INVALID`，没有进入窄修订或 Rules。

原工具文本的 social success 嵌套闭合符错误，consequences 写入了 response 内；同时选择了 check，但没有完整的 failure 执行分支。不能靠补括号、移动字段或新造失败后果使它成为可提交提案。原始文本未清洗、未提交，离线诊断没有追加模型调用。

实际 SQLite 提取并使用同一运行时 `replay`：0 事件、0 Receipt、0 Claims、0 到期任务，状态精确等于 genesis，无随机、资源或虚构时间变化。没有 Claims，不能宣称旁白验证通过。原始会话、工具响应和 NPC 私有知识仅保留本地受限文件，报告不外发正文。

## 下一步与尚未完成

本批暴露真实 strict 工具输出仍不可靠。下一步先对照官方 function calling/strict 文档核验实际 Provider endpoint、参数和支持范围，不从 `strict:true` 或旧 handshake 样例推断严格约束已生效；再依据差异决定修复，不能继续抽样挑成功。V05 冻结澄清继续方案在真实批次期间仅只读准备，没有改变冻结源码。

本批没有修复后真实对照、后续行动或完整旁白。普通/复杂主链、双玩家 20+ 连续行动、A–O、生产替换及退役仍待完成；完整 Goal 保持 active。
