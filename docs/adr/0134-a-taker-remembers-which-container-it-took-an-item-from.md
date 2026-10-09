# ADR 0134：取出物品的角色记得它来自哪个容器

- 状态：已接受
- 日期：2026-10-10
- 依据：[真实调用检查](../agent/receipts/possession-recall-live-20261010.md)里，"我把刚拿出的那一块放回同一个盒子"四次都选成了盒里剩下的那叠。冻结上下文不带近期旁白（[narrative-continuity.ts](../../app/_runtime/lib/kp/vnext/context/narrative-continuity.ts)），普通取物也不留任何记录；两块都叫"干净布条"，没有事实能说明哪块是刚取出的。真实游戏和探针一样。用户要求补上取出来源的记录。
- 当前规则：[SPEC 0001 §16](../specs/0001-llm-kp-responsibility-contract.md)（物品与角色知识持续，查看记录按角色持续）；条款不变。
- 取代范围：无。

## 决定

1. **记录归取出的人。** 角色从容器里取出物品、拿在手上（不在别的容器里）时，在 `vNextItemAuthority.takenFrom[角色][物品]` 记下容器、数量和取出的事件序号。这是该角色的记忆，同 [ADR 0130](0130-container-inspection-and-original-content-provenance.md) 的查看记录；物品条目本身不变，堆叠规则也不变。
2. **不再拿在手上就忘掉。** 该物品放进容器、交给别人、丢下或用掉之后，相关角色下一次库存操作时删除这条记录。提交和 replay 用同一个事件处理函数，结果一致；更正审计按记录恢复。
3. **KP 只看行动者自己的记录。** 冻结的物品记录和随身物清单行都只带行动者本人的 `takenFrom`；随身物清单行显示容器、数量和事件序号。别人的记录不出现，刚取出的那件也不再和同类物品合成一行。
4. **发新版本。** 事件处理的解释变了，按 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md) 换用 `runtime-srd51-2014-authoritative-vnext-stage3-v9` 与事件格式 `room-world-events-vnext-stage3-v7`，已开房间退役。模型上下文升为 vnext-18。

## 后果

- 只有带取出记录的随身物会让请求变大，每行多一个容器引用、数量和序号。
- 记录不进入玩家视图。
- 模型会不会用这条记录选对来源，要靠新的真实样本确认。
