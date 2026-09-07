# Round 59：冻结原审核请求的拒绝原因确认

2026-09-07。仅一次诊断请求，复用round58原PublicReceipt、Frozen Claims/context及成功生成正文，未修改措辞、模型或审核材料。离线重建的generation request与原capture完全一致；审核input文件SHA `8aed79a9a66d361beb03cd53b9e42ccfaf2d2035f656e440aafc097f515e35e1`，Provider body文件SHA `b1ef7d14c77fdf2d3b136ab7c4b6dcbe94789bbd8310403ad286ed47cccd5770`。原始round58未保留审核HTTP错误，本次结果不回填为它的原响应。

沿现役createDeepSeekStrictToolBinding及同一默认deepseek-v4-flash发送，私有fetcher只记录请求体和HTTP响应，不记录认证header。实际HTTP400：`invalid_request_error`，message为 **An object with no properties is not allowed.** 审核schema中唯一空对象为resultChecks；该知识回顾的mechanicalResults为空，没有空enum。现役本地strict校验接受该请求，故这是已确认的接口兼容缺口。

预设1调用、58000输入/8192输出、60秒、¥0.25；真实请求1次，0 Room提交、0骰子/资源、0旁白发布，原审核文件SHA保持。错误响应无usage，未将token预留计为实耗，未假定账单为零。命令 `npx tsx /tmp/zhuwei-round59-diagnostic.mjs` 退出0，报告和HTTP原文保存在 `/tmp/zhuwei-round59-private/`，权限0700/0600。

拟修复：冻结机械结果为空时省去resultChecks；非空仍逐组检查真实机械结果。唯一供应商schema校验器提前拒绝空properties，保留位置和原因；服务请求拒绝不再误报正文填表失败。修复后另开真实正常Room批次；本次不代表旁白恢复或NPC到期成功。未部署或push。
