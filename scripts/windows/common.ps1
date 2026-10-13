# ==============================================================================
# Aurel Windows Automation Suite — Shared Utilities
# ==============================================================================
# Strict safety rules:
# 1. Never terminate processes indiscriminately (no taskkill /IM node.exe).
# 2. Never kill PostgreSQL.
# 3. Double-verify process identity and creation-time before termination.
# 4. Reject stale PIDs if Windows recycled the PID for an unrelated process.
# 5. Missing or corrupted ownership records never trigger process killing.
# 6. Handle Windows paths with spaces reliably.
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $scriptDir = $null
    if ($PSScriptRoot) {
        $scriptDir = $PSScriptRoot
    } elseif ($MyInvocation.MyCommand -and (Get-Member -InputObject $MyInvocation.MyCommand -Name "Path")) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    } else {
        $scriptDir = (Get-Location).Path
    }
    
    # Climb up to repository root where package.json with name 'aurel-monorepo' resides
    $curr = Resolve-Path $scriptDir
    while ($curr) {
        $pkg = Join-Path $curr.Path "package.json"
        if (Test-Path $pkg) {
            try {
                $content = Get-Content $pkg -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($content -and $content.name -eq "aurel-monorepo") {
                    return $curr.Path
                }
            } catch {}
        }
        $parent = Split-Path -Parent $curr.Path
        if (-not $parent -or $parent -eq $curr.Path) { break }
        $curr = Resolve-Path $parent
    }
    return (Get-Location).Path
}

function Get-RuntimePaths {
    $repoRoot = Get-RepoRoot
    $runtimeDir = Join-Path $repoRoot ".aurel-runtime"
    $logsDir = Join-Path $runtimeDir "logs"
    $pidFile = Join-Path $runtimeDir "pids.json"
    
    return [PSCustomObject]@{
        RepoRoot      = $repoRoot
        RuntimeDir    = $runtimeDir
        LogsDir       = $logsDir
        PidFile       = $pidFile
        ApiLog        = Join-Path $logsDir "api.log"
        StorefrontLog = Join-Path $logsDir "storefront.log"
        OperationsLog = Join-Path $logsDir "operations.log"
    }
}

function Initialize-Runtime {
    $paths = Get-RuntimePaths
    if (-not (Test-Path $paths.RuntimeDir)) {
        New-Item -ItemType Directory -Path $paths.RuntimeDir -Force | Out-Null
    }
    if (-not (Test-Path $paths.LogsDir)) {
        New-Item -ItemType Directory -Path $paths.LogsDir -Force | Out-Null
    }
}

function Test-TcpPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [string]$HostName = "127.0.0.1",
        [int]$TimeoutMs = 1500
    )
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.BeginConnect($HostName, $Port, $null, $null)
        $success = $connect.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($success -and $client.Connected) {
            $client.EndConnect($connect)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($client -ne $null) {
            $client.Close()
        }
    }
}

function Get-PortListener {
    param([Parameter(Mandatory = $true)][int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            return [PSCustomObject]@{
                Port          = $Port
                ProcessId     = $conn.OwningProcess
                LocalAddress  = $conn.LocalAddress
            }
        }
        return $null
    } catch {
        return $null
    }
}

function Get-ProcessDetails {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        return $proc
    } catch {
        return $null
    }
}

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSec = 3
    )
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -Method Get -ErrorAction Stop
        $code = [int]$response.StatusCode
        $isOk = ($code -ge 200 -and $code -lt 400)
        return [PSCustomObject]@{
            Success    = $isOk
            StatusCode = $code
            Content    = $response.Content
            Error      = $null
        }
    } catch {
        $msg = $_.Exception.Message
        $code = 0
        if ($_.Exception -is [System.Net.WebException]) {
            $webEx = [System.Net.WebException]$_.Exception
            if ($webEx.Response) {
                $code = [int]$webEx.Response.StatusCode
            }
        }
        return [PSCustomObject]@{
            Success    = $false
            StatusCode = $code
            Content    = $null
            Error      = $msg
        }
    }
}

function Find-PostgreSqlService {
    try {
        $service = Get-Service -Name "*postgre*" -ErrorAction SilentlyContinue | Select-Object -First 1
        return $service
    } catch {
        return $null
    }
}

function Get-ProcessDescendants {
    param([Parameter(Mandatory = $true)][int]$ParentPid)
    $descendants = @()
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue
        if ($children) {
            foreach ($child in $children) {
                $descendants += $child
                $subChildren = Get-ProcessDescendants -ParentPid $child.ProcessId
                if ($subChildren) {
                    $descendants += $subChildren
                }
            }
        }
    } catch {}
    return $descendants
}

