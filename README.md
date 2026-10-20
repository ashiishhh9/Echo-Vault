# Digital Time Capsule

Digital Time Capsule (Echovault) preserves the existing React/Vite interface and uses the existing Node.js server as its main API. The Node service provides authenticated capsule and memory APIs, SQLite persistence, notifications, and the built frontend. A Python FastAPI compatibility API remains under `backend/app` for the earlier API workflow and its existing test suite.

## Requirements

- Node.js 24 or newer (the Node API uses the built-in `node:sqlite` module).
- Python 3.11 only when running the compatibility API or its tests.
- Existing frontend packages are installed from `frontend/package-lock.json`.

## Run the main application

From the project root, open three terminals to run all features.

Terminal 1, build and start the Node API/web server:

```powershell
npm.cmd ci
npm.cmd ci --prefix frontend
npm.cmd --prefix frontend run build
Copy-Item backend/.env.example backend/.env
node backend/server.mjs
```

Terminal 2, run the Vite frontend in development mode:

```powershell
npm.cmd --prefix frontend run dev
```

Terminal 3, start the local AI service (Python 3.11):

```powershell
py -3.11 -m venv ai-service/.venv
ai-service/.venv/Scripts/Activate.ps1
python -m pip install -r ai-service/requirements.txt
python -m uvicorn app:app --app-dir ai-service --host 127.0.0.1 --port 8100
```

The embedding model downloads when semantic search or memory chat is first used. AI insights use local sentiment scoring and extractive summaries. Memory chat retrieves relevant unlocked entries and quotes them; it is retrieval-only rather than generative.

Open the URL Vite prints, usually `http://localhost:5173`. The default API is `http://127.0.0.1:4173/api/v1`; override it with `VITE_API_URL` in `frontend/.env` when needed. The production web app is served directly by the Node server at `http://127.0.0.1:4173` after the frontend build.

The frontend API client uses same-origin `/api/v1` by default, which is appropriate when the production Node server serves the built frontend. For Vite development, copy `frontend/.env.example` to `frontend/.env`; that file points Vite to the local Node API.

The API health check is `GET http://127.0.0.1:4173/api/v1/health`.

## Main backend and storage

The main backend entry point is [backend/server.mjs](backend/server.mjs), implemented with Node's built-in HTTP server and SQLite. The database defaults to `database/digital-time-capsule.sqlite`; set `DATABASE_PATH` to move it. Capsule rows own their memory rows via SQLite foreign keys. JWT secrets, token expiry, CORS origins, and port are configured in `backend/.env.example`.

Use a random `SECRET_KEY` with at least 32 characters for production. New media uploads are MIME/signature and size validated, stored under `storage/media` (or `MEDIA_STORAGE_DIR`), and referenced by private media IDs in SQLite. The directory is outside the frontend's public assets. Authenticated media requests check ownership and capsule unlock status. Existing data URL records remain readable until migrated.

### Embedding and media persistence

Memory vectors are stored in the SQLite `memories` table as validated JSON with model name, dimensions, retry status, and attempt count. The current service keeps `BAAI/bge-small-en-v1.5` at 384 dimensions. New and edited searchable text is embedded on save; an AI outage leaves the memory saved with a failed/retryable embedding. Search generates a query vector and reuses stored, model-compatible memory vectors. Missing or invalid vectors are retried during search or through `POST /api/v1/ai/embeddings/backfill` (authenticated, unlocked memories only; batches up to 100 records per call). Follow the returned `next_cursor` through the archive; restart without a cursor to retry earlier failures. Inspect `attempted`, `migrated`, `failed`, `remaining`, and `progress`.

`media_assets` stores the media ID, memory association, opaque storage key, verified MIME type, sanitized original filename, size, and timestamp. To migrate old data URLs, back up the SQLite database and media directory together, then call authenticated `POST /api/v1/media/migrate` with an optional `{ "limit": 25 }` body. Each call migrates up to 50 unlocked records, verifies stored bytes before changing the reference, and reports migrated, failed, remaining, and locked records. The operation is resumable; locked capsules are left untouched until unlocked. Legacy data URLs remain usable if migration fails.

Chat conversations and messages are stored in SQLite and scoped to the signed-in user. Recent turns help form a better retrieval query; answers still quote retrieved memories and do not use a generative model. References are rechecked against current ownership and capsule unlock status when history is loaded. Image and video retrieval indexes the memory note/title, original upload filename, MIME type, and media type, then returns only private media linked to cited unlocked memories. The service does not analyze image pixels, create captions, extract video keyframes, or transcribe audio/video. Add a note or caption when saving media to make its contents searchable. No heavy media-processing dependency is required.

For recovery, stop the server and back up/restore the SQLite file and configured media directory as one set. Local file storage assumes one application instance with access to the same directory; a multi-instance deployment needs shared object storage and a compatible storage adapter. Existing photos can be analyzed incrementally with authenticated `POST /api/v1/ai/images/reprocess`; no media is sent outside the local Node/AI-service boundary. The local caption model does not identify people or infer emotions, causes, or hidden details, and video processing is not implemented.

## Python compatibility API

The earlier FastAPI implementation remains available and stores its own data in `backend/data/capsules.sqlite3` by default (`PYTHON_DATABASE_PATH` can override it). From `backend/`, run:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Its docs are at `http://127.0.0.1:8000/docs`. The frontend's default target remains the Node API; set `VITE_API_URL=http://127.0.0.1:8000/api/v1` to use FastAPI instead.

