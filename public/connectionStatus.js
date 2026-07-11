export function deriveConnectionStatus({ nasReachable, onlineAgents, readyCodex }) {
  if (!nasReachable) {
    return { level: "offline", label: "未连接", detail: "无法连接 NAS" };
  }
  if (onlineAgents < 1) {
    return { level: "recovering", label: "等待电脑", detail: "NAS 已连接，电脑代理未上线" };
  }
  if (readyCodex < 1) {
    return { level: "recovering", label: "恢复中", detail: "电脑在线，Codex 服务正在恢复" };
  }
  return { level: "online", label: "已连接", detail: "NAS、电脑和 Codex 均可用" };
}
