# ==============================================================================
# Aurel Windows Automation Suite — Startup Orchestrator
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Load shared utilities
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "common.ps1")

$repoRoot = Get-RepoRoot
$paths = Get-RuntimePaths
Initialize-Runtime

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  AUREL" -ForegroundColor Yellow
Write-Host "  Restaurant Commerce & Operations Platform" -ForegroundColor White
Write-Host "  Initializing Local Demonstration Environment..." -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------------------
# [1/6] Checking prerequisites...
# ------------------------------------------------------------------------------
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Cyan

# 1.1 Verify repository structure
$pkgPath = Join-Path $repoRoot "package.json"
if (-not (Test-Path $pkgPath)) {
    Write-Host "  [FAIL] Repository root package.json not found in $repoRoot" -ForegroundColor Red
    exit 1
}
$apiPkg = Join-Path $repoRoot "apps\api\package.json"
$storefrontPkg = Join-Path $repoRoot "apps\storefront\package.json"
$operationsPkg = Join-Path $repoRoot "apps\operations\package.json"
if (-not (Test-Path $apiPkg) -or -not (Test-Path $storefrontPkg) -or -not (Test-Path $operationsPkg)) {
    Write-Host "  [FAIL] Core workspace directories (apps/api, apps/storefront, apps/operations) are missing." -ForegroundColor Red
    exit 1
}

