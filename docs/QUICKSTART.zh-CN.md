# 小白快速安装

目标效果：手机访问一个网页，选择项目，然后像聊天一样让 Win11 上的 Codex 做事。

## 1. 准备

你需要：

- 一台飞牛 NAS
- 一台 Win11 电脑
- 手机浏览器
- Node.js：安装在 Win11 上
- Docker：安装在 NAS 上
- Codex CLI：安装并登录在 Win11 上
- Tailscale：可选，但推荐用于外网访问

## 2. 在 NAS 上启动面板

把源码放到 NAS 的某个目录后，进入目录：

```bash
cd openclaw-codex-dispatcher
bash scripts/setup-nas-docker.sh
```

按提示填写：

- 面板端口：建议 `1314`
- 手机访问地址：局域网可填 `http://NAS-IP:1314`，Tailscale 可填 `http://设备名:1314`
- Win11 项目根目录：默认 `D:/aixm`

脚本结束后会显示：

- 手机访问地址
- 网页访问密码
- Win11 agent token

请把 `agent token` 留给下一步使用。

## 3. 在 Win11 上启动执行端

在 Win11 的源码目录里运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows-agent.ps1
```

按提示填写：

- NAS 地址：例如 `http://192.168.101.8:1314`
- agent token：复制 NAS 脚本输出的值
- 项目根目录：例如 `D:\aixm`

看到 `agent accepted` 或 `reported ... discovered projects`，说明 Win11 已经连上 NAS。

## 4. 手机访问

局域网内：

```text
http://NAS-IP:1314
```

Tailscale 内：

```text
http://Tailscale设备名:1314
```

第一次打开会要求输入访问密码，也就是 `dispatcherToken`。

## 5. 第一次测试

建议先选择：

```text
只测试连接
```

输入：

```text
测试 Win11 是否能收到任务
```

如果成功，再切换到：

```text
正式让 Codex 执行
```

## 常见问题

- 手机打不开：先确认手机和 NAS 在同一局域网，或手机 Tailscale 已连接。
- Win11 不在线：检查 Win11 脚本里的 NAS 地址和 agent token。
- Codex 执行失败：先在 Win11 终端单独运行 Codex，确认已登录。
- 不要开放公网端口：推荐用 Tailscale，不推荐路由器端口映射。
