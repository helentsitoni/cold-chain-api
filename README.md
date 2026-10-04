# Cold Chain API

![CI](https://github.com/helentsitoni/cold-chain-api/actions/workflows/ci.yml/badge.svg)

**Live demo:** [cold-chain-api.onrender.com/api](https://cold-chain-api.onrender.com/api) (Swagger UI). Log in with `nurse@demo.com` / `Demo1234!`, `lab@demo.com` or `auditor@demo.com`. The free instance sleeps when idle, so the first request can take up to a minute.

A backend REST API for tracking clinical trial biological samples through a temperature-controlled supply chain. It records who handled each sample and when (chain of custody), enforces which role may move a sample to which state, automatically locks a sample if its temperature leaves the allowed range during transport, and alerts a compliance auditor if a sample stays in transit for too long.

Built with **NestJS**, **TypeScript**, **Prisma**, **PostgreSQL** and **BullMQ**.

---

## Features

- **Authentication** with JWT (register, login, protected routes) and bcrypt password hashing
- **Role-based access control** with three roles: `FIELD_NURSE`, `LAB_ANALYST`, `COMPLIANCE_AUDITOR`
- **Sample lifecycle state machine**: invalid transitions are rejected, and each transition is restricted to a specific role
- **Immutable audit log** (chain of custody): every status change is recorded in the same database transaction as the change itself
- **Temperature monitoring**: an out-of-range reading during transport automatically marks the sample `COMPROMISED` and blocks any further transitions
- **Time-based escalation**: when a sample goes `IN_TRANSIT`, a delayed job is queued with BullMQ; if the sample is still in transit after 24 hours, an alert is created for the compliance auditor
- **Input validation** on every request with DTOs and `class-validator`
- **Interactive API docs** with Swagger / OpenAPI
- **Unit and end-to-end tests** with Jest and Supertest, running in **GitHub Actions** on every push
- **PostgreSQL and Redis in Docker** for local development, with schema migrations managed by Prisma

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime / language | Node.js 20+, TypeScript |
| Framework | NestJS 12 |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Background jobs | BullMQ, Redis 7 |
| Auth | `@nestjs/jwt`, `bcryptjs` |
| Validation | `class-validator`, `class-transformer` |
| API docs | `@nestjs/swagger` |
| Testing | Jest, Supertest |
| CI | GitHub Actions |
| Hosting | Render (API, Redis), Neon (PostgreSQL) |

---

## Sample lifecycle

A sample only moves forward, one step at a time, and each step can only be performed by a specific role. The `COMPROMISED` state is set automatically by the system and is final.

```mermaid
stateDiagram-v2
    [*] --> COLLECTED: FIELD_NURSE creates sample
    COLLECTED --> IN_TRANSIT: FIELD_NURSE
    IN_TRANSIT --> LAB_RECEIVED: LAB_ANALYST
    LAB_RECEIVED --> ANALYSIS_COMPLETE: LAB_ANALYST
    ANALYSIS_COMPLETE --> STORED: LAB_ANALYST
    IN_TRANSIT --> COMPROMISED: temperature out of range (automatic)
    STORED --> [*]
    COMPROMISED --> [*]
```

The rules live in [`src/samples/state-machine.ts`](src/samples/state-machine.ts) as data rather than `if/else` logic, so adding a new transition is a one-line change.

### Example: temperature rule

Sample `S-002` has an allowed range of 2–8 °C and is `IN_TRANSIT`:

1. A reading of **6.4 °C** is within range. It is stored and the sample stays `IN_TRANSIT`.
2. A reading of **9.1 °C** is above 8 °C. In a single transaction the reading is stored, the sample becomes `COMPROMISED`, and a custody event is written with the note `Temperature 9.1°C outside 2-8°C` and no user as actor.
3. A lab analyst then tries to move it to `LAB_RECEIVED`. There is no rule out of `COMPROMISED`, so the API returns **409 Conflict**.

### Example: time-based escalation

1. A nurse moves sample `DEMO-005` to `IN_TRANSIT`. The API queues a delayed job `check-transit` in BullMQ, due in 24 hours.
2. When the job fires, the worker reloads the sample. If it is still `IN_TRANSIT`, it creates an alert: `Sample DEMO-005 has been IN_TRANSIT longer than allowed`.
3. If the sample was already received in the lab, the job does nothing.
4. A compliance auditor sees the alert at `GET /alerts`.

The delay is set by `ESCALATION_DELAY_MS`, so locally and in the live demo it can be a few seconds or minutes instead of 24 hours.

---

## Data model

```mermaid
erDiagram
    User ||--o{ CustodyEvent : performs
    Sample ||--o{ CustodyEvent : has
    Sample ||--o{ TemperatureReading : has
    Sample ||--o{ Alert : triggers

    User {
        string id PK
        string email UK
        string password "bcrypt hash"
        Role role
        datetime createdAt
    }
    Sample {
        string id PK
        string code UK
        SampleStatus status
        float minTemp
        float maxTemp
        datetime createdAt
    }
    TemperatureReading {
        string id PK
        string sampleId FK
        float value
        datetime recordedAt
    }
    CustodyEvent {
        string id PK
        string sampleId FK
        SampleStatus fromStatus "null on creation"
        SampleStatus toStatus
        string actorId FK "null for automatic events"
        string note
        datetime createdAt
    }
    Alert {
        string id PK
        string sampleId FK
        string message
        datetime createdAt
    }
```

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (on Windows, with WSL 2)

### 1. Clone and install

```bash
git clone https://github.com/helentsitoni/cold-chain-api.git
cd cold-chain-api
npm install
```

### 2. Configure environment variables

Copy the example file and adjust the values if needed:

```bash
cp .env.example .env
```

| Variable | Description | Example |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://app:app@localhost:5433/coldchain` |
| `JWT_SECRET` | Secret used to sign JWTs. Use a long random string | `change-me-to-a-long-random-string` |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection for the job queue | `localhost` / `6379` |
| `ESCALATION_DELAY_MS` | How long a sample may stay `IN_TRANSIT` before an alert. Defaults to 24 hours | `86400000` |
| `PORT` | Optional. HTTP port, defaults to 3000 | `3000` |

> The database runs on port **5433** on the host to avoid clashing with a locally installed PostgreSQL on 5432.

### 3. Start PostgreSQL and Redis

```bash
docker compose up -d
```

This starts three containers: the development database (port 5433), a separate test database (port 5434) and Redis (port 6379).

### 4. Run the migrations

```bash
npx prisma migrate dev
```

### 5. Load demo data (optional)

```bash
npm run seed
```

This resets the database and creates 6 sample records in every status, plus three users (password `Demo1234!` for all):

| Email | Role |
| --- | --- |
| `nurse@demo.com` | `FIELD_NURSE` |
| `lab@demo.com` | `LAB_ANALYST` |
| `auditor@demo.com` | `COMPLIANCE_AUDITOR` |

### 6. Start the API

```bash
npm run start:dev
```

The API is now running on `http://localhost:3000`, and the interactive documentation (Swagger) is at `http://localhost:3000/api`.

---

## Running tests

```bash
# Unit tests (no database needed)
npm test

# End-to-end tests (use the separate test database on port 5434)
docker compose up -d
npm run test:e2e:setup
npm run test:e2e
```

The same build, unit tests and end-to-end tests run in GitHub Actions on every push to `main`, against PostgreSQL and Redis service containers.

---

## API reference

All endpoints except `register` and `login` require the header:

```
Authorization: Bearer <access_token>
```

| Method | Path | Allowed roles | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | Create a user |
| `POST` | `/auth/login` | Public | Returns an `access_token` (valid for 1 hour) |
| `GET` | `/auth/me` | Any authenticated user | Returns the user id (`sub`) and `role` from the token |
| `POST` | `/samples` | `FIELD_NURSE` | Create a sample in `COLLECTED` state |
| `GET` | `/samples` | Any authenticated user | List samples, newest first |
| `GET` | `/samples/:id` | Any authenticated user | Get a sample with its custody events and readings |
| `PATCH` | `/samples/:id/status` | Depends on the transition | Move a sample to a new status |
| `POST` | `/samples/:id/readings` | `FIELD_NURSE` | Add a temperature reading (only while `IN_TRANSIT`) |
| `GET` | `/alerts` | `COMPLIANCE_AUDITOR` | List escalation alerts, newest first |

### Example requests

**Register and log in**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"nurse@test.com","password":"secret123","role":"FIELD_NURSE"}'

curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nurse@test.com","password":"secret123"}'
# → { "access_token": "eyJhbGciOi..." }
```

**Create a sample**

```bash
curl -X POST http://localhost:3000/samples \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"S-001","minTemp":2,"maxTemp":8}'
```

**Change status**

```bash
curl -X PATCH http://localhost:3000/samples/<id>/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"toStatus":"IN_TRANSIT","note":"Picked up from site 3"}'
```

**Add a temperature reading**

```bash
curl -X POST http://localhost:3000/samples/<id>/readings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":6.4}'
```

### Error responses

| Status | When |
| --- | --- |
| `400 Bad Request` | The body fails validation (e.g. invalid email, password under 8 characters, unknown status) |
| `401 Unauthorized` | Missing, invalid or expired token, or wrong login credentials |
| `403 Forbidden` | The user's role is not allowed to perform this action or transition |
| `404 Not Found` | The sample does not exist |
| `409 Conflict` | Duplicate email or sample code, an invalid status transition, or a reading on a sample that is not `IN_TRANSIT` |

---

## Project structure

```
src/
├── main.ts                       # Bootstrap, loads .env, validation, Swagger
├── app.module.ts                 # Root module, Redis connection for BullMQ
├── prisma/
│   ├── prisma.module.ts          # Global module exposing PrismaService
│   └── prisma.service.ts         # Shared Prisma client
├── auth/
│   ├── auth.controller.ts        # /auth endpoints
│   ├── auth.service.ts           # Hashing, credential check, token issuing
│   ├── auth.module.ts            # JWT configuration
│   ├── jwt-auth.guard.ts         # Verifies the Bearer token
│   ├── roles.guard.ts            # Checks @Roles() metadata against the user's role
│   ├── roles.decorator.ts        # @Roles(...) decorator
│   ├── auth-user.ts              # Shape of the token payload
│   └── dto/                      # Register and login DTOs
└── samples/
    ├── samples.controller.ts     # /samples endpoints
    ├── samples.service.ts        # Lifecycle, audit log, temperature rule, job scheduling
    ├── state-machine.ts          # Allowed transitions and roles
    ├── escalation.processor.ts   # BullMQ worker that creates escalation alerts
    ├── alerts.controller.ts      # /alerts endpoint for auditors
    ├── *.spec.ts                 # Unit tests
    └── dto/                      # Create, transition and reading DTOs
test/
└── cold-chain.e2e-spec.ts        # End-to-end tests
prisma/
├── schema.prisma                 # Data model
├── seed.ts                       # Demo data
└── migrations/                   # SQL migrations
.github/workflows/ci.yml          # GitHub Actions pipeline
docker-compose.yml                # PostgreSQL (dev and test) and Redis
```

---

## Design decisions

- **Transactions for every status change.** The status update and its custody event are written together with `prisma.$transaction`, so a status can never change without an audit record, and an audit record never exists without the change.
- **State machine as data.** Transitions and their allowed roles are a plain array. The service looks up the rule; it contains no transition-specific logic.
- **Two layers of authorization.** `RolesGuard` protects whole endpoints (e.g. only nurses create samples), while the state machine decides per transition who may act.
- **Escalation re-checks the current state.** The delayed job does not assume the sample is still in transit; the worker reloads it and only raises an alert if it is. Each job also has a fixed id (`transit-<sampleId>`), so the same sample cannot be scheduled twice.
- **Automatic events have no actor.** `actorId` is nullable because a `COMPROMISED` status is decided by the system, not by a user.
- **Passwords are never stored or returned.** Passwords are hashed with bcrypt (cost 10), and user queries select only safe fields.
- **Generic login errors.** Login returns the same `Invalid credentials` message for an unknown email and a wrong password, to avoid revealing which emails are registered.

---

## Roadmap

- [x] Unit and end-to-end tests with Jest
- [x] Swagger / OpenAPI documentation
- [x] GitHub Actions CI running the test suite on every push
- [x] Time-based escalation with BullMQ and Redis
- [x] Live deployment
- [ ] Restrict role assignment at registration to an admin
- [ ] Optimistic locking for concurrent status changes on the same sample
- [ ] Pagination and filtering on `GET /samples`

---

## Author

**Eleni Tsitoni**, Electrical and Computer Engineering, University of Thessaly
