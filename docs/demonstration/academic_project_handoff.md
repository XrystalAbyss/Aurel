# Aurel — An Integrated Restaurant Ordering and Operations Management System

> **Academic Project Handoff & Technical Demonstration Guide**  
> **Course / Degree:** Final Year Capstone / Advanced Software Engineering Project  
> **System Classification:** Production-Grade Modular Monolith (Web & API)  
> **Target Delivery Date:** October 15, 2026

---

## 1. Executive Summary

### Academic Project Description (For Evaluators & Faculty)

_Aurel_ is an enterprise-grade, omnichannel restaurant commerce and operations management system engineered as a high-reliability TypeScript modular monolith. The system bridges the divide between customer-facing guest commerce (menu discovery, modifier customization, cart calculations, omnichannel checkout, and privacy-preserving status tracking) and internal kitchen/staff operations (Kanban kitchen display terminal, role-based order state machines, and 86-item availability management). Built atop NestJS, PostgreSQL 16 with Prisma ORM, and dual Vite/React applications, Aurel enforces rigorous concurrency safety, server-authoritative integer paise pricing, double-submit CSRF protection bound to session state, and idempotent transaction processing.

### Resume-Ready Project Summary

> **Aurel — Integrated Restaurant Commerce & Operations Platform** _(TypeScript, NestJS, React, PostgreSQL, Prisma, Tailwind)_  
> • Architected a full-stack restaurant platform with decoupled Guest Storefront and Staff Operations web portals backed by a strict modular monolith REST API.  
> • Implemented an immutable order fulfillment state machine with PostgreSQL transactions, Argon2id identity authentication, and granular Role-Based Access Control (RBAC).  
> • Engineered server-authoritative financial calculation in integer paise with modifier constraints and cryptographic idempotency key fingerprinting.  
> • Enforced multi-layered security boundaries including double-submit CSRF protection, guest PII data masking, and automated rate limiting, validated by 193 unit and 129 PostgreSQL E2E tests.

---

## 2. System Architecture

