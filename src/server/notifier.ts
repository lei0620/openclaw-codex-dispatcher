import type { DispatcherConfig, TaskRecord } from "../shared/types.js";

export async function notifyTaskFinished(config: DispatcherConfig, task: TaskRecord): Promise<void> {
  const webhook = process.env.WECHAT_WEBHOOK_URL;
  if (!webhook || (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")) {
    return;
  }
  const url = `${config.server.publicBaseUrl}/?task=${encodeURIComponent(task.id)}`;
  const message = [
    `Codex 任务 ${task.status}`,
    `项目: ${task.projectId}`,
    `任务: ${task.prompt.slice(0, 120)}`,
    `详情: ${url}`
  ].join("\n");
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: message } })
    });
  } catch (error) {
    console.warn("wechat notification failed", error);
  }
}
