# 🪝 Hookpit

[![CI](https://github.com/Aliweb789/hookpit/actions/workflows/ci.yml/badge.svg)](https://github.com/Aliweb789/hookpit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A self-hostable webhook inspector.** Get a URL in one click, point Stripe / GitHub / your own code at it, and watch every request appear live, with its exact method, headers, query and raw body.

Your payloads stay on your own server instead of a third-party site.

> **Status: early (v0.1).** Capture, live inspection and replay work today. Mocking and signature checks are on the [roadmap](#roadmap). Contributions are very welcome.

## Features

- ✅ Unique capture URL per endpoint (`/h/<slug>`), any HTTP method and sub-path
- ✅ **Raw body preserved byte-for-byte**, not re-serialized (important for signature checks)
- ✅ Live dashboard: new requests appear instantly over Server-Sent Events
- ✅ **Replay** any captured request to a URL of your choice, editing the method and body first
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
| `POST` | `/api/endpoints/:slug/requests/:id/replay` | Resend a captured request. JSON body: `{ "url": "...", "method"?, "headers"?, "body"? }`. Returns the target's `status`, `headers`, `body`, `durationMs` |
| `ANY` | `/h/:slug[/anything]` | **The capture URL.** Accepts any method and path |

## Replay and security

Replay makes the **Hookpit server** call a URL you provide. On a server that is reachable by other people, that is a classic [SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery) risk (reaching cloud metadata services, databases or admin panels on the private network), so replay is **safe by default**:

- only `http` and `https`, no credentials in the URL
- loopback, private, link-local (e.g. `169.254.169.254`) and other reserved addresses are **blocked**, including IPv6 and IPv4-mapped forms, checked at DNS-lookup time so DNS rebinding does not work
- redirects are never followed; 10 second timeout; responses are capped at 1 MB

Running Hookpit privately and want to replay to `localhost` or your LAN? Opt in:

| Variable | Default | Meaning |
|---|---|---|
| `HOOKPIT_ALLOW_PRIVATE_TARGETS` | `false` | `true` lets replay reach private and loopback addresses. **Only enable on an instance you do not expose publicly.** |
| `HOOKPIT_REPLAY_TIMEOUT_MS` | `10000` | How long to wait for the target |

```bash
# without Docker
HOOKPIT_ALLOW_PRIVATE_TARGETS=true npm run start -w apps/api

# with Docker (inside a container, "localhost" is the container itself;
# use http://host.docker.internal:3000/... to reach your machine)
HOOKPIT_ALLOW_PRIVATE_TARGETS=true docker compose up --build
```

Known limitations: there is no authentication yet (anyone who knows an endpoint slug and request id can replay it), replay has no rate limiting, and bodies are stored as UTF-8 text so binary payloads may not replay byte-for-byte. See the roadmap.

## Roadmap

- [x] Replay a captured request to any URL, editing it first
- [ ] Authentication and per-endpoint access control
- [ ] Faithful replay of binary bodies
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
