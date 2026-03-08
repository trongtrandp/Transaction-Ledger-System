# Transaction Ledger System

An immutable transaction ledger API built with NestJS 11, PostgreSQL 17, Redis 7, and BullMQ. Designed for high-throughput write workloads with idempotent request handling and async job processing.

Stress-tested to **~2000 write RPS in the write-only benchmark** on a single process with 0% error rate.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | NestJS 11 |
| Database | PostgreSQL 17 |
| Cache/Queue | Redis 7 + BullMQ |
| ORM | Prisma 7.x + @prisma/adapter-pg |
| Validation | class-validator + Joi |
| Rate Limiting | @nestjs/throttler |
| API Docs | @nestjs/swagger |
| Security | Helmet |

## Quick Start

### Docker

```bash
cp .env.example .env
docker compose up -d
npx prisma migrate deploy

# http://localhost:3000
# http://localhost:3000/api/docs
```

### Local Development

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npx prisma migrate dev
npm run start:dev
```

Prisma commands read `DATABASE_URL` from `.env` via [`prisma.config.ts`](prisma.config.ts).

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Service status |
| `POST` | `/transactions` | Create transaction (requires `Idempotency-Key` header) |
| `GET` | `/transactions` | List transactions (paginated, filterable) |
| `GET` | `/transactions/:id` | Get transaction by ID |
| `GET` | `/notifications` | List notifications (paginated, filterable) |
| `GET` | `/notifications/:id` | Get notification by ID |
| `GET` | `/health` | Health check |
| `GET` | `/api/docs` | Swagger UI |

### Example

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"type": "DEPOSIT", "amount": "1000.50", "currency": "USD", "toAccount": "ACC-001"}'

# 202 Accepted → { "id": "uuid", "status": "QUEUED" }
```

## Environment Variables

Start from [`.env.example`](.env.example) and create a local `.env` before running Prisma or the app locally.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `THROTTLE_TTL` | 60000 | Rate limit window (ms) |
| `THROTTLE_LIMIT` | 10 | Max requests per window |
| `IDEMPOTENCY_TTL_HOURS` | 24 | Idempotency key TTL |
| `DB_POOL_SIZE` | 20 | PostgreSQL connection pool size |
| `CLUSTER_WORKERS` | auto (CPU cores) | Number of cluster workers (`start:cluster` mode) |

## Scripts

```bash
npm run start:dev       # Development with hot reload
npm run start:prod      # Production (single process)
npm run start:cluster   # Production (multi-process clustering)
npm run test            # Unit tests
npm run test:cov        # Test coverage
npm run lint            # ESLint
```

## Testing

```bash
npm run test
```

10 test suites covering services, controllers, processors, interceptors, and infrastructure (Prisma, Redis).

## Stress Testing

k6-based stress test suite with isolated infrastructure. See [`stress-tests/STRESS-TEST.md`](stress-tests/STRESS-TEST.md).

```bash
npm run stress:infra:up
npm run build && npm run stress:db:setup
npm run stress:app:start   # separate terminal
npm run stress:smoke
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — diagrams, write/read paths, idempotency flow, database schema
- [System Design](docs/SYSTEM-DESIGN.md) — scaling strategy (100K users), observability, AWS infrastructure
- [Stress Tests](stress-tests/STRESS-TEST.md) — scenarios, results, performance analysis

## Project Structure

```
src/
├── app.module.ts                 # Root module
├── main.ts                       # Bootstrap
├── cluster.ts                    # Node.js clustering
├── common/
│   ├── constants/                # Queue/job name constants
│   ├── dto/                      # Shared pagination DTO
│   ├── interceptors/             # Idempotency interceptor
│   ├── prisma/                   # PrismaClient + pg.Pool adapter
│   └── redis/                    # ioredis wrapper
├── health/                       # GET /health
├── idempotency/                  # Redis + DB idempotency logic
├── transaction/                  # Transaction create/read API + BullMQ processor
└── notification/                 # Notification queries + BullMQ processor
```
