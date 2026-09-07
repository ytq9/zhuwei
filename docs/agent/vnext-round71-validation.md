# Round71：真实能力填写成功，资源同步失败

2026-09-07，parser v36，默认 deepseek-v4-flash，正常注册 Cookie → createRoom → lockCharacter → startGame，完整三阶牧师初态自动核对通过。UUID 骰式误判修复后正常初始化恢复；没有受伤、能力或资源 fixture。

首句原话“我握住圣徽，对自己施放一次一环的治愈伤口。”完成纯选择 abilityOperation、完整填写、Rules/Room 提交及旁白发布。两次提案请求/响应与 Room journal 完全相等，两轮冻结上下文一致，没有窄修订。旁白及审核另各一次，总计4次真实模型调用。

然而资源一致性验收失败：第3事件 ResourceSpent 的 spellSlot:1 after=3 正确，但 core 保留 slot1=4 并新建 spellSlot:1=3；公开 controlledCharacter 忠实展示两份余额。core maximum 只有 slot1=4。首个明确机械不一致后停批，后两句0发送，不重采、不改验收断言。旁白说“这一环法术的可用次数已减少至3”，不能替代状态一致性证明。

权威记录9个事件、1个Receipt。真实骰为d8=8，1d8+3共11，满血24/24所以applied=0；没有实际HP恢复证据。根因在 ResourceSpent 用combat ID直接回写core，未复用既有combatResourceId反查原池；事件前缀逐一重放确认第3事件首次分叉。独立离线长休→重建还复现combat变成3/3，说明不仅是显示问题。详见 `/tmp/zhuwei-round71-resource-diagnosis`。

实际usage为59652输入、488输出；按同日核验官方峰价并区分命中/未命中计费 **¥0.1755528**。4 calls分别是选择、填写、旁白、审核；没有格式失败、提案Rules拒绝或窄修订。本批计1次机械不一致。完整旁白品质和重复提交/ACK验收在停批后未继续，不据局部旁白推称其全面通过。

停批后精确Room提取及该批冻结源码下replay均exit0，exactState=true；321项源码起止一致，SHA256 `93f250341b3748f1803118a09f0762c24f593633ab13e589249c0206bb57da06`。game/capture均已停止、端口4320/4321消失；detached进程退出码不可取得。该结果只证明原失败状态可在原源码下重放，不声称后续修复源码会产生同一个错误状态。

[机器证据](vnext-round71-live-evidence.json)，私有原始请求/响应、卡片、权限上下文与journal位于 `/tmp/zhuwei-round71-ability-preparation/evidence`。原批次不覆盖，尚未修复/迁移本地错误房间数据。完整稳定性、第二法术、状态追问、连续多人和长休真实API仍未通过。无部署、push、commit、远端migration或数据退役；Goal active。
