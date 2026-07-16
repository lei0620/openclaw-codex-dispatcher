import fs from "node:fs";
import { describe, expect, it } from "vitest";

const launcherSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
};

describe("Android launcher icon", () => {
  it("keeps the generated source artwork and every required density", () => {
    expect(readPngSize("artwork/codex-mobile-icon-ios-wifi-blue-source.png")).toEqual({ width: 1254, height: 1254 });

    for (const [density, size] of Object.entries(launcherSizes)) {
      const directory = `android/app/src/main/res/mipmap-${density}`;
      expect(readPngSize(`${directory}/ic_launcher.png`)).toEqual({ width: size, height: size });
      expect(readPngSize(`${directory}/ic_launcher_round.png`)).toEqual({ width: size, height: size });
      const foreground = `${directory}/ic_launcher_foreground.png`;
      expect(readPngSize(foreground)).toEqual({
        width: Math.round(size * 2.25),
        height: Math.round(size * 2.25)
      });
      expect(readPngColorType(foreground)).toBe(2);
    }
  });
});

function readPngSize(file: string): { width: number; height: number } {
  const png = fs.readFileSync(file);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}

function readPngColorType(file: string): number {
  return fs.readFileSync(file).readUInt8(25);
}
