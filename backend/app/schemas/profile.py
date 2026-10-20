from pydantic import BaseModel, EmailStr, Field


class ProfileResponse(BaseModel):
    id: str
    name: str
    email: str
    location: str = ""
    bio: str = ""
    initials: str = ""


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    location: str | None = None
    bio: str | None = None
    initials: str | None = Field(default=None, min_length=1, max_length=5)


class SettingsResponse(BaseModel):
    notifications: bool = True
    compact_mode: bool = False
    export_format: str = "json"


class SettingsUpdate(BaseModel):
    notifications: bool | None = None
    compact_mode: bool | None = None
    export_format: str | None = Field(default=None, min_length=1, max_length=10)
