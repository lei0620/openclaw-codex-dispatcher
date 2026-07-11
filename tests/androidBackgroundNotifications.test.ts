import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android background realtime notifications", () => {
  const servicePath = "android/app/src/main/java/com/aixm/openclawcodex/BackgroundRealtimeService.java";
  const pluginPath = "android/app/src/main/java/com/aixm/openclawcodex/BackgroundNotificationsPlugin.java";

  it("declares a remoteMessaging foreground service with required permissions", () => {
    const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING");
    expect(manifest).toContain('android:name=".BackgroundRealtimeService"');
    expect(manifest).toContain('android:foregroundServiceType="remoteMessaging"');
  });

  it("uses an authenticated native websocket with an independent replay cursor", () => {
    const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
    const source = fs.readFileSync(servicePath, "utf8");

    expect(gradle).toContain('com.squareup.okhttp3:okhttp:4.12.0');
    expect(source).toContain("newWebSocket");
    expect(source).toContain('put("type", "client.hello")');
    expect(source).toContain('put("token", settings.token)');
    expect(source).toContain('put("clientId", "android-background:');
    expect(source).toContain("KEY_LAST_EVENT_ID");
    expect(source).toContain("socket.send");
    expect(source).toContain("START_STICKY");
    expect(source).toContain("RECONNECT_DELAYS_MS = { 1000, 2000, 5000, 10000, 30000 }");
    expect(source).not.toMatch(/new Request\.Builder\(\).*token/);
  });

  it("only notifies and never mutates a Codex task", () => {
    const source = fs.readFileSync(servicePath, "utf8");

    expect(source).toContain('"approval.requested"');
    expect(source).toContain('"task.updated"');
    expect(source).toContain("AppVisibility.isForeground()");
    expect(source).toContain("startForeground");
    expect(source).not.toContain("/api/tasks");
    expect(source).not.toContain("/approve");
    expect(source).not.toContain("/deny");
    expect(source).not.toContain("Authorization");
  });

  it("requests notification permission only from an explicit enable call", () => {
    const plugin = fs.readFileSync(pluginPath, "utf8");
    const activity = fs.readFileSync(
      "android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java",
      "utf8"
    );

    expect(plugin).toMatch(/@CapacitorPlugin\([\s\S]*name = "BackgroundNotifications"/);
    expect(plugin).toContain('alias = "notifications"');
    expect(plugin).toContain("Manifest.permission.POST_NOTIFICATIONS");
    expect(plugin).toContain("public void enable(PluginCall call)");
    expect(plugin).toContain('requestPermissionForAlias("notifications"');
    expect(plugin).toContain("@PermissionCallback");
    expect(plugin).toContain("BackgroundRealtimeService.setEnabled(getContext(), true)");
    expect(plugin).toContain("public void disable(PluginCall call)");
    expect(plugin).toContain("BackgroundRealtimeService.setEnabled(getContext(), false)");
    expect(activity).toContain("registerPlugin(BackgroundNotificationsPlugin.class)");
  });

  it("restores an enabled service after boot or an app update", () => {
    const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    const receiver = fs.readFileSync(
      "android/app/src/main/java/com/aixm/openclawcodex/BootCompletedReceiver.java",
      "utf8"
    );

    expect(manifest).toContain("android.permission.RECEIVE_BOOT_COMPLETED");
    expect(manifest).toContain('android:name=".BootCompletedReceiver"');
    expect(manifest).toContain("android.intent.action.BOOT_COMPLETED");
    expect(manifest).toContain("android.intent.action.MY_PACKAGE_REPLACED");
    expect(receiver).toContain("BackgroundRealtimeService.isEnabled(context)");
    expect(receiver).toContain("BackgroundRealtimeService.start(context)");
  });
});
