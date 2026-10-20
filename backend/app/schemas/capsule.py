from datetime import datetime

from pydantic import BaseModel, Field


class CapsuleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    unlock_at: datetime


class CapsuleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    unlock_at: datetime | None = None


class CapsuleResponse(BaseModel):
    id: str
    owner_id: str
    title: str
    description: str
    created_at: datetime
    updated_at: datetime
    unlock_at: datetime
    status: str
    memories: list = Field(default_factory=list)
    memory_count: int = 0
