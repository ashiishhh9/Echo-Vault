import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import HTTPException, status

from app.models.notification import Notification
from app.services.persistence import PersistentDict


class InMemoryNotificationRepository:
    def __init__(self):
        self._notifications: Dict[str, Notification] = PersistentDict("notifications")
        self._user_notifications: Dict[str, list[str]] = PersistentDict("user_notifications")

    def create(self, user_id: str, notification_type: str, message: str) -> Notification:
        notification = Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            type=notification_type,
            message=message,
            created_at=datetime.now(timezone.utc),
            read=False,
        )
        self._notifications[notification.id] = notification
        user_notifications = self._user_notifications.get(user_id, [])
        user_notifications.append(notification.id)
        self._user_notifications[user_id] = user_notifications
        return notification

    def list_for_user(self, user_id: str) -> list[Notification]:
        return [self._notifications[notification_id] for notification_id in self._user_notifications.get(user_id, [])]

    def get(self, notification_id: str) -> Optional[Notification]:
        return self._notifications.get(notification_id)

    def mark_read(self, notification_id: str) -> Notification:
        notification = self._notifications[notification_id]
        notification.read = True
        self._notifications[notification_id] = notification
        return notification


class NotificationService:
    def __init__(self, repository: Optional[InMemoryNotificationRepository] = None):
        self.repository = repository or InMemoryNotificationRepository()

    def create_notification(self, user_id: str, notification_type: str, message: str) -> Notification:
        return self.repository.create(user_id, notification_type, message)

    def list_notifications(self, user_id: str) -> list[Notification]:
        notifications = self.repository.list_for_user(user_id)
        if not notifications:
            self.repository.create(user_id, "system", "Welcome to your Digital Time Capsule.")
            notifications = self.repository.list_for_user(user_id)
        return notifications

    def mark_notification_read(self, user_id: str, notification_id: str) -> Notification:
        notification = self.repository.get(notification_id)
        if notification is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
        if notification.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this notification")
        return self.repository.mark_read(notification_id)


notification_service = NotificationService()
