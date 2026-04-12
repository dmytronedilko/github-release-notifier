# GitHub Release Notification API

A monolithic TypeScript + Fastify service that lets users subscribe to email notifications about new GitHub repository releases.

---

## Features

- Subscribe an email to any GitHub repository's release notifications
- Double opt-in: confirmation email with a token link
- Background scanner checks repos for new releases on a configurable cron schedule
- Graceful GitHub API 429 rate-limit handling (X-RateLimit-Reset header + exponential backoff)
- PostgreSQL persistence via DrizzleORM with automatic migrations on startup
- Token-based unsubscribe links in every notification email
- Redis caching of GitHub API responses (10-minute TTL)
- GitHub OAuth login for managing API keys and GitHub tokens
- API key authentication for protected endpoints
- Prometheus metrics at `/metrics`
- gRPC interface as an alternative to REST API
- Pug-based HTML UI for subscribing to releases

---

## API

Subscription and auth routes are prefixed with `/api`.

### Subscription endpoints

| Method | Path                        | Auth        | Description                              |
| ------ | --------------------------- | ----------- | ---------------------------------------- |
| `POST` | `/api/subscribe`            | API key     | Subscribe an email to a repo (JSON body) |
| `GET`  | `/api/confirm/:token`       | No          | Confirm subscription via emailed token   |
| `GET`  | `/api/unsubscribe/:token`   | No          | Remove subscription via token            |
| `GET`  | `/api/subscriptions?email=` | API key     | List all subscriptions for an email      |

### Auth & key management endpoints

| Method   | Path                         | Auth    | Description                       |
| -------- | ---------------------------- | ------- | --------------------------------- |
| `GET`    | `/api/auth/github`           | No      | Start GitHub OAuth login flow     |
| `GET`    | `/api/auth/github/callback`  | No      | GitHub OAuth callback             |
| `POST`   | `/api/auth/logout`           | No      | Destroy session                   |
| `GET`    | `/api/auth/me`               | Session | Get current authenticated user    |
| `POST`   | `/api/auth/generate`         | Session | Generate a new API key            |
| `GET`    | `/api/auth/keys`             | Session | List your API keys                |
| `DELETE` | `/api/auth/keys/:id`         | Session | Delete an API key                 |
| `POST`   | `/api/auth/github-tokens`    | Session | Add a GitHub personal access token|
| `GET`    | `/api/auth/github-tokens`    | Session | List your GitHub tokens           |
| `DELETE` | `/api/auth/github-tokens/:id`| Session | Delete a GitHub token             |

### Other endpoints

| Method | Path       | Auth | Description        |
| ------ | ---------- | ---- | ------------------ |
| `GET`  | `/health`  | No   | Health check       |
| `GET`  | `/metrics` | No   | Prometheus metrics |

**Authentication** has two layers:

- **API key** — endpoints marked "API key" expect an `X-API-KEY` header with a valid key obtained from `POST /api/auth/generate`.
- **Session** — endpoints marked "Session" require a GitHub OAuth login. The user logs in via `GET /api/auth/github`, and the server sets a `session` cookie.

### POST /api/subscribe

Accepts `application/json`:

```json
{
  "email": "user@example.com",
  "repo": "owner/repo"
}
```

Headers: `X-API-KEY: <your-api-key>`

Responses:

- `200` — Subscription created; confirmation email sent
- `400` — Invalid email or repo format
- `401` — Missing or invalid API key
- `404` — Repository not found on GitHub
- `409` — Email already subscribed to this repository

---

## gRPC Interface

A gRPC server runs alongside the HTTP API on the port defined by `GRPC_PORT` (default: `50051`).

Proto definition: [`proto/notifier.proto`](proto/notifier.proto)

Available RPCs:

| RPC                | Request                   | Response                   |
| ------------------ | ------------------------- | -------------------------- |
| `Subscribe`        | `SubscribeRequest`        | `SubscribeResponse`        |
| `Confirm`          | `TokenRequest`            | `MessageResponse`          |
| `Unsubscribe`      | `TokenRequest`            | `MessageResponse`          |
| `GetSubscriptions` | `GetSubscriptionsRequest` | `GetSubscriptionsResponse` |

Errors are mapped to gRPC status codes: `INVALID_ARGUMENT` (400), `NOT_FOUND` (404), `ALREADY_EXISTS` (409).

