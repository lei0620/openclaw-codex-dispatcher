import { describe, expect, it, vi } from "vitest";
import { createConnectionSettingsStore } from "../public/connectionSettings.js";

describe("connection settings store", () => {
  it("loads credentials from the native secure store", async () => {
    const nativeStore = {
      load: vi.fn(async () => ({ token: "native-token", apiBase: "http://nas:1314" })),
      save: vi.fn(async () => undefined)
    };
    const storage = new MemoryStorage();
    const store = createConnectionSettingsStore({ nativeStore, localStorage: storage, defaultApiBase: () => "http://default" });

    await expect(store.load()).resolves.toEqual({ token: "native-token", apiBase: "http://nas:1314", storage: "native" });
    expect(nativeStore.save).not.toHaveBeenCalled();
  });

  it("migrates legacy WebView credentials once and removes plaintext after native save succeeds", async () => {
    const nativeStore = {
      load: vi.fn(async () => ({ token: "", apiBase: "" })),
      save: vi.fn(async () => undefined)
    };
    const storage = new MemoryStorage({ openclawToken: "legacy-token", openclawApiBase: "http://legacy:1314/" });
    const store = createConnectionSettingsStore({ nativeStore, localStorage: storage, defaultApiBase: () => "http://default" });

    await expect(store.load()).resolves.toEqual({ token: "legacy-token", apiBase: "http://legacy:1314", storage: "native" });
    expect(nativeStore.save).toHaveBeenCalledWith({ token: "legacy-token", apiBase: "http://legacy:1314" });
    expect(storage.getItem("openclawToken")).toBeNull();
    expect(storage.getItem("openclawApiBase")).toBeNull();
  });

  it("preserves legacy plaintext when native migration fails", async () => {
    const nativeStore = {
      load: vi.fn(async () => ({ token: "", apiBase: "" })),
      save: vi.fn(async () => { throw new Error("keystore unavailable"); })
    };
    const storage = new MemoryStorage({ openclawToken: "legacy-token", openclawApiBase: "http://legacy:1314" });
    const store = createConnectionSettingsStore({ nativeStore, localStorage: storage, defaultApiBase: () => "http://default" });

    await expect(store.load()).rejects.toThrow("keystore unavailable");
    expect(storage.getItem("openclawToken")).toBe("legacy-token");
    expect(storage.getItem("openclawApiBase")).toBe("http://legacy:1314");
  });

  it("uses localStorage only for the browser panel fallback", async () => {
    const storage = new MemoryStorage({ openclawToken: "browser-token" });
    const store = createConnectionSettingsStore({ localStorage: storage, defaultApiBase: () => "http://default:1314/" });

    await expect(store.load()).resolves.toEqual({ token: "browser-token", apiBase: "http://default:1314", storage: "browser" });
    await store.save({ token: "changed", apiBase: "http://other:1314/" });
    expect(storage.getItem("openclawToken")).toBe("changed");
    expect(storage.getItem("openclawApiBase")).toBe("http://other:1314");
  });

  it("saves Android changes natively and removes any stale WebView credentials", async () => {
    const nativeStore = { load: vi.fn(), save: vi.fn(async () => undefined) };
    const storage = new MemoryStorage({ openclawToken: "stale", openclawApiBase: "http://stale" });
    const store = createConnectionSettingsStore({ nativeStore, localStorage: storage, defaultApiBase: () => "http://default" });

    await store.save({ token: "secure", apiBase: "http://nas:1314/" });

    expect(nativeStore.save).toHaveBeenCalledWith({ token: "secure", apiBase: "http://nas:1314" });
    expect(storage.getItem("openclawToken")).toBeNull();
    expect(storage.getItem("openclawApiBase")).toBeNull();
  });
});

class MemoryStorage {
  private values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
