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
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
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

$processes = Get-Process |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    (
      $_.ProcessName -match "Codex|OpenAI" -or
      $_.MainWindowTitle -match $WindowTitlePattern
    )
  } |
  Sort-Object StartTime -Descending

$target = $processes | Select-Object -First 1
if (-not $target) {
  throw "No visible Codex desktop window was found."
}

$handle = [IntPtr]$target.MainWindowHandle
[OpenClawWin32]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 120
[OpenClawWin32]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 350

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
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")

Write-Output "Sent prompt to Codex desktop window: pid=$($target.Id), title=$($target.MainWindowTitle)"
