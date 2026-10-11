# Aurel — P1 Architecture Decision Notes

## Engineering Foundation & Baseline Adjustments

---

### Decision 1: Monorepo Orchestration via pnpm Workspaces

- **Decision:** Utilize native `pnpm` workspaces (`apps/*`, `packages/*`) pinned to pnpm 12 (v12.11.2) without secondary monorepo wrappers like Turborepo or Nx for P1.
- **Rationale:** Keeps developer experience lightweight and minimizes build tool overhead while guaranteeing fast, symlinked package resolution across `@aurel/shared-types`, `@aurel/api`, `@aurel/storefront`, and `@aurel/operations`.

### Decision 2: Prisma Schema Baseline & Migration Strategy

- **Decision:** Scaffold a minimal `SystemMetadata` table in `prisma/schema.prisma` with checked-in SQL migration `20261011161600_init_foundation`.
- **Rationale:** Establishes and verifies database connectivity, client generation, and schema migration without prematurely writing unapproved business models (orders, menu items, payments) before their dedicated milestones.

### Decision 3: Decoupled Single-Page Applications

- **Decision:** Separate `storefront` (port 5173) and `operations` (port 5174) with dedicated Vite configs and Tailwind design tokens.
- **Rationale:** Honors the P0 architectural mandate that Customer and Operations experiences have fundamentally divergent user journeys, visual palettes, and bundle optimization profiles.

### Decision 4: Test Infrastructure Selection (Jest 29 + ts-jest)

- **Decision:** Adopt Jest 29 paired with `ts-jest` for `@aurel/api` unit and end-to-end integration tests rather than Vitest with `@swc/core`.
- **Rationale:** The host Windows 11 machine enforces an App Control / Code Integrity policy that actively blocked native Rust binaries (`swc.win32-x64-msvc.node`). `ts-jest` executes pure JavaScript compilation without native binary execution hazards, providing 100% deterministic reproducibility across host developer environments and headless CI pipelines.

### Decision 5: Prisma 7 Driver Adapter Architecture (@prisma/adapter-pg)

- **Decision:** Align the persistence layer with Prisma 7 (v7.10.0), moving database connection configuration to `apps/api/prisma.config.ts`, adopting the `@prisma/adapter-pg` driver adapter, and utilizing a native `pg.Pool` connection pooler within NestJS `PrismaService`.
- **Rationale:** Strictly satisfies the P0 specification requiring Prisma 7 with driver adapters. Eliminates internal Rust query engine network abstraction in favor of standard JavaScript database driver adapters (`pg`), exposes pool tuning (`max: 10`, `idleTimeoutMillis: 30000`), and resolves schema datasource migration requirements cleanly.

### Decision 6: Test Database Isolation Safeguard

- **Decision:** Bind `PrismaService` connection logic to `TEST_DATABASE_URL` during test execution (`NODE_ENV === 'test'`) and enforce via E2E regression test that tests execute exclusively against `aurel_test` and never against `aurel_dev`.
- **Rationale:** Eliminates the risk of destructive or corrupting test operations impacting the local development database.
