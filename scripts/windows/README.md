# Aurel — Windows One-Click Automation Suite

Professional, production-grade Windows automation scripts for starting, inspecting, and gracefully stopping the complete **Aurel Restaurant Commerce & Operations Platform** with a single double-click.

---

## 1. Quick Start

| Action           | Entry Point       | Description                                                                                                                                                       |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start Aurel**  | `Start_Aurel.bat` | Double-click to start PostgreSQL check, Database validation, NestJS API, Customer Storefront, and Operations Dashboard. Opens default browser tabs automatically. |
| **Check Health** | `Check_Aurel.bat` | Double-click to inspect real-time system status (PostgreSQL, DB connection, API, Storefront, Operations, and PIDs).                                               |
| **Stop Aurel**   | `Stop_Aurel.bat`  | Double-click to gracefully shut down Aurel API, Storefront, and Operations processes. Preserves PostgreSQL and unrelated applications.                            |

---

## 2. Platform Architecture & Ports

| Component                | Port   | Health Endpoint / URL                 | Technology                      |
| ------------------------ | ------ | ------------------------------------- | ------------------------------- |
| **PostgreSQL Database**  | `5432` | `127.0.0.1:5432/aurel_dev`            | PostgreSQL 16 (Windows Service) |
| **Backend REST API**     | `4000` | `http://localhost:4000/api/v1/health` | NestJS 11 + Prisma ORM          |
| **Customer Storefront**  | `5173` | `http://localhost:5173`               | React 18 + Vite 6               |
| **Operations Dashboard** | `5174` | `http://localhost:5174`               | React 18 + Vite 6               |

---

## 3. Directory & File Structure

```
Aurel/
├── Start_Aurel.bat              # Primary launcher entrypoint (double-clickable)
├── Stop_Aurel.bat               # Safe shutdown entrypoint (double-clickable)
├── Check_Aurel.bat              # Diagnostics and status check entrypoint
├── scripts/
│   └── windows/
│       ├── common.ps1           # Shared utilities (ports, TCP/HTTP, process tree verification)
│       ├── start.ps1            # 6-step initialization orchestrator with health polling
│       ├── stop.ps1             # Graceful process tree terminator with safety checks
│       ├── check.ps1            # Real-time health diagnostic utility
│       └── README.md            # This operational documentation
└── .aurel-runtime/              # Runtime directory (Git-ignored)
    ├── pids.json                # Active launcher process tracking state
    └── logs/
        ├── api.log              # API stdout/stderr log
        ├── storefront.log       # Customer storefront log
        └── operations.log       # Operations dashboard log
```

---

## 4. Startup Workflow (`Start_Aurel.bat`)

When you double-click `Start_Aurel.bat`, the orchestrator executes the following six stages:

1. **[1/6] Checking prerequisites:**
   - Confirms execution from repository root (`aurel-monorepo`).
   - Verifies Node.js installation (requires Node.js >= 20, recommended 24+).
   - Verifies `pnpm` availability (>= 9 or 12).
   - Verifies that `node_modules` dependencies exist.
   - Verifies environment configuration in `apps/api/.env`.
2. **[2/6] Checking PostgreSQL:**
   - Tests TCP socket connection on port 5432.
   - If PostgreSQL is stopped, detects the installed Windows service (e.g. `postgresql-x64-16`) and attempts to start it.
   - If administrator elevation is required, alerts the user with exact commands to start the service manually.
3. **[3/6] Checking database readiness:**
   - Runs non-destructive read-only migration status check (`prisma migrate status`).
   - Ensures `aurel_dev` database schema is up to date.
   - Never drops tables, never resets database, and never modifies unrelated databases.
4. **[4/6] Starting backend API:**
   - Checks if API is already running or port 4000 is occupied.
   - Launches `pnpm --filter @aurel/api dev` detached in background with logs redirected to `.aurel-runtime/logs/api.log`.
5. **[5/6] Starting customer storefront:**
   - Launches `pnpm --filter @aurel/storefront dev` detached on port 5173 with logs to `.aurel-runtime/logs/storefront.log`.
