import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readPublicFile(name: string): string {
  return fs.readFileSync(path.join(root, "public", name), "utf8");
}

describe("mobile approval inbox controls", () => {
  it("exposes a topbar permission inbox button and badge", () => {
    const html = readPublicFile("index.html");

    expect(html).toContain('id="approval-toggle"');
    expect(html).toContain('id="approval-count"');
    expect(html.indexOf('id="approval-toggle"')).toBeLessThan(html.indexOf('id="settings-open"'));
  });

  it("keeps pending approvals behind the dedicated topbar button", () => {
    const app = readPublicFile("app.js");

    expect(app).toContain("approvalToggle");
    expect(app).toContain("toggleApprovalInbox");
    expect(app).toContain("notifyPendingApprovals");
  });
});
