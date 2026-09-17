# 按故障编号排查

玩家遇到错误后，点击桌面下方的「复制故障信息」，把复制结果发给维护者。内容只有故障编号和请求时间。截图中的编号也可以直接使用，不需要重新提交行动来制造日志。

这套能力在对应代码部署后才会出现在页面；旧截图没有编号时，使用带时区的发生时间查询。日志权限、记录保留与采样仍由 Cloudflare 决定。

## 查询一条故障

在仓库根目录运行，将 `ZW-...` 换成完整编号：

```bash
npm run diagnose -- --reference ZW-...
```

命令按编号中的请求时间查询前后各 10 分钟，先找到该 HTTP 请求，再按已取得的 Cloudflare 请求身份和 submission/root/receipt 哈希查相关记录。报告按时间排序，包含公开错误码、失败阶段、具体分类、耗时和有证据的服务状态码。不会按同房间或同玩家扩大匹配范围。

没有编号的旧截图：

```bash
npm run diagnose -- --at 2026-09-16T12:01:03+08:00 --minutes 5
```

时间查询会列出窗口内现有 Worker `zhuwei` 的脱敏记录，需要结合时间及行动哈希判断哪条对应截图。不能把同一时间附近的错误直接当作目标故障。

历史查询默认最多两组、每组 3 页、每页 200 条，全部使用临时查询 `dry: true`；不会保存 Cloudflare 查询或创建资源。达到上限时返回 `partial` 和退出码 2，不声称记录完整。`--minutes` 可设 1–60；优先缩小时间范围，避免无边界拉取日志。

## 历史日志权限

历史查询自动读取仓库内已被 Git 忽略的 `.wrangler/diagnostics.env`，只采用 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 与可选 `HTTPS_PROXY`。显式环境变量优先；未配置专用 Token 时，复用 `wrangler whoami --json` 和 `wrangler auth token --json` 的当前登录。多账号时用 `--account` 指定账号 ID。配置文件应为 `0600`，不要把内容复制到聊天或日志。

专用 Token 仅用于历史查询；`--tail` 继续使用原有 Wrangler 登录或显式环境变量，`--file` 不读取凭据。

Cloudflare 的[历史查询接口](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)要求 **Workers Observability Write** 权限。名称带 Write，但本工具仅调用查询接口，并设置 `dry: true`。`workers_tail:read` 只证明实时读取权限，不能保证历史查询可用。

如果返回 401/403：

1. 在 Cloudflare 控制台检查登录和目标账号，以及 Workers Observability 权限。
2. 在本地受限配置文件 `.wrangler/diagnostics.env` 或凭证管理工具中配置具备所需权限的 `CLOUDFLARE_API_TOKEN`，同时设置目标 `CLOUDFLARE_ACCOUNT_ID`。不要把 Token 放进聊天、命令参数、版本控制或日志。
3. 重新运行上面的查询命令。未取得适用授权时，agent 不自行创建 Token、扩大权限或修改线上配置。

网络需要代理时，使用当前环境中的 `HTTPS_PROXY`。工具通过标准输入向 `curl` 传递凭证，不把它放进进程命令行；接口响应只在内存中处理，输出重新经过字段白名单。

## 实时采集与离线查询

已有实时日志读取权限时，可以先启动一次有界采集，再由玩家正常使用页面；采集命令本身不发送游戏请求、不自动重试、不调用模型。

```bash
npm run diagnose -- --tail --seconds 60 --out /tmp/zhuwei-diagnostic.json
```

默认 60 秒、最多 300 秒，可以用 Ctrl+C 提前停止。连接未确认、鉴权失败与网络失败都明确报错；连接已确认但没有相关事件时返回空结果及其证据边界。只保存结构化日志的允许字段，原始请求、Cookie、堆栈和模型内容不会落盘。

拿到玩家编号后，筛选刚才保存的报告：

```bash
npm run diagnose -- --file /tmp/zhuwei-diagnostic.json --reference ZW-...
```

`--file` 也接受 Wrangler JSON/JSONL 原始采集格式，读取后再过滤；工具不会把原始文件内容复制到输出。输入文件上限 16 MB。`--out` 可以保存脱敏查询结果，文件创建权限为 `0600`。

## 怎样解释结果

- `found`：取得匹配的结构化记录。先看 HTTP 结果，再看关联模型、调用账本或 Room 的失败阶段，区分已知原因与推断。
- `no_matching_events`：没有取得匹配记录。可能未入库、已过保留期、被采样或请求未到达服务端；不证明操作没执行，也不证明系统没出错。
- `partial`：达到本次查询/采集上限，证据不完整。
- 退出码 1：查询、认证、连接或输入失败，不能当作空结果。

页面编号只定位一次 HTTP 尝试，不是房间访问凭证。重试有新编号，但原行动的 submission 身份不变；日志通过哈希关联两次尝试。诊断中的可重试分类不授予新的模型调用权限，游戏仍由原恢复协议决定。

本工具不包含玩家原话、模型原文、私人旁白或隐藏世界事实。对于表达质量和事实矛盾，仅凭结构化日志可能无法裁定，应明确说明缺少哪类证据，不能编造根因。

## 实现与验证入口

- HTTP 关联：[game route](../../app/api/game/route.ts)、[request diagnostics](../../app/_runtime/lib/platform/game-request-diagnostics.ts)、[错误边界](../../app/api/_shared.ts)。
- 页面信息：[reference](../../app/_runtime/lib/platform/diagnostic-reference.ts)、[game client](../../app/_runtime/lib/platform/game-client.ts)、[复制按钮](../../app/_runtime/components/diagnostic-copy.tsx)。
- 查询：[CLI](../../tools/diagnose-game.mjs)、[脱敏与关联](../../tools/diagnostics/telemetry.mjs)。
- 定向验证：[关联、复制与查询](../../tests/platform/telemetry/game-diagnostics.test.mjs)、[真实本地 HTTP](../../tests/platform/telemetry/game-diagnostics.http.test.mts)。后者使用 `tests/config/history-http.config.mjs`。
