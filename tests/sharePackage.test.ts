import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("share package assets", () => {
  it("includes beginner documentation and a required-info checklist", () => {
    expect(fs.existsSync("README.zh-CN.md")).toBe(true);
    expect(fs.existsSync("docs/QUICKSTART.zh-CN.md")).toBe(true);
    expect(fs.existsSync("docs/REQUIRED_INFO.zh-CN.md")).toBe(true);
    expect(fs.existsSync("docs/SECURITY.zh-CN.md")).toBe(true);
    expect(fs.existsSync("docs/GIT_SHARE.zh-CN.md")).toBe(true);

    const quickstart = fs.readFileSync("docs/QUICKSTART.zh-CN.md", "utf8");
    expect(quickstart).toContain("飞牛 NAS");
    expect(quickstart).toContain("Win11");
    expect(quickstart).toContain("手机");
  });

  it("provides one-click setup scripts and a public-safe config template", () => {
    expect(fs.existsSync("scripts/setup-nas-docker.sh")).toBe(true);
    expect(fs.existsSync("scripts/setup-windows-agent.ps1")).toBe(true);
    expect(fs.existsSync("config/dispatcher.config.template.json")).toBe(true);

    const template = fs.readFileSync("config/dispatcher.config.template.json", "utf8");
    expect(template).toContain("REPLACE_WITH_DISPATCHER_TOKEN");
    expect(template).toContain("REPLACE_WITH_AGENT_TOKEN");
    expect(template).not.toMatch(/[a-f0-9]{64}/i);
  });

  it("packages source without local secrets or runtime folders", () => {
    expect(fs.existsSync("scripts/package-share.ps1")).toBe(true);
    const script = fs.readFileSync("scripts/package-share.ps1", "utf8");
    const gitignore = fs.readFileSync(".gitignore", "utf8");

    for (const excluded of ["node_modules", "dist", "logs", "data", "release", "config/dispatcher.config.json"]) {
      expect(script).toContain(excluded);
    }
    expect(gitignore).toContain("config/dispatcher.config.json");
    expect(gitignore).toContain("config/agent.local.config.json");
    expect(gitignore).toContain("release/");
  });
});
