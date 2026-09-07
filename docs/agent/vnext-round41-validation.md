# vNext round41：真实 Room 修订暴露表示确认误拒

2026-09-06，本地未提交 cloudflare 开发树，parser v20。预设3次真实correction、48,000输入、1,800输出、每次45秒、全批4分钟、¥0.17；首个失败即停。

复用现有 `kp-vnext-provider-room.test.ts` 的两个表示修订与一个检定驱逐恢复样例，在临时副本中仅把 correction binding 换为真实 DeepSeek。首稿固定合成；Room、调用票据、持久化与 Rules 是真实本地实现；旁白为测试替身，不是完整 Cookie/HTTP 或真实游戏验收。原测试文件 SHA 为 `4e82e4a0ab87269b3b0899de57585a75257f7d968832bf9c0ef1927d205483ce`，运行后原文件不变；临时副本已删除。

首个 worldInteraction 样本的真实 correction 在1,688ms返回，六项改动全部等于服务端已证明值：五项字段修复，加一个空 producer 数组转 strict none 对象的表示确认。现行 provider 只把前五项送进字段 allowlist；第六项虽在 wireEvidence 中已证明等义，仍被 `correction:path-not-allowed` 拒绝，结果为 `needsKp / PROPOSAL_REPAIR_EXHAUSTED / notCommitted`。这是本批暴露的通用修订接口误拒；后两个样本未调用。

初次测试桥接预检误把 Room 已组装请求的 max_tokens 当作 max_completion_tokens，0次外部调用即停止。修正此断言后才执行本批唯一API；这不是产品故障，不计模型请求。真实失败后没有重采样；须先修复同源表示确认边界再另开批次。

本批1 attempt、1 known usage：2,608输入（1,024命中、1,584未命中）、186输出；按当日已核验官方空闲价 Decimal复算 ¥0.0032642。累计round6–41为77 attempts/66 known usage、763,833输入/63,208输出，已知¥1.12877835–1.2429151，另11未知费用。全部计开发验收，不作为成功行动均价。

[脱敏证据与产物SHA](vnext-round41-live-evidence.json)。命令 `node --import tsx /tmp/zhuwei-diagnostics-room-live-41b.mts --execute`，exit1；日志 `/tmp/zhuwei-diagnostics-room-live-41b.log`；原始请求、响应与usage在 `/tmp/zhuwei-diagnostics-room-live-41b-private/`，未进入公开DTO。未部署、push或远端修改。
