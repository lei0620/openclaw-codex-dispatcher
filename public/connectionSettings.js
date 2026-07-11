const tokenKey = "openclawToken";
const apiBaseKey = "openclawApiBase";

export function createConnectionSettingsStore(options) {
  const storage = options.localStorage;
  const nativeStore = options.nativeStore;

  async function load() {
    if (!nativeStore) {
      return {
        token: storage.getItem(tokenKey) || "",
        apiBase: normalizeApiBase(storage.getItem(apiBaseKey) || options.defaultApiBase()),
        storage: "browser"
      };
    }

    const current = await nativeStore.load();
    const legacyToken = storage.getItem(tokenKey) || "";
    const legacyApiBase = storage.getItem(apiBaseKey) || "";
    const resolved = {
      token: current.token || legacyToken,
      apiBase: normalizeApiBase(current.apiBase || legacyApiBase || options.defaultApiBase())
    };
    const needsMigration = resolved.token !== (current.token || "") || resolved.apiBase !== normalizeApiBase(current.apiBase || "");
    if (needsMigration) {
      await nativeStore.save(resolved);
    }
    storage.removeItem(tokenKey);
    storage.removeItem(apiBaseKey);
    return { ...resolved, storage: "native" };
  }

  async function save(settings) {
    const normalized = {
      token: String(settings.token || ""),
      apiBase: normalizeApiBase(settings.apiBase || options.defaultApiBase())
    };
    if (nativeStore) {
      await nativeStore.save(normalized);
      storage.removeItem(tokenKey);
      storage.removeItem(apiBaseKey);
      return;
    }
    if (normalized.token) storage.setItem(tokenKey, normalized.token);
    else storage.removeItem(tokenKey);
    if (normalized.apiBase) storage.setItem(apiBaseKey, normalized.apiBase);
    else storage.removeItem(apiBaseKey);
  }

  return { load, save };
}

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}