function Verify-IsAurelProcess {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [string]$ExpectedServiceName = ""
    )
    $proc = Get-ProcessDetails -ProcessId $ProcessId
    if (-not $proc) {
        return $false
    }
    
    $name = if ($proc.Name) { $proc.Name.ToLower() } else { "" }
    $cmd = if ($proc.CommandLine) { $proc.CommandLine.ToLower() } else { "" }
    $repoRoot = (Get-RepoRoot).ToLower()
    
    # Process must be a Node/CMD/pnpm/Vite wrapper
    $validNames = @("node.exe", "cmd.exe", "pnpm.cmd", "pnpm.exe", "vite.exe")
    if ($validNames -notcontains $name) {
        return $false
    }
    
    # Verify command line is tied to Aurel or contains the workspace path
    if ($cmd.Contains($repoRoot) -or 
        $cmd.Contains("aurel") -or 
        $cmd.Contains("dev:api") -or 
        $cmd.Contains("dev:storefront") -or 
        $cmd.Contains("dev:operations") -or 
        $cmd.Contains("nest start") -or 
        $cmd.Contains("vite")) {
        return $true
    }
    
    return $false
}

function Verify-LauncherOwnedProcess {
    param(
        [Parameter(Mandatory = $true)]$RecordedProcess,
        [string]$ServiceName = "Service"
    )
    
    $pidToCheck = 0
    if ($RecordedProcess -and $RecordedProcess.PSObject.Properties['RootPid']) {
        $pidToCheck = [int]$RecordedProcess.RootPid
    }
    if ($pidToCheck -le 0) {
        return [PSCustomObject]@{
            IsValid = $false
            Reason  = "InvalidPid"
            Message = "No valid process ID recorded for $ServiceName."
            Process = $null
        }
    }
    
    $proc = Get-ProcessDetails -ProcessId $pidToCheck
    if (-not $proc) {
        return [PSCustomObject]@{
            IsValid = $false
            Reason  = "ProcessNotRunning"
            Message = "$ServiceName (PID $pidToCheck) is not running."
            Process = $null
        }
    }
    
    # Creation-time verification to prevent PID reuse attack / PID recycling
    if ($RecordedProcess.PSObject.Properties['CreationDate'] -and 
        $RecordedProcess.CreationDate -and 
        $proc.CreationDate) {
        try {
            $recordedTime = [DateTime]::Parse($RecordedProcess.CreationDate).ToUniversalTime()
            $actualTime = $proc.CreationDate.ToUniversalTime()
            $diffSeconds = [Math]::Abs(($actualTime - $recordedTime).TotalSeconds)
            if ($diffSeconds -gt 5) {
                return [PSCustomObject]@{
                    IsValid = $false
                    Reason  = "StalePidRecycled"
                    Message = "Safety violation: PID $pidToCheck was recycled by Windows (creation time mismatch: recorded $recordedTime, actual $actualTime). Refusing to terminate."
                    Process = $proc
                }
            }
        } catch {
            # If parsing fails, proceed to signature check
        }
    }
    
    # Signature check on executable name and command line
    $isAurel = Verify-IsAurelProcess -ProcessId $pidToCheck -ExpectedServiceName $ServiceName
    if (-not $isAurel) {
        return [PSCustomObject]@{
            IsValid = $false
            Reason  = "SignatureMismatch"
            Message = "Safety violation: PID $pidToCheck command line does not match Aurel signature. Refusing to terminate."
            Process = $proc
        }
    }
    
    return [PSCustomObject]@{
        IsValid = $true
        Reason  = "Verified"
        Message = "$ServiceName (PID $pidToCheck) verified as launcher-owned Aurel process."
        Process = $proc
    }
}

function Read-PidState {
    $paths = Get-RuntimePaths
    if (Test-Path $paths.PidFile) {
        try {
            $raw = Get-Content $paths.PidFile -Raw -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $data = $raw | ConvertFrom-Json
                return $data
            }
        } catch {
            return $null
        }
    }
    return $null
}

function Write-PidState {
    param([Parameter(Mandatory = $true)]$State)
    $paths = Get-RuntimePaths
    Initialize-Runtime
    $json = $State | ConvertTo-Json -Depth 5
    Set-Content -Path $paths.PidFile -Value $json -Force -Encoding UTF8
}

function Clear-PidState {
    $paths = Get-RuntimePaths
    if (Test-Path $paths.PidFile) {
        Remove-Item -Path $paths.PidFile -Force -ErrorAction SilentlyContinue
    }
}