---

## Setup

### Prerequisites

- Node.js 24+
- npm
- PostgreSQL (or use Docker Compose)

### Local development

```bash
# 1. Clone and install
git clone <repo-url>
cd github-release-notifier
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, Brevo API key, GitHub OAuth credentials, etc.

# 3. Generate and apply migrations
npm run db:generate   # generate SQL migration files from schema
npm run db:push       # push schema directly (dev shortcut)

# 4. Start the server
npm run dev
```

### Docker Compose (recommended)

```bash
cp .env.example .env
# Fill in POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB and optionally
# BREVO_API_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET

docker-compose up --build
```

This starts four services:

| Service        | Port | Description                     |
| -------------- | ---- | ------------------------------- |
| **app**        | 3000 | Fastify HTTP API + gRPC (50051) |
| **db**         | 5433 | PostgreSQL 16                   |
| **redis**      | 6379 | Redis 7 (GitHub API cache)      |
| **prometheus** | 9090 | Prometheus metrics scraper      |

The app will:

1. Wait for PostgreSQL and Redis to be healthy
2. Run database migrations automatically on startup
3. Start the HTTP API server on port 3000 and gRPC server on port 50051
4. Schedule the background release scanner

---

## Environment Variables

| Variable               | Required | Default                      | Description                                                   |
| ---------------------- | -------- | ---------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`         | Yes      | —                            | PostgreSQL connection string                                  |
| `POSTGRES_USER`        | Docker   | —                            | PostgreSQL user (used by docker-compose)                      |
| `POSTGRES_PASSWORD`    | Docker   | —                            | PostgreSQL password (used by docker-compose)                  |
| `POSTGRES_DB`          | Docker   | —                            | PostgreSQL database name (used by docker-compose)             |
| `GITHUB_CLIENT_ID`     | No       | —                            | GitHub OAuth App client ID (required for user login)          |
| `GITHUB_CLIENT_SECRET` | No       | —                            | GitHub OAuth App client secret (required for user login)      |
| `REDIS_URL`            | No       | —                            | Redis connection string (enables GitHub API response caching) |
| `BREVO_API_KEY`        | No       | —                            | Brevo API key (if omitted, a mock mailer logs to console)     |
| `BREVO_SENDER_NAME`    | No       | `GitHub Release Notifier`    | Sender name for notification emails                           |
| `BREVO_SENDER_EMAIL`   | No       | `noreply@localhost`          | Sender email address                                          |
| `APP_BASE_URL`         | No       | `http://localhost:3000`      | Base URL for confirm/unsubscribe links in emails              |
| `SCAN_CRON`            | No       | `*/5 * * * *`                | Cron schedule for background scanner                          |
| `PORT`                 | No       | `3000`                       | HTTP port                                                     |
| `GRPC_PORT`            | No       | `50051`                      | gRPC server port                                              |
| `TRUST_PROXY`          | No       | `false`                      | Trust X-Forwarded-\* headers (set to `true` behind a proxy)   |

---

## Background Scanner

The scanner runs on the schedule defined by `SCAN_CRON` (default: every 5 minutes).

### Algorithm

1. Query all **unique repos** that have at least one **confirmed** subscription
2. For each repo, fetch the latest release tag from GitHub
3. Compare with the stored `last_seen_tag` in the `repo_states` table
4. If the tag has **changed** — upsert the DB and email all confirmed subscribers
5. If the tag is the **same** or **null** (no releases) — skip silently

### Initial tag seeding

When a user first subscribes to a repo with no existing `repo_states` entry, the current latest tag is fetched and stored **without sending any email**. This prevents users from receiving notifications about releases that already existed before they subscribed.

---

## GitHub API 429 Rate-Limit Handling

When the GitHub API returns `429 Too Many Requests`:

1. **Check `X-RateLimit-Reset` header** — if present, the value is a Unix timestamp indicating when the rate limit resets. The client sleeps until that time (plus a 500ms safety buffer) before retrying.

2. **Exponential backoff fallback** — if the header is absent, the client waits `2^attempt * 1000ms` before retrying (1s -> 2s -> 4s over up to 3 attempts).

This ensures the service never floods the GitHub API and recovers gracefully from temporary rate-limit windows.

---

## Redis Caching

