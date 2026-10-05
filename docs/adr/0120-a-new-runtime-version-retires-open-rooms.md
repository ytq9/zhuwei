# ADR 0120：规则解释改变时发新版本，已开房间退役

- 状态：已接受
- 日期：2026-10-05
- 依据：
  - 用户要求工具、武器与护甲熟练对已开的房间也生效。
  - 这与 SPEC 0013 §§2.2、2.3、3.4 和 DEC-043 冲突：改变规则解释须发新版本清单，已开房间不回填人物字段，迁移要另做产品决定。
  - 问用户怎么处理时给了三个选项：就地生效并补数据、发新版本让旧房间退役、只对新房间生效。用户选了"发新版本，旧房间退役"。
- 当前规则：[SPEC 0013 §2.3](../specs/0013-versioned-runtime-profiles.md)
- 取代范围：SPEC 0013 §2.3 原句"未来加入第二个 manifest 前，必须先明确裁定 0.4 房间的保留、迁移或退役策略"中待裁定的部分，现裁定为退役。

## 决定

1. 规则解释改变时，换用新的完整 manifest。生产 Registry 仍只登记当前一项，不并存两个版本。
2. 按旧 manifest 开的房间随之退役：
   - 不迁移，不补字段，不保留兼容分支；
   - 行动时房间绑定校验不通过，房间不能再继续。
3. 本次（ADR 0119 的熟练、[ADR 0114](0114-a-door-of-a-new-place-is-completed-on-first-use.md) 的门补全、上锁门的开锁转换）一起换成 `runtime-srd51-2014-authoritative-vnext-stage3-v2`。

## 影响

- 部署本次改动后，之前开的房间都不能继续，玩家需要开新房间。
- 以后规则解释再变，照此处理，不再逐次询问保留或迁移。
- 旧版本房间不再续跑，验证跨版本续跑的测试一并删除：
  - [ADR 0068](0068-freeze-inventory-admission-policy-with-the-plan.md) 的旧版本事件夹具 `frozen-inventory-legacy-events.json`；
  - `frozen-inventory.room.test.ts`（原为 SPEC 0016 的门）；
  - `frozen-choice.test.mjs` 中按旧版本回放的用例。现行受理规则的用例保留；
  - 旧版本隐蔽检定事件夹具 `concealed-primary-legacy-events.json` 及 `concealed-check.test.mjs` 中回放它的用例。
