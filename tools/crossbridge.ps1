[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $Command
)

$ErrorActionPreference = "Stop"

# Full SDK:
# $env:CROSSBRIDGE_IMAGE = "ghcr.io/33tu/crossbridge:15.0.0.3-full"

$image = if ([string]::IsNullOrWhiteSpace($env:CROSSBRIDGE_IMAGE)) {
    "ghcr.io/33tu/crossbridge:15.0.0.3-light"
} else {
    $env:CROSSBRIDGE_IMAGE
}

$runtime = if ([string]::IsNullOrWhiteSpace($env:CROSSBRIDGE_DOCKER)) {
    "docker"
} else {
    $env:CROSSBRIDGE_DOCKER
}

$runtimeArguments = @(
    "run"
    "--rm"
    "--mount"
    "type=bind,source=$($PWD.Path),target=/work"
    "--workdir"
    "/work"
    "-e"
    "FLEX=/opt/flex"
)

if (-not [Console]::IsInputRedirected -and
    -not [Console]::IsOutputRedirected) {
    $runtimeArguments += "-it"
}

$runtimeArguments += $image

if ($null -eq $Command -or $Command.Count -eq 0) {
    $runtimeArguments += "bash"
} else {
    $runtimeArguments += $Command
}

& $runtime @runtimeArguments
exit $LASTEXITCODE
