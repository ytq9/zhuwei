# 已加载小表单的纯 schema 选择

2026-09-07。round66 只请求 passTime+social，未形成草稿；接口只允许 step 名称，因此格式拒绝。parser v33 从同一实际初始填写 schema 派生小表单标识，与 step registry 合成请求 enum。已加载部分复用原结构，所选 step 仍闭合原类型依赖；未知、同数组重复 ID、混合草稿继续精确拒绝。

只有小表单的查询也占唯一补取阶段；expanded 不再允许查询或空 steps 的澄清。未知值诊断补 arguments pathBase；无法对应原字段的内部依赖错误不编造位置。

修改 schema/provider/guidance 3 个生产文件及 schema-retrieval/provider-room 直接测试。Room 原保存响应重证继续使用同一解析器，无新持久化入口。5 文件全部 SHA 核对、0 冲突，见 [集成记录](vnext-terminal-selection-integration.json)。普通 2 阶段、补取 3 阶段、HTTP 5 调用与一次 correction 不变。

主树 Node 目标组 55/55（本接口 29、持续施法 Rules 26）、持续施法/时间 Room 11/11、typecheck exit 0。Provider 目标 6/6、35项未选，exit 0，`/tmp/zhuwei-terminal-selection-root-room.log`。日志：`/tmp/zhuwei-terminal-casting-root-node.log`、`/tmp/zhuwei-casting-root-room.log`、`/tmp/zhuwei-terminal-casting-root-types.log`。

round66 原响应仅做 0 调用离线解析，得到 schemaRequested/social；原稿未改，原真实失败不改判，未提交世界。round67 原 NPC 话术真实复验尚待。没有稳定性提高声明、部署或 push。

[round67真实复验](vnext-round67-validation.md)未再触发已加载类型错误，但首轮直接生成不完整social决定，格式拒绝；不能因此声称选择接口稳定性提高。0世界变化，原稿保持；后续入口设计调查继续。
