# 内部授权工具

离线签名私钥默认保存在 `%LOCALAPPDATA%\商品生图助手授权管理\license-private-key.pem`，绝不能放进扩展目录、客户 ZIP、聊天记录或公开仓库。

Node 发码示例（推荐）：

```powershell
node .\generate-license.mjs "机器码" "2026-10-06T23:59:59+08:00" customer-001
```

脚本使用 Web Crypto 兼容的 P-256 / SHA-256 / IEEE-P1363 签名格式。若客户机器码不是 32 个十六进制字符分组，请先确认复制内容完整。

如需指定其他位置，可设置 `LICENSE_PRIVATE_KEY_PATH` 环境变量。私钥永远不要放入客户 ZIP。
