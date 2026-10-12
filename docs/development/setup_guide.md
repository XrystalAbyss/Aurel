# Aurel — Developer Setup & Environment Guide

---

## 1. Prerequisites

- **Operating System:** Windows 11 (tested), macOS, or Linux.
- **Node.js:** v24.x LTS (verified with v24.20.0).
- **Package Manager:** pnpm 12 (pinned v12.11.2).
- **PostgreSQL:** PostgreSQL 16 running on `127.0.0.1:5432`.
- **Git:** Git v2.40+ (verified with v2.55.0).

---

## 2. Local Environment Setup

### Step 1: Install Dependencies

```powershell
# In Windows PowerShell (Run once if execution policy restricts ps1 scripts):
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Install monorepo workspace dependencies:
pnpm install --frozen-lockfile
```

### Step 2: Configure Environment Variables

Copy `.env.example` to `apps/api/.env` and update credentials using placeholders:

```powershell
Copy-Item .env.example apps/api/.env
```

Ensure `DATABASE_URL` and `TEST_DATABASE_URL` match your local PostgreSQL connection strings:

```text
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@127.0.0.1:5432/aurel_dev?schema=public"
TEST_DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@127.0.0.1:5432/aurel_test?schema=public"
```

> **Security Note:** Real `.env` files are ignored by `.gitignore`. Never commit or paste active database passwords into issue reports, version control, or shared documentation.

### Step 3: Provision Databases & Apply Migrations

Create two segregated local databases for development and testing:

```powershell
# Connect via psql to create development and testing databases:
psql -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE aurel_dev;"
psql -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE aurel_test;"

# Generate Prisma 7 Client:
pnpm db:generate

# Apply baseline database migrations:
pnpm db:migrate
```

---

## 3. Running Applications in Development

Run components concurrently or individually:

- **Start Core API (NestJS):**

  ```powershell
  pnpm dev:api
  ```

  - API endpoint: `http://localhost:4000/api/v1`
  - Swagger UI: `http://localhost:4000/api/docs`
  - Health check: `http://localhost:4000/api/v1/health`

- **Start Customer Storefront (Aurel Table):**

  ```powershell
  pnpm dev:storefront
  ```

  - Storefront opens at `http://localhost:5173`

- **Start Operations Workspace (Aurel Operations):**

  ```powershell
  pnpm dev:operations
  ```

  - Operations dashboard opens at `http://localhost:5174`

---

## 4. Running Quality Gates & Tests

```powershell
# Execute unit tests:
pnpm test

# Execute API integration & end-to-end tests (asserts test database isolation against aurel_test):
pnpm test:e2e

# Verify TypeScript type checks across all workspaces:
pnpm typecheck

# Verify ESLint across packages:
pnpm lint

# Verify Prettier code style:
pnpm format:check

# Build all packages and applications:
pnpm build
```

---

## 5. Safe Database Credential Rotation

If you suspect database credentials have been exposed:

1. Update the local PostgreSQL user password via `psql`:
   ```powershell
   psql -U postgres -h 127.0.0.1 -p 5432 -c "ALTER USER postgres WITH PASSWORD '<NEW_STRONG_PASSWORD>';"
   ```
2. Update `apps/api/.env` with the rotated `<NEW_STRONG_PASSWORD>`.
3. Verify connectivity with `pnpm test:e2e`.

---

## 6. Reverse Proxy Trust & Client-IP Security Architecture

Aurel enforces strict client-IP resolution to ensure rate limiting cannot be evaded by malicious clients injecting fake forwarding headers:

### Baseline Security Defaults (`TRUST_PROXY=false`)

- **Default Behavior**: Proxy trust is disabled by default.
- **Client IP Derivation**: Express derives `req.ip` directly from the TCP socket connection address (`req.socket.remoteAddress`).
- **Header Isolation**: Client-supplied `X-Forwarded-*` headers are completely ignored.
- **Local Development**: In development and automated test suites, all incoming requests resolve to the true connection IP (`127.0.0.1` or `::1`), ensuring that rotating `X-Forwarded-For` headers cannot bypass rate-limiting counters.

### Production Reverse Proxy Deployment (`TRUST_PROXY=true`)

When Aurel is deployed behind a dedicated front-facing reverse proxy (e.g., AWS ALB, Nginx, Cloudflare, Traefik):

1. **Enable Proxy Trust**: Set `TRUST_PROXY=true` in the environment.
2. **Framework Boundary**: Express is configured with `app.set('trust proxy', 1)`. Express evaluates the client IP from the 1st trusted reverse proxy hop from the right, preventing clients from prepending arbitrary leftmost IPs in the forwarding chain.
3. **Mandatory Proxy Sanitization**: The front-facing reverse proxy **must** sanitize client-submitted `X-Forwarded-For` headers. For example, in Nginx:
   ```nginx
   # Nginx must replace or cleanly append the client connection address:
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Real-IP $remote_addr;
   ```
4. **Security Risk of Misconfiguration**: Setting `TRUST_PROXY=true` when the application is directly exposed to public traffic (without an intervening reverse proxy) allows attackers to freely select their rate-limiting identity, defeating IP-based brute-force defenses.
