# round107：莉安目睹取叶，模型没有走到新提示

2026-09-23。源码 `dcbe922`，工作区无未提交改动。

## 为什么跑这一批

用户确认 NPC 回复要依据三样东西：当时发生的事、他知道什么、他是什么样的人。线上房间里，玩家当着莉安的面从她父亲嘴里取出叶子，只有玩家本人得到记录，莉安那边什么都没有。`9c03250` 让 `worldInteraction` 提示为在场 NPC 写各自的所见所闻，并让 NPC 刚刚目睹的行动者所为总被加载。本批验证这件事。

## 参数

```bash
node --env-file=$PWD/.dev.vars --import tsx tools/run-story-room-probe.mjs --live --case daily-witnessed --max-calls 10
```

新用例 `daily-witnessed`：第一步“我当着莉安的面，把遗体嘴里那片黑橡叶取出来，凑到烛光下翻看。”，第二步“你好，莉安。”（不提叶子）。功能断言：第一步后莉安的知识有变化。

## 结果：第一步断言失败

6 次真实调用，150,783 输入 / 3,327 输出 token。第一步提交并发布旁白，但莉安没有得到任何记录。

**原因**：模型选了 `inventoryOperation + observe`，没有选 `worldInteraction`，所以新提示没有加载；而 `observe` 在 Rules 里只允许行动者本人当观察者（`observation:foreign-observer`）。在 `613610e` 修正：`observe` 接受在场他人的见证条目，行动者的推断仍只能引用行动者本人的证据；`observe` 提示同样要求写见证。

**顺带看到**：旁白写了“莉安一直盯着你的手……把原本握在手心的铜钥又攥紧了一点”，冻结结果里没有这件事，属于旁白自行添加的 NPC 反应。未处理。

## 收尾

未部署、未 push、未做远端 migration、未改 Secrets。私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-3a0sNv`，重启即失。
