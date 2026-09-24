# 安全策略

## 报告漏洞

**请不要用公开 issue 报告安全漏洞。** 使用 GitHub 的私有漏洞报告
（Security 标签页 → Report a vulnerability），或参阅引擎仓库
[mammoth 的安全基线](https://github.com/3th1nk/mammoth/blob/main/docs/security-baseline.md)
了解整体安全模型。

## 安全模型要点（console 视角）

- console 是纯静态 SPA + 伴生 Caddy 反代，**无后端、无用户体系**：引擎的
  单一静态 token 即管理员权限（kubectl kubeconfig 同款信任模型），token
  保存在浏览器 localStorage,不落任何服务器。
- webhook 签名密钥只在订阅创建响应中出现一次；引擎对每次投递做
  HMAC-SHA256 签名，接收方应重算校验（见事件页的"Webhooks 订阅"说明）。
- 引擎侧的配置/凭证/网络安全基线（HTTPS 终止、主密钥轮换、token 生成）
  见引擎仓库 `docs/security-baseline.md`——console 不重复该面。
