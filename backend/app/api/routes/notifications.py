from fastapi import APIRouter, Depends, status

from app.core.dependencies import get_current_user
from app.schemas.notification import NotificationResponse
from app.services.notification_service import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationResponse])
def list_notifications(current_user=Depends(get_current_user)):
    notifications = notification_service.list_notifications(current_user.id)
    return [
        NotificationResponse(
            id=notification.id,
            user_id=notification.user_id,
            type=notification.type,
            message=notification.message,
            created_at=notification.created_at,
            read=notification.read,
        )
        for notification in notifications
    ]


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_read(notification_id: str, current_user=Depends(get_current_user)):
    notification = notification_service.mark_notification_read(current_user.id, notification_id)
    return NotificationResponse(
        id=notification.id,
        user_id=notification.user_id,
        type=notification.type,
        message=notification.message,
        created_at=notification.created_at,
        read=notification.read,
    )
