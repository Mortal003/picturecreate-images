param(
  [Parameter(Mandatory=$true)][string]$MachineCode,
  [Parameter(Mandatory=$true)][datetime]$ExpiresAt,
  [string]$LicenseId = (Get-Date -Format "yyyyMMdd-HHmmss")
)
$ErrorActionPreference = "Stop"
$node = Get-Command node -ErrorAction SilentlyContinue
if (!$node) { throw "未找到 Node.js，请先安装 Node.js。" }
& $node.Source (Join-Path $PSScriptRoot "generate-license.mjs") $MachineCode $ExpiresAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") $LicenseId
