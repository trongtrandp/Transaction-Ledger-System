# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
npm run build

# Dev server (run manually in terminal)
npm run start:dev

# Lint & format
npm run lint
npm run lint:fix
npm run format

# Tests
npm run test                    # all unit tests
npx jest --testPathPattern=<pattern>  # single test file
npm run test:cov                # with coverage
npm run test:e2e                # e2e tests (needs running app + infra)

# Database
npx prisma generate             # regenerate client after schema changes
npx prisma migrate dev           # create/apply migrations
npx prisma migrate deploy        # apply migrations (production)

# Infrastructure
docker compose up -d             # start postgres + redis locally
```

## Architecture

NestJS 11 application — an immutable transaction ledger with async processing via BullMQ (Redis-backed job queues) and PostgreSQL (via Prisma with `@prisma/adapter-pg`).

### Write Path
`POST /transactions` → IdempotencyInterceptor checks/acquires Redis lock → TransactionService creates DB record (status=QUEUED) → enqueues BullMQ job → TransactionProcessor picks up job → marks COMPLETED → enqueues notification job → NotificationProcessor delivers.

### Read Path
`GET /transactions`, `GET /transactions/:id`, `GET /notifications`, `GET /notifications/:id` — direct Prisma queries with pagination (`PaginationDto`).

### Module Dependency Graph
```
AppModule
├── PrismaModule (@Global)     — PrismaClient with pg Pool adapter
├── RedisModule (@Global)      — ioredis singleton
├── IdempotencyModule          — Redis SET NX + DB placeholder pattern
├── TransactionModule          — controller, service, BullMQ processor
├── NotificationModule         — controller, service, BullMQ processor
└── HealthModule               — Prisma ping health check
```

### Key Patterns
- **Idempotency**: `IdempotencyInterceptor` requires `Idempotency-Key` header on POST. Uses Redis SET NX for distributed lock, stores response in DB for replay. Three states: `cached` (return stored response), `in_progress` (409 Conflict), `hash_mismatch` (422 if body differs).
- **BullMQ processors**: `TransactionProcessor` and `NotificationProcessor` extend `WorkerHost`. Concurrency=5. Deterministic `jobId` for deduplication (`notif-{transactionId}`).
- **Prisma client**: Generated to `src/generated/prisma/` (gitignored). Uses `@prisma/adapter-pg` with a raw `pg.Pool` for connection pooling. Schema maps to snake_case table/column names.
- **Global guards**: `ThrottlerGuard` applied via `APP_GUARD` — all endpoints are rate-limited.
- **Cluster mode**: `src/cluster.ts` forks workers via Node.js `cluster` module for multi-process deployment.

### Database Schema (prisma/schema.prisma)
Three models: `Transaction` (status lifecycle: QUEUED→PROCESSING→COMPLETED/FAILED), `Notification` (PENDING→PROCESSING→DELIVERED/FAILED/DEAD_LETTER), `IdempotencyRecord` (stores request hash + cached response).

### Environment Variables
Required: `DATABASE_URL`. Optional with defaults: `PORT` (3000), `REDIS_HOST` (localhost), `REDIS_PORT` (6379), `THROTTLE_TTL` (60000), `THROTTLE_LIMIT` (10), `IDEMPOTENCY_TTL_HOURS` (24), `DB_POOL_SIZE` (20).

## Code Conventions

- Path alias: `@/*` maps to `src/*` (tsconfig paths)
- Prisma generated client lives at `src/generated/prisma/` — import enums/types from `../generated/prisma/client`
- Prettier: single quotes, trailing commas, 100 char line width, 2-space indent
- ESLint ignores `src/generated/`
- Test files: `*.spec.ts` colocated with source in `src/`
- E2E tests: `test/` directory
