import type { DispatcherConfig, ProjectConfig } from "./types.js";

export function resolveProject(source: DispatcherConfig | ProjectConfig[], projectId: string, mode?: string): ProjectConfig {
  const projects = Array.isArray(source) ? source : source.projects;
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new Error(`project is not whitelisted: ${projectId}`);
  }
  const requestedMode = mode ?? project.defaultMode;
  if (!project.allowedModes.includes(requestedMode)) {
    throw new Error(`mode is not allowed for project ${projectId}: ${requestedMode}`);
  }
  return project;
}
