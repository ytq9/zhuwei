# ADR 0066：隐蔽检定所挂的步骤是被瞒的举动，不能是与主要察觉者的对话

- 状态：已接受
- 日期：2026-09-28
- 依据：「趁莉安不注意取叶，同时问她话」这句里，取叶是库存操作，没有结果字段，挂不了检定；正确写法是再写一个 worldInteraction 步骤挂隐蔽检定，库存操作绑定 onSuccess（round144 就是这样）。模型走捷径时把隐蔽检定挂到对莉安的 social 步骤上：round137 第 1 句的填写 goal 写着「趁莉安被问话引开注意，与同束的暗中取叶动作配合」，掷的是问话，提交了；round146-1c 更进一步，连取叶也写成第二个 social 步骤，三轮修正都在修那个错步骤的字段，`PROPOSAL_REPAIR_EXHAUSTED`。现存 38 份带检定的同用例填写里，普通 `check` 挂 social 的 3 次都是正当的（说谎、劝说），`concealedCheck` 挂在与主要察觉者对话上的 2 次都是这个错。用户裁定：这类矛盾由程序判定，不只靠模型选。
- 当前规则：[SPEC 0016 §7.3](../specs/0016-part-c-compound-actions-and-claims.md)。
- 取代范围：无；把 SPEC 0005 §6.2 已有的“隐蔽的对象是主要察觉者”落到填写校验。

## 决定

1. **`concealedCheck` 的检定步骤若是 social，且其 `npcRef` 就是 `primaryObserverRef`，Bundle 降低时拒绝。** 只比对这两个字段，不看文字。诊断 `concealment:hidden-act-is-not-the-talk-with-its-observer` 指向该步骤（表单里的 `check.social[k]`），写明：要瞒的动作写成 worldInteraction 挂在 check 下，物品变化用绑定 onSuccess 的 inventoryOperation，问话保留为 outcomeBinding=always 的 social 步骤。允许修正。
2. **不禁止其他挂法。** 普通 `check` 挂 social、`concealedCheck` 挂 observe 或 worldInteraction、以及 `npcRef ≠ primaryObserverRef` 的悄悄话都不受影响。
3. **不加提示词。** 填写指引已写明检定挂在“决定其结果的那一步”；这条矛盾由服务器第一轮就指出。

## 后果

- round137 第 1 句那种“掷在问话上但靠单独库存操作完成”的提案从此被拒，改为要求正确的结构。
- 模型该写 worldInteraction 却什么都不写、该给在场者写见证却没写，仍判不了：那是缺项，不是可核对的矛盾。
- 门：`tests/kp/knowledge/concealed-check.test.mjs`。
