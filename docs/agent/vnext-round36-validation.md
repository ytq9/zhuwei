# vNext round36：单次strict审核候选对照

2026-09-06，cloudflare / 258caee404e0814405eb497653ee9f00d647b773 未提交开发树，复用[round34源码manifest](vnext-round34-source-manifest.json)。收尾重新核验305个源码文件，差异0；本批没有产品源码修改。

## 候选范围与预算

保留round33同一冻结Viewer材料、原生成正文、messages、`deepseek-v4-flash`、thinking及8,192输出上限，仅在临时脚本中改为beta strict工具transport与required tool choice。工具schema移除该方言不支持的数组长度/唯一性关键字，将 `minLength=1` 改成匹配非空字符串的pattern；本地完整 `validateNarrationReview` 保持不变。数组数量、唯一性等要求仍由原校验器执行，不宣称删去这些字段后的远端schema与原schema整体等义。

预设最多1次调用、12,000输入、8,192输出、45秒、开发费用上限¥0.11；无自动重试。输入估算5,352只用于预算。请求hash为 `f5bd2e7718642fd1bd818742f6b8d29ab90acef17fd4a2b47d9180a66544388b`，原请求hash仍为 `937d2727431e956e6d9c0db3c91e7765948a96c20d70aaf3864779bb9b91af88`，候选正文hash为 `13c17a9ec3881933c8cd8ef3e3866b3ef5ae4397c9f68689240be095798b0dae`。脚本发送前验证冻结材料和上述不变字段，不重跑Proposal、Rules或Room提交。

## 已完成结果

调用于2026-09-06 21:19:49.794（Asia/Shanghai）发起。247ms取得HTTP 400响应头，248ms保存 `status=failed / error=request_rejected`；严格binding按当前 `!response.ok` 分支抛错，未进入正文JSON解析或本地审核校验。服务端具体错误正文未保存，不能从HTTP 400或通用错误码推断是thinking、schema、tool choice、beta入口或其他具体原因。

两份传输记录需区分：最终结果内嵌快照为 `phase=headers / byteCount=0`；独立transport文件随后记录249ms首个正文chunk、累计146bytes。该后续记录只有计数，没有保留正文内容，不能据此恢复错误原因或usage，也不能写成“服务端完全没发正文”。

这次候选被服务端拒绝，**不可据此采用该候选或声称修复审核超时**；未接入产品源码，也不将本次结果外推为所有strict调用都不受支持。没有通过的review、旁白发布或新增Room事件。原round33行动仍是机械已提交、旁白未发布。本批已结束，不再追加对照调用。

## 用量与结账

本批1次尝试、0次已知usage、1次未知费用。HTTP 400不自动表示零费用，146bytes也不是模型tokens；实际输入、输出和费用保持未知。沿用同日已核验官方价格，但缺usage时不计算实际费用。round6–36累计71→72次尝试、仍64次已知usage，已知756,763输入/62,593输出、¥1.11689065–1.2310274，另有8次未知费用；详情见[成本账](vnext-cost-estimate.md)。

原始记录位于 `/tmp/zhuwei-review-strict-36.json`、`/tmp/zhuwei-review-strict-36-transport.json`、`.log`，临时脚本 `/tmp/zhuwei-review-strict-36.mts`；脱敏结果与hash见[真实证据](vnext-round36-live-evidence.json)。收尾只核对既有产物，没有新增API调用、产品源码修改、部署或push。官方thinking说明不提供本次400原因，不作为该原因的证据。
