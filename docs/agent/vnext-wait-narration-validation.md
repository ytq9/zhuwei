# 等待走模型旁白：上下文路线的前提

2026-09-07，基线 `81c3b1e`。承接 [交接 §7 第 1 条](../../handoff.md)：要让 KP 在等待里把「敲账台两下」这类只存在于上下文的承诺还给玩家，等待必须先有旁白。round61 的 [被动时间回执](vnext-passive-time-validation.md) 出于预算把纯等待做成了只走 Activity 确定性显示、不建模型 audience；这一条现在收窄。

## 改了什么

- **Room**（`authorityAudienceBindings`）：纯等待跳过旁白只保留给 lifecycle 受众——`controlledCharacter` 为 null，即已死亡或离场角色的原控制者。活着的 Viewer 的纯等待现在建模型 audience，走 `frozenRenderableClaims-vnext-1` 旁白（生成 + 审核）。Activity 的确定性状态显示不变。
- **旁白上下文**（`roomNarrationContext`）：等待结果没有自己的对话，`recentDialogue` 原本只收 Claims 引用到的线程发言，等待时为空。现在，当 Claims 含本人的 `timePassageCompleted`/`timePassageInterrupted`，取本人已结束等待 Activity 的 `[开始 − 30 分钟, 结束]` 虚构窗口，选同场景线程（`sourceSceneId` 等于当前场景）的 `claimRef`/`responseClaimRef` 中 `acquiredAtFictionMicros` 落在窗口内的已听发言；本人最近的 transcript 发言也纳入（说明等待是为了什么）。`sourceClaims` 改按 `acquiredAtFictionMicros` 再 `claimId` 排序，同一瞬间保持原顺序。
- **提示词**（`narration-vnext.ts`）：生成与审核各加一条等待条款——`recentDialogue` 中在场 NPC 当面说出、约定在经过时间内兑现的即时小动作，可以按原话写成已经发生；不新增台词、信息、持续状态或机械效果；约定时刻超出实际经过时间、等待已中断或原话没说过的不能写。审核对这类不报 `UNRECORDED_CREATION`。review schema v11 → v12，policy v9 → v10。

## 代价

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 纯等待 | 2 次调用/HTTP | 4（+生成 +审核） |
| 等待中有可见 NPC 行动 | 5 | 7（NPC 旁白 2 + 等待旁白 2） |

round61 定的「每 HTTP 5 次」在第二种组合上不再够；`kp-vnext-time-passage-room` 的预算用例改为 7。真实批次遇到这种场景，per-HTTP 限额要设 7。闹钟路径完成的等待：audience 建好但当时无人旁白，落成 `narrationRecovery`，玩家下次 observe 时按现有恢复链发布——未真实验证。

## 本地证据

- typecheck 0 错。
- node 全套按名比对基线 `81c3b1e`：0 新失败（基线 worktree 里两个套件因路径加载失败，不计）；新增 1 测试。
- vitest 全套：54 个失败两边完全相同，0 新失败。
- `kp-vnext-time-passage-room` 9/9：纯等待 1 次旁白且请求含「等待已结束，实际经过 17 秒」；死亡中断 0 次（lifecycle）；NPC 到期 + 等待 2 次，按提交顺序。
- `kp-vnext-narration` 新用例：等待冻结 `[开始 − 30 分钟, 结束]` 内的同场景发言，按虚构时间排序，本人最近发言纳入；过旧、别的场景、等待结束之后、其他玩家的行都不进；无等待时同一投影不借出任何对话。
- `kp-vnext-pass-time` 里「missing, invalid or additional time decisions…」在基线上同样失败（`authorityBasisRefs is not iterable`，夹具过期），不是本次引入。

## 没有验证的

- 真实模型是否会在等待旁白里把那两下敲击还回来——round81 第三句看这个。
- 审核会不会把「敲两下账台」误判成新增行动——条款是新的，零真实证据。
- 30 分钟的回看窗口是一个粗档位，不是测出来的。
