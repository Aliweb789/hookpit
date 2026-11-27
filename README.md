# 🪝 Hookpit

[![CI](https://github.com/Aliweb789/hookpit/actions/workflows/ci.yml/badge.svg)](https://github.com/Aliweb789/hookpit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A self-hostable webhook inspector.** Get a URL in one click, point Stripe / GitHub / your own code at it, and watch every request appear live, with its exact method, headers, query and raw body.

Your payloads stay on your own server instead of a third-party site.

> **Status: early (v0.1).** Capture and live inspection work today. Replay, mocking and signature checks are on the [roadmap](#roadmap). Contributions are very welcome.

## Features

- ✅ Unique capture URL per endpoint (`/h/<slug>`), any HTTP method and sub-path
- ✅ **Raw body preserved byte-for-byte**, not re-serialized (important for signature checks)
- ✅ Live dashboard: new requests appear instantly over Server-Sent Events
- ✅ Persistent history in SQLite, a single file with no database server to run
- ✅ MIT licensed

## Quick start

### With Docker (recommended)

```bash
git clone https://github.com/Aliweb789/hookpit.git
cd hookpit
docker compose up --build
```

Open <http://localhost:3000>, click **Create endpoint**, then send it a request:

```bash
curl -X POST http://localhost:4000/h/<your-slug> \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

> The Docker setup is new and has not been tested on many machines yet. If something breaks, please [open an issue](../../issues).

Hosting on a real domain? Set the API address your *browser* will use:

```bash
HOOKPIT_PUBLIC_API_URL=https://hooks.example.com docker compose up --build
```

### Without Docker (development)

Requires Node.js 20+.

```bash
npm install
npm run build -w apps/api
npm run start -w apps/api      # API on http://localhost:4000
npm run dev:web                # dashboard on http://localhost:3000 (second terminal)
```

## How it works

```
Stripe / GitHub / curl ──HTTP──►  API (NestJS)  ──►  SQLite file
                                      │
                                      └── Server-Sent Events ──►  Dashboard (Next.js)
```

| Folder | What it is |
|---|---|
| `apps/api` | NestJS server: creates endpoints, captures requests, stores them, streams them live |
| `apps/web` | Next.js dashboard: create an endpoint and watch requests arrive |

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/endpoints` | Create an endpoint, returns `{ slug, createdAt }` |
| `GET` | `/api/endpoints/:slug/requests` | List captured requests (newest first) |
| `GET` | `/api/endpoints/:slug/stream` | Live stream of new requests (SSE) |
| `ANY` | `/h/:slug[/anything]` | **The capture URL.** Accepts any method and path |

## Roadmap

- [ ] Replay a captured request to any URL, editing it first
- [ ] Mock responses (custom status, body, headers, delay per path)
- [ ] Signature verification (Stripe, GitHub, Slack)
- [ ] OpenAPI import to generate mock endpoints
- [ ] CLI that forwards requests to `localhost` (`npx hookpit listen 3000`)
- [ ] Automatic expiry and rate limiting for public instances
- [x] CI (build on every pull request)
- [x] Automated tests for the API (unit and end-to-end; dashboard tests still welcome)

## Contributing

New here? Great. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the PR workflow, and look for issues labelled **good first issue**.

## License

[MIT](LICENSE)