When `REDIS_URL` is configured, GitHub API responses are cached with a 10-minute TTL:

- `checkRepo()` — caches repo existence (`gh:repo:{owner}/{repo}`)
- `getLatestTag()` — caches latest tag (`gh:tag:{owner}/{repo}`)

Cache failures are non-fatal: if Redis is unavailable, requests fall through to the live GitHub API.

---

## Monitoring

### Prometheus Metrics

The `/metrics` endpoint exposes:

| Metric                          | Type      | Description                                      |
| ------------------------------- | --------- | ------------------------------------------------ |
| `http_requests_total`           | Counter   | Total HTTP requests (method, route, status_code) |
| `http_request_duration_seconds` | Histogram | Request duration (p50/p95/p99)                   |
| `scan_runs_total`               | Counter   | Scanner runs (success/error)                     |
| `notifications_sent_total`      | Counter   | Release emails sent                              |

Default Node.js process metrics (memory, event loop lag) are also included.

---

## Testing

```bash
npm test                 # unit tests
npm run test:integration # integration tests (requires PostgreSQL)
npm run test:coverage    # unit tests with V8 coverage report
```

### Unit tests

Tests live in `src/tests/` and use Vitest with mocks for all external dependencies.

| File                           | Scenarios                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subscription.service.test.ts` | subscribe success, invalid email, invalid repo format, GitHub 404, duplicate (409), DB insert error, confirm, already-confirmed, unsubscribe, getSubscriptions (with/without tag, invalid email) |
| `scanner.service.test.ts`      | new release detected (tag A->B), no change (tag A->A), null tag (no releases), multiple repos with mixed results                                                                                 |
| `notifier.service.test.ts`     | emails sent to all confirmed subscribers, no subscribers -> no emails, mailer error propagation                                                                                                  |
| `github.plugin.test.ts`        | checkRepo 200/404/500, getLatestTag via release endpoint, fallback to /tags, empty tags list, 429 with reset header, 429 with exponential backoff                                                |
| `apikey.service.test.ts`       | key generation (64-char hex), SHA-256 hash storage, user binding, verification (valid/invalid/expired/quota exhausted)                                                                           |
| `grpc.server.test.ts`          | all 4 RPCs (Subscribe, Confirm, Unsubscribe, GetSubscriptions), error mapping (400->INVALID_ARGUMENT, 404->NOT_FOUND, 409->ALREADY_EXISTS)                                                       |

### Integration tests

Tests live in `src/integration/` and run against a real PostgreSQL database.

| File                                      | Scenarios                                                             |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `SubscriptionService.integration.test.ts` | full subscribe/confirm/unsubscribe/getSubscriptions flow with real DB |
| `ScannerService.integration.test.ts`      | release detection, state updates, multi-repo, unconfirmed skip        |
| `NotifierService.integration.test.ts`     | email dispatch to confirmed subscribers only                          |

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request:

1. **Lint** — `npm run lint` (ESLint + Prettier)
2. **Type check** — `npx tsc --noEmit`
3. **Unit tests** — `npm test`
4. **Build** — `npm run build`
5. **Integration tests** — `npm run test:integration` (with a PostgreSQL service container)

---

## Project Structure

```
/src
  /db           — Drizzle schema, DB connection, migration runner
  /errors       — Custom Fastify error factories (400, 401, 404, 409, etc.)
  /grpc         — gRPC server (proto-loader, error mapping)
  /integration  — Integration tests (real DB)
  /plugins      — GitHub client, Redis cache, Brevo mailer, API key auth, session auth
  /routes       — Fastify route handlers (subscription, auth, metrics, UI)
  /services     — SubscriptionService, ScannerService, NotifierService, ApiKeyService, AuthService, GithubTokenService
  /tests        — Unit tests (Vitest)
  app.ts        — Fastify app factory
  index.ts      — Entry point (migrations, HTTP + gRPC servers, cron scheduler)
  logger.ts     — Pino logger configuration
  metrics.ts    — Prometheus metric definitions
/proto          — Protocol Buffer definitions (notifier.proto)
/public         — Static assets (favicon)
/views          — Pug templates (pages, partials, email templates)
/monitoring     — Prometheus configuration
Dockerfile
docker-compose.yml
drizzle.config.ts
vitest.config.ts
vitest.integration.config.ts
.env.example
```
