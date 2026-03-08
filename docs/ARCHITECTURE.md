# Architecture

High-level architecture in this document is verified against the current codebase. Capacity sizing and infrastructure estimates live in `docs/SYSTEM-DESIGN.md`.

## Overview

```mermaid
graph TB
    User([fa:fa-user Client Application])

    subgraph System["Transaction Ledger System"]
        API["NestJS REST API<br/><i>Handles HTTP requests,<br/>validation, idempotency</i>"]
        Workers["BullMQ Workers<br/><i>Async transaction processing<br/>& notification delivery</i>"]
    end

    PG[("PostgreSQL 17<br/><i>Transactions, Notifications,<br/>Idempotency Records</i>")]
    Redis[("Redis 7<br/><i>Idempotency locks,<br/>Job queue (BullMQ)</i>")]

    User -->|"REST API<br/>JSON/HTTPS"| API
    API -->|"Read/Write"| PG
    API -->|"Lock + Cache + Enqueue"| Redis
    Workers -->|"Read/Write"| PG
    Workers -.->|"Consume jobs"| Redis
```

## Detailed Component Diagram

```mermaid
graph TD
    Client([Client])

    subgraph NestJS["NestJS Application"]
        subgraph HTTP["HTTP Request Handling"]
            POST["POST /transactions"]
            GET_TX["GET /transactions"]
            GET_NTF["GET /notifications"]
            HEALTH["GET /health"]

            POST --> IDEMP_CHECK["IdempotencyInterceptor<br/>Redis SET NX + DB INSERT placeholder"]
            IDEMP_CHECK --> TX_SVC["TransactionService<br/>DB INSERT transaction (QUEUED)<br/>+ BullMQ queue.add()"]
            TX_SVC --> IDEMP_STORE["IdempotencyInterceptor (after)<br/>DB UPDATE + Redis SET"]
            IDEMP_STORE --> RES_202["Response 202"]

            GET_TX --> FIND_ALL["DB findMany + count (parallel)"]
            GET_NTF --> FIND_NTF["DB findMany + count (parallel)"]
            HEALTH --> PING["DB ping"]
        end

        subgraph Workers["BullMQ Workers"]
            TX_PROC["TransactionProcessor (concurrency: 5)<br/>DB read + status updates<br/>→ Enqueue notification"]
            NTF_PROC["NotificationProcessor (concurrency: 5)<br/>DB dedup check + INSERT notification"]
            TX_PROC --> NTF_PROC
        end
    end

    Client --> POST
    Client --> GET_TX
    Client --> GET_NTF
    Client --> HEALTH

    IDEMP_CHECK --> Redis[(Redis 7<br/>Idempotency + BullMQ Queue)]
    TX_SVC --> Redis
    IDEMP_STORE --> Redis
    IDEMP_CHECK --> PG[(PostgreSQL 17<br/>Transactions + Notifications + Idempotency)]
    IDEMP_STORE --> PG
    FIND_ALL --> PG
    FIND_NTF --> PG
    PING --> PG
    TX_PROC --> PG
    NTF_PROC --> PG
    Workers -.-> Redis
```

## Write Path (POST /transactions)

### 6 High-Level Application Steps

1. Redis `SET NX` — acquire idempotency lock
2. PostgreSQL `INSERT` — create idempotency placeholder
3. PostgreSQL `INSERT` — create transaction record (status: QUEUED)
4. BullMQ `queue.add()` — enqueue Redis-backed job
5. PostgreSQL `UPDATE` — store response in idempotency record
6. Redis `SET` — cache idempotency result

Returns `202 Accepted` with `{ id, status: "QUEUED" }`.

BullMQ enqueueing expands into multiple Redis commands internally. The list above stays at the application-flow level rather than claiming an exact Redis command trace.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant I as IdempotencyInterceptor
    participant R as Redis
    participant DB as PostgreSQL
    participant S as TransactionService
    participant Q as BullMQ Queue

    C->>+I: POST /transactions<br/>Idempotency-Key: abc-123
    I->>R: SET NX (acquire lock)
    R-->>I: OK
    I->>DB: INSERT idempotency placeholder
    DB-->>I: created
    I->>+S: handle()
    S->>DB: INSERT transaction (status: QUEUED)
    DB-->>S: created
    S->>Q: queue.add(transactionId)
    Q-->>S: job enqueued
    S-->>-I: { id, status: QUEUED }
    I->>DB: UPDATE idempotency (store response)
    I->>R: SET (cache result, TTL 24h)
    I-->>-C: 202 Accepted
