export function groupConversationMessages(messages) {
  const grouped = [];
  let process = [];

  const flushProcess = () => {
    if (process.length > 0) {
      grouped.push({ type: "process", process });
      process = [];
    }
  };

  for (const message of messages ?? []) {
    if (message?.role === "assistant" && message.phase === "commentary") {
      process.push(message);
      continue;
    }
    if (message?.role === "user") {
      flushProcess();
      grouped.push({ type: "message", message, process: [] });
      continue;
    }
    if (message?.role === "assistant") {
      grouped.push({ type: "message", message, process });
      process = [];
    }
  }

  flushProcess();
  return grouped;
}
