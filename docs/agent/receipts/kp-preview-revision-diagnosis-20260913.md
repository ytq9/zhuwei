# 本地 KP 修订格式与原行动复验

2026-09-13，承接[启用回执](./kp-preview-enable-20260913.md)。本次继续在用户明确授权的 3000 预览工作树处理。

## 修订失败的结论

前批首稿括号错误，修订又返回 `arguments` 字符串包装，内部仍是同一份非法 JSON。服务器拒绝该回复是正确行为。核对 [SPEC 0016 §7.2](../../specs/0016-part-c-compound-actions-and-claims.md) 与 [ADR 0021](../../adr/0021-one-narrow-proposal-revision-may-rejudge.md) 后，确认已批准合同只有一次修订；现有预览代码的三轮实现与文档存在既有差异，不能据其 `roundsRemaining` 把本次停止判成缺少合法重试。本次没有扩大调用资格、修改已批准规格、自动补括号或解包返回。

提案 guidance v29 明确区分填表工具的直接 JSON 对象与修正工具的字符串封装，要求无可解析原稿时重新填写有效整稿；选表说明同时区分取物、观察和对象补全，禁止以文字代替实物操作。此项是提示改进，不声称能确定性约束模型输出。

新增回归用例经过实际 Provider 修订入口：坏 JSON 的字符串包装与好 JSON 的字符串包装都拒绝；直接合法替换与正常首稿得到相同提案，原工单及冻结上下文保持不变。首次运行误将解码结果与编码前夹具比较而失败，修正为正常首稿的公开解析结果后通过；该失败不是产品 Bug 的红灯证据。

`npx tsx --test tests/kp-vnext-proposal-revision.test.mjs tests/kp-vnext-unparsed-revision.test.mjs tests/kp-vnext-prompt-contract.test.mjs`：28/28。包含 Room 保存请求与恢复防篡改检查。没有修改公共类型或解析接口，未运行 typecheck、全量测试或构建。

## 一次真实原行动

通过已登录的正常 Chrome 页面创建并开局 8D9B5M，默认 3 级人类战士“散木”；新桌完整 manifest 与 v29 源码逐字一致。未修改 PRX4HR 的绑定或已有事实。

调用前保存上限：1 行动、6 次物理调用、600,000 输入、50,000 输出 tokens、¥5、10 分钟，首次结果后停止，不重采样。本地 HTTP 调用限制设为 6。实际只发送“拿起黑橡叶仔细查看。”，5 次调用，111,320 输入、2,118 输出 tokens；从计划落盘到证据收集约 284 秒，相关源码起止 hash 一致。费用未由 Provider 返回，保持未知。

本次填写 JSON 合法，无修订调用，旁白生成与审核均返回，受众状态为 `published`。正文没有“中等把握”“把握中等”或“仪式”。这证明此样例回复已送达，不证明全面恢复或稳定成功率。

完整能力验收仍未通过：

- 首选包含 `inventoryOperation`，最终该步骤数组为空；`worldInteraction` 的文字声明取起物品。权威事件中没有 `InventoryOperationApplied`，目标 ItemEntry 仍为 `disposition: scene`、`holderRef: null`。不能把已发布的“拿起”称为真实取物成功。
- 上游仍创建了关于行凶的推断，感官依据不足以支持该结论。旁白没有复述这整条推断，但它已形成 `CharacterInferenceFormed`，所以不能把表面没有秘密关键词当成知识边界已闭合。
- 当前结构、引用、Rules 校验与提交后旁白审核未拦住上述语义问题。本次没有用动作关键词硬编码转库存、删除冻结推断或放宽校验掩盖缺口；单纯 Prompt 改进不足以宣称完成。

目标 DO 为 `00a70fb1870b9f2e34f769e3aef7ca44cf40c33f695d409c27917f8da4b08c16.sqlite`，由 `__miniflare_do_name` 精确匹配房间身份。13 个权威事件、3 个含 Activity 阶段的回执、1 个已发布受众。最初按文件修改时间读到另一个 DO，发现身份不符后弃用其计数；本页只记录精确匹配结果。

私有计划、捕获 135–139、状态与报告位于 `.wrangler/kp-preview-20260913/final-validation/`；前批证据不改写。收尾移除临时 HTTP 调用限制，保留原捕获配置。没有部署、push、远端 migration 或其他账号修改。
