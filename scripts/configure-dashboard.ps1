$ErrorActionPreference = "Stop"

$defaultComfyUrl = "http://127.0.0.1:8188"
$comfyUrl = Read-Host "ComfyUI URL [$defaultComfyUrl]"
if ([string]::IsNullOrWhiteSpace($comfyUrl)) { $comfyUrl = $defaultComfyUrl }

$parsedComfy = $null
if (-not [Uri]::TryCreate($comfyUrl, [UriKind]::Absolute, [ref]$parsedComfy) -or $parsedComfy.Scheme -notin @("http", "https")) {
    throw "ComfyUI URL must be an absolute http:// or https:// address."
}

$defaultLmUrl = "http://127.0.0.1:1234"
$lmUrl = Read-Host "LM Studio URL [$defaultLmUrl]"
if ([string]::IsNullOrWhiteSpace($lmUrl)) { $lmUrl = $defaultLmUrl }

$parsedLm = $null
if (-not [Uri]::TryCreate($lmUrl, [UriKind]::Absolute, [ref]$parsedLm) -or $parsedLm.Scheme -notin @("http", "https")) {
    throw "LM Studio URL must be an absolute http:// or https:// address."
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
    "COMFYUI_URL=$(ConvertTo-DotEnvValue $parsedComfy.AbsoluteUri.TrimEnd('/'))"
    "LMSTUDIO_URL=$(ConvertTo-DotEnvValue $parsedLm.AbsoluteUri.TrimEnd('/'))"
)
if (-not [string]::IsNullOrWhiteSpace($workflowDir)) {
    $settings += "COMFYUI_WORKFLOW_DIR=$(ConvertTo-DotEnvValue $workflowDir)"
}

$target = Join-Path $PSScriptRoot "..\.env.local"
Set-Content -LiteralPath $target -Value $settings -Encoding utf8
Write-Host "Saved local configuration to .env.local (excluded from Git)."

