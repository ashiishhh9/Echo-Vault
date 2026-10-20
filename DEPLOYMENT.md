# Deployment guide

## Recommended hosting shape

Run one always-on Linux VM or VPS behind an HTTPS reverse proxy. Give it a persistent local block volume for both the Node SQLite database and `MEDIA_STORAGE_DIR`. The Node service should serve the built React app and own the scheduler. Run the AI FastAPI service on loopback or a private network that only the Node service can reach. Its shared internal API key is defense in depth; do not expose the AI API publicly.

This setup matches the current SQLite and local media adapters. Do not use an ephemeral container filesystem, serverless functions, or multiple uncoordinated Node replicas for the main service. Backups must include the SQLite database and uploaded media. If the host sleeps, restarts frequently, or cannot mount persistent storage, choose a different host or move the database/media to managed persistent services before deployment.

## Production environment

Copy `backend/.env.example` to `backend/.env` on the server and set these values. Keep that file out of source control and restrict its file permissions.

```env
NODE_ENV=production
PORT=4173
HOST=127.0.0.1
TRUST_PROXY=true
SECRET_KEY=<random secret with at least 32 characters>
ACCESS_TOKEN_EXPIRE_MINUTES=60
DATABASE_PATH=/srv/digital-time-capsule/data/digital-time-capsule.sqlite
MEDIA_STORAGE_DIR=/srv/digital-time-capsule/media
AI_SERVICE_URL=http://127.0.0.1:8100
AI_SERVICE_API_KEY=<same random secret configured for the AI service>
BACKEND_CORS_ORIGINS=https://capsule.example.com

APP_BASE_URL=https://capsule.example.com
EMAIL_NOTIFICATIONS_ENABLED=true
RESEND_API_KEY=<server-side Resend API key>
EMAIL_FROM=Digital Time Capsule <capsules@example.com>
```

Replace the example domain, paths, and credentials. `APP_BASE_URL` must be the public HTTPS frontend URL. Configure `EMAIL_FROM` on a sender domain verified with Resend before enabling email. If email is not configured, keep `EMAIL_NOTIFICATIONS_ENABLED=false`; the application still starts and in-app notifications continue.

The frontend API URL is same-origin `/api/v1` by default. That is correct when the Node process serves both the frontend build and API. If you host the frontend separately, set `VITE_API_URL` to the public HTTPS API base ending in `/api/v1` at build time, and set `BACKEND_CORS_ORIGINS` to the exact frontend origin. Production CORS defaults to no cross-origin origins unless you configure them. The Node API applies frame and content security headers, request-size bounds, and authentication throttling. Do not put secrets in any `VITE_*` variable because Vite embeds them in public assets.

Keep `AI_SERVICE_URL` private and set the same random `AI_SERVICE_API_KEY` (at least 32 characters) in the Node and AI service environments. The Node backend sends it only on server-to-server calls; the AI service rejects requests without it in production. Do not expose the key through the frontend or logs. Set `ENVIRONMENT=production` and `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5` in the AI process environment unless deliberately using a compatible 384-dimensional FastEmbed model. Production mode requires the internal key and hides the interactive API documentation. The initial embedding request downloads the model, so allow outbound access during deployment or prewarm the model cache before restricting outbound traffic.

## Build and run

Install Node.js 24 or newer and Python 3.11 on the VM. From a clean checkout:

```sh
npm ci
npm ci --prefix frontend
npm run build
python3.11 -m venv ai-service/.venv
ai-service/.venv/bin/pip install -r ai-service/requirements.txt
```

Create the persistent directories and make them writable by the service account:

```sh
sudo install -d -m 700 -o capsule -g capsule /srv/digital-time-capsule/data
sudo install -d -m 700 -o capsule -g capsule /srv/digital-time-capsule/media
```

The Node API and Python compatibility store set database files to owner-only permissions on POSIX systems. Keep their parent directories restricted to the service account as above; the media adapter creates private directories and files.

Run the AI service on loopback and keep it under a service manager so it restarts after a crash or reboot:

```sh
ai-service/.venv/bin/uvicorn app:app --app-dir ai-service --host 127.0.0.1 --port 8100 --workers 1
```

