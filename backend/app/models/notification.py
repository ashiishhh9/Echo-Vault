from dataclasses import dataclass
from datetime import datetime


@dataclass
class Notification:
    id: str
    user_id: str
    type: str
    message: str
    created_at: datetime
    read: bool = False

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "type": self.type,
            "message": self.message,
            "created_at": self.created_at.isoformat(),
            "read": self.read,
        }
