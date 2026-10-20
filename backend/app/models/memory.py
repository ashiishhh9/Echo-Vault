from dataclasses import dataclass
from datetime import datetime


@dataclass
class Memory:
    id: str
    capsule_id: str
    type: str
    content_text: str
    media_url: str
    created_at: datetime
    updated_at: datetime

    def to_dict(self):
        return {
            "id": self.id,
            "capsule_id": self.capsule_id,
            "type": self.type,
            "content_text": self.content_text,
            "media_url": self.media_url,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