```text
                               ┌──────────────────────────────────────────────┐
                               │               Client Tier                    │
                               │                                              │
                               │  Storefront (SPA)       Operations Portal    │
                               │   (Port 5173)              (Port 5174)       │
                               │  [Guest Commerce]       [Staff / Kitchen]    │
                               └──────────────┬──────────────────┬────────────┘
                                              │ HTTP / JSON      │ HTTP / JSON
                                              │ (CORS Whitelist) │ (SameSite Cookies)
                                              ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NestJS Modular Monolith API                        │
│                                  (Port 4000)                                │
│                                                                             │
│  ┌─────────────────────────┐  ┌────────────────────────┐  ┌──────────────┐  │
│  │     IdentityModule      │  │     CatalogModule      │  │ OrdersModule │  │
│  │  • Argon2id Hashing     │  │  • Hierarchical Menu   │  │  • Lifecycle │  │
│  │  • Stateful Sessions    │  │  • Modifier Constraints│  │  • State Mach│  │
│  │  • Double-Submit CSRF   │  │  • Live 86 Manager     │  │  • Integer ₹ │  │
│  └────────────┬────────────┘  └───────────┬────────────┘  └──────┬───────┘  │
│               │                           │                      │          │
│  ┌────────────▼───────────────────────────▼──────────────────────▼───────┐  │
│  │                  Security Guards & Interceptor Layer                  │  │
│  │     SessionAuthGuard  •  CsrfGuard  •  PermissionsGuard (RBAC)         │  │
│  └────────────────────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────────────────┼─────────────────────────────────┘
                                            │ Prisma 7 (@prisma/adapter-pg)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PostgreSQL 16 Relational Engine                       │
│                                                                             │
│   [users] ──< [auth_sessions]    [menu_categories] ──< [menu_items]         │
│      │                                                      │               │
│      └──< [security_audit_logs]     [modifier_groups] ──< [order_items]     │
│                                                                 ▲           │
│   [orders] (Idempotency Fingerprint & Guest Token) ─────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Features & Capabilities

### Customer Storefront (`@aurel/storefront`)

- **Visual Haute Gastronomie UI:** Responsive dark-mode interface with gold/bronze palette and Cormorant Garamond / Plus Jakarta Sans typography.
- **Omnichannel Fulfillment:** Instant switching between **Dine-In** (table service), **Pickup** (curbside counter), and **Delivery** (+₹50 logistics fee).
- **Modifier Engine:** Dynamic options modal supporting required doneness options, optional sauces/sides, and real-time total pricing.
- **Client-Side Cart:** Dynamic item quantity adjustment, automatic subtotal and 5% GST tax computation.
- **Guest Order Privacy & Tracking:** Placed orders receive a cryptographically random, hashed guest access token stored in `sessionStorage`. Active order tracker updates via adaptive polling without requiring user account creation while masking PII (`a***r@example.com`, `***-***-3210`).

### Operations Workspace (`@aurel/operations`)

- **Role-Based Command Terminal:** Authenticated dashboard tailored for **Floor Staff**, **Kitchen Staff**, **Managers**, and **Administrators**.
- **Kanban Order Queue:** Orders partitioned across 4 lifecycle columns:
  1. _Incoming / Placed_ (Awaiting staff acceptance)
  2. _Kitchen Display_ (Active preparation on Robata grill & wood-fired stations)
  3. _Ready for Service_ (Plated and waiting for runner / dispatch)
  4. _Fulfilled / History_ (Delivered / tableside service complete)
- **Menu 86 Manager:** Managers and administrators can toggle item availability in real-time to immediately prevent orders on out-of-stock inventory.
- **Local Dev Profile Switcher:** Rapid demonstration profile switcher in non-production environments (`Staff`, `Kitchen`, `Admin`).

---

## 4. Technical Specifications & Stack

| Dimension               | Technology         | Specification / Standard                                              |
| :---------------------- | :----------------- | :-------------------------------------------------------------------- |
| **Runtime**             | Node.js            | v20+ / v24 Active LTS                                                 |
| **Package Management**  | pnpm               | Workspace monorepo (`pnpm@9+` / `12+`)                                |
| **Backend Framework**   | NestJS             | v11, TypeScript strict, modular architecture                          |
| **Relational Database** | PostgreSQL         | PostgreSQL 16 with native JSONB and indexes                           |
| **ORM & Driver**        | Prisma ORM         | Prisma 7 (`@prisma/adapter-pg` driver adapter)                        |
| **Frontends**           | React 18 & Vite    | Dual SPAs with Tailwind CSS                                           |
| **Password Security**   | Argon2id           | Memory: 64MB, Iterations: 3, Parallelism: 4                           |
| **Anti-CSRF**           | Cryptographic HMAC | Double-submit token tied to session ID / anonymous                    |
| **Financial Math**      | Integer Paise      | Pure integer math (1 INR = 100 paise) preventing IEEE 754 float drift |
| **Testing**             | Jest & Supertest   | 193 Unit Tests & 129 PostgreSQL-backed E2E Tests                      |

---

## 5. Local Setup & Safe Demonstration Startup

### Step 1: Clone & Install

```bash
git clone https://github.com/XrystalAbyss/Aurel.git
cd Aurel
pnpm install --frozen-lockfile
```

### Step 2: Configure Environment

Copy `.env.example` to `apps/api/.env` and verify database connection:

```env
PORT=4000
API_PREFIX=api/v1
DATABASE_URL="postgresql://aurel_app_dev:password@127.0.0.1:5432/aurel_dev?schema=public"
TEST_DATABASE_URL="postgresql://aurel_app_test:password@127.0.0.1:5432/aurel_test?schema=public"
CORS_ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5174"
SESSION_SECRET="development_session_secret_change_in_production_min_32_chars"
CSRF_SECRET="development_csrf_secret_change_in_production_min_32_chars"
```

### Step 3: Run Migrations & Safe Demo Seeding

```bash
# Apply all 7 database migrations
pnpm db:migrate:deploy

