from dataclasses import dataclass


@dataclass
class User:
    id: str
    name: str
    email: str
    password_hash: str
    location: str = ""
    bio: str = ""
    initials: str = ""
    notifications: bool = True
    compact_mode: bool = False
    export_format: str = "json"
