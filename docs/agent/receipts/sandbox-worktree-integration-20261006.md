# 沙盒接续前的本地分支整合

日期：2026-10-06。用户已批准实施及合并；范围限本地 `cloudflare`。没有 push、部署或远端 migration，原 Claude worktree 全部保留。

## 操作审计

- 整合前：`247219fe476bab2fce8ffad0b2d31fbc6a85380d`。恢复引用：`refs/codex/sandbox-integration-base-20261006`。
- 战术分支快进至 `b0b0a26dfd8b44d3e7217b51eb2c3fa3a99d117f`。
- 开锁分支 `8085ea0fe2088e3e10ae35c5fca175536d20212b` 合入，merge 为 `746e03d6`。保留战斗结束和未完成门两类入口；两个 worker 的补丁已在开锁分支内，不重复合并。
- 动态地点分支 `819226b3732682ac5ffdea27ac53470395779207` 合入，merge 为 `58e19b2f`。合并未知目的地、门、地形和终点诊断，保留 NPC 专用填写边界。

| 原标识 | 整合后 | 处理 |
| --- | --- | --- |
| 开锁 ADR 0112 | ADR 0119 | 熟练规则与直接引用同步改号 |
| 开锁 ADR 0113 | ADR 0120 | 新运行时让旧房间退役；直接引用同步改号 |
| 开锁 ADR 0114 | 不变 | 战术分支没有使用此号 |
| 开锁 round175 | round177 | 保留战术 round175；映射说明保留原历史提交信息，不改写源分支历史 |
| 动态地点 ADR 0097 | ADR 0121 | 目的地与通路条款及直接引用同步改号 |

## 此时的验证

以下证据属于整合版本 `58e19b2f` 及其父版本，不外推为后续接续实现已通过：

- 开锁整合后类型检查通过；6 个定向 Node 文件共 62 项通过。
- 动态地点/常用动作/SPEC 0001 定向组 34 项通过。
- `npm run spec:check`：0 错误，12 警告。
- `npm run gates:check`：96 个已声明测试文件全部通过，exit 0；未扩大违规或红门基线。
- 提案体积增量已向用户说明，并使用 `--accept-request-size` 接受。开锁：常见填写 +18–19 token，completeObject +185，worldInteraction +76，authorItem +158，全部组合 +372。动态地点：materializeObject 及组合 +136，全部组合 +137；相关拒绝请求的运行时指导约 +77。

本地详细输出：`/tmp/zhuwei-sandbox-merge-node-20261006.log`、`/tmp/zhuwei-sandbox-dynamic-node-20261006.log`、`/tmp/zhuwei-sandbox-integration-gates-20261006.log`、`/tmp/zhuwei-sandbox-spec-check-20261006.log`。临时日志不承担长期规格权威。

未进行真实模型调用。本次整合包含 ADR 0120 的既有裁定：将来部署新 manifest 时，旧 manifest 的开放房间会退役；本次本地合并不影响线上房间。
