# Frontend

This React + Vite app uses the Node.js API as its primary backend. It is not a standalone local-storage demo.

## Development

From the repository root, install dependencies with `npm ci` and `npm ci --prefix frontend`, copy `frontend/.env.example` to `frontend/.env`, then run:

```powershell
npm.cmd run dev
```

The Vite app defaults to `http://localhost:5173`; `.env.example` points its API client to the Node server at `http://127.0.0.1:4173/api/v1`. Start the Node API and AI service using the commands in the root [README](../README.md).

## Production

Build with `npm.cmd run build` from the repository root. The Node server serves `frontend/dist` and the `/api/v1` API from one origin. The client uses relative `/api/v1` by default. If hosting the frontend separately, set `VITE_API_URL` to the HTTPS API base at build time and add that exact frontend origin to `BACKEND_CORS_ORIGINS`.

The browser stores the bearer access token in local storage; the Node API validates it and logout revokes it. Capsule, memory, and profile data are loaded from the authenticated API. The server enforces capsule ownership and unlock time before returning private memory contents or media.

See the root [deployment guide](../DEPLOYMENT.md) for persistent storage, production environment variables, and health checks.
