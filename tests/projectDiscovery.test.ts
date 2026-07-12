import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProjects } from "../src/agent/projectDiscovery.js";
import { TaskStore } from "../src/server/taskStore.js";

let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

describe("discoverProjects", () => {
  it("uses the Codex desktop workspace list and excludes archived or unrelated folders", () => {
    const previousCodexHome = process.env.CODEX_HOME;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-projects-"));
    try {
      const codexHome = path.join(tmpRoot, ".codex-home");
      const activeProject = path.join(tmpRoot, "active-project");
      const nestedProject = path.join(tmpRoot, "kaifa", "mavis-drama-assistant");
      fs.mkdirSync(codexHome);
      fs.mkdirSync(activeProject);
      fs.mkdirSync(nestedProject, { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, "archived-project"));
      fs.mkdirSync(path.join(tmpRoot, "android-sdk"));
      fs.writeFileSync(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
        "electron-saved-workspace-roots": [nestedProject, activeProject]
      }));
      process.env.CODEX_HOME = codexHome;

      const projects = discoverProjects({
        enabled: true,
        roots: [tmpRoot],
        exclude: [],
        defaultMode: "codex",
        allowedModes: ["codex", "dry-run"],
        notify: true
      });

      expect(projects.map((project) => project.path)).toEqual([
        nestedProject.replaceAll("\\", "/"),
        activeProject.replaceAll("\\", "/")
      ]);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("turns first-level folders under a workspace root into selectable projects", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-projects-"));
    fs.mkdirSync(path.join(tmpRoot, "openclaw"));
    fs.mkdirSync(path.join(tmpRoot, "sjnews"));
    fs.mkdirSync(path.join(tmpRoot, "beifen"));
    fs.writeFileSync(path.join(tmpRoot, "readme.txt"), "not a folder");

    const projects = discoverProjects({
      enabled: true,
      roots: [tmpRoot],
      exclude: ["beifen"],
      defaultMode: "codex",
      allowedModes: ["codex", "dry-run"],
      notify: true
    });

    expect(projects.map((project) => project.id)).toEqual(["openclaw", "sjnews"]);
    expect(projects[0]).toMatchObject({
      id: "openclaw",
      name: "openclaw",
      defaultMode: "codex",
      allowedModes: ["codex", "dry-run"],
      notify: true
    });
  });
});

describe("TaskStore project catalog", () => {
  it("merges configured projects with agent-discovered projects", () => {
    const store = new TaskStore();
    store.setAgentProjects("win11-main", [
      {
        id: "ctrlg",
        name: "ctrlg",
        path: "D:/aixm/ctrlg",
        defaultMode: "codex",
        allowedModes: ["codex", "dry-run"],
        notify: true
      }
    ]);

    const projects = store.listProjects([
      {
        id: "openclaw",
        name: "OpenClaw Bridge",
        path: "D:/aixm/openclaw",
        defaultMode: "codex",
        allowedModes: ["codex", "dry-run"],
        notify: true
      }
    ]);

    expect(projects.map((project) => project.id)).toEqual(["openclaw", "ctrlg"]);
  });
});
