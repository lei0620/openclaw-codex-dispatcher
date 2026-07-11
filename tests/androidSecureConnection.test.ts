import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android SecureConnection plugin", () => {
  const pluginPath = "android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionPlugin.java";
  const storePath = "android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionStore.java";

  it("registers the native secure connection plugin", () => {
    const activity = fs.readFileSync("android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java", "utf8");

    expect(activity).toContain("registerPlugin(SecureConnectionPlugin.class)");
  });

  it("encrypts dispatcher credentials with AndroidKeyStore AES-GCM", () => {
    const plugin = fs.readFileSync(pluginPath, "utf8");
    const source = fs.readFileSync(storePath, "utf8");

    expect(plugin).toContain('@CapacitorPlugin(name = "SecureConnection")');
    expect(plugin).toContain("SecureConnectionStore.load(getContext())");
    expect(plugin).toContain("SecureConnectionStore.save(getContext(), token, apiBase)");
    expect(source).toContain('KeyStore.getInstance("AndroidKeyStore")');
    expect(source).toContain('KeyGenerator.getInstance("AES", "AndroidKeyStore")');
    expect(source).toContain('Cipher.getInstance("AES/GCM/NoPadding")');
    expect(source).toContain('getSharedPreferences(PREFS, Context.MODE_PRIVATE)');
    expect(source).toContain('editor.putString(KEY_TOKEN, encrypt(');
    expect(plugin).toContain('@PluginMethod\n    public void load');
    expect(plugin).toContain('@PluginMethod\n    public void save');
    expect(`${plugin}\n${source}`).not.toContain("Log.");
    expect(`${plugin}\n${source}`).not.toContain("System.out");
    expect((`${plugin}\n${source}`.match(/openclaw_dispatcher_connection_key/g) ?? [])).toHaveLength(1);
  });

  it("refreshes an enabled background connection after credentials change", () => {
    const plugin = fs.readFileSync(pluginPath, "utf8");

    expect(plugin).toContain("BackgroundRealtimeService.refreshIfEnabled(getContext())");
    expect(plugin).toContain("BackgroundRealtimeService.setEnabled(getContext(), false)");
    expect(plugin).toContain("BackgroundRealtimeService.stop(getContext())");
  });
});
