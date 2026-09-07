# Round81：第一次连过三句；等待有了旁白；档位落地

2026-09-08 凌晨，源码 `1f4300a`（功能提交：`efe2879` 等待走模型旁白、`27e1d55` 时长档位 parser v44）。正常注册建卡，初态核对通过。场景仍是 round70 三意图，gate 同 round79/80（每句的虚构增量双向核对）。**三句全发**，12 次调用，¥0.617334（无未知 usage），duplicate 0 调用。

## 首句：档位、裸 `"none"`、又一个不同的瓦罗

4 次调用，committed 且 published。模型在共享裁决上填 `duration: "5min"`；`branch:main` 由 0 推进到 300000000，`FictionTimeAdvanced` 为本根首条事件、带 `characterId`、`scene-observers` 可见。

`addressedThreadRef` 写成了裸 `"none"`——round79 因它整批作废的拼写——这次一次调用即被接受：v43 的 codec 修复第一次被真实触发。

瓦罗这次说：「好。我在此处候着。想清楚了，同我说一声便接着念；也不必等敲台——你开口我就知道。」**他拒绝了敲击。** 旁白把半分钟就地收掉：「半分钟过去了，你们这轮交谈就此完成，瓦罗仍守在账台旁等你开口。」档位合同预言的副产品出现了。`consequences: []`，第六批。

因此第三句只能走 `noReminder` 分支：交接里「KP 有没有把两下敲击还回来」这一问，本批没有可测的正例。

## 第二句：等待第一次有旁白

4 次调用（offer、`passTime` 60000000、旁白、审核）；`narration: published`——round78/80 同一句是 `notApplicable`。

冻结的旁白上下文 `recentDialogue` 恰是三句：玩家的请求、瓦罗的回应、玩家的等待句——等待窗口按设计工作。旁白：「你静静等了一分钟，约定的时间到了。」没有替瓦罗补出他拒绝的敲击（负例通过）；审核五项 pass、`m0 complete`。「约定的时间到了」措辞略过：约定是半分钟、等了一分钟，不是机械矛盾。

选择 `["passTime","observe"]`，填写只出 `passTime`，`observe` 再次丢弃、不留痕（已知缺口）。Activity 300000000 → 360000000 完成。

## 第三句：连续性

4 次调用，committed 且 published，`duration: "5min"`。social 的 `addressedThreadRef` 填了首句的真实线程引用（`conversation:42d4…`）——第一次看到模型接续线程。瓦罗：「好，你开口了，我便接着。备案我还搁在这儿。你是要接着听我念，还是先问你的？」与他首句的话自洽。审核通过（`m0`、`m3 complete`）。360000000 → 660000000。

## 收尾

duplicate 0 新调用、同一 receipt。`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 17，17 条事件。322 项源码起止 `allEqual=true`。

[机器证据](vnext-round81-live-evidence.json)。私有证据在 `/tmp/zhuwei-round81-npc-preparation/evidence`。

## 证明了什么，没证明什么

- **证明**：三句连通（此前从未）；等待有旁白且上下文正确；档位被模型接受并如数执行（两次 5min）；裸 `"none"` 修复真实触发；模型接续了真实线程引用。
- **没证明**：承诺经上下文归还的正例（瓦罗没承诺，条款没被触发）；审核对「按原话兑现的小动作」的宽容；`crossedDeadlines` 无数据；补选仍零证据；`observe` 丢弃仍不留痕。一批三句不等于稳定。