```

### Read Path (GET /transactions) — 2 parallel I/O ops

1. PostgreSQL `SELECT` — findMany with filters + pagination
2. PostgreSQL `SELECT` — count total records

## Background Processing

```mermaid
sequenceDiagram
    participant Q as BullMQ Queue
    participant TP as TransactionProcessor
    participant DB as PostgreSQL
    participant NQ as Notification Queue
    participant NP as NotificationProcessor

    Q->>+TP: dequeue transaction job
    TP->>DB: SELECT transaction
    alt Transaction not found
        TP-->>TP: skip + log error
    else Transaction status = COMPLETED
        TP->>NQ: enqueue notification job (deduped)
    else Transaction status = QUEUED/PROCESSING/FAILED
        TP->>DB: UPDATE status → PROCESSING
        TP->>DB: UPDATE status → COMPLETED
        TP->>NQ: enqueue notification job (deduped)
    end
    TP-->>-Q: job done

    NQ->>+NP: dequeue notification job
    alt Already delivered
        NP-->>NP: skip (idempotent)
    else Not delivered
        NP->>DB: COUNT delivered notifications
        NP->>DB: INSERT notification (DELIVERED)
    end
    alt Failure (max retries)
        NP->>DB: INSERT notification (DEAD_LETTER)
    end
    NP-->>-NQ: job done
```

- **TransactionProcessor** (concurrency: 5): Loads the transaction, short-circuits missing/already-completed jobs, updates QUEUED/PROCESSING/FAILED → COMPLETED, then enqueues a notification with deterministic deduplication
- **NotificationProcessor** (concurrency: 5): Checks for an existing delivered notification, creates DELIVERED on success, or creates DEAD_LETTER after retries are exhausted

## Idempotency

```mermaid
flowchart TD
    A[POST /transactions<br/>Idempotency-Key: X] --> B{Redis SET NX<br/>acquire lock}
    B -->|Lock acquired| C[DB INSERT<br/>idempotency record]
    C --> D[Process request]
    D --> E[DB UPDATE + Redis SET<br/>store response]
    E --> F[202 Accepted]

    B -->|Lock exists| G{Check cached<br/>response in Redis}
    G -->|Cache hit| H{Hash match?}
    H -->|Same body| I[Return cached<br/>202 Accepted]
    H -->|Different body| J[422 Hash Mismatch]

    G -->|No cache| K{DB lookup<br/>idempotency record}
    K -->|Found + response| L{Hash match?}
    L -->|Same body| M[Return stored<br/>202 Accepted]
    L -->|Different body| N[422 Hash Mismatch]
    K -->|Found + no response| O[409 Conflict<br/>in progress]
```

| Scenario | Response |
|----------|----------|
| New key | `202` — transaction queued |
| Same key + same body | `202` — cached response returned |
| Same key + different body | `422` — hash mismatch |
| Key in progress (concurrent) | `409` — conflict |

### Interceptor vs Service

**IdempotencyInterceptor** (request-level): Extracts `Idempotency-Key` header, computes SHA256 hash of request body, delegates to service for lock/cache logic, stores response after handler completes, releases lock on error.

**IdempotencyService** (logic-level): `checkAndAcquire()` atomic Redis SET NX + DB placeholder, `store()` DB update + Redis cache, `release()` cleanup on failure, `inspectExisting()` check state from Redis/DB, handles stale placeholders (>60s auto-cleanup).

## Database Schema

```mermaid
erDiagram
    Transaction ||--o{ Notification : "has many"

    Transaction {
        UUID id PK
        TransactionType type
        TransactionStatus status
        Decimal amount
        String currency
        String fromAccount "nullable"
        String toAccount "nullable"
        Json metadata "nullable"
        DateTime createdAt
        DateTime updatedAt
    }

    Notification {
        UUID id PK
        UUID transactionId FK
        NotificationChannel channel
        NotificationStatus status
        String recipient
        Json payload
        Int attempts
        String lastError "nullable"
        DateTime createdAt
        DateTime updatedAt
    }

    IdempotencyRecord {
        UUID id PK
        String key UK
        String requestHash
        Int statusCode "nullable"
        Json response "nullable"
        DateTime createdAt
        DateTime updatedAt
    }
```

### Enums

| Enum | Values |
|------|--------|
| TransactionType | `DEPOSIT` `WITHDRAWAL` `TRANSFER` `REFUND` |
| TransactionStatus | `QUEUED` `PROCESSING` `COMPLETED` `FAILED` |
| NotificationChannel | `EMAIL` `SMS` `PUSH` `WEBHOOK` |
| NotificationStatus | `PENDING` `PROCESSING` `DELIVERED` `FAILED` `DEAD_LETTER` |