# Safely seed demonstration accounts (requires opt-in on aurel_dev)
cmd /c "set ALLOW_DEV_DB_DEMO_SEED=true&& pnpm seed:staff"
```

### Step 4: Launch Applications

In three separate terminal tabs:

```bash
# Terminal 1 — Backend API (Port 4000)
pnpm dev:api

# Terminal 2 — Customer Storefront (Port 5173)
pnpm dev:storefront

# Terminal 3 — Operations Terminal (Port 5174)
pnpm dev:operations
```

---

## 6. End-to-End Demonstration Script (5–7 Minutes)

| Time            | Scene                                         | Demonstrated Actions                                                                                                                                         | Key Talking Points                                                                                                          |
| :-------------- | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **0:00 - 1:00** | **Scene 1: Introduction**                     | Overview of Aurel monorepo and architecture diagram.                                                                                                         | Highlight modular monolith structure, separate guest vs operational concerns, and strict PostgreSQL transaction model.      |
| **1:00 - 2:15** | **Scene 2: Storefront Discovery**             | Navigate `http://localhost:5173`. Switch channels (Dine-in / Pickup / Delivery). Select item with modifiers (e.g., A5 Wagyu Tenderloin with Truffle Butter). | Real-time catalog retrieval from PostgreSQL; modifier group validation enforces required options server-side.               |
| **2:15 - 3:00** | **Scene 3: Cart & Guest Checkout**            | Adjust cart quantities. Fill Dine-In details (Alexander Vance, Table 4). Place order.                                                                        | Server-authoritative integer paise calculation; double-submit anonymous CSRF token; idempotency key prevents double submit. |
| **3:00 - 3:45** | **Scene 4: Order Confirmation & PII Masking** | Note Order Number and Live Tracker banner. Show masked email and phone.                                                                                      | Guest token authentication protects order data from public scanning without requiring an account.                           |
| **3:45 - 4:45** | **Scene 5: Operations Queue & Staff Accept**  | Open `http://localhost:5174`. Log in as Floor Staff (`staff@aurel.restaurant`). Click **Accept Order**.                                                      | Session cookie authentication; RBAC permission `orders.edit.status`; order transitions from `PLACED` to `ACCEPTED`.         |
| **4:45 - 5:45** | **Scene 6: Kitchen Display & Fulfillment**    | Switch to Kitchen Staff (`kitchen@aurel.restaurant`). Advance to `PREPARING`, then `READY`. Switch to Floor Staff to mark `SERVED`.                          | Strict state machine lifecycle; kitchen staff lacks permission to mark fulfilled; floor staff marks served tableside.       |
| **5:45 - 6:30** | **Scene 7: Live Status Reflection**           | Return to Storefront tab `http://localhost:5173`. Note Live Tracker reflects `SERVED`.                                                                       | Adaptive polling reflects kitchen updates to customer in real-time.                                                         |
| **6:30 - 7:00** | **Scene 8: Architecture & Security**          | Review test suite (193 unit, 129 E2E) and Swagger documentation.                                                                                             | Concurrency safety, audit trails, and security boundaries.                                                                  |

---

## 7. Real vs. Simulated Capabilities

### Real Capabilities (Production-Ready Code)

- **Database Engine:** PostgreSQL 16 schema with 7 migrations, foreign keys, cascade safety, and unique constraints.
- **Authentication & Authorization:** Stateful sessions stored in database, Argon2id hashing, role-based access control (`CUSTOMER`, `STAFF`, `KITCHEN`, `MANAGER`, `ADMIN`).
- **CSRF Defense:** Double-submit cookie pattern cryptographically verified and bound to session IDs.
- **Pricing & Currency:** Integer paise arithmetic preventing rounding errors; server-side modifier price summing.
- **Concurrency & Idempotency:** Hashed idempotency key storage rejecting duplicate or tampered requests with HTTP 409.

