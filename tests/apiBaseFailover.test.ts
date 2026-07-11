import { describe, expect, it } from "vitest";
import { buildApiBaseCandidates, isFailoverSafeRequest } from "../public/apiBaseFailover.js";

const lan = "http://192.168.101.8:1314";
const vpn = "http://100.69.253.5:1314";

describe("LAN and VPN API failover", () => {
  it("keeps the selected route first and deduplicates known fallbacks", () => {
    expect(buildApiBaseCandidates("", [lan, vpn])).toEqual(["", lan, vpn]);
    expect(buildApiBaseCandidates(lan, [lan, vpn])).toEqual([lan, vpn]);
    expect(buildApiBaseCandidates(vpn, [lan, vpn])).toEqual([vpn, lan]);
    expect(buildApiBaseCandidates("http://custom:1314/", [lan, vpn])).toEqual([
      "http://custom:1314",
      lan,
      vpn
    ]);
  });

  it("only retries read requests and idempotent task sends on another route", () => {
    expect(isFailoverSafeRequest("/api/health", {})).toBe(true);
    expect(isFailoverSafeRequest("/api/tasks", { method: "POST", body: '{"clientMessageId":"phone-1"}' })).toBe(true);
    expect(isFailoverSafeRequest("/api/conversations", { method: "POST", body: "{}" })).toBe(false);
    expect(isFailoverSafeRequest("/api/approvals/a/approve", { method: "POST" })).toBe(false);
  });
});
