export function buildApiBaseCandidates(preferred, fallbacks = []) {
  const candidates = [];
  for (const [index, value] of [preferred, ...fallbacks].entries()) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (index === 0 && normalized === "") {
      candidates.push("");
      continue;
    }
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }
  return candidates;
}

export function isFailoverSafeRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return true;
  }
  if (method !== "POST" || url !== "/api/tasks") {
    return false;
  }
  try {
    const body = JSON.parse(String(options.body || "{}"));
    return Boolean(String(body.clientMessageId || "").trim());
  } catch {
    return false;
  }
}
