# Stress Test Documentation — Transaction Ledger System

## Tổng quan

Stress test suite cho hệ thống Transaction Ledger (NestJS 11, PostgreSQL 17, Redis 7, BullMQ).
Sử dụng [Grafana k6](https://k6.io/) với `ramping-arrival-rate` executor để kiểm soát chính xác RPS (requests per second).

**Target**: tối thiểu 1K write TPS (transactions per second).

---

## Kiến trúc hệ thống

```
Client → NestJS (single process) → PostgreSQL + Redis + BullMQ
```

### Write path (POST /transactions) — 6 I/O ops per request

```
Request
  → IdempotencyInterceptor
    1. Redis SET NX (acquire lock)
    2. DB INSERT idempotencyRecord
  → TransactionService
    3. DB INSERT transaction (status: QUEUED)
    4. Redis LPUSH (BullMQ queue.add)
  → IdempotencyInterceptor (after handler)
    5. DB UPDATE idempotencyRecord (store response)
    6. Redis SET (cache result)
  → Response 202
```

### Read path (GET /transactions) — 2 I/O ops per request

```
Request
  → TransactionService.findAll()
    1. DB SELECT findMany (parallel)
    2. DB SELECT count (parallel)
  → Response 200
```

### Background processing (BullMQ)

```
TransactionProcessor (concurrency: 5)
  → DB INSERT/UPDATE transaction record
  → Enqueue notification job

NotificationProcessor (concurrency: 5)
  → DB INSERT notification record
```

---

## Cấu trúc thư mục

```
stress-tests/
├── config/
│   └── base.js                # BASE_URL, HEADERS, THRESHOLDS
├── helpers/
│   ├── transaction.js         # generateTransaction(), newIdempotencyKey()
│   └── checks.js              # checkCreateTransaction(), checkListTransactions()
├── scenarios/
│   ├── smoke.js               # 2 VUs, 1 min — verify connectivity
│   ├── load.js                # Ramp to 1K write TPS, sustain 1 min
│   ├── stress.js              # Push to 2K write TPS — find breaking point
│   ├── spike.js               # Burst 2K TPS, 80% write
│   ├── write-only.js          # 2K write TPS, 10s — benchmark thuần write
│   ├── idempotency.js         # Replay, conflict, concurrent validation
│   └── throttle.js            # Validate 429 with throttle active
├── results/                   # k6 JSON output (gitignored)
├── docker-compose.stress.yml  # Isolated PostgreSQL + Redis
├── .env.stress                # Stress environment variables
└── run.sh                     # Runner script
```

---

## Infrastructure

### docker-compose.stress.yml

| Service | Image | Port | Tuning |
|---------|-------|------|--------|
| stress-postgres | postgres:17-alpine | 5433 | tmpfs, max_connections=300, synchronous_commit=off, shared_buffers=256MB |
| stress-redis | redis:7-alpine | 6380 | No persistence (--save "" --appendonly no) |

Dùng port riêng (5433/6380) để không conflict với dev environment.
PostgreSQL chạy trên tmpfs (RAM) và tắt synchronous_commit để tối đa throughput.

### .env.stress

| Variable | Value | Lý do |
|----------|-------|-------|
| DB_POOL_SIZE | 200 | Read path dùng 2 parallel DB ops/request, cần pool lớn |
| THROTTLE_LIMIT | 999999 | Disable throttle cho stress test |
| IDEMPOTENCY_TTL_HOURS | 1 | TTL ngắn cho stress |
| DATABASE_URL | localhost:5433 | Stress PostgreSQL |
| REDIS_PORT | 6380 | Stress Redis |

---

## Scenarios

### 1. Smoke (smoke.js)

- **Mục đích**: Verify connectivity, tất cả endpoints hoạt động
- **Config**: 2 VUs, 1 phút
- **Endpoints**: POST /transactions, GET /transactions, GET /notifications

### 2. Load (load.js)

- **Mục đích**: Xác nhận hệ thống đạt 1K write TPS
- **Config**: ramping-arrival-rate
  - Write: 50 → 1000 RPS (30s ramp), sustain 1 min, cooldown 30s
  - Read: 20 → 200 RPS (background)
  - maxVUs: 50 write + 10 read = 60 total
- **Thresholds**: p95 < 500ms, p99 < 1s, error < 1%, rate >= 800 RPS

### 3. Stress (stress.js)

- **Mục đích**: Tìm breaking point, push đến 2K write TPS
- **Config**: ramping-arrival-rate
  - Write: 100 → 1500 → 2000 RPS
  - Read: 50 → 300 → 500 RPS
  - maxVUs: 50 write + 20 read = 70 total
- **Thresholds**: relaxed (p95 < 2s, error < 5%)

### 4. Spike (spike.js)

- **Mục đích**: Test khả năng chịu burst traffic và recovery
- **Config**: ramping-arrival-rate
  - Baseline 100 → spike 2000 → drop 100 → recovery
  - 80% write, 20% read
  - maxVUs: 100
- **Thresholds**: relaxed

### 5. Write-only (write-only.js)

- **Mục đích**: Benchmark throughput thuần write (không có read)
- **Config**: constant-arrival-rate, 2000 RPS, 10 giây
- **Dùng để**: Xác định capacity thực tế của 1 process

### 6. Idempotency (idempotency.js)

- **Mục đích**: Validate idempotency logic dưới concurrent load
- **3 sub-scenarios**:
  - Replay: same key + same body → expect 202 (cached)
  - Conflict: same key + different body → expect 422
  - Concurrent: 3 parallel requests cùng key → expect 1×202 + 2×409

### 7. Throttle (throttle.js)

- **Mục đích**: Validate rate limiting hoạt động đúng
- **Config**: 20 RPS, 1 phút
- **Lưu ý**: Không dùng .env.stress (vì THROTTLE_LIMIT=999999 sẽ disable throttle). Chạy app với default config hoặc set `THROTTLE_LIMIT=10` riêng
- **Expect**: mix 202 + 429 responses

---

## Kết quả test

### Benchmark thuần write (1 process)

| Metric | Giá trị |
|--------|---------|
| Throughput | **~2000 RPS** |
| Avg latency | 3.68ms |
| p95 latency | 5.13ms |
| VUs cần | 6-7 |
| Error rate | 0% |

### Kết quả các scenario

| Test | Kết quả | Avg RPS | Error | p95 latency |
|------|---------|---------|-------|-------------|
| Smoke | PASS | 4 | 0% | 18ms |
| Load (1K write) | PASS | 911 | 0% | 44ms |
| Stress (2K write) | PASS | 884 | 0% | 219ms |
| Spike (burst 2K) | PASS | 292 | 0% | 863ms |
| Idempotency | PASS | 58 | expected | 13ms |

### Ghi chú kết quả

- **Load test avg RPS = 911** (không phải 1000): vì `rate` trong k6 là trung bình cả test, bao gồm ramp-up (0→1000) và cooldown (1000→50). Giai đoạn sustain đạt đúng 1K RPS.
- **Stress test dropped_iterations = 91,900**: hệ thống bắt đầu drop request khi push quá 2K write RPS — đây là breaking point.
- **Spike test avg RPS thấp (292)**: do phần lớn thời gian test ở baseline 100 RPS, chỉ burst 2K trong 1 phút. Quan trọng là 0% error — hệ thống chịu được burst mà không crash.

---

## Bottleneck Analysis

### Bottleneck chính: Node.js single-thread event loop

Hệ thống chạy trên 1 process NestJS = 1 event loop thread. Mỗi write request cần 6 async I/O operations (3 PG + 3 Redis), tất cả phải schedule qua cùng 1 event loop.

**Bằng chứng**:
- 150 VUs → 58ms latency, ~2600 RPS tổng
- 320 VUs → 120ms latency, ~2600 RPS tổng (throughput KHÔNG tăng)
- Tăng gấp đôi VUs mà throughput đứng yên = event loop đã bão hòa

**Không phải bottleneck**:
- PostgreSQL: max_connections=300, pool chưa đầy, query latency < 5ms
- Redis: in-memory, no persistence, latency < 1ms
- DB connection pool: tăng từ 100 → 200 không thay đổi throughput

### Capacity của 1 process

| Workload | Max RPS | Avg latency |
|----------|---------|-------------|
| Thuần write | ~2000 | 3.68ms |
| Write + Read (5:1) | ~1800 | 7ms |
| Write + Read (2:1) | ~2600 | 31ms |

### Scaling

Nếu cần vượt 2K RPS: dùng Node.js clustering (PM2 hoặc cluster module).
Mỗi worker có event loop riêng, nhưng scaling **không tuyến tính** do DB connection contention — xem `docs/SYSTEM-DESIGN.md` §3.1 cho measured multi-worker data và giải pháp (RDS Proxy).

---

## Cách chạy

### Prerequisites

- Docker Desktop
- k6: `brew install k6`
- Node.js 20+

### Chạy từng bước

```bash
# 1. Start stress infrastructure
docker compose -f stress-tests/docker-compose.stress.yml up -d

# 2. Build app
npm run build

# 3. Migrate stress database
dotenv -e stress-tests/.env.stress -- npx prisma migrate deploy

# 4. Start app (terminal riêng)
dotenv -e stress-tests/.env.stress -- node dist/src/main

# 5. Chạy test
k6 run -e BASE_URL=http://localhost:3000 stress-tests/scenarios/smoke.js
k6 run -e BASE_URL=http://localhost:3000 stress-tests/scenarios/load.js
k6 run -e BASE_URL=http://localhost:3000 stress-tests/scenarios/stress.js
k6 run -e BASE_URL=http://localhost:3000 stress-tests/scenarios/spike.js
k6 run -e BASE_URL=http://localhost:3000 stress-tests/scenarios/idempotency.js

# 6. Cleanup
docker compose -f stress-tests/docker-compose.stress.yml down
```

### Hoặc dùng npm scripts

```bash
npm run stress:infra:up
npm run stress:db:setup
npm run stress:app:start    # terminal riêng
npm run stress:smoke
npm run stress:load
npm run stress:stress
npm run stress:spike
npm run stress:idempotency
npm run stress:infra:down
```

---

## Lưu ý quan trọng

### VU (Virtual User) và Little's Law

k6 dùng `ramping-arrival-rate` executor: target là RPS, k6 tự tạo VU để đạt target.

```
VUs cần = RPS × latency (giây)
```

Ví dụ: 1000 RPS × 0.004s = 4 VUs. Đặt maxVUs quá cao sẽ gây **death spiral**: quá nhiều VU → contention → latency tăng → k6 tạo thêm VU → contention tệ hơn.

### Death spiral prevention

maxVUs nên đặt = `RPS × expected_latency × 10` (safety factor 10x):
- Write 1K RPS × 0.005s × 10 = 50 VUs
- Read 200 RPS × 0.005s × 10 = 10 VUs

### Reset DB giữa các test

Chạy nhiều test liên tiếp sẽ tích lũy data → read query chậm dần (findMany + count trên bảng lớn). Reset DB trước mỗi session:

```bash
dotenv -e stress-tests/.env.stress -- npx prisma migrate reset --force
```
