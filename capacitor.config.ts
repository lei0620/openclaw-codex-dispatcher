import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aixm.openclawcodex",
  appName: "手机遥控 Codex",
  webDir: "public",
  plugins: {
    SystemBars: {
      style: "LIGHT",
      insetsHandling: "css"
    }
  }
};

export default config;
