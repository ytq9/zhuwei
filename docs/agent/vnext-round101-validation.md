# Round101：dev 服务器编译期间 register 超时，未建房

2026-09-10 凌晨，源码 `add92b1`（选择阶段召回 NPC 视图与记忆正文），场景同 round82–91。**setup 的 register 调用撞上 runner 的 120 秒每 HTTP 超时，批次没有建出房间：0 次模型调用、¥0、无世界状态、进程已关、389 项源码起止相同。被测源码未被触及，这是环境/harness 失败，按发生原样记录。**

## 发生了什么

`services.py start game` 只等端口开始监听，不等路由编译。刚启动的 dev server 在 register 请求期间仍在做 Vite 编译——服务器日志里 `[vite] (rsc) warning` 的时间戳（02:18:25Z）正落在 register 的窗口（02:16:49Z 发出，02:18:49Z 中止）内。

round102 开跑前用只读 HTTP 直接量过：根路由编译 369 秒、`/api/auth/register` 136 秒、`/api/game` 178 秒，都远超 120 秒的客户端中止。

## 背景噪声（不是本次原因）

服务器日志里绝大多数是共享本地 state 中 8 个历史房间的 `room.archive.failed` 重试。这类失败是既有的：round98 记录了 8,860 条仍然跑完 11 次调用。本轮把它记为背景，不作为原因。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。extract/replay 记未覆盖（没有房间可读，也不造房补样）。389 项源码起止 `allEqual=true`。[机器证据](vnext-round101-live-evidence.json)。私有证据在 `/tmp/zhuwei-round101-npc-preparation/evidence`。
