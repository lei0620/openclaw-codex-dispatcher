import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android WebDAV updater", () => {
  it("fails manifest checks quickly while keeping a longer APK download timeout", () => {
    const source = fs.readFileSync(
      "android/app/src/main/java/com/aixm/openclawcodex/AndroidUpdaterPlugin.java",
      "utf8"
    );

    expect(source).toContain("MANIFEST_CONNECT_TIMEOUT_MS = 8000");
    expect(source).toContain("MANIFEST_READ_TIMEOUT_MS = 12000");
    expect(source).toContain("APK_READ_TIMEOUT_MS = 60000");
    expect(source).toContain("连接更新服务器超时，请检查网络后重试。");
    expect(source).toMatch(/openConnection\(\s*url,\s*credentials,\s*MANIFEST_CONNECT_TIMEOUT_MS,\s*MANIFEST_READ_TIMEOUT_MS\s*\)/);
    expect(source).toMatch(/openConnection\(\s*url,\s*credentials,\s*APK_CONNECT_TIMEOUT_MS,\s*APK_READ_TIMEOUT_MS\s*\)/);
  });
});
