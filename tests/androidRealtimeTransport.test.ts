import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android foreground realtime transport", () => {
  it("allows the HTTPS Capacitor page to connect to trusted LAN and VPN ws endpoints", () => {
    const config = fs.readFileSync("capacitor.config.ts", "utf8");
    const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

    expect(config).toContain("allowMixedContent: true");
    expect(manifest).toContain('android:usesCleartextTraffic="true"');
  });
});
