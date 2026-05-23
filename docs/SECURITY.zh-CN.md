# 安全说明

这个项目会让手机远程触发 Win11 上的 Codex，所以要守住边界。

## 不要公开这些文件

- `config/dispatcher.config.json`
- `config/agent.local.config.json`
- `.env`
- `logs/`
- `data/`

这些文件可能包含真实 token、运行日志或任务内容。

## 推荐网络方式

推荐：

```text
Tailscale / VPN
```

不推荐：

```text
路由器公网端口映射
```

原因是当前面板只是轻量 token 保护，没有完整的公网登录限流、HTTPS 证书和审计系统。

## 项目目录范围

建议只允许：

```text
D:\aixm
```

不要允许：

```text
C:\
D:\
你的整个用户目录
```

Codex 应该只处理代码项目，不应该拿到整台电脑的文件权限。

## Token 建议

- 每个人自己生成 token
- 不要把 token 上传 GitHub
- 如果怀疑泄露，重新运行 NAS 配置脚本生成新 token

## 分享源码前

运行：

```powershell
npm run package:share
```

不要手动压缩整个工作目录。
