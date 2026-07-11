export function buildDiagnosticsSnapshot(input) {
  const agent = input.agents?.find((item) => item.online) ?? input.agents?.[0];
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appVersion: input.appVersion ?? "unknown",
    apiBase: input.apiBase ?? "",
    nas: {
      reachable: input.health?.services?.nas?.reachable === true,
      latencyMs: Number.isFinite(input.latencyMs) ? input.latencyMs : null,
      realtimeState: input.realtimeState ?? "unknown",
      lastEventId: Number.isInteger(input.lastEventId) ? input.lastEventId : null
    },
    agent: agent ? {
      id: agent.id,
      online: agent.online === true,
      lastSeenAt: agent.lastSeenAt ?? agent.updatedAt ?? null,
      codexPhase: agent.codex?.phase ?? "unknown",
      codexReady: agent.codex?.ready === true,
      latestError: agent.codex?.error ?? null
    } : null,
    codex: {
      ready: input.health?.services?.codex?.ready > 0 || agent?.codex?.ready === true,
      windowCount: input.codexWindows?.length ?? 0
    },
    conversation: input.conversation ? {
      id: input.conversation.id,
      projectId: input.conversation.projectId,
      threadId: input.conversation.codexSessionId ?? null,
      refreshWindowId: input.conversation.refreshWindowId ?? null
    } : null,
    pendingApprovals: input.pendingApprovals ?? 0,
    activeTasks: input.activeTasks ?? 0,
    latestError: input.latestError ?? null
  };
}

export function formatSanitizedDiagnostics(snapshot) {
  return sanitizeDiagnosticText(JSON.stringify(redactSensitiveFields(snapshot), null, 2));
}

export function sanitizeDiagnosticText(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, "$1[已隐藏]")
    .replace(/(bearer\s+)[^\s"',}]+/gi, "$1[已隐藏]")
    .replace(/\b(password|token|secret|webdav(?:password|token)?)(\s*[:=]\s*)([^\s,"'}]+)/gi, "$1$2[已隐藏]")
    .replace(/\b[a-f0-9]{32,128}\b/gi, "[已隐藏]");
}

function redactSensitiveFields(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeDiagnosticText(value) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/^(?:authorization|password|token|secret|webdav)/i.test(key)) {
      return [key, "[已隐藏]"];
    }
    return [key, redactSensitiveFields(item)];
  }));
}