### Simulated / Demonstration Boundaries

- **Payment Gateway:** Demonstrates payment handling via `DEMO` payment mode (in-memory balance simulation; no live Stripe/Razorpay credit card integration).
- **Taxation:** Flat 5% GST computation for demonstration; does not integrate with official tax filing authorities.
- **Multi-Tenancy:** Single restaurant location architecture; multi-branch enterprise isolation is out of scope.
- **Physical Printing:** Kitchen tickets render visually on the KDS board; physical POS ESC/POS hardware printing is not connected.

---

## 8. Verified Quality Baseline

All tests executed and verified against active PostgreSQL 16 engine:

- **Unit Tests:** `193 passed` (16 test suites)
- **PostgreSQL E2E Tests:** `129 passed` (5 test suites)
- **TypeScript:** 0 errors across 4 workspaces
- **ESLint:** 0 warnings, 0 errors
- **Prettier:** 100% formatted
- **Workspace Builds:** All 4 workspaces compile to production artifacts

---

## 9. Ten Likely Professor / Evaluator Questions & Accurate Answers

### Q1: Why did you choose a Modular Monolith architecture instead of Microservices?

**Answer:** A modular monolith provides the strong domain encapsulation of microservices (distinct `IdentityModule`, `CatalogModule`, `OrdersModule`) without distributed transaction overhead, network latency, distributed tracing complexity, or partial-failure modes. Cross-module operations run within native PostgreSQL transactions, ensuring ACID guarantees without two-phase commit protocols.

### Q2: Why represent prices in integer paise instead of floating-point numbers?

**Answer:** Standard IEEE 754 floating-point arithmetic introduces cumulative precision errors (e.g., `0.1 + 0.2 = 0.30000000000000004`). In financial commerce, this leads to accounting drift. Aurel stores and computes all monetary amounts in integer paise (₹1.00 = 100 paise), guaranteeing exact integer mathematics across item totals, modifiers, GST taxes, and delivery fees.

### Q3: How is double-checkout / duplicate order placement prevented under poor network conditions?

**Answer:** Orders require a client-generated `idempotencyKey` passed in request header and body. The backend computes a SHA-256 fingerprint of the request payload. In PostgreSQL, idempotency keys are tracked with unique constraints. A duplicate submission with the identical payload returns the originally created order safely; an attempt to reuse an idempotency key with a modified payload returns HTTP 409 Conflict.

### Q4: How does guest checkout protect customer privacy without requiring user accounts?

**Answer:** During guest checkout, a high-entropy random token (`guestAccessToken`) is generated. The database stores only a SHA-256 hash of this token. The unhashed token is returned once to the caller and stored in browser `sessionStorage`. Subsequent queries to `/orders/:id` require the `X-Order-Token` header. Responses sanitize customer Personally Identifiable Information (e.g., masking email as `a***r@example.com` and phone as `***-***-3210`).

### Q5: Why Argon2id over bcrypt or PBKDF2 for password storage?

**Answer:** Argon2id is the winner of the Password Hashing Competition (PHC) and combines Argon2d (data-dependent memory access resistant to GPU side-channel attacks) and Argon2i (data-independent memory access resistant to cache timing attacks). Aurel configures 64MB memory cost, 3 iterations, and parallelism of 4.

### Q6: How does the multi-layer CSRF defense model work across guest and authenticated requests?

**Answer:** Layer 1 verifies `Origin` and `Referer` headers against the strict CORS allowlist. Layer 2 employs a double-submit HMAC token pattern. For authenticated staff, tokens are cryptographically bound to the active `session.id`. For pre-login guests, tokens are bound to an `anonymous` scope. Requests carrying cookies, origin headers, or mutating state must match the header token to the cookie token and validate the cryptographic signature.

