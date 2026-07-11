param(
  [string]$PromptFile = "",
  [int]$ClickYOffset = 92,
  [string]$WindowTitlePattern = "Codex|OpenAI",
  [string]$WindowProcessId = "",
  [string]$WindowHandle = ""
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

function Set-CodexForeground([IntPtr]$targetHandle, [bool]$requireExactHandle) {
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
    if (Test-WindowForeground $targetHandle $requireExactHandle) {
      return
    }
  }
}

function Test-WindowForeground([IntPtr]$targetHandle, [bool]$requireExactHandle) {
  $foregroundHandle = [OpenClawWin32]::GetForegroundWindow()
  if ($foregroundHandle -eq $targetHandle) {
    return $true
  }
  if ($requireExactHandle) {
    return $false
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

$processes = @(Get-Process |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.Path -and
    $_.Path -match "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$"
  } |
  Sort-Object StartTime -Descending)

$target = $null
if ($WindowProcessId.Trim()) {
  $targetProcessIdValue = [Int32]$WindowProcessId.Trim()
  $target = $processes | Where-Object { $_.Id -eq $targetProcessIdValue } | Select-Object -First 1
  if (-not $target) {
    throw "Bound Codex desktop window was not found: pid=$WindowProcessId"
  }
} elseif ($WindowHandle.Trim()) {
  $targetHandleValue = [Int64]$WindowHandle.Trim()
  $target = $processes | Where-Object { $_.MainWindowHandle.ToInt64() -eq $targetHandleValue } | Select-Object -First 1
  if (-not $target) {
    throw "Bound Codex desktop window was not found: handle=$WindowHandle"
  }
} else {
  if ($processes.Count -gt 1) {
    $titles = ($processes | ForEach-Object { "pid=$($_.Id), title=$($_.MainWindowTitle)" }) -join "; "
    throw "Multiple Codex desktop windows are visible; bind a window before using desktop input: $titles"
  }
  $target = $processes | Select-Object -First 1
}
if (-not $target) {
  throw "No visible Codex desktop window was found."
}

$handle = [IntPtr]$target.MainWindowHandle
[OpenClawWin32]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 120
$requireExactHandle = [bool]$WindowHandle.Trim()
Set-CodexForeground $handle $requireExactHandle
if (-not (Test-WindowForeground $handle $requireExactHandle)) {
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
