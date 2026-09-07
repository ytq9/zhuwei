# vNext round33：修订审核填写面后的真实行动链

2026-09-06，cloudflare / 258caee404e0814405eb497653ee9f00d647b773 未提交开发树。本批运行时 Proposal parser v20、旁白审核 v6，精确源码见 [manifest](vnext-round33-source-manifest.json)，不将其改写为后续开发树。模型保持 deepseek-v4-flash 和本批 thinking 配置，不清洗输出或增加修订调用。隔离副本中的 social 修复尚未集成，本批期间不修改运行源码。

本批从新 Cookie、新房、正常建卡/开团与 `/api/game` 开始。先按真实库存完成普通操作，再从已公开材料继续一次需要组合能力的行动；若没有实际触发 schema 补取，则复杂补取记为未覆盖。另行检查原 submission 幂等、Viewer 正文、资源/时间与完整 replay。动态地点/通路能力差量保持未完成，不以此次库存操作外推其通过。

预设最多2个新行动、10次实际模型调用、580,000输入及81,920输出tokens、10分钟、开发费上限¥2.50；每次可能调用模型的HTTP预留5次调用及120秒，未知usage按上限占预算。首个明确失败立即停批、保留原响应并定位，不重复采样挑成功；合法待决保留原root并以原冻结答案继续，不开新意图替代。

