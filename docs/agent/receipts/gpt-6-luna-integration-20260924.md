# GPT‑6 Luna 接入验收

2026-09-24，`cloudflare` 工作树。产品决定于 2026-09-23 获用户确认，见 [ADR 0040](../../adr/0040-gpt-6-luna-provider-and-room-binding.md) 与 [SPEC 0011 §§3–4](../../specs/0011-reliability-correction-observability-and-evaluation.md)。未部署、push、修改远端 Secret 或创建远端资源。

能力合同：新房可以选择 DeepSeek V4 Flash 或 GPT‑6 Luna；提案、旁白、NPC 和故事准备使用同一房间的模型绑定，重启、调用恢复与归档恢复保留它。错误按原合同分类，不切换模型。默认 DeepSeek 及其既有 workflow 保持不变。

## 实际验证

- 传输、模型目录和房间绑定两组定向 Node 检查分别为 40/40、22/22（包含重叠用例）。覆盖真实产品的选择、填写、旁白、审核和世界故事分流请求，schema 转换幂等、描述文字保留、发送与账本请求一致，以及缺失密钥、401、403、404、429、额度不足、500、中止和不降级。
- 真实本地 Worker/SQLite 定向检查：两模型各三个提案阶段的显式恢复共 6/6，覆盖驱逐、晚到响应隔离、原响应复用和归档恢复；两模型的旁白恢复与两种故事准备共 6/6。最终门还通过跨 Provider 调用拒绝、未知模型标识拒绝及无标识旧房保持 DeepSeek 的用例。
- 当前源码的本地 HTTP 服务使用隔离 D1/DO 目录，应用本地迁移后验证正常注册/会话、大厅渲染、两模型分别创建房间及读取原模型绑定、未建角色拒绝开局。未发送游戏模型请求。测试服务已关闭。
- `npm run typecheck`：退出 0。`npm run spec:check`：0 错误、7 条既有警告。文档断链 0，`git diff --check` 通过。
- `ZHUWEI_HTTP_TEST_ORIGIN=http://127.0.0.1:4193 npm run gates:check`：退出 0；声明的 61 个测试文件全部通过（Node、Worker 及页面 HTTP）。模块检查无新增违规，未修改棘轮基线。该命令不执行全量单测或三个声明的工具入口，不将它们计为已运行。

首轮验收门为 59/61：三个选择修订测试的 Room 请求夹具没有实际模型标识，另一个 HTTP 测试读到了旧 `dist`。前者改为经过现役请求序列化的有效模型夹具；后者增加只接受 loopback 的源码服务入口并验证两个模型。没有放宽行为断言或更新失败基线，最终整组重验通过。

## 真实 OpenAI API

官方模型查询返回 HTTP 200，模型标识为 `gpt-6-luna`。生成探针使用隔离的冻结场景及真实产品请求构造器，单次有超时与输出上限；失败后停止，定位 schema 差异后仅做有界复验。

| 调用 | HTTP | 输入 / 输出 token | 结果 |
| --- | --- | --- | --- |
| 类型选择 | 200 | 10154 / 23 | `offer_kp_proposal_bundle`，解析为 `schemaRequested` |
| 初次填写 | 400 | 未返回 | `invalid_function_parameters` |
| schema 定位对照 | 400 | 未返回 | 确认 OpenAI 不接受 `$ref` 的 `description` 同级字段 |
| 修复后填写 | 200 | 14110 / 343 | `submit_kp_proposal_bundle`，现役解析器返回 `locallyAccepted` |
| 纯文本旁白 | 200 | 1447 / 18 | `stop`，现役旁白候选解析器通过 |

修复将带字段说明的引用转换成单元素 `anyOf`，保留原说明与约束，没有关闭 strict。成功调用合计已知输入 25711、输出 384 token；失败请求未返回 usage，不据此宣称零用量。另有一次本地 Node fetch 未获得 HTTP 响应，改用本地 Python 网络传输执行同一适配器请求。没有追加模型采样挑选成功结果。

旁白探针的后处理曾把解析器的 `{ body }` 返回对象按字符串判断，报告标签误写为 `invalidNarration`；实际解析器已返回且没有抛错。依据该解析器的非空正文检查确认候选解析通过，没有为纠正报告标签再次调用模型。

## 范围

用户提供的密钥仅保存在 Git 忽略的 `.dev.vars`，权限 `0600`；有效期由 Provider 校验，不写入源码或房间数据。未验证线上部署、长期连续游玩、真实 NPC/故事准备全链及所有模型输出质量；本地受控响应不计作真实模型成功。未运行 production build 或 `npm test`。
