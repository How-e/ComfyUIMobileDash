$ErrorActionPreference = "Stop"

$defaultUrl = "http://127.0.0.1:8188"
$url = Read-Host "ComfyUI URL [$defaultUrl]"
if ([string]::IsNullOrWhiteSpace($url)) { $url = $defaultUrl }

$parsed = $null
if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -notin @("http", "https")) {
    throw "ComfyUI URL must be an absolute http:// or https:// address."
}

$workflowDir = Read-Host "Workflow directory for integration tests [auto-detect]"
if (-not [string]::IsNullOrWhiteSpace($workflowDir)) {
    $workflowDir = (Resolve-Path -LiteralPath $workflowDir).Path
}

function ConvertTo-DotEnvValue([string]$value) {
    return '"' + $value.Replace('\', '\\').Replace('"', '\"') + '"'
}

$settings = @(
    "# Local-only Comfy Deck settings. This file is ignored by Git."
    "COMFYUI_URL=$(ConvertTo-DotEnvValue $parsed.AbsoluteUri.TrimEnd('/'))"
)
if (-not [string]::IsNullOrWhiteSpace($workflowDir)) {
    $settings += "COMFYUI_WORKFLOW_DIR=$(ConvertTo-DotEnvValue $workflowDir)"
}

$target = Join-Path $PSScriptRoot "..\.env.local"
Set-Content -LiteralPath $target -Value $settings -Encoding utf8
Write-Host "Saved local configuration to .env.local (excluded from Git)."
