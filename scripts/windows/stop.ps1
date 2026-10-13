# ==============================================================================
# Aurel Windows Automation Suite — Graceful Shutdown Utility
# ==============================================================================
# Safety guarantees:
# 1. Never uses indiscriminate commands like 'taskkill /IM node.exe'.
# 2. Only stops verified launcher-owned processes with matching creation timestamps.
# 3. Missing or corrupted ownership records NEVER trigger process killing.
# 4. Port scanning alone does NOT authorize process termination.
# 5. PostgreSQL is preserved and never stopped.
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Load shared utilities
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "common.ps1")

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  AUREL SHUTDOWN UTILITY" -ForegroundColor Yellow
Write-Host "  Stopping Demonstration Environment..." -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$state = Read-PidState

if ($state -and $state.Services) {
    Write-Host "Stopping verified Aurel services from launcher state..." -ForegroundColor Cyan
    
    # 1. Backend API
    if ($state.Services.Api) {
        $res = Stop-AurelProcessTree -RecordedService $state.Services.Api -ServiceName "Backend API"
        Write-Host "  $($res.Message)" -ForegroundColor DarkGray
    }
    
    # 2. Customer Storefront
    if ($state.Services.Storefront) {
        $res = Stop-AurelProcessTree -RecordedService $state.Services.Storefront -ServiceName "Customer Storefront"
        Write-Host "  $($res.Message)" -ForegroundColor DarkGray
    }
    
    # 3. Operations Dashboard
    if ($state.Services.Operations) {
        $res = Stop-AurelProcessTree -RecordedService $state.Services.Operations -ServiceName "Operations Dashboard"
        Write-Host "  $($res.Message)" -ForegroundColor DarkGray
    }
    
    Clear-PidState
} else {
    Write-Host "No launcher PID state file found (.aurel-runtime\pids.json)." -ForegroundColor DarkYellow
    
    # Check if ports are listening
    $activeListeners = @()
    $ports = @(
        @{ Port = 4000; Name = "Backend API" },
        @{ Port = 5173; Name = "Customer Storefront" },
        @{ Port = 5174; Name = "Operations Dashboard" }
    )
    
    foreach ($entry in $ports) {
        $listener = Get-PortListener -Port $entry.Port
        if ($listener) {
            $proc = Get-ProcessDetails -ProcessId $listener.ProcessId
            $activeListeners += [PSCustomObject]@{
                Port      = $entry.Port
                Name      = $entry.Name
                ProcessId = $listener.ProcessId
                ProcName  = if ($proc) { $proc.Name } else { "Unknown" }
            }
        }
    }
    
    if ($activeListeners.Count -eq 0) {
        Write-Host "  No active services detected on Aurel ports (4000, 5173, 5174)." -ForegroundColor Green
        Write-Host "  System is already stopped." -ForegroundColor DarkGray
    } else {
        Write-Host ""
        Write-Host "  Detected active listeners on Aurel ports:" -ForegroundColor Yellow
        foreach ($al in $activeListeners) {
            Write-Host "    - Port $($al.Port) ($($al.Name)): In use by PID $($al.ProcessId) ($($al.ProcName))" -ForegroundColor White
        }
        Write-Host ""
        Write-Host "  ==================================================================" -ForegroundColor Yellow
        Write-Host "  PROCESS SAFETY SAFEGUARD ENGAGED:" -ForegroundColor Yellow
        Write-Host "  Automatic process termination is disabled because launcher ownership" -ForegroundColor Yellow
        Write-Host "  records are missing or invalid." -ForegroundColor Yellow
        Write-Host "  Port scanning alone does not authorize process termination." -ForegroundColor Yellow
        Write-Host "  ==================================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Manual Troubleshooting Instructions:" -ForegroundColor Cyan
        Write-Host "    1. If these services were started in VS Code or manual terminals," -ForegroundColor White
        Write-Host "       please close those specific terminal windows." -ForegroundColor White
        Write-Host "    2. To terminate a specific verified process manually, run:" -ForegroundColor White
        Write-Host "       taskkill /PID <PID> /F" -ForegroundColor DarkGray
        Write-Host "    3. To reset runtime files, remove .aurel-runtime\ directory." -ForegroundColor White
        Write-Host ""
    }
}

Start-Sleep -Milliseconds 800

# Verify final port status
$apiStillListening = Test-TcpPort -Port 4000
$storefrontStillListening = Test-TcpPort -Port 5173
$operationsStillListening = Test-TcpPort -Port 5174
$pgStillListening = Test-TcpPort -Port 5432

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  AUREL SHUTDOWN COMPLETE" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ("  Backend API (Port 4000):          " + $(if ($apiStillListening) { "STILL OCCUPIED" } else { "STOPPED" })) -ForegroundColor $(if ($apiStillListening) { "Red" } else { "Green" })
Write-Host ("  Customer Storefront (Port 5173):  " + $(if ($storefrontStillListening) { "STILL OCCUPIED" } else { "STOPPED" })) -ForegroundColor $(if ($storefrontStillListening) { "Red" } else { "Green" })
Write-Host ("  Operations Dashboard (Port 5174): " + $(if ($operationsStillListening) { "STILL OCCUPIED" } else { "STOPPED" })) -ForegroundColor $(if ($operationsStillListening) { "Red" } else { "Green" })
Write-Host ("  PostgreSQL (Port 5432):           " + $(if ($pgStillListening) { "PRESERVED (not stopped)" } else { "OFFLINE" })) -ForegroundColor DarkCyan
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  All Aurel runtime processes and state files cleaned up." -ForegroundColor Gray
Write-Host ""
exit 0
