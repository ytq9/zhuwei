# 组件组装与拆解：本地实现及真实验证边界

2026-09-07。能力合同：KP 为行动者持有、未装备的现有组件声明数量与拆解可恢复性，经同一库存权威保存当前地点的普通组装物；原组件被占用，原组装者拆解时只取回可恢复件。身份由服务器生成，数量、状态、Claims、Viewer 和 replay 均来自 ItemSystem。普通组装不自动创建 ItemDefinition、Ability 或伤害能力。

模型填写 `assemble {label, description, components[{entryRef, quantity, recoverable}]}` 或 `disassemble {assemblyRef}`。`recoverable` 指原组件拆解后的可回收性，不是提案错误分类。通用诊断与一次等义窄修订机制保留；组件重复或数量错误不能靠去重、换材料、改数量来修订。

代表性矩阵覆盖整件可恢复的绳索/餐具、部分堆叠与混合可恢复性、拆解后普通库存合堆及再次组装、占用件的独立使用/消耗/移动拒绝、外人/另场景拒绝、重复拆解、战斗免费操作拒绝、填写到 atomic Rules、公开 Table DTO、Claims、服务端更正与 replay。可恢复件保留 charges、durability 和 condition；不可恢复件不补回数量。

26 文件差量按基线 SHA 串行集成，0 冲突，保存原文件；[集成清单](vnext-component-assembly-integration.json)包含完整原/新 SHA。直接消费者为 KP schema/类型槽/依赖图/lowering、授权 context/read-set、库存转换/事件/correction、Claims/observer/projector 和 Table 两级公开白名单。parser 为 v26；原 v25 根尾语法修订保持。

实际验证：

- 隔离三文件组：新矩阵 8/8、库存 21/21、旧 Table 17/20，整个命令退出 1。三个失败均为未改动源码的旧正则断言（Profile 调用、party guard、useReaction）；未改测试制造通过。日志 `/tmp/zhuwei-assembly-targets-final.log`。
- 隔离 Table 四项直接投影行为 4/4，退出 0；类型检查退出 0。日志 `/tmp/zhuwei-assembly-table-target.log`、`/tmp/zhuwei-assembly-types-final.log`。
- 集成后 `npx tsx --test tests/item-assemblies-vnext.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-proposal-schema.test.mjs`：53/53，退出 0；`npm run typecheck` 和 `git diff --check` 退出 0。日志 `/tmp/zhuwei-assembly-integrated-node.log`、`/tmp/zhuwei-assembly-integrated-types.log`。
- [真实 round56](vnext-round56-validation.md)前两步通过，第三步组装+手动测试整束因不同 Form 的结果字段混填而拒绝。组装条目已选用新接口，但未产生任何组装提交；不能将本地实现或正确填写一个条目计为真实组装完成。

上述 round56 结束时完整真实组装/拆解尚未通过。随后 [round57](vnext-round57-validation.md) 在 parser v27 的同源 entries 填写面上完成原四句正常登录/HTTP 真实链：两件原组件被占用，下一轮准确消费公开 assemblyRef 拆解，两件各一归还，完整公开库存与开局相同；未创建新 ItemDefinition/Ability。四次重复 submission 无新增调用或提交，8事件完整 replay 精确一致；自然根尾 JSON 错误通过一次等义确认恢复。13次真实调用，估算¥0.2178194；保留 round56 的失败原稿和计数。

尚未支持整件搬运、他人取得、耗时 Activity 或战斗动作版本；当前即时路径在 active encounter 中明确拒绝，不自行补成本。真实不可恢复组件、长期连续稳定性、20+ 双人链和 Goal 仍未完成。未部署、push 或修改已批准规格。
