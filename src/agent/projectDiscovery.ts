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

  for (const root of config.roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || excluded.has(entry.name.toLowerCase())) {
        continue;
      }
      const projectPath = path.join(root, entry.name).replaceAll("\\", "/");
      const id = uniqueProjectId(projects, entry.name, projectPath);
      projects.set(id, {
        id,
        name: entry.name,
        path: projectPath,
        defaultMode: config.defaultMode,
        allowedModes: config.allowedModes,
        notify: config.notify
      });
    }
  }

  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
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
