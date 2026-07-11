import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("createRefreshGate", () => {
  it("coalesces overlapping refresh requests into one follow-up refresh", async () => {
    const { createRefreshGate } = await import(pathToFileURL(path.resolve("public/refreshGate.js")).href);
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const refresh = createRefreshGate(async () => {
      calls.push(`call-${calls.length + 1}`);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    const first = refresh();
    void refresh();
    void refresh();
    await Promise.resolve();

    expect(calls).toEqual(["call-1"]);

    releases.shift()?.();
    await first;
    await waitFor(() => calls.length === 2);

    expect(calls).toEqual(["call-1", "call-2"]);

    releases.shift()?.();
    await waitFor(() => releases.length === 0);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met");
}
