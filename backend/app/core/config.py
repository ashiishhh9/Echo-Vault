import os
from typing import List

from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()


class Settings(BaseModel):
    app_name: str = Field(default="Digital Time Capsule API")
    api_v1_prefix: str = Field(default="/api/v1")
    backend_cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"]
    )
    environment: str = Field(default="development")
    debug: bool = Field(default=True)


def get_settings() -> Settings:
    environment = os.getenv("ENVIRONMENT", "development").lower()
    is_production = environment == "production"
    debug = os.getenv("DEBUG", "true").lower() == "true"
    if is_production and debug:
        raise RuntimeError("DEBUG must be false in production")
    if is_production and len(os.getenv("SECRET_KEY", "")) < 32:
        raise RuntimeError("Set a random SECRET_KEY of at least 32 characters in production")
    configured_origins = os.getenv("BACKEND_CORS_ORIGINS")
    if configured_origins is None:
        configured_origins = "" if is_production else "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    return Settings(
        app_name=os.getenv("APP_NAME", "Digital Time Capsule API"),
        api_v1_prefix=os.getenv("API_V1_PREFIX", "/api/v1"),
        backend_cors_origins=[origin.strip() for origin in configured_origins.split(",") if origin.strip()],
        environment=environment,
        debug=False if is_production else debug,
    )
