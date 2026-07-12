import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ProjectConfig, ProjectDiscoveryConfig } from "../shared/types.js";

export function discoverProjects(config: ProjectDiscoveryConfig): ProjectConfig[] {
  if (!config.enabled) {
    return [];
  }

  const excluded = new Set(config.exclude.map((item) => item.toLowerCase()));
  const projects = new Map<string, ProjectConfig>();
  const codexWorkspaceRoots = readCodexWorkspaceRoots(config.roots, excluded);
  if (codexWorkspaceRoots.length > 0) {
    for (const projectPath of codexWorkspaceRoots) {
      addProject(projects, projectPath, config);
    }
    return [...projects.values()];
  }

  for (const root of config.roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || excluded.has(entry.name.toLowerCase())) {
        continue;
      }
      addProject(projects, path.join(root, entry.name), config);
    }
  }

  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function readCodexWorkspaceRoots(allowedRoots: string[], excluded: Set<string>): string[] {
  const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || "", ".codex");
  const statePath = path.join(codexHome, ".codex-global-state.json");
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    const savedRoots = state["electron-saved-workspace-roots"];
    if (!Array.isArray(savedRoots)) {
      return [];
    }
    const normalizedAllowedRoots = allowedRoots.map((root) => path.resolve(root));
    const seen = new Set<string>();
    return savedRoots
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => path.resolve(value))
      .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory())
      .filter((candidate) => normalizedAllowedRoots.some((root) => isAllowedWorkspace(candidate, root, excluded)))
      .filter((candidate) => {
        const key = candidate.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch {
    return [];
  }
}

function isAllowedWorkspace(candidate: string, root: string, excluded: Set<string>): boolean {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const firstSegment = relative.split(path.sep).filter(Boolean)[0];
  return !firstSegment || !excluded.has(firstSegment.toLowerCase());
}

function addProject(projects: Map<string, ProjectConfig>, rawPath: string, config: ProjectDiscoveryConfig): void {
  const projectPath = path.resolve(rawPath).replaceAll("\\", "/");
  const name = path.basename(rawPath);
  const id = uniqueProjectId(projects, name, projectPath);
  projects.set(id, {
    id,
    name,
    path: projectPath,
    defaultMode: config.defaultMode,
    allowedModes: config.allowedModes,
    notify: config.notify
  });
}

function uniqueProjectId(projects: Map<string, ProjectConfig>, folderName: string, projectPath: string): string {
  const slug = toProjectId(folderName) || `project-${shortHash(projectPath)}`;
  if (!projects.has(slug)) {
    return slug;
  }
  return `${slug}-${shortHash(projectPath)}`;
}

function toProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}