6. **[6/6] Starting operations dashboard:**
   - Launches `pnpm --filter @aurel/operations dev` detached on port 5174 with logs to `.aurel-runtime/logs/operations.log`.
7. **Readiness Polling & Browser Launch:**
   - Polls HTTP endpoints (`/api/v1/health`, `:5173`, `:5174`) with bounded timeout (60 seconds).
   - Detects premature process exits and displays the last lines of the service log.
   - Once all three endpoints report HTTP 200, opens `http://localhost:5173` and `http://localhost:5174` in the default Windows browser.
   - Records process IDs to `.aurel-runtime/pids.json`.
   - Displays completion banner. Closing the launcher terminal **does NOT terminate** the background services.

---

## 5. Critical Safety Guarantees

### A. No Indiscriminate Process Termination & Process Ownership Safety

The launcher **never** runs indiscriminate commands such as `taskkill /F /IM node.exe`.

- **Cryptographic Process Identity:** When processes are launched, the launcher records root PIDs, executable names, command lines, and exact OS creation timestamps (`CreationDate`) in `.aurel-runtime/pids.json`.
- **Stale PID Rejection:** Before terminating any process, `Stop_Aurel.bat` verifies that the running process creation timestamp matches the recorded timestamp. If Windows has recycled the PID for an unrelated process, the launcher rejects termination and issues a safety alert.
- **Child Process Verification:** Descendant processes in the tree are inspected before termination to confirm they are legitimate Aurel subprocesses (`node.exe`, `pnpm`, `vite.exe`).
- **Missing State Safeguard:** If `.aurel-runtime/pids.json` is missing or corrupted, `Stop_Aurel.bat` **will not kill any processes**. Port scanning alone is used solely for diagnostics, never to authorize termination. Manual troubleshooting instructions are displayed instead.
- **Bounded Graceful Shutdown:** Services are given a bounded graceful shutdown window (3 seconds) before any targeted forced termination is applied strictly to verified launcher PIDs.

### B. Database Safety

- The launcher **never** runs `prisma migrate reset`, destructive migrations, or automated seed resets.
- Existing order records, menu items, demo accounts, and password hashes are strictly preserved.
- PostgreSQL service is **never stopped automatically**, ensuring shared database instances (e.g., other projects) continue uninterrupted.

### C. Duplicate Stack Prevention

- If `Start_Aurel.bat` is executed while Aurel is already running, the launcher detects that all services are active and healthy, reports the URLs, and exits safely without spawning duplicate service processes or cluttering browser tabs.

---

## 6. Troubleshooting & Common Issues

### Issue 1: PostgreSQL is Stopped

- **Symptom:** Launcher reports `[FAIL] PostgreSQL is not running on port 5432`.
- **Solution:** If Windows permissions prevent non-admin service starting, open PowerShell as Administrator and run:
  ```powershell
  net start postgresql-x64-16
  ```
  Or press `Win + R`, type `services.msc`, locate `postgresql-x64-16`, and click **Start**.

### Issue 2: Port Conflict (Port 4000, 5173, or 5174 occupied)

- **Symptom:** Launcher reports `Port XXXX is occupied by an unverified process (PID: YYYY)`.
- **Solution:** Run `Check_Aurel.bat` to see which service is running. If an unrelated program is using the port, terminate the offending process using its PID or restart that program on a different port.

### Issue 3: Missing Dependencies or Environment Files

- **Symptom:** Launcher reports `[FAIL] Project dependencies are missing` or `apps\api\.env missing`.
- **Solution:**
  1. Ensure you have run:
     ```powershell
     pnpm install
     ```
  2. Verify that `apps/api/.env` exists and has valid database credentials.

### Issue 4: Inspection of Service Logs

- All background output and error traces are captured in real time:
  - Backend API: `.aurel-runtime\logs\api.log`
  - Customer Storefront: `.aurel-runtime\logs\storefront.log`
  - Operations Dashboard: `.aurel-runtime\logs\operations.log`
