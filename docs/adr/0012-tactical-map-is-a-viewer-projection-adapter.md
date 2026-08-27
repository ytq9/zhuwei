# 战术地图是观察者投影 Adapter，不是第二空间权威

- 状态：已接受（用户 Goal 明确批准）
- 日期：2026-08-27
- 关联规格：SPEC 0001、SPEC 0003、SPEC 0005、SPEC 0010、SPEC 0012、SPEC 0013、SPEC 0014

## 背景

烛帷需要一个可操作的二维战术地图，但现有 authoritative-v2 Geometry 已以整数英寸、独立高度、占位、路径、屏障、掩护和区域算法构成机械事实。若页面把像素/方格保存成位置、按可见 token 自行算目标或读取完整 GM geometry 后再隐藏 DOM，就会形成第二空间权威并把隐藏实体、障碍和区域集合暴露给客户端。另一端若只保留抽象一维距离或空 obstacles，则已裁定的 Geometry 无法成为真实产品行为。

## 决策

Room DO 的 WorldState 和绑定版本的 Geometry Profile 是唯一权威战术空间。LLM/KP 只能提出带因果依据的结构化环境定义、有限状态转换、路径、区域原点/方向和封闭选择；Rules 经同一 `step` 验证并确定实际路径前缀、环境机械语义和全部受影响集合，Room DO 原子提交可回放事件。页面不得提交任意状态 patch、实际区域 `targetIds`、掩护、碰撞或骰面。

`project(viewer)` 产生版本化 `Tactical Projection`，同时供二维地图、文字战术读数、无障碍信息和秘密安全 preview 使用。地图只把该投影适配成俯视格子或等价二维视觉；5 尺格、像素、缩放和视觉舍入不回写状态。preview 也是同一 projector 的观察查询，只展示 Viewer 已知的自伤、友军波及、公开阻挡/掩护/高度，不公开隐藏候选数量或完整实际集合；正式提交始终针对最新完整 WorldState 重算。

环境不采用通用物理模拟器。KP 按叙事权威决定合理的定性环境事实，Rules 只执行版本化定义允许的 `open/closed/destroyed`、`intact/damaged/destroyed`、燃烧/结冰/坍塌/困难地形/持续区域等有限状态和机械后果。会影响 DC、目标、随机、资源或不可逆结果的条件与阈值必须在骰前冻结。

旧 ruleset 仍由明确 Legacy Adapter 保持原行为；不得从旧一维距离、页面坐标或空 obstacles 猜 authoritative-v2 geometry。

## 被否决的方案

- 客户端网格/像素作为机械坐标：会造成不同视口和舍入下的第二状态真相。
- 把完整 GM 地图下发后用 CSS 隐藏：DOM、网络和 preview 均会泄露秘密。
- 页面按当前可见 token 计算区域目标：会遗漏隐藏实体并允许调用者删改真实集合。
- 让 LLM 提交任意环境 patch 或骰后解释材质：会绕过 Rules、破坏回放并允许按结果偏置。
- 建立通用物理引擎：超出首版产品范围，也会错误取代 KP 对故事世界的定性裁决。

## 后果

authoritative-v2 必须真正保存、投影和回放 scene geometry、环境要素/状态、持续区域与高度；地图不可用时同源文字读数仍可操作。任何 Geometry、环境状态图、投影 schema 或算法语义变化都需要新版本/Profile，并保留旧房解释器。验收必须包含隐藏状态不可区分、门/破坏物/环境效果/高度、Room 恢复、375px/1440px DOM 与视觉证据。