### Q7: How does the order state machine prevent illegal or out-of-order status transitions?

**Answer:** Order statuses follow a strict finite state machine: `PLACED` ➔ `ACCEPTED` ➔ `PREPARING` ➔ `READY` ➔ `SERVED` (or `DELIVERED`). Each transition is governed by Role-Based Access Control (RBAC). For example, kitchen staff cannot jump from `PLACED` to `READY` or mark an order `SERVED`; floor staff must verify and serve tableside.

### Q8: What prevents an attacker from self-registering as a manager or administrator?

**Answer:** The public `/auth/register` endpoint hardcodes user creation to role `CUSTOMER`. Staff and administrative identities can only be provisioned through internal bootstrap CLI scripts or authenticated administrative invitations requiring a single-use hashed setup token. The demo seeder enforces an exact database allowlist and explicitly refuses to elevate existing customer accounts.

### Q9: Why use adaptive polling rather than WebSockets for the guest order tracker?

**Answer:** Anonymous guest tracking over WebSockets requires maintaining stateful TCP connections and heartbeat management for potentially thousands of transient visitors who may leave the tab. Adaptive HTTP polling (3-second interval while active) with conditional `X-Order-Token` headers is stateless, horizontally scalable, resilient to temporary disconnections, and simpler to secure behind edge reverse proxies.

### Q10: What are the primary boundaries between production-ready code and simulation in this MVP?

**Answer:** Production-ready components include the PostgreSQL relational schema, Prisma ORM queries, Argon2id authentication, RBAC authorization, state machines, integer financial calculations, and CSRF protection. Simulated boundaries include the payment processing (handled via `DEMO` in-memory mode rather than live bank webhooks) and flat 5% GST computation (which is an illustrative estimate rather than an integrated multi-jurisdiction tax engine).

---

## 10. Project Summary for Formal Applications & Cover Letters

> **Aurel — An Integrated Restaurant Ordering and Operations Management System**  
> Designed and built an enterprise-grade restaurant commerce platform utilizing a TypeScript modular monolith architecture (NestJS 11, React 18, Vite 6, PostgreSQL 16, Prisma 7). The platform integrates a high-aesthetic luxury customer storefront with a role-based staff operations and kitchen display terminal. Implemented server-authoritative integer paise financial calculation, double-submit CSRF protection bound to session scopes, cryptographic idempotency fingerprinting, and privacy-preserving guest tracking with SHA-256 hashed tokens. Verified through 193 unit tests, 129 PostgreSQL-backed E2E integration tests, and 7 database migrations.

---

## 11. Live Demonstration Troubleshooting Checklist

| Issue Observed                            | Root Cause                                                                | Immediate Resolution                                                                                                            |
| :---------------------------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| **`ECONNREFUSED 127.0.0.1:5432`**         | PostgreSQL service is stopped.                                            | Start PostgreSQL 16 service locally or via Docker Compose (`docker compose -f infrastructure/docker/docker-compose.yml up -d`). |
| **Port Conflict (`EADDRINUSE: 4000`)**    | Previous background API process still listening.                          | Run `netstat -ano \| findstr 4000` and terminate the PID (`taskkill /PID <PID> /F`).                                            |
| **`403 Forbidden: CSRF_ERROR`**           | Request missing `X-CSRF-Token` header or mismatching `aurel_csrf` cookie. | Refresh storefront tab to trigger auto-bootstrap from `/api/v1/auth/csrf`. Ensure browser allows SameSite cookies on localhost. |
| **Demo Seeder Refusal on `aurel_dev`**    | Safety guard requires explicit opt-in for dev target.                     | Run with opt-in: `cmd /c "set ALLOW_DEV_DB_DEMO_SEED=true&& pnpm seed:staff"`.                                                  |
| **Tracking Banner Missing After Refresh** | Session storage cleared or hard private browsing reset.                   | Re-enter order number in the `🔍 Track Order` lookup modal using the order reference code.                                      |
