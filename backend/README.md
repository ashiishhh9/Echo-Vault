# Digital Time Capsule Backend

## Primary server

The primary backend is the Node.js service in `server.mjs`. It serves the built React frontend and the `/api/v1` API. It requires Node.js 24 or newer for the built-in SQLite module.

From the project root:

```powershell
npm.cmd ci
npm.cmd ci --prefix frontend
Copy-Item backend/.env.example backend/.env
npm.cmd --prefix frontend run build
node backend/server.mjs
```

Default address: `http://127.0.0.1:4173`; health check: `/api/v1/health`. The SQLite file is `database/digital-time-capsule.sqlite` unless `DATABASE_PATH` is set.

## Python compatibility API

`app/` preserves the earlier FastAPI API implementation. From this directory, create/activate `.venv`, install `requirements.txt`, then run:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Its API docs are at `/docs` in development and disabled in production. Production requires `ENVIRONMENT=production`, `DEBUG=false`, and a random `SECRET_KEY` of at least 32 characters. Its SQLite data defaults to `data/capsules.sqlite3`. Set `PYTHON_DATABASE_PATH` to override that path. Run its tests with `python -m pytest -q`.

The Python API is retained for compatibility and is not the primary server used by the frontend.

## Embeddings and private media files

### Local photo understanding

Stored image uploads can be analyzed by the local AI service using its configured Transformers vision model. `media_assets` records `analysis_status`, a SHA-256 of the analyzed bytes, the factual caption, attempt count, error, and timestamp. Only successful captions are added to the existing embedding text, so pending or failed analysis cannot make the system claim it understood a photo. Reprocessing is authenticated and unlocked-capsule scoped: call `POST /api/v1/ai/images/reprocess` with an optional `{ "limit": 10 }` (maximum 50). Unchanged successful images are hash-reused; failed images can be retried. Existing local images are backfilled by the same endpoint. Locked images, deleted assets, unauthorized users, and remote legacy URLs are not sent for analysis.

The Node API adds embedding status/model/vector columns to the existing `memories` table in an additive, data-preserving startup migration; memory IDs and content are unchanged. Vectors are JSON-serialized 384-number arrays, tied to the model string returned by the AI service. Save/update makes a bounded embedding attempt and records failures for retry. Search retries missing/invalid vectors and sends only the authenticated user's unlocked memories. To backfill in batches, authenticate and call `POST /api/v1/ai/embeddings/backfill` with `{ "limit": 50 }`; follow `next_cursor` to page through the archive and restart without a cursor to retry earlier failures. Responses include processed counts and progress.

New data URL uploads are validated, written atomically under `MEDIA_STORAGE_DIR` (default `storage/media` at the project root), and represented in SQLite by a `media:<id>` reference and a `media_assets` row. Retrieval uses `/api/v1/media/<id>` and enforces owner and unlock checks. Legacy data URLs are still returned as before until migrated. After backing up the database and media directory, migrate unlocked records with authenticated `POST /api/v1/media/migrate`; use `{ "limit": 25 }` to set a batch size (maximum 50). The response reports migrated, failed, remaining, and locked counts. Failed records keep their original data URL for retry.

Back up or restore the SQLite database and media directory together while the server is stopped. Local storage is intended for development or a single server instance. Multiple instances need shared storage and a shared database; a future storage adapter can replace local files without changing capsule authorization.

## Unlock email notifications

Email is sent through Resend's official Node.js SDK. Configure `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, and `EMAIL_NOTIFICATIONS_ENABLED=true` in `backend/.env` (see `.env.example`). Email is disabled by default, and missing credentials do not stop the API. Never place the key in frontend configuration. Resend requires a verified sending domain and DNS records before it can send from a production domain; use an eligible sender address from that domain.

The existing 30-second due-capsule scheduler writes the unlock status, in-app notification, and unique SQLite email delivery row together. The mail worker claims rows conditionally, retries transient errors at increasing intervals up to five attempts, and uses Resend idempotency keys. It recovers stale sends after ten minutes. The email contains only the capsule title and dashboard link. Opening it still requires login, owner match, and an unlocked capsule. Each user can disable unlock emails in Settings without changing in-app notifications. A provider accepted state means submission accepted, not guaranteed inbox delivery.

Keep the Node backend or a dedicated worker running continuously, persist SQLite delivery state, and avoid multiple uncoordinated schedulers. If the hosting platform sleeps, schedule an always-on worker or external job against the shared database.