调用前重新核验[DeepSeek价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，页面SHA256 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`：周日空闲每百万命中输入/其他输入/输出¥0.05/1.5/4.5，高峰为双倍；按全未命中高峰估算本批最坏¥2.47728。首次抓取收到302后跟随官方重定向取得正文，不将重定向页当价格证据。

前置定向验证：审核v6保留原文覆盖、必需事实、同Claim证据及显式遗漏合同，把事实覆盖就近放在断言中，服务端构造反向关系。原失败示例离线拒绝不改判。新填写面先红0/1，目标文件31/31通过；typecheck首次发现schema构造器泛型信息丢失，补齐纯类型声明后exit0。独立只读审查未见约束弱化，均非真实稳定性结论。

私有session/capture/SQLite提取位于 `/tmp/zhuwei-vnext-round33*`，文件600、目录700；4320/4321启动前无监听。已发生调用的结果与结账如下。

首个真实动作“从背包取出一根未点燃火把放在脚边”已提交唯一 InventoryOperationApplied 和1 Receipt；Proposal 3,105ms、生成1,361ms，审核再次超时。原旁白未发布，批次停止且没有第二行动。两个服务已停止，原状态精确replay，冻结Viewer上下文conformance通过。此结果仍是主链失败，不能因为库存生效改判完整成功。

为区分当前审核在简单与复杂正文都出现的延迟，只追加一次不提交/不发布的配置对照：重用这次持久冻结材料与原生成正文，唯一改变是review thinking=disabled（移除仅enabled适用的reasoning_effort），同一v6 schema、模型、messages与8,192输出上限。45秒、12,000输入预留，计入本批10次调用、总token和¥2.50上限；无自动重试。对照不能改变原行动结果，不能单独证明稳定性。收取结果后显式合并私有HTTP账本未统计的这一次调用。

## 唯一对照与最终结果

对照于2026-09-06 20:58:13.420（Asia/Shanghai）发起，私有capture记录 `status=failed`、`durationMs=45008`、`error=23`，没有response、finish reason或usage。脚本绑定45秒 `AbortSignal.timeout`，此记录支持对照在该时限失败；不能据此推断服务端内部原因、输出内容或零费用。输入估算5,348是预算估算，不是实际usage。脚本在发送前核对原生成材料与持久冻结projection一致，并断言除thinking及其适用的reasoning_effort外请求一致；收尾没有重发或重新生成正文。

对照请求hash `17bb9839e1093973ab0416802b3689b3f153cc5d1576b1a376d9e10e510be7fe`，原配置请求hash `937d2727431e956e6d9c0db3c91e7765948a96c20d70aaf3864779bb9b91af88`，原候选正文hash `13c17a9ec3881933c8cd8ef3e3866b3ef5ae4397c9f68689240be095798b0dae`。未发布正文为“你从背包取出一根火把，没有点燃，直接放在了脚边。”；不存在通过的审核结果，不能以正文生成成功宣称完整行动成功。

原HTTP结果仍为 `outcomeKind=committed / action=committed / narration=retryableFailure / NARRATION_PROVIDER_TIMEOUT`。原审核使用剩余43,639ms后超时，disabled-thinking对照也在45秒内未完成。两次失败不足以证明具体思考模式或服务端根因；本批没有完成旁白恢复、原submission重复提交、第二行动或复杂schema补取。

## 库存、时间与replay证据

同一原始SQLite提取重新经过现役 `Rules.replay`，`node --import tsx /tmp/zhuwei-vnext-round33-replay.mts` exit 0：当前state精确一致，唯一事件是 `InventoryOperationApplied`，唯一Receipt；操作为 `release / placement / quantity=1`。行动者持有火把10→9，同场景新增地面entry数量1，合计仍为10。源entry除quantity外不变，地面entry保留定义、可用状态及所有者；其余itemSystem完全不变。角色loadout与combat中的库存镜像均只对应10→9，其他角色状态、战斗状态及非库存资源不变。虚构时间仍为0，待决输入、内部续行与随机状态均未变化，没有随机事件。一个冻结受众的context conformance通过。

收尾修正的是临时replay脚本的证据标签：旧脚本把 `Inventory` 事件也纳入随机判断，故错误输出 `randomnessAbsent=false`；又比较整个entities/combatRuntime，正常库存变动便使 `resourcesAndTimeUnchanged=false`。新证据分别检查预期库存变化及守恒、非库存资源、时间、随机与续行，不把“全部状态未变”当作成功标准。临时脚本首次加强断言时将combat数值字符串误按number比较，修正该脚本类型比较后通过；原事件、源码与权威数据未修改。抽查用于replay的115个Rules/runtime-policy/narration-context文件均与本批manifest hash一致。

单次事件/Receipt及精确replay证明本次已提交数量正确，不等同于真实重复HTTP请求幂等测试；该路径未执行。前置审核v6的31/31及typecheck exit 0仅证明本地目标合同，日志为 `/tmp/zhuwei-review-v6-node.log`、`/tmp/zhuwei-review-v6-types-final.log`；两者没有新增真实调用，也不证明审核时延或完整主链通过。

## 开发费用结账

| 已发生调用 | 输入 | 命中 | 未命中 | 输出 | 周日空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Proposal | 26,077 | 8,320 | 17,757 | 495 | ¥0.029279 |
| 旁白生成 | 1,808 | 0 | 1,808 | 69 | ¥0.0030225 |
| 原旁白审核超时 | 未返回usage | 未知 | 未知 | 未知 | 未知 |
| 唯一disabled-thinking审核对照 | 未返回usage | 未知 | 未知 | 未知 | 未知 |
| 本批已知合计 | 27,885 | 8,320 | 19,565 | 564 | ¥0.0323015 |

最终4次尝试、2次已知usage、2次未知费用。旁白生成中的47个reasoning tokens已包含在69个completion tokens中，不重复计价。私有session meter记录原HTTP的3次；本表从独立对照capture另计第4次，未改私有账本。按本批抓取的官方周日价格用Decimal复算；收尾只核对本地价格文件hash，没有新增API调用、模型请求或批次。

脱敏统计、调用及产物hash、修正后的replay标签见[真实证据](vnext-round33-live-evidence.json)，累计见[成本账](vnext-cost-estimate.md)。本批关闭为“机械提交、旁白审核未完成”的真实主链失败，不改判成功；无部署、push或远端数据修改。
