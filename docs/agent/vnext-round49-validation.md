# vNext round49：普通动作已提交，重复事实表导致旁白拒绝

2026-09-07；分支 cloudflare，HEAD 258caee404e0814405eb497653ee9f00d647b773，保留未提交工作。正常 Cookie 注册、开房、建卡、开团后，玩家输入“我从背包里取出一根火把，放在身旁”。本批预算3个新行动/15调用，首个失败即停，后两行动及重复HTTP未执行。

真实默认 DeepSeek 共3调用：Proposal 合法 directSuccess inventory release 1；生成正文“你从背包里取出一根火把，放在身旁。”；review/v9以missingClaimFacts拒绝。两个inventory Claims来自同一次事件，f0/f2的必述结果文本相同；审核填了f0/f1，f2为空。这是覆盖表漏填，未把旧失败改判成功。

SQLite核验：1个InventoryOperationApplied、1个receipt，库存10→9、地面1，虚构时间不变；完整runtime.replay与存储状态精确一致。delivery仍open、audience rejected，正文未发布。308文件批次开始/结束SHA一致，无新增/删除。两本地服务已停止。

用量34,794输入（命中1,536、未命中33,258）/866输出，按本批重新读取的官方空闲价格计算¥0.0538608，未核对账户账单。价格页面SHA 899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5。全部计开发验收，不能当正常完整行动均价。

离线extract、完整replay、费用与源码核对均exit0（工具chunk 34d59c、3b5f78、8fea91、bf0a31）。脱敏证据见[vnext-round49-live-evidence.json](vnext-round49-live-evidence.json)。原请求经原Room delivery构造器从SQLite导出，generation请求与capture完整深等；没有重新project、重提案、API调用或发布。私有冻结请求/tmp/zhuwei-round49-frozen-request.json，0600，SHA 10e1c04f4d8819f3f0d09ca9b06fa72f2120a8072c8b2392e489405097523549。

本批不证明成功发布、恢复、连续游戏或成功率提升；不部署、不push。
