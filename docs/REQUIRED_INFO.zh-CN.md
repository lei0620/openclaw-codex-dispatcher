# 需要提前准备和确认的信息

安装前先准备这些信息。不会填的地方可以先用默认值。

## NAS 侧

- NAS 局域网 IP：例如 `192.168.101.8`
- 面板端口：推荐 `1314`
- 是否使用 Tailscale：推荐使用，外网访问更安全
- Tailscale 名字：例如 `openclaw-nas`，没有也可以先用 NAS IP
- NAS 是否有 Docker：需要能运行 `docker compose`

## Win11 侧

- Node.js 是否安装：需要 `node` 和 `npm`
- Codex CLI 是否能用：建议先在 Win11 终端里确认 Codex 可以登录和运行
- 项目根目录：例如 `D:\aixm`
- OpenClaw Codex 源码目录：例如 `D:\aixm\openclaw`

## Token

脚本会自动生成两个 token：

- `dispatcherToken`：手机网页访问密码
- `agentToken`：Win11 执行端连接 NAS 的密码

这两个值不要发到 GitHub、群聊或公开网页。

## 项目白名单

第一版推荐只开放一个项目根目录，例如：

```text
D:\aixm
```

系统会把这个目录下的一层子文件夹显示成项目。不要把整个 C 盘或用户目录开放给 Codex。
