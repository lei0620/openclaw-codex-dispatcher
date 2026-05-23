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