# 1.2 Verify Node.js installation
$nodeVersion = $null
try {
    $nodeVersion = (& node -v 2>&1).Trim()
} catch {
    Write-Host "  [FAIL] Node.js is not installed or not available in PATH." -ForegroundColor Red
    Write-Host "         Please install Node.js (>= 20, recommended 24+) from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
if ($nodeVersion -notmatch '^v(\d+)\.') {
    Write-Host "  [FAIL] Unexpected Node.js version format: $nodeVersion" -ForegroundColor Red
    exit 1
}
$nodeMajor = [int]$matches[1]
if ($nodeMajor -lt 20) {
    Write-Host "  [FAIL] Node.js version $nodeVersion is too old. Aurel requires Node.js >= 20 (Node 24 recommended)." -ForegroundColor Red
    exit 1
}

# 1.3 Verify pnpm installation
$pnpmVersion = $null
try {
    $pnpmOut = (& cmd.exe /c pnpm -v 2>&1).Trim()
    if ($pnpmOut -match '^\d+\.\d+\.\d+') {
        $pnpmVersion = $matches[0]
    }
} catch {
    Write-Host "  [FAIL] pnpm is not available in PATH." -ForegroundColor Red
    Write-Host "         Please install pnpm (>= 9 or 12) via 'npm install -g pnpm'." -ForegroundColor Yellow
    exit 1
}
if (-not $pnpmVersion) {
    Write-Host "  [FAIL] Unable to determine pnpm version. Output: $pnpmOut" -ForegroundColor Red
    exit 1
}

# 1.4 Verify dependencies
$rootModules = Join-Path $repoRoot "node_modules"
$apiModules = Join-Path $repoRoot "apps\api\node_modules"
if (-not (Test-Path $rootModules) -or -not (Test-Path $apiModules)) {
    Write-Host "  [FAIL] Project dependencies are missing." -ForegroundColor Red
    Write-Host "         Please run 'pnpm install' from the repository root before starting." -ForegroundColor Yellow
    exit 1
}

# 1.5 Verify environment configuration
$apiEnv = Join-Path $repoRoot "apps\api\.env"
if (-not (Test-Path $apiEnv)) {
    Write-Host "  [FAIL] Environment file missing: apps\api\.env" -ForegroundColor Red
    Write-Host "         Please copy .env.example to apps\api\.env and verify DATABASE_URL." -ForegroundColor Yellow
    exit 1
}
$envContent = Get-Content $apiEnv -Raw -ErrorAction SilentlyContinue
if ($envContent -notmatch "DATABASE_URL") {
    Write-Host "  [FAIL] DATABASE_URL is not defined in apps\api\.env" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Prerequisites verified: Node.js $nodeVersion, pnpm v$pnpmVersion, configuration valid." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# [2/6] Checking PostgreSQL...
# ------------------------------------------------------------------------------
Write-Host "[2/6] Checking PostgreSQL..." -ForegroundColor Cyan

$pgPort = 5432
$isPgListening = Test-TcpPort -Port $pgPort

if (-not $isPgListening) {
    Write-Host "  [INFO] PostgreSQL is not responding on port $pgPort. Detecting Windows service..." -ForegroundColor DarkYellow
    $pgService = Find-PostgreSqlService
    
    if ($pgService) {
        Write-Host "  [INFO] Found service '$($pgService.Name)' (Status: $($pgService.Status))." -ForegroundColor DarkYellow
        if ($pgService.Status -ne "Running") {
            Write-Host "  [INFO] Attempting to start PostgreSQL service '$($pgService.Name)'..." -ForegroundColor Yellow
            try {
                Start-Service -Name $pgService.Name -ErrorAction Stop
                Write-Host "  [INFO] Service start command issued. Waiting for port $pgPort..." -ForegroundColor Yellow
            } catch {
                Write-Host "  [FAIL] Cannot start service '$($pgService.Name)' without elevated administrator rights." -ForegroundColor Red
                Write-Host "         Action required: Open an Administrator terminal and run:" -ForegroundColor Yellow
                Write-Host "           net start $($pgService.Name)" -ForegroundColor White
                Write-Host "         Or start '$($pgService.DisplayName)' from Windows Services (services.msc)." -ForegroundColor Yellow
                exit 1
            }
        }
    } else {
        Write-Host "  [FAIL] PostgreSQL is not running on port $pgPort, and no PostgreSQL Windows service was found." -ForegroundColor Red
        Write-Host "         Please start your PostgreSQL 16 server on localhost:5432." -ForegroundColor Yellow
        exit 1
    }
    
    # Wait bounded time for TCP readiness
    $maxWaitSec = 15
    $waited = 0
    while ($waited -lt $maxWaitSec) {
        Start-Sleep -Seconds 1
        $waited++
        if (Test-TcpPort -Port $pgPort) {
            $isPgListening = $true
            break
        }
    }
    
    if (-not $isPgListening) {
        Write-Host "  [FAIL] PostgreSQL did not become reachable on port $pgPort within $maxWaitSec seconds." -ForegroundColor Red
        exit 1
    }
}

Write-Host "  [OK] PostgreSQL is active and accepting connections on port $pgPort." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# [3/6] Checking database readiness...
# ------------------------------------------------------------------------------
Write-Host "[3/6] Checking database readiness..." -ForegroundColor Cyan

# Check migration status using read-only command (no destructive changes)
$prevEAP = $ErrorActionPreference
$migrateOutput = $null
$migrateExit = 0
try {
    $ErrorActionPreference = "Continue"
    Set-Location $repoRoot
    & cmd.exe /c "pnpm --filter @aurel/api prisma migrate status > nul 2>&1"
    $migrateExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prevEAP
}

if ($migrateExit -ne 0) {
    Write-Host "  [FAIL] Database verification failed (exit code $migrateExit)." -ForegroundColor Red
    $migrateText = ($migrateOutput | Out-String).Trim()
    if ($migrateText -match "Can't reach database server" -or $migrateText -match "Authentication failed") {
        Write-Host "         Database connection error. Check credentials in apps\api\.env." -ForegroundColor Red
    } elseif ($migrateText -match "have not yet been applied" -or $migrateText -match "Following migration") {
        Write-Host "         Pending database migrations detected." -ForegroundColor Yellow
        Write-Host "         To apply migrations safely without resetting data, run:" -ForegroundColor Yellow
        Write-Host "           pnpm db:migrate:deploy" -ForegroundColor White
    } else {
        Write-Host "         $migrateText" -ForegroundColor DarkGray
    }
    exit 1
}

Write-Host "  [OK] Database schema verified (aurel_dev is reachable and migrations are up to date)." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# Duplicate Stack Prevention
# ------------------------------------------------------------------------------
$apiHealthy = (Test-HttpEndpoint -Url "http://localhost:4000/api/v1/health" -TimeoutSec 2).Success
$storefrontHealthy = (Test-HttpEndpoint -Url "http://localhost:5173" -TimeoutSec 2).Success
$operationsHealthy = (Test-HttpEndpoint -Url "http://localhost:5174" -TimeoutSec 2).Success

if ($apiHealthy -and $storefrontHealthy -and $operationsHealthy) {
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  AUREL IS ALREADY RUNNING" -ForegroundColor Yellow
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  All Aurel services are active on their designated ports." -ForegroundColor White
    Write-Host ""
    Write-Host "  Customer Storefront:" -ForegroundColor Cyan
    Write-Host "  http://localhost:5173" -ForegroundColor White
    Write-Host ""
    Write-Host "  Operations Dashboard:" -ForegroundColor Cyan
    Write-Host "  http://localhost:5174" -ForegroundColor White
    Write-Host ""
    Write-Host "  Backend API:" -ForegroundColor Cyan
    Write-Host "  http://localhost:4000" -ForegroundColor White
    Write-Host ""
    Write-Host "  Logs Directory:" -ForegroundColor DarkGray
    Write-Host "  $($paths.LogsDir)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  (Duplicate process startup skipped to preserve existing sessions)" -ForegroundColor DarkGray
    Write-Host "======================================================================" -ForegroundColor Green
    exit 0
}

# Port Conflict Safeguards (unrelated processes)
$port4000Listener = Get-PortListener -Port 4000
if ($port4000Listener -and -not $apiHealthy) {
    Write-Host "  [FAIL] Port 4000 is occupied by an unverified process (PID: $($port4000Listener.ProcessId))." -ForegroundColor Red
    Write-Host "         Please terminate the conflicting process before starting Aurel API." -ForegroundColor Yellow
    exit 1
}

$port5173Listener = Get-PortListener -Port 5173
if ($port5173Listener -and -not $storefrontHealthy) {
    Write-Host "  [FAIL] Port 5173 is occupied by an unverified process (PID: $($port5173Listener.ProcessId))." -ForegroundColor Red
    Write-Host "         Please terminate the conflicting process before starting Customer Storefront." -ForegroundColor Yellow
    exit 1
}

$port5174Listener = Get-PortListener -Port 5174
if ($port5174Listener -and -not $operationsHealthy) {
    Write-Host "  [FAIL] Port 5174 is occupied by an unverified process (PID: $($port5174Listener.ProcessId))." -ForegroundColor Red
    Write-Host "         Please terminate the conflicting process before starting Operations Dashboard." -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------------------------------
# [4/6] Starting backend API...
# ------------------------------------------------------------------------------
Write-Host "[4/6] Starting backend API..." -ForegroundColor Cyan

$apiInfo = $null
$apiRootPid = 0
if ($apiHealthy) {
    Write-Host "  [OK] Backend API is already responding on http://localhost:4000" -ForegroundColor Green
} else {
    $apiInfo = Start-AurelBackgroundProcess `
        -CommandLine "pnpm --filter @aurel/api dev" `
        -WorkingDirectory $repoRoot `
        -LogFilePath $paths.ApiLog `
        -ServiceName "api"
        
    $apiRootPid = $apiInfo.ProcessId
    Write-Host "  [INFO] API background runner spawned (Launcher PID: $apiRootPid)." -ForegroundColor DarkGray
}
Write-Host ""

# ------------------------------------------------------------------------------
# [5/6] Starting customer storefront...
# ------------------------------------------------------------------------------
Write-Host "[5/6] Starting customer storefront..." -ForegroundColor Cyan

$storefrontInfo = $null
$storefrontRootPid = 0
if ($storefrontHealthy) {
    Write-Host "  [OK] Customer Storefront is already responding on http://localhost:5173" -ForegroundColor Green
} else {
    $storefrontInfo = Start-AurelBackgroundProcess `
        -CommandLine "pnpm --filter @aurel/storefront dev" `
        -WorkingDirectory $repoRoot `
        -LogFilePath $paths.StorefrontLog `
        -ServiceName "storefront"
        
    $storefrontRootPid = $storefrontInfo.ProcessId
    Write-Host "  [INFO] Storefront background runner spawned (Launcher PID: $storefrontRootPid)." -ForegroundColor DarkGray
}
Write-Host ""

# ------------------------------------------------------------------------------
# [6/6] Starting operations dashboard...
# ------------------------------------------------------------------------------
Write-Host "[6/6] Starting operations dashboard..." -ForegroundColor Cyan

$operationsInfo = $null
$operationsRootPid = 0
if ($operationsHealthy) {
    Write-Host "  [OK] Operations Dashboard is already responding on http://localhost:5174" -ForegroundColor Green
} else {
    $operationsInfo = Start-AurelBackgroundProcess `
        -CommandLine "pnpm --filter @aurel/operations dev" `
        -WorkingDirectory $repoRoot `
        -LogFilePath $paths.OperationsLog `
        -ServiceName "operations"
        
    $operationsRootPid = $operationsInfo.ProcessId
    Write-Host "  [INFO] Operations background runner spawned (Launcher PID: $operationsRootPid)." -ForegroundColor DarkGray
}
Write-Host ""

# ------------------------------------------------------------------------------
# Readiness Polling Loop (Bounded with Retries)
# ------------------------------------------------------------------------------
Write-Host "Waiting for service endpoints to report healthy..." -ForegroundColor Yellow

$timeoutSec = 60
$elapsed = 0
$apiReady = $apiHealthy
$storefrontReady = $storefrontHealthy
$operationsReady = $operationsHealthy

while ($elapsed -lt $timeoutSec) {
    Start-Sleep -Seconds 1
    $elapsed++
    
    # Check if any launcher process died unexpectedly
    if ($apiRootPid -gt 0) {
        $ap = Get-ProcessDetails -ProcessId $apiRootPid
        if (-not $ap -and -not $apiReady) {
            Write-Host "  [FAIL] Backend API process died prematurely!" -ForegroundColor Red
            Show-LogTail -FilePath $paths.ApiLog -Lines 20
            exit 1
        }
    }
    if ($storefrontRootPid -gt 0) {
        $sp = Get-ProcessDetails -ProcessId $storefrontRootPid
        if (-not $sp -and -not $storefrontReady) {
            Write-Host "  [FAIL] Storefront process died prematurely!" -ForegroundColor Red
            Show-LogTail -FilePath $paths.StorefrontLog -Lines 20
            exit 1
        }
    }
    if ($operationsRootPid -gt 0) {
        $op = Get-ProcessDetails -ProcessId $operationsRootPid
        if (-not $op -and -not $operationsReady) {
            Write-Host "  [FAIL] Operations process died prematurely!" -ForegroundColor Red
            Show-LogTail -FilePath $paths.OperationsLog -Lines 20
            exit 1
        }
    }
    
    # Poll HTTP endpoints
    if (-not $apiReady) {
        $res = Test-HttpEndpoint -Url "http://localhost:4000/api/v1/health" -TimeoutSec 2
        if ($res.Success) {
            $apiReady = $true
            Write-Host "  -> Backend API ready at http://localhost:4000/api/v1/health ($($elapsed)s)" -ForegroundColor Green
        }
    }
    if (-not $storefrontReady) {
        $res = Test-HttpEndpoint -Url "http://localhost:5173" -TimeoutSec 2
        if ($res.Success) {
            $storefrontReady = $true
            Write-Host "  -> Customer Storefront ready at http://localhost:5173 ($($elapsed)s)" -ForegroundColor Green
        }
    }
    if (-not $operationsReady) {
        $res = Test-HttpEndpoint -Url "http://localhost:5174" -TimeoutSec 2
        if ($res.Success) {
            $operationsReady = $true
            Write-Host "  -> Operations Dashboard ready at http://localhost:5174 ($($elapsed)s)" -ForegroundColor Green
        }
    }
    
    if ($apiReady -and $storefrontReady -and $operationsReady) {
        break
    }
}

if (-not ($apiReady -and $storefrontReady -and $operationsReady)) {
    Write-Host "  [FAIL] Timed out waiting for all services to become ready within $timeoutSec seconds." -ForegroundColor Red
    if (-not $apiReady) {
        Write-Host "  API (port 4000) not responding. Log output:" -ForegroundColor Red
        Show-LogTail -FilePath $paths.ApiLog -Lines 15
    }
    if (-not $storefrontReady) {
        Write-Host "  Storefront (port 5173) not responding. Log output:" -ForegroundColor Red
        Show-LogTail -FilePath $paths.StorefrontLog -Lines 15
    }
    if (-not $operationsReady) {
        Write-Host "  Operations (port 5174) not responding. Log output:" -ForegroundColor Red
        Show-LogTail -FilePath $paths.OperationsLog -Lines 15
    }
    exit 1
}

# ------------------------------------------------------------------------------
# Persist Process State for Safe Shutdown
# ------------------------------------------------------------------------------
$apiListen = Get-PortListener -Port 4000
$storefrontListen = Get-PortListener -Port 5173
$operationsListen = Get-PortListener -Port 5174

$state = [PSCustomObject]@{
    StartedAt  = (Get-Date).ToUniversalTime().ToString("o")
    Services   = [PSCustomObject]@{
        Api        = [PSCustomObject]@{
            RootPid      = $apiRootPid
            CreationDate = if ($apiInfo) { $apiInfo.CreationDate } else { (Get-Date).ToUniversalTime().ToString("o") }
            CommandLine  = if ($apiInfo) { $apiInfo.CommandLine } else { "" }
            ProcessName  = if ($apiInfo) { $apiInfo.ProcessName } else { "cmd.exe" }
            ListeningPid = if ($apiListen) { $apiListen.ProcessId } else { 0 }
            Port         = 4000
            Url          = "http://localhost:4000"
            HealthUrl    = "http://localhost:4000/api/v1/health"
        }
        Storefront = [PSCustomObject]@{
            RootPid      = $storefrontRootPid
            CreationDate = if ($storefrontInfo) { $storefrontInfo.CreationDate } else { (Get-Date).ToUniversalTime().ToString("o") }
            CommandLine  = if ($storefrontInfo) { $storefrontInfo.CommandLine } else { "" }
            ProcessName  = if ($storefrontInfo) { $storefrontInfo.ProcessName } else { "cmd.exe" }
            ListeningPid = if ($storefrontListen) { $storefrontListen.ProcessId } else { 0 }
            Port         = 5173
            Url          = "http://localhost:5173"
        }
        Operations = [PSCustomObject]@{
            RootPid      = $operationsRootPid
            CreationDate = if ($operationsInfo) { $operationsInfo.CreationDate } else { (Get-Date).ToUniversalTime().ToString("o") }
            CommandLine  = if ($operationsInfo) { $operationsInfo.CommandLine } else { "" }
            ProcessName  = if ($operationsInfo) { $operationsInfo.ProcessName } else { "cmd.exe" }
            ListeningPid = if ($operationsListen) { $operationsListen.ProcessId } else { 0 }
            Port         = 5174
            Url          = "http://localhost:5174"
        }
    }
}
Write-PidState -State $state

# ------------------------------------------------------------------------------
# Automatic Browser Launch
# ------------------------------------------------------------------------------
Write-Host "Opening web applications in default browser..." -ForegroundColor Yellow
try {
    Start-Process "http://localhost:5173"
    Start-Sleep -Milliseconds 800
    Start-Process "http://localhost:5174"
} catch {
    Write-Host "  [WARN] Could not automatically launch default browser: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  AUREL IS READY" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Customer Storefront:" -ForegroundColor Cyan
Write-Host "  http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "  Operations Dashboard:" -ForegroundColor Cyan
Write-Host "  http://localhost:5174" -ForegroundColor White
Write-Host ""
Write-Host "  Backend API:" -ForegroundColor Cyan
Write-Host "  http://localhost:4000" -ForegroundColor White
Write-Host ""
Write-Host "  Logs Directory:" -ForegroundColor DarkGray
Write-Host "  $($paths.LogsDir)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press any key to close the launcher window." -ForegroundColor Gray
Write-Host "  (Services will continue running in the background)" -ForegroundColor DarkGray
Write-Host "======================================================================" -ForegroundColor Green
exit 0
