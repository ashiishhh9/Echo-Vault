from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MemoryCreate(BaseModel):
    type: Literal["text", "image", "video", "audio"]
    content_text: str | None = Field(default=None, max_length=20_000)
    media_url: str | None = Field(default=None, max_length=70 * 1024 * 1024)
    file_size: int | None = Field(default=None, ge=0)


class MemoryUpdate(BaseModel):
    type: Literal["text", "image", "video", "audio"] | None = None
    content_text: str | None = Field(default=None, max_length=20_000)
    media_url: str | None = Field(default=None, max_length=70 * 1024 * 1024)
    file_size: int | None = Field(default=None, ge=0)


class MemoryResponse(BaseModel):
    id: str
    capsule_id: str
    type: str
    content_text: str | None = None
    media_url: str | None = None
    created_at: datetime
    updated_at: datetime
