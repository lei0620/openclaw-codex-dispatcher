param(
  [string]$PromptFile = "",
  [int]$ClickYOffset = 92,
  [string]$WindowTitlePattern = "Codex|OpenAI"
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class OpenClawWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetActiveWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
"@

if ($PromptFile) {
  $text = Get-Content -LiteralPath $PromptFile -Raw -Encoding UTF8
} else {
  $text = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "No prompt text was provided."
}

function Set-CodexForeground([IntPtr]$targetHandle) {
  [uint32]$targetProcessId = 0
  $targetThreadId = [OpenClawWin32]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcessId)
  $currentThreadId = [OpenClawWin32]::GetCurrentThreadId()

  for ($attempt = 0; $attempt -lt 8; $attempt++) {
    if ($attempt -eq 0) {
      try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate($targetProcessId) | Out-Null
      } catch {
        # AppActivate is best-effort; the Win32 path below still handles normal focus.
      }
      Start-Sleep -Milliseconds 180
    }
    if ($targetThreadId -ne 0) {
      [OpenClawWin32]::AttachThreadInput($currentThreadId, $targetThreadId, $true) | Out-Null
    }
    try {
      [OpenClawWin32]::ShowWindow($targetHandle, 9) | Out-Null
      [OpenClawWin32]::BringWindowToTop($targetHandle) | Out-Null
      [OpenClawWin32]::SetActiveWindow($targetHandle) | Out-Null
      [OpenClawWin32]::SetFocus($targetHandle) | Out-Null
      [OpenClawWin32]::SetForegroundWindow($targetHandle) | Out-Null
      if ($attempt -ge 2) {
        [OpenClawWin32]::SwitchToThisWindow($targetHandle, $true)
      }
    } finally {
      if ($targetThreadId -ne 0) {
        [OpenClawWin32]::AttachThreadInput($currentThreadId, $targetThreadId, $false) | Out-Null
      }
    }
    Start-Sleep -Milliseconds 220
    if (Test-WindowForeground $targetHandle) {
      return
    }
  }
}

function Test-WindowForeground([IntPtr]$targetHandle) {
  $foregroundHandle = [OpenClawWin32]::GetForegroundWindow()
  if ($foregroundHandle -eq $targetHandle) {
    return $true
  }

  [uint32]$targetProcessId = 0
  [uint32]$foregroundProcessId = 0
  [OpenClawWin32]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcessId) | Out-Null
  [OpenClawWin32]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId) | Out-Null
  $targetProcessId -ne 0 -and $targetProcessId -eq $foregroundProcessId
}

function Send-Key([byte]$key) {
  [OpenClawWin32]::keybd_event($key, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [OpenClawWin32]::keybd_event($key, 0, 0x0002, [IntPtr]::Zero)
}

function Send-KeyCombo([byte[]]$keys) {
  foreach ($key in $keys) {
    [OpenClawWin32]::keybd_event($key, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
  [array]::Reverse($keys)
  foreach ($key in $keys) {
    [OpenClawWin32]::keybd_event($key, 0, 0x0002, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
}

$processes = Get-Process |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    (
      $_.ProcessName -ieq "Codex" -or
      (
        $_.Path -and
        $_.Path -match "\\OpenAI\.Codex_.*\\app\\Codex\.exe$"
      ) -or
      (
        $_.ProcessName -match "OpenAI" -and
        $_.MainWindowTitle -match $WindowTitlePattern
      )
    )
  } |
  Sort-Object @{ Expression = { $_.ProcessName -ieq "Codex" }; Descending = $true }, StartTime -Descending

$target = $processes | Select-Object -First 1
if (-not $target) {
  throw "No visible Codex desktop window was found."
}

$handle = [IntPtr]$target.MainWindowHandle
[OpenClawWin32]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 120
Set-CodexForeground $handle
if (-not (Test-WindowForeground $handle)) {
  throw "Failed to focus Codex desktop window."
}

$rect = New-Object RECT
if (-not [OpenClawWin32]::GetWindowRect($handle, [ref]$rect)) {
  throw "Failed to read Codex window bounds."
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 320 -or $height -lt 240) {
  throw "Codex window is too small to target the input box."
}

$x = [int]($rect.Left + ($width / 2))
$y = [int]($rect.Bottom - [Math]::Max(40, $ClickYOffset))
[OpenClawWin32]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 80
[OpenClawWin32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 40
[OpenClawWin32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 180

Set-Clipboard -Value $text
Send-KeyCombo @(0x11, 0x56)
Start-Sleep -Milliseconds 220
Send-Key 0x0D

Write-Output "Sent prompt to Codex desktop window: pid=$($target.Id), title=$($target.MainWindowTitle)"