Provide `ai-service/.env` to the AI service through the service manager's environment-file support, or set the same variables directly in its service definition. Start from `ai-service/.env.example`, set `ENVIRONMENT=production`, and use the same private API key as `backend/.env`. Restrict both environment files to the service account. The AI service accepts request bodies up to 16 MiB; the Node API applies smaller limits to ordinary requests and allows larger media upload bodies only on memory create/update routes.

Run the Node service continuously with `backend/.env` loaded by the entry point:

```sh
npm start
```

Use systemd or the host's equivalent to start both commands at boot and restart them on failure. Place Caddy, Nginx, or an equivalent TLS reverse proxy in front of Node; proxy HTTPS requests to `127.0.0.1:4173` and do not expose ports 4173 or 8100 publicly. Configure the proxy to set HSTS after confirming every served hostname uses HTTPS. With `TRUST_PROXY=true`, the Node app only honors `X-Forwarded-For` when the TCP peer is loopback. Configure the reverse proxy to replace (not append to) the incoming `X-Forwarded-For` header with the actual client address. For a proxy on another host, use an explicit trusted-proxy design instead of setting this loopback-only option. Without a proxy, leave `TRUST_PROXY=false` and bind Node to a private interface.

The Python compatibility API is optional and is not used by the default frontend. If it is needed, configure its separate `PYTHON_DATABASE_PATH` on persistent storage and run it as a separate private service. It does not share the Node API's SQLite database.

For the Python compatibility API, set `ENVIRONMENT=production`, `DEBUG=false`, a random `SECRET_KEY` of at least 32 characters, and exact `BACKEND_CORS_ORIGINS`. Production startup rejects a missing key or enabled debug mode and disables interactive API docs. This optional API uses a pickle-backed SQLite key-value store, so the database and backups must remain trusted and service-account-only; it is not hardened for multiple processes. Its due-capsule check runs on authenticated capsule-list requests rather than in a background scheduler. Use the Node service as the production scheduler.

## Scheduler, database, and recovery

The Node process runs the due-capsule scheduler every 30 seconds and also checks due capsules during authenticated API requests. Keep exactly one coordinated Node service process for this SQLite deployment. Its conditional SQLite updates and unique email-delivery records limit duplicate work, but local SQLite/media are intended for a single host and do not provide a supported multi-host shared-storage deployment.

Capsule status and its unlock notification/email outbox record are persisted in SQLite. Transient email failures retry with bounded delays. A provider outage does not lock a due capsule again. Keep the email environment variables only on the backend. Resend acceptance records successful submission to the provider, not confirmed inbox delivery.

For a consistent backup, stop the Node process first so SQLite can checkpoint its WAL, then back up the database and media directory together. Restore both to the same configured persistent paths before starting the service. Test restores periodically. Never copy only the SQLite main file while the process is writing; use SQLite's backup mechanism or stop the process and include any remaining WAL sidecar files.

## Health checks and troubleshooting

- `GET /api/v1/health` — Node API and SQLite readiness.
- `GET /api/v1/ai/health` — authenticated Node-to-AI connectivity.
- `GET http://127.0.0.1:8100/health` from the VM — internal AI model/service status.

Common issues:

- **Frontend shows a network error:** verify the built frontend uses same-origin `/api/v1`, or rebuild with the right `VITE_API_URL`; check the reverse proxy and CORS origin.
- **The API cannot write the database or uploads:** confirm the service account owns the persistent database parent directory and media directory.
- **Capsules unlock but email is disabled:** check `EMAIL_NOTIFICATIONS_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`, sender-domain verification, and backend logs. A disabled or failed email never grants or revokes capsule access.
- **AI insights work but semantic search fails on first use:** allow the AI process to download/cache the configured embedding model, check `/health`, and verify Node's `AI_SERVICE_URL`.
- **Scheduled work stops:** confirm the Node service is continuously running and the host does not suspend it. A serverless request handler alone does not run this in-process scheduler continuously.

## Deployment verification

Build and run the automated suites from the repository root:

```sh
npm run test:node
npm run build
```

Run the Python compatibility tests from `backend/` and AI tests from `ai-service/` using their virtual environments. Use a fresh temporary database for the Python suite. After deployment, verify the health checks, register a dedicated test account, and exercise authentication, ownership/locking, capsule/memory CRUD, AI features, and notifications. Only test actual email delivery with a controlled recipient and explicitly configured provider credentials; otherwise report real delivery as unverified.
