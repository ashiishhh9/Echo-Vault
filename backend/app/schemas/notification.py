from datetime import datetime

from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    type: str
    message: str
    created_at: datetime
    read: bool = False


class NotificationReadUpdate(BaseModel):
    read: bool | None = None
