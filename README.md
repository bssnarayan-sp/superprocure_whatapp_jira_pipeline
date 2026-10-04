# SuperProcure WhatsApp Support Crawler

Crawls a WhatsApp Web support group (the **SuperProcure Control Room**), turns the flat stream of messages into **threads** (a root message plus all of its replies), stores them in PostgreSQL, publishes each thread to an **n8n** webhook for classification / Jira ticketing, and exposes everything through a REST API and a React dashboard.

## How it works

```
WhatsApp Web ──► Crawler (Playwright) ──► BuildThreads ──► PostgreSQL ──► n8n webhook
                                                               │
                                                               ▼
                                              REST API (Express) ──► React dashboard
```

1. **Crawl** – Playwright opens WhatsApp Web with a persistent profile (`./data/whatsapp-profile`, so you scan the QR code only once), opens the target chat and reads the rendered messages.
2. **Thread building** – `BuildThreads` links each message to the one it replies to. Replies pointing outside the rendered window are resolved against messages already in Postgres, so a thread is never split.
3. **Persist** – threads are saved first, then their messages (foreign key `support_messages.thread_id → support_threads.thread_id`).
4. **Publish** – each full thread is sent to n8n, which fills in `classification`, `summary`, `severity`, `customer`, `module` and the Jira fields (`jira_key`, `jira_status`, `jira_url`).
5. **Browse** – the API serves paginated threads and their messages; the dashboard renders them.

## Project structure

```
src/
├── index.js                  # Crawler entry point
├── domain/                   # Models (SupportThread, ThreadMessage) and interfaces
├── application/services/     # BuildThreads, PublishThreads
├── implementation/
│   ├── whatsapp-web/         # Playwright message source
│   ├── database/             # Postgres pool + thread repository
│   └── publishers/           # n8n publisher
├── migrations/               # support_threads.sql, support_messages.sql
├── api/                      # Express API (+ Swagger, API-key auth)
└── web/                      # React + Vite dashboard
```

The code follows a ports-and-adapters layout: `domain/interfaces` defines `MessageSource`, `ThreadRepository` and `MessagePublisher`, and `implementation/` provides the WhatsApp, Postgres and n8n adapters.

## Setup

Requires Node.js 20+ and PostgreSQL.

```bash
npm install
npx playwright install chromium
psql "$DATABASE_URL" -f src/migrations/support_threads.sql
psql "$DATABASE_URL" -f src/migrations/support_messages.sql
```

### Environment

Root `.env` (crawler):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `N8N_WEBHOOK_URL` | n8n webhook that receives each thread |

`src/api/.env`:

| Variable | Purpose |
|---|---|
| `API_PORT` | API port (default `3001`) |
| `DATABASE_URL` | Postgres connection string |
| `API_KEY` | Required in the `x-api-key` header |

`src/web/.env`:

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL, e.g. `http://localhost:3001` |
| `VITE_API_KEY` | Same value as the API's `API_KEY` |

## Running

```bash
# 1. Crawler – opens WhatsApp Web (scan the QR on first run)
node src/index.js

# 2. API – Swagger docs at http://localhost:3001/swagger
node src/api/server.js

# 3. Dashboard – http://localhost:6067
cd src/web && npm install && npm run dev
```

## API

All `/api/threads` routes require the `x-api-key` header.

| Method | Path | Description |
|---|---|---|
| GET | `/api/threads?page=1&pageSize=20` | Paginated threads, newest activity first |
| GET | `/api/threads/:threadId/messages` | Messages of a thread, oldest first |

## Dashboard

A responsive (light/dark) React app showing thread summary, customer/module, classification, severity, Jira key (linked) and status. Click a row to expand the conversation as a chat view; search and filter by severity; paginate through results.

## Notes

- `src/web/.env` and `src/api/.env` contain secrets — keep them out of version control.
- The crawler reads the chat's currently rendered window, so run it regularly to avoid gaps.
