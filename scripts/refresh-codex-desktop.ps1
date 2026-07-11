param(
  [string]$WindowTitlePattern = "Codex|OpenAI",
  [string]$WindowProcessId = "",
  [string]$WindowHandle = "",
  [switch]$AllowMultipleWindows
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class OpenClawRefreshWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetActiveWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

  public static string ReadWindowTitle(IntPtr hWnd) {
    var text = new StringBuilder(512);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString();
  }
}
"@

function Test-WindowForeground([IntPtr]$targetHandle) {
  [OpenClawRefreshWin32]::GetForegroundWindow() -eq $targetHandle
}

function Set-CodexForeground([IntPtr]$targetHandle) {
  [uint32]$targetProcessId = 0
  $targetThreadId = [OpenClawRefreshWin32]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcessId)
  $currentThreadId = [OpenClawRefreshWin32]::GetCurrentThreadId()

  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    if ($attempt -eq 0) {
      try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate($targetProcessId) | Out-Null
      } catch {
        # Best effort; direct Win32 focus calls below still run.
      }
      Start-Sleep -Milliseconds 180
    }
    if ($targetThreadId -ne 0) {
      [OpenClawRefreshWin32]::AttachThreadInput($currentThreadId, $targetThreadId, $true) | Out-Null
    }
    try {
      [OpenClawRefreshWin32]::ShowWindow($targetHandle, 9) | Out-Null
      [OpenClawRefreshWin32]::BringWindowToTop($targetHandle) | Out-Null
      [OpenClawRefreshWin32]::SetActiveWindow($targetHandle) | Out-Null
      [OpenClawRefreshWin32]::SetFocus($targetHandle) | Out-Null
      [OpenClawRefreshWin32]::SetForegroundWindow($targetHandle) | Out-Null
    } finally {
      if ($targetThreadId -ne 0) {
        [OpenClawRefreshWin32]::AttachThreadInput($currentThreadId, $targetThreadId, $false) | Out-Null
      }
    }
    Start-Sleep -Milliseconds 180
    if (Test-WindowForeground $targetHandle) {
      return
    }
  }
}

function Send-KeyCombo([byte[]]$keys) {
  foreach ($key in $keys) {
    [OpenClawRefreshWin32]::keybd_event($key, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
  [array]::Reverse($keys)
  foreach ($key in $keys) {
    [OpenClawRefreshWin32]::keybd_event($key, 0, 0x0002, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
}

$processes = @(Get-Process |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.Path -and
    $_.Path -match "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$"
  } |
  Sort-Object StartTime -Descending)

$target = $null
if ($WindowHandle.Trim()) {
  $targetHandleValue = [IntPtr][Int64]$WindowHandle.Trim()
  if (-not [OpenClawRefreshWin32]::IsWindow($targetHandleValue) -or -not [OpenClawRefreshWin32]::IsWindowVisible($targetHandleValue)) {
    Write-Output "Skipped Codex desktop refresh because the bound window was not found: handle=$WindowHandle"
    exit 0
  }
  [uint32]$targetProcessIdValue = 0
  [OpenClawRefreshWin32]::GetWindowThreadProcessId($targetHandleValue, [ref]$targetProcessIdValue) | Out-Null
  $targetProcess = Get-Process -Id $targetProcessIdValue -ErrorAction SilentlyContinue
  if (-not $targetProcess -or -not $targetProcess.Path -or $targetProcess.Path -notmatch "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$") {
    Write-Output "Skipped Codex desktop refresh because the bound handle is not a Codex window: handle=$WindowHandle"
    exit 0
  }
  $target = [pscustomobject]@{
    Id = [Int32]$targetProcessIdValue
    MainWindowHandle = $targetHandleValue
    MainWindowTitle = [OpenClawRefreshWin32]::ReadWindowTitle($targetHandleValue)
  }
} elseif ($WindowProcessId.Trim()) {
  $targetProcessIdValue = [Int32]$WindowProcessId.Trim()
  $target = $processes | Where-Object { $_.Id -eq $targetProcessIdValue } | Select-Object -First 1
  if (-not $target) {
    Write-Output "Skipped Codex desktop refresh because the bound process was not found: pid=$WindowProcessId"
    exit 0
  }
} else {
  if (-not $AllowMultipleWindows -and $processes.Count -gt 1) {
    $titles = ($processes | ForEach-Object { "pid=$($_.Id), title=$($_.MainWindowTitle)" }) -join "; "
    Write-Output "Skipped Codex desktop refresh because multiple Codex windows are visible: $titles"
    exit 0
  }
  $target = $processes | Select-Object -First 1
}

if (-not $target) {
  throw "No visible Codex desktop window was found."
}

$handle = [IntPtr]$target.MainWindowHandle
$previousForegroundHandle = [OpenClawRefreshWin32]::GetForegroundWindow()
Set-CodexForeground $handle
if (-not (Test-WindowForeground $handle)) {
  Write-Output "Skipped Codex desktop refresh because the target window could not be focused: pid=$($target.Id), title=$($target.MainWindowTitle)"
  exit 0
}

Send-KeyCombo @(0x11, 0x52)
Start-Sleep -Milliseconds 300
if (
  $previousForegroundHandle -ne [IntPtr]::Zero -and
  $previousForegroundHandle -ne $handle -and
  [OpenClawRefreshWin32]::IsWindow($previousForegroundHandle)
) {
  Set-CodexForeground $previousForegroundHandle
}
Write-Output "Refreshed Codex desktop window: pid=$($target.Id), title=$($target.MainWindowTitle)"
