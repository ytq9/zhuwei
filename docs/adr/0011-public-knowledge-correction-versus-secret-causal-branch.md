# 公开知识勘误可前向补偿，秘密误授必须进入因果分支

- 状态：已接受（SPEC 0001/0005/0011 一致性决议）
- 日期：2026-08-27
- 关联规格：SPEC 0001、SPEC 0005、SPEC 0010、SPEC 0011

## 背景

SPEC 0005 的验收要求同类错误知识取得分别覆盖前向补偿和因果分支，同时其正文与 SPEC 0011 又明确规定秘密获得或已经影响后继选择时必须打开因果分支。若把“前向补偿”实现成让现实玩家忘掉已见秘密，既不可能兑现，也会借更正扩大秘密旁路；若把所有知识勘误都强制分支，又无法证明无后继影响的公开事实勘误。

## 决策

知识错误按“取得资格与因果影响”而非仅按事件类型分类：

- 角色有权取得、内容为 `publiclyObservable`、且尚未影响另一 Root Action 或玩家选择时，可以追加显式前向补偿。活动投影移除错误内容并显示可公开的更正说明；原取得事件、旧 Receipt 和更正记录永久保留。系统不声称现实玩家遗忘，只明确说明先前内容不成立。
- 私人/共享秘密被错误授予、观察者原本无取得资格，或任何知识已经影响后继行动、关系、资源、位置、死亡或玩家选择时，必须打开因果分支并 supersede 受影响闭包。旧分支只供授权审计，活动投影与 replacement Delivery 不得再次携带失效秘密。
- 错误的 Source Claim 仍可作为世界内谣言被角色记住；只有系统误把它当成 Canonical Fact/感官证据时才走本 ADR 的服务更正。世界内人物后来澄清谣言属于新的世界事件，不是服务端改史。

Rules 依据已提交 KnowledgeRecord 的 visibility、Receipt 因果闭包与后继 Root 判断策略；Room/调用者不能用 `errorKind` 自报“公开”来降级成前向补偿。

## 后果

SPEC 0005 的“双策略”验收必须用两个同类但资格不同的场景：无后继影响的公开错误知识走 `CorrectionApplied`，私人秘密误授或已影响选择的知识走 `CorrectionBranchOpened → BranchActivated`。两者都通过真实 Room `commitCorrection`、`project/observe`、归档恢复与 O16 replacement Delivery 验证；不得直接改知识表或把旧正文留在投递槽。

## 实现映射

- 策略与 fold：`app/_runtime/lib/rules/v2/correction.ts`、`app/_runtime/lib/rules/v2/actions.ts`
- Room 更正与替代投递：`app/_runtime/lib/room/durable-object.ts`、`app/_runtime/lib/room/action.ts`
- 验收：`tests/archive-correction-v2.test.ts`、`tests/correction-delivery-o16-red.test.ts`
