# ==============================================================================
# Aurel Windows Automation Suite — Health Check & Diagnostics Utility
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Load shared utilities
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "common.ps1")

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  AUREL SYSTEM STATUS" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. PostgreSQL Check
$pgPort = 5432
$pgListening = Test-TcpPort -Port $pgPort
$pgService = Find-PostgreSqlService
$pgStatusStr = "UNREACHABLE"
$pgColor = "Red"

if ($pgListening) {
    $svcInfo = if ($pgService) { " (Service: $($pgService.Name))" } else { "" }
    $pgStatusStr = "RUNNING$svcInfo"
    $pgColor = "Green"
} elseif ($pgService -and $pgService.Status -eq "Stopped") {
    $pgStatusStr = "STOPPED (Service: $($pgService.Name))"
    $pgColor = "Red"
}

# 2. Database Connectivity Check
$dbStatusStr = "UNREACHABLE"
$dbColor = "Red"

if ($pgListening) {
    $prevEAP = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $repoRoot = Get-RepoRoot
        Set-Location $repoRoot
        & cmd.exe /c "pnpm --filter @aurel/api prisma migrate status > nul 2>&1"
        if ($LASTEXITCODE -eq 0) {
            $dbStatusStr = "CONNECTED (aurel_dev schema up to date)"
            $dbColor = "Green"
        } else {
            $dbStatusStr = "ERROR (Connection or migration issue)"
            $dbColor = "Yellow"
        }
    } catch {
        $dbStatusStr = "ERROR"
        $dbColor = "Red"
    } finally {
        $ErrorActionPreference = $prevEAP
    }
} else {
    $dbStatusStr = "UNREACHABLE (PostgreSQL is offline)"
}

# 3. Backend API Check
$apiRes = Test-HttpEndpoint -Url "http://localhost:4000/api/v1/health" -TimeoutSec 3
$apiStatusStr = "STOPPED"
$apiColor = "Red"
if ($apiRes.Success) {
    $apiStatusStr = "RUNNING (http://localhost:4000/api/v1/health)"
    $apiColor = "Green"
}

# 4. Customer Storefront Check
$storefrontRes = Test-HttpEndpoint -Url "http://localhost:5173" -TimeoutSec 3
$storefrontStatusStr = "STOPPED"
$storefrontColor = "Red"
if ($storefrontRes.Success) {
    $storefrontStatusStr = "RUNNING (http://localhost:5173)"
    $storefrontColor = "Green"
}

# 5. Operations Dashboard Check
$operationsRes = Test-HttpEndpoint -Url "http://localhost:5174" -TimeoutSec 3
$operationsStatusStr = "STOPPED"
$operationsColor = "Red"
if ($operationsRes.Success) {
    $operationsStatusStr = "RUNNING (http://localhost:5174)"
    $operationsColor = "Green"
}

# Print formatted summary table
Write-Host ("  PostgreSQL:           " + $pgStatusStr) -ForegroundColor $pgColor
Write-Host ("  Database:             " + $dbStatusStr) -ForegroundColor $dbColor
Write-Host ("  Backend API:          " + $apiStatusStr) -ForegroundColor $apiColor
Write-Host ("  Customer Storefront:  " + $storefrontStatusStr) -ForegroundColor $storefrontColor
Write-Host ("  Operations Dashboard: " + $operationsStatusStr) -ForegroundColor $operationsColor
Write-Host "======================================================================" -ForegroundColor Cyan

# Runtime state details
$state = Read-PidState
if ($state -and $state.Services) {
    Write-Host "Launcher State:" -ForegroundColor DarkGray
    Write-Host "  Started: $($state.StartedAt)" -ForegroundColor DarkGray
    if ($state.Services.Api) {
        Write-Host "  API PID: $($state.Services.Api.ListeningPid) (Launcher PID: $($state.Services.Api.RootPid))" -ForegroundColor DarkGray
    }
    if ($state.Services.Storefront) {
        Write-Host "  Storefront PID: $($state.Services.Storefront.ListeningPid) (Launcher PID: $($state.Services.Storefront.RootPid))" -ForegroundColor DarkGray
    }
    if ($state.Services.Operations) {
        Write-Host "  Operations PID: $($state.Services.Operations.ListeningPid) (Launcher PID: $($state.Services.Operations.RootPid))" -ForegroundColor DarkGray
    }
    Write-Host ""
}

# Actionable status summary
if ($apiRes.Success -and $storefrontRes.Success -and $operationsRes.Success -and $pgListening) {
    Write-Host "STATUS: ALL SYSTEMS OPERATIONAL" -ForegroundColor Green
    Write-Host "Aurel platform is ready for demonstration." -ForegroundColor White
    Write-Host "Open Customer Storefront:   http://localhost:5173" -ForegroundColor Cyan
    Write-Host "Open Operations Dashboard:  http://localhost:5174" -ForegroundColor Cyan
} elseif (-not $pgListening) {
    Write-Host "STATUS: POSTGRESQL OFFLINE" -ForegroundColor Red
    if ($pgService) {
        Write-Host "Action: Start service via 'net start $($pgService.Name)' or services.msc." -ForegroundColor Yellow
    } else {
        Write-Host "Action: Ensure PostgreSQL 16 is started on port 5432." -ForegroundColor Yellow
    }
} elseif (-not $apiRes.Success -or -not $storefrontRes.Success -or -not $operationsRes.Success) {
    Write-Host "STATUS: SERVICES STOPPED / DEGRADED" -ForegroundColor Yellow
    Write-Host "Action: Double-click Start_Aurel.bat to initialize all platform services." -ForegroundColor White
}
Write-Host ""
exit 0
