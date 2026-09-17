# MBDE3S 投影中断排查与本地修复

2026-09-14，`cloudflare`，HEAD `ff78223102950adb4605d8fee9b8c837a34d55fa` 加原有未提交工作区。本次仅修改 table 的服务端/客户端读取边界，新增两项定向测试；保留其他改动。没有部署、push、远端写入或模型调用。

## 已确认的问题与修复

用户确认线上出现“房间投影暂时不可用，请稍后刷新”，整个桌面消失。桌面通过 `fetchTable` 每 3 秒轮询；原服务端把 Room 读取异常和投影拒绝都转成 HTTP 200 的 `{ ok: false }`。React Query 将其视为新数据，替换上一份成功桌面，导致 `PlayTable` 卸载、输入草稿丢失。

[组件回归](../../../tests/product/table/table-sync.test.mjs) 使用真实 `TableClient`、React Query 与游戏客户端，在 HTTP 响应处注入原错误载荷，先得到 `a failed projection poll must not unmount the entire table: 0 !== 1`。正常轮询对照保持草稿。

[服务端](../../../app/_runtime/lib/table/server.ts) 将未取得 Room 观察结果的异常标为 `retryable: true`；[客户端](../../../app/_runtime/lib/table/client.ts) 将该分类转入现有查询错误/重试路径，保留桌面和草稿、展示同步错误。已有的正常同步与手动刷新入口继续负责恢复。

明确的权限拒绝和不合格投影不获得这个标志，仍替换旧数据并停止展示；没有按错误文案匹配、绕过投影验证或补造成功状态。对应 SPEC 0007 §2、SPEC 0001 §9。

## 实际验证

- `npx tsx --test tests/product/table/table-sync.test.mjs tests/product/safety/player-error-feedback.test.mjs`：5/5。覆盖失败后恢复、正常刷新、草稿保留、离席/无效投影清屏、仅重读而不重发行动，以及既有公开错误与原提交重试规则。随后为兼容仓库 Node 基线把测试加载器换为 `module.register`，单独重跑组件用例 1/1。
- `npx vitest run tests/product/table/table-sync.room.test.ts`：1/1。[服务集成测试](../../../tests/product/table/table-sync.room.test.ts) 使用本地 D1 migrations、实际 Room DO 和 table 服务；只在 Room RPC 边界注入连接异常/拒绝/错误 Viewer。验证成功读取、可重试异常分类、恢复、秘密不泄露与观察结果不变。未声称覆盖真实浏览器 HTTP 鉴权。夹具初次误用用户表名、漏填必填列，修正后通过。
- `npm run typecheck`：exit 0。`git diff --check`：exit 0。没有全量测试、Lint 或 production build。

## 线上只读证据与未闭合范围

对用户指定房间做一次 D1 `SELECT id, code, status`，确认其为 `play`，读 1 行、写 0 行。由房间 ID 计算 telemetry 的 room hash，将下面记录核对为 MBDE3S。

Wrangler 日志直连因订阅连接超时失败；使用本机已有系统代理后取得一次 55 秒采样，再做一次 55 秒对照（无新事件）。没有改变系统代理。浏览器初始会话未登录；随后只读确认用户 Chrome 中已登录 MBDE3S，尝试网络诊断时遇到用户操作中断，未继续操作房间。

| 北京时间 | 实际观测 |
| --- | --- |
| 23:23:56 起的一次 alarm | `room.archive.failed / archiveFailure`；平台记录 CPU 14,670 ms、wall 19,208 ms；应用记录归档等待约 994 秒。内部异常原因未被现有脱敏日志保留。 |
| 23:24:15 | 同房间 `observe.completed`，耗时 14,624 ms，最终成功。 |
| 23:24:21、23:24:26 | `observe.completed`，分别 132 ms、121 ms，最终成功。 |

平台计时与应用时间字段分别保留，不把应用 `durationMs: 0` 当成归档无开销。归档重试与慢读取存在时间相关性；**没有抓到原始 `observe` 失败，也未证明归档任务导致用户的断开**。这次本地注入验证只证明查询错误覆盖桌面的确定缺陷，不能代替线上异常根因的复现。

下一项建议检查是在 MBDE3S 再次出现原提示时，关联该次 `fetchTable` 与 `room.authority.observe` 日志，区分 Room RPC 异常和已返回观察结果后的投影拒绝，再决定服务端修复。当前没有改动归档机制。

唯一保留的本机日志摘要为 `.wrangler/diagnostics/mbde3s-summary.json`，仅含该房间的固定 telemetry 字段及平台计时；原始请求日志和诊断临时脚本已删除。线上仍运行原部署版本，本修复尚未发布。
