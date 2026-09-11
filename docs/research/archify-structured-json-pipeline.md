# Archify 如何约束大模型生成结构化 JSON

- 调研日期：2026-09-01
- 固定仓库：[tt-a1i/archify](https://github.com/tt-a1i/archify)
- 固定提交：[`199360cc6687a7857b54dd188d4922b09e466a4b`](https://github.com/tt-a1i/archify/commit/199360cc6687a7857b54dd188d4922b09e466a4b)
- 调研范围：官方 README、Agent Skill、JSON Schema、示例、CLI、validator、renderer、HTML template 与官方 ordinary-model benchmark；Archify 本体源码链接均固定到上述提交。

## 结论

Archify 并没有内置一个“调用大模型并要求 `response_format: json_schema`”的服务。它是一个安装到 Cursor、Claude Code、Codex、OpenCode 等外部编码 Agent 中的 **Agent Skill + 本地确定性编译器**：外部 Agent 负责理解自然语言并写出 JSON 文件，Archify 负责严格验证、给出机器可读诊断、确定性生成 SVG/HTML，再做交付检查。[官方 README 直接把边界写成 “Agents produce typed JSON IR; Archify deterministically compiles it into HTML/SVG”](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/README.md#L13-L20)，作者手册也明确说它首先是 Agent-facing Skill，普通用户不需要自己学习 schema 或运行命令。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/docs/authoring-cookbook.md#L1-L5)

因此，它“要求大模型编译 JSON”的实际办法不是一段神奇的 system prompt，而是五层约束共同工作：

1. `SKILL.md` 规定生成流程和语义/布局不变量；
2. 每种图有独立、封闭的 JSON Schema；
3. 模型只读一个同类型示例来学习字段形状；
4. CLI 把 schema、跨集合、布局和最终 HTML 检查错误变成结构化 repair receipt；
5. Agent 按 receipt 做有界局部修复，最终由确定性 renderer 和原子交付门收口。

官方自己的 ordinary-model benchmark 也说明这不是“Prompt 一写就稳定”：在当前 verifier 下，原始与后修样本都只有 **8/15 first-pass usable**；不同图型仍会在复杂 data-flow、lifecycle 和 routing 上失败。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/benchmarks/ordinary-model-floor/README.md#L92-L124) 真正提高可靠性的不是只靠模型服从指令，而是后面的 strict schema、确定性门、结构化诊断与有界修复。

## 仓库消歧

用户所指的“最近很火的 Archify”最符合 `tt-a1i/archify`：它的官方描述正是把代码库或系统描述变成可交互系统图，并明确采用 typed JSON IR → HTML/SVG。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/README.md#L11-L20)

同名的 `Harrison-Yuan/archify-webui` 是增加 Web UI 和模型 API 的封装，其 README 自己把 `tt-a1i/archify` 称为 original project。[来源](https://github.com/Harrison-Yuan/archify-webui/blob/b86f7fa63085601d9323cd60d47e3b99c62fd348/README.md#L148-L150) 本报告研究的是热门项目本体，而不是该 WebUI 封装。

## 一、它怎样把“问题”变成 JSON

### 1. 两层 Prompt，而不是把完整 Schema 塞进用户问题

第一层是用户/场景 prompt，只说要表达的事实、受众问题和信息密度。例如官方中文系统总览模板要求：描述用户、核心组件、主路径、外部依赖和边界；只追问会实质改变图的缺失事实；未知项不得编造；控制在 8–12 个核心组件和一条主路径。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/recipes/scenarios.mjs#L1-L24) 场景路由器只是返回这种 description/repository prompt，不把 schema 展开进用户文案。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/recipes/scenarios.mjs#L271-L283)

第二层才是安装到 Agent 上下文中的 `SKILL.md`。它要求 Agent：

- 从问题中先选 `architecture`、`workflow`、`sequence`、`dataflow` 或 `lifecycle`；
- 只读取对应 mode schema、`common.schema.json` 和一个对应 JSON 示例；
- 示例只用于字段形状，必须重新生成稳定 ID、领域措辞、事实和布局；
- 下一次工具动作就写 candidate 文件，不先在 prose 中规划坐标；
- 第一版保留一条主路径、短分支、稀疏标签，最多 12 个主节点；
- 默认写 `meta.quality_profile: "showcase"`，先用自动路由，诊断要求之前不得擅自增加 `via`、`labelAt` 等几何控制。

这些是它真正给大模型的 authoring instructions。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/SKILL.md#L13-L28)

官方 benchmark 中给 Agent 的实际任务 prompt 更能看出这种分工：任务只要求模型“fresh typed JSON”“showcase”“自选稳定 ID 和布局”“保留系统角色与有标签关系”“用 CLI 校验修复”，最后把候选写到精确文件名；字段细节由 Skill、schema 和示例承担。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/benchmarks/ordinary-model-floor/prompts/web-runtime.architecture.md#L1-L7)

### 2. 五种问题先路由到五种小 IR

Archify 没有让一个万能 JSON 同时表达所有图。它先按读者要回答的问题选类型，再使用该类型的小型 IR：

| 类型 | 核心结构数组 |
|---|---|
| `architecture` | `components`、`boundaries`、`connections` |
| `workflow` | `lanes`、`phases`、`groups`、`mainPath`、`nodes`、`edges` |
| `sequence` | `participants`、`segments`、`messages`、`activations` |
| `dataflow` | `stages`、`nodes`、`flows` |
| `lifecycle` | `lanes`、`states`、`transitions` |

五个 renderer 的结构分工由 schema 索引明确列出。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/schemas/README.md#L1-L20) `SKILL.md` 也给出了同样的类型路由语义；不确定时让 Agent 调 `guide`，而不是先猜字段。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/SKILL.md#L55-L65)

这会显著缩小模型一次要理解的 schema 表面积：一个 architecture 请求不需要同时理解 sequence 的 participant/message 或 lifecycle 的 state/transition。

### 3. JSON Schema 是封闭合同

以 Architecture 为例，schema 使用 JSON Schema Draft 2020-12，顶层 `additionalProperties: false`，并强制：

- `schema_version` 必须为 `1`；
- `diagram_type` 必须为 `"architecture"`；
- 必须有 `meta.title`；
- 必须有至少一个 `components`；
- component 必须有 `id`、`type`、`label`；
- component type、relationship variant、side、route 等都是封闭枚举；
- ID、坐标、尺寸、数组长度和字符串长度都有类型/范围约束；
- connection 的 `from`/`to` 必须符合共享 ID 形状，实际引用存在性由 renderer 跨集合检查；几何修复字段被限制为 renderer 认识的集合。

顶层和 `meta` 的严格合同见 [architecture schema L1-L68](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/schemas/architecture.schema.json#L1-L68)，component、boundary、connection 的完整字段见 [L69-L175](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/schemas/architecture.schema.json#L69-L175)。共享 ID pattern 和枚举定义见 [schema reference](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/schemas/README.md#L133-L164)。

Architecture 的最小结构可以概括为：

```json
{
  "schema_version": 1,
  "diagram_type": "architecture",
  "meta": {
    "title": "系统运行时架构",
    "locale": "zh-CN",
    "quality_profile": "showcase"
  },
  "layout": { "mode": "grid", "cols": 4 },
  "components": [
    { "id": "browser", "type": "external", "label": "浏览器", "row": 0, "col": 0 },
    { "id": "api", "type": "backend", "label": "API", "row": 0, "col": 1 }
  ],
  "connections": [
    { "id": "browser-to-api", "from": "browser", "to": "api", "label": "HTTPS" }
  ]
}
```

这是对 schema 的结构概括，不是 Archify 仓库中的原样示例。官方完整示例还展示了 `views`、自由坐标、边界、连接路由和 cards，供模型学习字段组合。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/examples/web-app.architecture.json#L1-L46)

### 4. 它明确禁止模型“自己发明字段”

Authoring contract 直接要求同时读 mode schema 与 common schema，“Do not invent fields”，只可用最近的示例学习结构，然后重新创作 ID、措辞、事实与布局。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/references/authoring-contract.md#L1-L14)

这比在 prompt 中罗列几十个字段更稳：字段权威留在机器可验证的 schema，prompt 只负责告诉模型“去读哪个合同、如何选择和如何修复”。

## 二、它怎样校验和修复模型 JSON

### 1. 先解析，再做多层确定性检查

Renderer 的共享入口按固定顺序执行：

1. `JSON.parse` 读取 candidate；
2. 运行该 diagram type 的 JSON Schema validator；
3. 校验 guided view 跨集合引用、relationship ID 唯一性和可选 engineering profile；
4. 可选验证 revision-pinned repository evidence；
5. 读取同一个 HTML template，交给具体 renderer。

源码路径见 [`loadDiagram`](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/cli.mjs#L16-L47)；跨集合 guided view 和 relationship ID 检查见 [L72-L146](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/cli.mjs#L72-L146)。

Schema 在开发时由 AJV 2020 以 `strict: true`、`allErrors: true` 编译成 standalone ESM validator，生成物随 Skill 一起发布，因此用户运行时不需要 npm 或网络依赖。[生成源码](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/scripts/generate-validators.mjs#L1-L27) [无运行时依赖的生成门](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/scripts/generate-validators.mjs#L43-L65)

具体 renderer 再做 JSON Schema 不适合表达的语义和几何检查。Architecture renderer 会检查 ID 唯一、grid/free placement、有限坐标、viewBox、文本可读性、节点间距、boundary 引用和 route 几何，然后才生成 SVG。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/architecture/render-architecture.mjs#L332-L604)

最后，`validate` 不是只检查 JSON：它先在临时目录渲染 HTML，再运行最终 artifact checker；成功才输出包含 checks 和 composition 的 JSON receipt。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/bin/archify.mjs#L1810-L1931) Artifact checker 会检查单一 SVG、非有限值、正交箭头、关系交叉、共享走廊、边界贴线、route rhythm、label-route clearance、legend clearance 和桌面可读性。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/scripts/check-render-output.mjs#L62-L276)

### 2. 错误不是自由文本，而是模型可消费的 repair receipt

Schema error 会被转换为：

```json
{
  "code": "schema/additionalProperties",
  "severity": "error",
  "message": "...",
  "subject": {
    "diagramType": "architecture",
    "path": "/components/3",
    "identity": "api"
  },
  "evidence": {
    "keyword": "additionalProperties",
    "additionalProperty": "colour"
  },
  "supportedFixes": [
    "remove unsupported property \"colour\""
  ]
}
```

这类结构由 validator 显式组装；它还会把数组路径旁边最近的 `id`/`label` 注入 identity，方便模型精准定位对象。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/validator.mjs#L4-L35) `code`、`subject`、`evidence`、`supportedFixes` 的映射见 [L38-L84](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/validator.mjs#L38-L84)。JSON 语法错误和不可读输入也会被统一转换成 `input/json-parse`、`input/read` 诊断，而不是把原始 Node stack 当成修复提示。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/diagnostics.mjs#L69-L127)

### 3. Repair loop 是 Skill 驱动的，不是 renderer 偷偷改 JSON

`SKILL.md` 要求每次 candidate 编辑后和交付前都运行：

```bash
node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json
```

通过后 candidate 冻结，不得再编辑；失败时只改诊断给出的 `subject`，核对 `evidence`，只能从 `supportedFixes` 选择，并重新验证。如果连续两轮都没有降低历史最优错误数，就停止并如实报告。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/SKILL.md#L22-L35)

几何修复还有额外约束：先修 schema，再修节点，再修穿越/方向，再修 crossing/corridor/rhythm，最后修 label clearance；一次只应用一个被诊断出的 geometry control。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/references/authoring-contract.md#L114-L146)

因此，Archify 本身没有“自动调用第二个模型修 JSON”。同一个外部 Agent 在工具循环里读机器 receipt 并做局部修改；CLI 只负责验证和报告。

## 三、JSON 怎样变成可交互 HTML

### 1. 语义 IR 确定性编译为 inline SVG

Architecture renderer 通过共享入口拿到已验证的 diagram 和 template，建立组件、边界与连接布局，做机械校验，然后按固定 z-order 输出 boundary、connection、component、label、legend 的 inline SVG。[入口](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/architecture/render-architecture.mjs#L52-L60) [SVG 生成与写入](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/architecture/render-architecture.mjs#L1037-L1078)

Renderer 不再问模型如何画 SVG；节点形状、配色语义、箭头、legend 和 DOM data attributes 都由代码生成。模型提供的是有类型的语义和受控布局参数。

### 2. SVG、cards 和只读数据嵌入同一 HTML template

共享 `writeDiagram` 把 title、subtitle、SVG、cards、locale、preset、views 和 source evidence 交给 `applyTemplate` 并写出 standalone HTML。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/cli.mjs#L50-L70)

`applyTemplate` 使用固定 sentinel 替换 SVG/cards 槽位；用户字符串经过 HTML escape，嵌入 `<script type="application/json">` 的 JSON 会把 `<`、`>`、`&` 转义，避免 authored data 破坏脚本边界。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/utils.mjs#L89-L182)

生成 HTML 自带 theme、pan/zoom、search、focus、relationship tracing、semantic views、presentation 和 export；这些是统一 Viewer Runtime 的读者能力，不是模型每张图重新生成的 JS。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/SKILL.md#L118-L122)

### 3. Deliver 冻结输入并原子替换最终文件

`deliver` 的路径是：

1. 读取并解析原始 JSON bytes；
2. 在目标同目录建立 staging directory；
3. 把 exact specification bytes 冻结为 snapshot；
4. 从 snapshot 渲染 candidate HTML；
5. 运行最终 artifact checks；
6. 生成 specification/artifact SHA-256 和 validation receipt；
7. 全部通过后才 `rename` candidate 覆盖目标。

失败不会碰现有 last-good artifact。[准备和冻结](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/bin/archify.mjs#L750-L892) [渲染、检查、receipt 与原子 commit](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/bin/archify.mjs#L893-L1078)

整条链可以概括为：

```text
用户问题
  ↓
外部 Agent 加载 SKILL.md
  ↓  类型路由
读取 1 个 mode schema + common schema + 1 个同型示例
  ↓
写 candidate.json
  ↓
JSON.parse → AJV strict schema → 跨集合事实 → renderer 几何 → 临时 HTML artifact checks
  ↘ 失败：diagnostics[{code, subject, evidence, supportedFixes}] → Agent 局部修复 ↗
  ↓ 通过并冻结
确定性 SVG renderer → 统一 Viewer template
  ↓
同目录 snapshot/check/hash/atomic rename
  ↓
自包含可交互 HTML
```

## 四、它没有使用什么

### 没有内置模型 Provider 或模型 SDK

固定提交的 `package.json` 只有 AJV、HTML/XML parser 和图标相关开发依赖，没有 OpenAI、Anthropic、Vercel AI SDK 或类似 provider SDK。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/package.json#L1-L36)

官方 benchmark 更明确：harness 故意不启动 model provider；外部 runner 负责认证、模型选择、timeout、prompt delivery 和原始 transcript，Archify 只保留确定性 artifact checks。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/benchmarks/ordinary-model-floor/README.md#L25-L34)

在该固定提交的官方源码中也未发现 `response_format` 或 OpenAI Structured Outputs 调用。因此，“模型输出 JSON”发生在外部 Agent 的文件写入工具中，不是 Archify 自己通过 API 强制模型直接返回符合 schema 的 response body。这一点是对固定提交源码的检索结论，不应外推到非官方 WebUI 或未来版本。

### 没有从 Markdown 代码块里宽松抽取 JSON

正式路径直接 `JSON.parse` candidate 文件，语法错就 fail closed 并返回 `input/json-parse`；没有从模型 prose 中猜测 JSON 边界、去代码围栏或容忍 JSON5。[解析入口](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/cli.mjs#L16-L28) [语法错误诊断](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/archify/renderers/shared/diagnostics.mjs#L69-L89)

### 没有把语义正确性等同于 schema 正确

官方 benchmark 把第一遍可用拆成三道独立门：领域语义和连接正确、真实 CLI `showcase` validation 通过、具名 reviewer 视觉检查通过。只要语义错、机械校验错或没有视觉审查都不算通过。[来源](https://github.com/tt-a1i/archify/blob/199360cc6687a7857b54dd188d4922b09e466a4b/benchmarks/ordinary-model-floor/README.md#L1-L17)

## 五、对烛帷可借鉴的部分（推断）

以下是基于上述源码事实的设计推断，不是 Archify 自己对烛帷的建议：

1. **把模型合同分成“领域任务 prompt”和“小型 typed IR”两层。** 用户/上游 prompt 只表达目标、事实、权限和未知项处理；结构字段由一个按任务类型路由的小 schema 负责，不在 system prompt 里重复维护一份字段说明。
2. **让模型写 proposal artifact，而不是直接写可执行 HTML 或权威状态。** 对烛帷而言，这个 artifact 只能是来自已授权 Viewer 投影的呈现/编排提案；Rules 与 Room Authority 仍决定机械和正史，避免 JSON 成为第二权威。
3. **错误返回稳定的 `code + subject + evidence + supportedFixes`。** 这比“JSON 不合法，请重试”更适合让模型只修一个字段或一条关系，也便于记录 correction trace。
4. **把 schema、跨字段/跨集合不变量、确定性编译和最终 artifact 检查分层。** JSON Schema 只管形状；服务端规则管引用、权限、秘密和机械；compiler 管输出；最终门管 HTML/投影是否安全、完整、可交互。
5. **采用有界修复而不是无限 regeneration。** 保留上一次合法 artifact；只有诊断收敛时继续，连续不改善则停止并暴露真实错误。
6. **交付绑定 exact input bytes 与 output hash。** 这适合为某次 KP proposal、Observer presentation 或调试工件建立可核验的输入—输出关系，但不应把呈现工件的 hash 误当成世界状态权威。

最需要警惕的是：Archify 的 architecture 布局仍很依赖模型判断，而官方基准已经证明普通模型首遍并不稳定；若烛帷借鉴，应优先借 strict IR、确定性 gate 和 diagnostic loop，不要把可靠性归因于 prompt 文案本身。

## 一句话回答用户的问题

Archify 对大模型的要求可以压缩为：**先按问题选一种小型图 IR，只读该 IR 的 schema/common/example，立即写 JSON 文件；字段不得发明、事实不得从示例复制；每次修改都交给本地 strict validator，失败只按结构化诊断修指定 subject，最终由确定性 renderer 和原子交付门把通过的 JSON 编译成统一可交互 HTML。**