## Checks

The repeatable local suite runs the frontend TypeScript check/build, Node API/email/dashboard tests, Python compatibility API tests, and AI-service tests:

```powershell
npm.cmd ci
npm.cmd ci --prefix frontend
py -3.11 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
py -3.11 -m venv ai-service/.venv
ai-service/.venv/Scripts/python.exe -m pip install -r ai-service/requirements.txt
npm.cmd run test:all
```

`test:all` picks `backend/.venv` and `ai-service/.venv` when present. Otherwise it uses `PYTHON`, or the system Python 3.11 command. Each Python environment needs its project's requirements installed. The compatibility pytest suite creates a fresh temporary SQLite database and removes it at the end; it does not use `backend/data/capsules.sqlite3` or a production database. Node API and email tests use temporary databases and mocked AI/email services. No real credentials are needed.

To run one suite on its own:

```powershell
npm.cmd --prefix frontend run build
npm.cmd run test:node
Push-Location backend; .\.venv\Scripts\python.exe -m pytest -q; Pop-Location
Push-Location ai-service; .\.venv\Scripts\python.exe -m pytest tests -q; Pop-Location
```

AI-service pytest uses deterministic synthetic embeddings and does not download model files. To smoke-test the real embedding model and retrieval fixture, run this from `ai-service/`:

```powershell
.venv/Scripts/python.exe evaluate.py
```

The first real-model evaluation may download FastEmbed files and needs network access; it is intentionally separate from mandatory tests. Browser automation is also separate because Playwright and browser binaries are not installed. Real inbox delivery requires Resend credentials and a verified sender; automated email tests use a mock sender. See [ai-service/README.md](ai-service/README.md) for model details and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment procedures.

### Continuous integration

The GitHub Actions workflow is in `.github/workflows/ci.yml`. It runs on pushes and pull requests, caches npm and pip dependencies, builds the frontend, and runs all deterministic test suites without secrets or model downloads.

This workspace has no `.git` directory or configured remote, so GitHub Actions has **not** run here. To enable the workflow, create or select the intended GitHub repository, connect the project through its normal Git setup, commit and push the reviewed files, then check the first Actions run in GitHub. Do not commit `.env` files or credentials. A green local run is not evidence that GitHub Actions ran.

If a job fails, run `npm.cmd run test:all` locally to identify the failing suite, or run its individual command above. Real-model evaluation, browser testing, and real email delivery remain manual checks.

## Unlock email notifications

The Node API uses Resend's official Node.js SDK for one email when a capsule becomes available. Copy `backend/.env.example` to `backend/.env` and configure `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, and `EMAIL_NOTIFICATIONS_ENABLED=true`. Keep the API key only in the backend environment; `.env` is ignored by Git. The default is disabled, and the app starts normally without credentials.

## Administrator dashboard

Ordinary registration always creates a `user` role. After the trusted account has been registered, stop the Node service and run `node backend/scripts/provision-admin.mjs --email=admin@example.com` on the server. The command uses the configured `DATABASE_PATH` (or the default database), asks you to type the exact account email, and promotes only that existing account. Start the service again and sign in; the Admin dashboard link appears for that administrator. Never run this command with an untrusted account or expose it as a web endpoint.

The admin APIs are under `/api/v1/admin/` and independently check the signed-in account's database role. The dashboard shows aggregate counts, limited account details, persisted email delivery states, and best-effort AI health. Scheduler status is shown as unavailable until a recent scheduled worker run completes. Account status changes take effect on the next authenticated request; a disabled account cannot sign in. Role and status migrations are additive and default all existing accounts to active users. Status changes are recorded in `admin_audit_log`; this is an application audit trail, not a tamper-proof log.

Resend requires a verified sending domain for a production sender address. Verify the domain in the Resend dashboard, publish the DNS records Resend supplies, and use a sender address on that verified domain. The sender must be eligible under the account's sending limits.

When the 30-second backend scheduler or an authenticated API request finds a due capsule, it unlocks it using the existing server-side rules and writes its in-app notification and email outbox row together. Email delivery never grants access. The email links to `APP_BASE_URL`; the recipient still signs in, and ownership and unlock checks remain enforced by the API. The message contains the capsule title but no memory contents, media, password, or token. Users can turn off unlock email in Settings independently of in-app notifications.

SQLite stores each capsule's email status, attempt count, safe error, timestamps, provider message ID, and retry time. A unique capsule/type constraint and conditional claim prevent concurrent scheduler submissions. Resend idempotency keys protect retries after uncertain network results. Temporary failures use increasing delays, up to five attempts; invalid recipients and permanent provider rejections stop retrying. An abandoned `sending` record is recovered after ten minutes. Provider acceptance means Resend accepted the submission; it does not prove inbox delivery.

The backend scheduler must run continuously and the SQLite database must persist. Use one coordinated backend/worker for the database. On platforms that sleep or terminate background processes, use an always-on worker or an external scheduled job that invokes the same scheduler. Back up the database as part of deployment operations. Real inbox delivery needs configured Resend credentials and a verified sender; automated tests use a mock sender only.

For production configuration, persistent storage, private AI-service networking, and deployment commands, see [DEPLOYMENT.md](DEPLOYMENT.md).
