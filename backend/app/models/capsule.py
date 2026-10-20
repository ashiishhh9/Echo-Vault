from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class Capsule:
    id: str
    owner_id: str
    title: str
    description: str
    created_at: datetime
    updated_at: datetime
    unlock_at: datetime
    status: str = "LOCKED"
    memories: list = field(default_factory=list)

    def to_dict(self):
        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "title": self.title,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "unlock_at": self.unlock_at.isoformat(),
            "status": self.status,
            "memories": self.memories,
        }
