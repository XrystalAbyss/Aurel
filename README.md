# Aurel — Restaurant Commerce & Operations Platform

> **A high-reliability, omnichannel restaurant commerce and operations platform demonstrating domain-driven architecture, concurrency safety, transactional reliability, and physical physical security controls.**

---

## 1. Project Architecture

Aurel is engineered as a **TypeScript Modular Monolith** with decoupled customer-facing and restaurant-operational web applications:

```text
Aurel/
├── apps/
│   ├── api/            # NestJS 11 REST API, Swagger & Prisma 7 ORM (@prisma/adapter-pg)
│   ├── storefront/     # Aurel Table: Customer dining & ordering SPA (React + Vite)
│   └── operations/     # Aurel Operations: Kitchen display & manager dashboard (React + Vite)
├── packages/
│   └── shared-types/   # Shared TypeScript domain contracts, DTOs & enums
├── infrastructure/
│   └── docker/         # Docker Compose for local PostgreSQL 16 containerization
├── docs/
│   ├── architecture/   # P0 Architectural Blueprint (v1.2.0-RC)
│   ├── development/    # Local developer setup guide & Windows specifics
│   └── decisions/      # Milestone architecture decision notes
└── .github/
    └── workflows/      # CI build, lint, and test validation pipeline
```

---

## 2. Technology Stack

- **Runtime:** Node.js 24 Active LTS (v24.20.0 verified)
- **Package Manager:** pnpm 12 (pinned v12.11.2, monorepo workspaces)
- **Backend API:** NestJS 11 (Express platform, TypeScript strict mode)
- **Database & ORM:** PostgreSQL 16 with **Prisma 7 (v7.10.0)** and `@prisma/adapter-pg` driver adapter
- **Frontends:** React 18, Vite 6, Tailwind CSS
- **Testing:** Jest 29, `ts-jest` & Supertest (with automated test database isolation)
- **API Documentation:** OpenAPI 3.0 / Swagger UI (`/api/docs`)
- **Code Quality:** ESLint flat config (`eslint.config.mjs`) & Prettier

---

## 3. Quickstart

### Prerequisites

- Node.js 24 LTS (`node >= 24.0.0`)
- pnpm 12 (`pnpm@12.11.2`)
- PostgreSQL 16 running on `127.0.0.1:5432`

### Installation & Startup

```powershell
# 1. Install dependencies across workspaces with frozen lockfile
pnpm install --frozen-lockfile

# 2. Configure environment variables (using placeholders)
Copy-Item .env.example apps/api/.env

# 3. Generate Prisma 7 Client
pnpm db:generate

# 4. Apply baseline database migrations
pnpm db:migrate

# 5. Run Core API server
pnpm dev:api
```

- API Health Check: `http://localhost:4000/api/v1/health`
- Swagger UI Documentation: `http://localhost:4000/api/docs`
- Customer Storefront (Aurel Table): `http://localhost:5173`
- Operations Workspace (Aurel Operations): `http://localhost:5174`

---

## 4. Verification & Quality Gates

```powershell
# Run unit tests across modules
pnpm test

# Run end-to-end integration tests (asserts test database isolation against aurel_test)
pnpm test:e2e

# Verify TypeScript type safety across all workspaces
pnpm typecheck

# Verify linting rules across workspaces
pnpm lint

# Verify Prettier code style
pnpm format:check

# Compile production bundles for all applications and packages
pnpm build
```

---

## 5. Academic Project & Demonstration Handoff

- **Project Title:** _Aurel — An Integrated Restaurant Ordering and Operations Management System_
- **Complete Academic Handoff Guide:** [`docs/demonstration/academic_project_handoff.md`](docs/demonstration/academic_project_handoff.md)
- **Verified MVP Status:** Full restaurant-commerce lifecycle verified with 193 unit tests, 129 PostgreSQL-backed E2E tests, 7 database migrations, and production builds across all 4 workspaces.

---

## 6. Specification Reference

Refer to the approved architecture specification for complete technical requirements, state machines, and concurrency algorithms:
[`docs/architecture/p0_architecture_blueprint.md`](docs/architecture/p0_architecture_blueprint.md)
