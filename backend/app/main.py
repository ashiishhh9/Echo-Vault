from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from time import monotonic

from app.api.routes.auth import router as auth_router
from app.api.routes.capsules import router as capsules_router
from app.api.routes.memories import router as memories_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.profile import router as profile_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Digital Time Capsule backend API",
    docs_url=None if settings.environment == "production" else "/docs",
    redoc_url=None if settings.environment == "production" else "/redoc",
    openapi_url=None if settings.environment == "production" else "/openapi.json",
)

_auth_rate_limits: dict[str, tuple[int, float]] = {}


def _consume_auth_limit(client_ip: str, now: float) -> bool:
    current = _auth_rate_limits.get(client_ip)
    if current is None or current[1] <= now:
        if len(_auth_rate_limits) >= 10_000:
            for key, (_, expires_at) in list(_auth_rate_limits.items()):
                if expires_at <= now:
                    _auth_rate_limits.pop(key, None)
            if len(_auth_rate_limits) >= 10_000:
                _auth_rate_limits.pop(next(iter(_auth_rate_limits)))
        _auth_rate_limits[client_ip] = (1, now + 60)
        return False
    count, expires_at = current
    if count >= 60:
        return True
    _auth_rate_limits[client_ip] = (count + 1, expires_at)
    return False


@app.middleware("http")
async def limit_auth_and_request_size(request: Request, call_next):
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length"})
    body_limit = 70 * 1024 * 1024 if "/memories" in request.url.path else 64 * 1024
    if content_length > body_limit:
        return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
    if request.url.path in {f"{settings.api_v1_prefix}/auth/register", f"{settings.api_v1_prefix}/auth/login"}:
        client_ip = request.client.host if request.client else "unknown"
        if _consume_auth_limit(f"{client_ip}:{request.url.path}", monotonic()):
            return JSONResponse(status_code=429, content={"detail": "Too many authentication attempts. Try again later."})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(capsules_router, prefix=settings.api_v1_prefix)
app.include_router(memories_router, prefix=settings.api_v1_prefix)
app.include_router(notifications_router, prefix=settings.api_v1_prefix)
app.include_router(profile_router, prefix=settings.api_v1_prefix)


@app.get(f"{settings.api_v1_prefix}/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ok", "docs": "/docs"}


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=settings.debug)
