import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android SecureConnection plugin", () => {
  const pluginPath = "android/app/src/main/java/com/aixm/openclawcodex/SecureConnectionPlugin.java";

  it("registers the native secure connection plugin", () => {
    const activity = fs.readFileSync("android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java", "utf8");

    expect(activity).toContain("registerPlugin(SecureConnectionPlugin.class)");
  });

  it("encrypts dispatcher credentials with AndroidKeyStore AES-GCM", () => {
    const source = fs.readFileSync(pluginPath, "utf8");

    expect(source).toContain('@CapacitorPlugin(name = "SecureConnection")');
    expect(source).toContain('KeyStore.getInstance("AndroidKeyStore")');
    expect(source).toContain('KeyGenerator.getInstance("AES", "AndroidKeyStore")');
    expect(source).toContain('Cipher.getInstance("AES/GCM/NoPadding")');
    expect(source).toContain('getSharedPreferences(PREFS, Context.MODE_PRIVATE)');
    expect(source).toContain('editor.putString(KEY_TOKEN, encrypt(token))');
    expect(source).toContain('@PluginMethod\n    public void load');
    expect(source).toContain('@PluginMethod\n    public void save');
    expect(source).not.toContain("Log.");
    expect(source).not.toContain("System.out");
  });
});
