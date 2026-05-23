import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDispatcherConfig } from "../src/shared/config.js";

describe("loadDispatcherConfig", () => {
  it("loads project whitelist and shared tokens from a json file", () => {
    const config = loadDispatcherConfig(path.resolve("tests/fixtures/dispatcher.config.json"));

    expect(config.server.port).toBe(4318);
    expect(config.auth.dispatcherToken).toBe("panel-token");
    expect(config.auth.agentToken).toBe("agent-token");
    expect(config.projects.map((project) => project.id)).toEqual(["openclaw", "sjnews"]);
  });

  it("rejects duplicate project ids", () => {
    expect(() => loadDispatcherConfig(path.resolve("tests/fixtures/duplicate-projects.config.json"))).toThrow(
      /duplicate project id/i
    );
  });
});
