# 玩家能力资源池同步修复

2026-09-07，cloudflare 开发期。[round71](vnext-round71-validation.md) 真实首施法已提交，但 ResourceSpent 首次在第3事件写出两个余额：core slot1=4 与新建 spellSlot:1=3，combat3/4；公开原样展示，离线长休再把上限重建为3。原真实失败不改判。

修复复用唯一 combatResourceId 映射，通过 playerResourceKeyForCombatPool 查找恰好一个原有玩家池，并验证 core/combat 当前值及已声明 maximum 一致。spendCosts 对同池只检查首次前态后顺序扣费，反应施法共用同一准入；ResourceSpent fold 再核金额、before/after并回写原core key，不新建别名或改最大值。缺池、重复别名、余额/上限矛盾拒绝。NPC沿原同步、物品仍走ItemUsed；投影和休整不增加遮掩层。

代表性检查覆盖两种真实目录治疗、同池双成本与职业资源、反应法术、缺池/歧义/数值冲突、崩溃/重复提交及原始dice/journal。正常compileSheet卡连续两术后core/public slot1=2、max4且无新别名，公共Rules长休恢复4/4并精确replay。它是受控模型的本地Room/Rules证据，不是本次真实模型稳定性证据，也不是HTTP长休实测。

修改限3个生产文件（character-abilities、combat-actions、combat-events）及2个直接native能力测试。原fixture曾只在combat设置法术槽而core只有hitDice，现正确声明相同core池；不会为了旧fixture放宽缺池准入。新增public断言第一次未计既有零库存投影，后精确修正，初始18/19日志保留。

验证：精准red在合法core/combat初态下稳定失败（旧core余额2、预期1）；最终 `npx tsx --test tests/kp-vnext-ability-operation.test.mjs` 19/19 exit0，`npx vitest run tests/kp-vnext-ability-operation-room.test.ts` 5/5 exit0，`npm run typecheck` exit0。共享导出helper新增故做类型检查；未运行全量。精确基线/新SHA、日志与命令见[集成记录](vnext-resource-pool-integration.json)。

未改变schema、事件payload、Profile标识或hash算法。本次恢复尚未发布的能力实现；原round71本地错误状态及历史诊断只在原冻结源码快照下保留重放证据，不宣称新fold会重建同一个错误状态，也没有自动更正/迁移旧测试房间。保护未来vNext生产数据的发布/恢复方案仍属完整Goal的后续门。

独立审查对最终三个生产文件未发现可复现阻断。[round72](vnext-round72-validation.md) 第一施法已用正常 Cookie HTTP 及真实 DeepSeek 完整复验：core/public/combat 一环槽4→3、max4一致，重复原 submission 无新调用或资源变化，9事件 replay 精确。第二句被独立的重复 intent 填表错误拒绝，第三句未发；因此仅本次资源问题的首步真实恢复有证据，连续两次施法及查询尚未通过。三整卡更正快照容量、完整20+多人链和长期稳定性仍未闭合。未部署、push、commit、远端migration或退役；Goal active。
