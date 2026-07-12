import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android full exit", () => {
  it("registers a native AppExit plugin that disables and stops background work", () => {
    const plugin = fs.readFileSync(
      "android/app/src/main/java/com/aixm/openclawcodex/AppExitPlugin.java",
      "utf8"
    );
    const activity = fs.readFileSync(
      "android/app/src/main/java/com/aixm/openclawcodex/MainActivity.java",
      "utf8"
    );

    expect(plugin).toContain('@CapacitorPlugin(name = "AppExit")');
    expect(plugin).toContain("public void exitCompletely(PluginCall call)");
    expect(plugin).toContain("BackgroundRealtimeService.setEnabled(getContext(), false)");
    expect(plugin).toContain("BackgroundRealtimeService.stop(getContext())");
    expect(plugin).toContain("finishAndRemoveTask()");
    expect(plugin).toContain("Process.killProcess(Process.myPid())");
    expect(activity).toContain("registerPlugin(AppExitPlugin.class)");
  });

  it("exposes a confirmed Android-only exit action beside the settings button", () => {
    const html = fs.readFileSync("public/index.html", "utf8");
    const js = fs.readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="full-exit"');
    expect(html).toContain('src="/icons/exit.png"');
    expect(html.indexOf('id="full-exit"')).toBeLessThan(html.indexOf('id="settings-open"'));
    expect(js).toContain("getAppExitPlugin");
    expect(js).toContain("initFullExitControl");
    expect(js).toContain('window.confirm("退出后将停止所有后台提醒和实时连接，确定彻底退出吗？")');
    expect(js).toContain("realtime?.stop()");
    expect(js).toContain("lifecycleRecovery?.stop()");
    expect(js).toContain("plugin.exitCompletely()");
  });
});