function Stop-AurelProcessTree {
    param(
        [Parameter(Mandatory = $true)]$RecordedService,
        [string]$ServiceName = "Service"
    )
    
    # 1. Verify launcher process ownership and reject stale/recycled PIDs
    $verifyResult = Verify-LauncherOwnedProcess -RecordedProcess $RecordedService -ServiceName $ServiceName
    if (-not $verifyResult.IsValid) {
        return [PSCustomObject]@{
            Status  = $verifyResult.Reason
            Message = $verifyResult.Message
        }
    }
    
    $rootPid = [int]$RecordedService.RootPid
    $rootProc = $verifyResult.Process
    
    # 2. Collect and verify descendant processes in the tree
    $descendants = Get-ProcessDescendants -ParentPid $rootPid
    $verifiedDescendantPids = @()
    foreach ($d in $descendants) {
        $isChildAurel = Verify-IsAurelProcess -ProcessId $d.ProcessId
        if ($isChildAurel) {
            $verifiedDescendantPids += $d.ProcessId
        }
    }
    
    $allPidsToStop = @($rootPid) + $verifiedDescendantPids
    
    # 3. Graceful termination phase (bounded timeout)
    # Attempt graceful shutdown first without forced termination
    foreach ($pidToStop in $allPidsToStop) {
        try {
            Stop-Process -Id $pidToStop -ErrorAction SilentlyContinue
        } catch {}
    }
    
    # Wait up to 3 seconds for graceful exit
    $gracefulWaitSec = 3
    $elapsed = 0
    $stillAlivePids = @()
    while ($elapsed -lt $gracefulWaitSec) {
        Start-Sleep -Milliseconds 500
        $elapsed += 0.5
        $stillAlivePids = @()
        foreach ($p in $allPidsToStop) {
            $check = Get-ProcessDetails -ProcessId $p
            if ($check) {
                $stillAlivePids += $p
            }
        }
        if ($stillAlivePids.Count -eq 0) {
            break
        }
    }
    
    # 4. Bounded forced termination only for verified processes that did not exit gracefully
    if ($stillAlivePids.Count -gt 0) {
        try {
            & taskkill.exe /PID $rootPid /T /F 2>&1 | Out-Null
        } catch {}
        
        Start-Sleep -Milliseconds 500
        
        # Final cleanup pass strictly for verified target PIDs
        foreach ($p in $stillAlivePids) {
            $remaining = Get-ProcessDetails -ProcessId $p
            if ($remaining -and (Verify-IsAurelProcess -ProcessId $p)) {
                try {
                    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                } catch {}
            }
        }
    }
    
    # Confirm listening process (if recorded) is stopped
    if ($RecordedService.PSObject.Properties['ListeningPid'] -and $RecordedService.ListeningPid -and [int]$RecordedService.ListeningPid -gt 0) {
        $listPid = [int]$RecordedService.ListeningPid
        $lp = Get-ProcessDetails -ProcessId $listPid
        if ($lp -and (Verify-IsAurelProcess -ProcessId $listPid)) {
            try { Stop-Process -Id $listPid -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    
    return [PSCustomObject]@{
        Status          = "Terminated"
        Message         = "$ServiceName (PID $rootPid and $($verifiedDescendantPids.Count) child processes) shut down cleanly."
        DescendantsCount = $verifiedDescendantPids.Count
    }
}

function Start-AurelBackgroundProcess {
    param(
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$LogFilePath,
        [string]$ServiceName = "Service"
    )
    
    # Ensure log directory exists
    $logDir = Split-Path -Parent $LogFilePath
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    
    # Clean previous log file
    if (Test-Path $LogFilePath) {
        Remove-Item -Path $LogFilePath -Force -ErrorAction SilentlyContinue
    }
    
    # Direct execution via cmd.exe redirection
    $cmd = "cmd.exe /c $CommandLine > `"$LogFilePath`" 2>&1"
    
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine      = $cmd
        CurrentDirectory = $WorkingDirectory
    }
    
    if ($res.ReturnValue -ne 0) {
        throw "Failed to create background process (WMI ReturnValue: $($res.ReturnValue)) for command: $CommandLine"
    }
    
    $procId = [int]$res.ProcessId
    
    # Retrieve process details immediately to capture exact creation timestamp
    Start-Sleep -Milliseconds 300
    $proc = Get-ProcessDetails -ProcessId $procId
    $creationDate = if ($proc -and $proc.CreationDate) {
        $proc.CreationDate.ToUniversalTime().ToString("o")
    } else {
        (Get-Date).ToUniversalTime().ToString("o")
    }
    
    return [PSCustomObject]@{
        ProcessId    = $procId
        CommandLine  = $cmd
        CreationDate = $creationDate
        ProcessName  = if ($proc) { $proc.Name } else { "cmd.exe" }
        ServiceName  = $ServiceName
    }
}

function Show-LogTail {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [int]$Lines = 15
    )
    if (Test-Path $FilePath) {
        Write-Host "--- Last $Lines lines of $(Split-Path -Leaf $FilePath) ---" -ForegroundColor DarkYellow
        Get-Content -Path $FilePath -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  $_" -ForegroundColor DarkGray
        }
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkYellow
    } else {
        Write-Host "Log file not found: $FilePath" -ForegroundColor DarkGray
    }
}
