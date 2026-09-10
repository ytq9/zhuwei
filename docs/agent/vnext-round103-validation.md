# Round103：本地 dev 服务器饱和，未建房即中止

2026-09-10 凌晨，源码 `add92b1`，场景同 round82–91。**未进入 setup：只读预热在 600 秒内没能编译完根路由（round102 时是 369 秒），停掉预热后再单发一个静态 GET，90 秒仍无响应。没有房间、没有玩家意图、0 次模型调用、0 条私有捕获、¥0；进程已关，389 项源码起止相同。被测源码与本轮唯一的 harness 改动（客户端中止 120→240 秒，花费上限一律不变）都未被触及。**

## 环境读数

| 项 | 值 |
| --- | --- |
| 共享 state 目录房间 SQLite | 82 个，769 MB |
| 本轮日志中重试归档的房间 | 9 个 |
| 本轮 `room.archive.failed` | 791 条 |
| 根路由编译 | round102 369 秒 → 本轮 >600 秒 |

归档失败本身是既有现象（round98 记录 8,860 条仍跑完 11 次调用），但现在有 9 个房间在同一个 Miniflare isolate 里持续重试，而这个 isolate 同时要编译和服务请求。`vinext dev` 只提供 `--port` 与 `--hostname`，换一个 persist 目录意味着改产品配置，本批不做。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。extract/replay 记未覆盖。389 项源码起止 `allEqual=true`。[机器证据](vnext-round103-live-evidence.json)。私有证据在 `/tmp/zhuwei-round103-npc-preparation/evidence`。

第三句「我走到账台前，看看文书副本在不在。」在真实批次上仍未覆盖：round98 未发、round100 填不出、round102 客户端超时、本轮未建房。
