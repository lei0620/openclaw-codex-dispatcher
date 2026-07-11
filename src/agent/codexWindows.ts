import { spawn } from "node:child_process";
import type { CodexDesktopWindow } from "../shared/types.js";

interface RawCodexWindow {
  handle?: string | number;
  processId?: number;
  title?: string;
  startedAt?: string;
}

export function buildCodexDesktopExecutablePattern(): string {
  return String.raw`\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$`;
}

export async function listCodexDesktopWindows(agentId: string): Promise<CodexDesktopWindow[]> {
  if (process.platform !== "win32") {
    return [];
  }
  const raw = await runPowerShellJson(buildWindowDiscoveryScript());
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const now = new Date().toISOString();
  return items
    .map((item) => normalizeWindow(agentId, item as RawCodexWindow, now))
    .filter((item): item is CodexDesktopWindow => Boolean(item));
}

function normalizeWindow(agentId: string, raw: RawCodexWindow, updatedAt: string): CodexDesktopWindow | undefined {
  const handle = String(raw.handle ?? "").trim();
  const processId = Number(raw.processId);
  if (!handle || !Number.isFinite(processId)) {
    return undefined;
  }
  return {
    id: `${agentId}:hwnd:${handle}`,
    agentId,
    handle,
    processId,
    title: String(raw.title || "Codex"),
    startedAt: raw.startedAt,
    updatedAt
  };
}

function runPowerShellJson(script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Codex window discovery exited with code ${code ?? 1}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function buildWindowDiscoveryScript(): string {
  const executablePattern = buildCodexDesktopExecutablePattern();
  return `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class OpenClawTopLevelWindow {
  public long Handle;
  public int ProcessId;
  public string Title;
}

[StructLayout(LayoutKind.Sequential)]
public struct OpenClawWindowRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class OpenClawWindowDiscovery {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool GetWindowRect(IntPtr hWnd, out OpenClawWindowRect rect);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  public static OpenClawTopLevelWindow[] List() {
    var windows = new List<OpenClawTopLevelWindow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) {
        return true;
      }
      OpenClawWindowRect rect;
      if (!GetWindowRect(hWnd, out rect)) {
        return true;
      }
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width < 320 || height < 240) {
        return true;
      }
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId == 0) {
        return true;
      }
      int length = GetWindowTextLength(hWnd);
      var builder = new StringBuilder(Math.Max(length + 1, 256));
      GetWindowText(hWnd, builder, builder.Capacity);
      windows.Add(new OpenClawTopLevelWindow {
        Handle = hWnd.ToInt64(),
        ProcessId = (int)processId,
        Title = builder.ToString()
      });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
}
"@

$windows = @([OpenClawWindowDiscovery]::List() | ForEach-Object {
  $window = $_
  try {
    $process = Get-Process -Id $window.ProcessId -ErrorAction Stop
  } catch {
    $process = $null
  }
  if ($process -and $process.Path -and $process.Path -match "${executablePattern}") {
    [pscustomobject]@{
      handle = $window.Handle.ToString()
      processId = $window.ProcessId
      title = if ($window.Title) { $window.Title } else { "Codex" }
      startedAt = if ($process.StartTime) { $process.StartTime.ToString("o") } else { $null }
    }
  }
} | Sort-Object @{ Expression = "startedAt"; Descending = $true }, @{ Expression = "handle"; Descending = $true })
$windows | ConvertTo-Json -Depth 4
`;
}
