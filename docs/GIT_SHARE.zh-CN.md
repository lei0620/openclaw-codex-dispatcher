# 如何分享到 Git

## 先确认不能公开的文件

这些文件已经在 `.gitignore` 里，不要手动强行添加：

- `config/dispatcher.config.json`
- `config/agent.local.config.json`
- `.env`
- `docker-compose.yml`
- `logs/`
- `data/`
- `release/`
- `node_modules/`

## 第一次创建仓库

在项目目录运行：

```powershell
git init
git status
git add .
git status
git commit -m "Initial OpenClaw Codex dispatcher"
```

提交前看一眼 `git status`，确认没有 `config/dispatcher.config.json`。

## 推送到 GitHub

先在 GitHub 新建一个空仓库，然后运行：

```powershell
git remote add origin git@github.com:你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

如果你不用 SSH，也可以把 remote 换成 HTTPS 地址。

## 分享给别人

别人拿到后：

```powershell
git clone <仓库地址>
cd openclaw-codex-dispatcher
npm install
```

然后按 [小白快速安装](QUICKSTART.zh-CN.md) 继续。

## 生成 zip 分享包

如果只是发源码 zip，不想让别人接触你的本机运行文件，请运行：

```powershell
npm run package:share
```

把 `release/openclaw-codex-dispatcher-source.zip` 发给别人即可。
