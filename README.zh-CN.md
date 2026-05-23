# OpenClaw Codex 遥控面板

这是一个“小白也能用”的 Codex 遥控桥接服务：飞牛 NAS 负责显示手机网页和任务队列，Win11 电脑负责真正运行 Codex CLI。

## 你能用它做什么

- 手机打开网页，像聊天一样给 Codex 发任务。
- 在左侧按项目和对话切换历史任务。
- Win11 主动连接 NAS，不需要在 Win11 开公网端口。
- 只允许 Codex 在你配置的项目目录里工作。
- 支持 Tailscale：人在外面也可以安全访问 NAS 面板。

## 最快开始

先看：

- [需要准备的信息](docs/REQUIRED_INFO.zh-CN.md)
- [小白快速安装](docs/QUICKSTART.zh-CN.md)
- [安全说明](docs/SECURITY.zh-CN.md)
- [Git 分享步骤](docs/GIT_SHARE.zh-CN.md)

如果你已经下载源码：

```powershell
npm install
```

飞牛 NAS 上运行：

```bash
bash scripts/setup-nas-docker.sh
```

Win11 上运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows-agent.ps1
```

脚本会提示你输入 NAS 地址、访问端口、token 和 Win11 项目根目录。

## 分享源码

不要直接压缩整个目录，因为里面可能有真实 token、日志和本地数据。请运行：

```powershell
npm run package:share
```

生成的 zip 会在 `release/` 目录里。
