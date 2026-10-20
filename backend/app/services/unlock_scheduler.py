from datetime import datetime, timezone

from app.services.notification_service import notification_service


class UnlockScheduler:
    def __init__(self, capsule_service_ref=None, notification_service_ref=None):
        self.capsule_service = capsule_service_ref
        self.notification_service = notification_service_ref or notification_service

    def process_due_capsules(self, owner_id: str | None = None):
        if self.capsule_service is None:
            from app.services.capsule_service import capsule_service

            self.capsule_service = capsule_service

        repo = self.capsule_service.repository
        capsules = repo.list_for_user(owner_id) if owner_id else list(repo._capsules.values())
        unlocked_count = 0

        for capsule in capsules:
            now = datetime.now(timezone.utc)
            if capsule.status == "LOCKED" and now >= capsule.unlock_at:
                repo.unlock(capsule.id)
                self.notification_service.create_notification(
                    capsule.owner_id,
                    "capsule_unlocked",
                    f"Your capsule '{capsule.title}' has unlocked.",
                )
                unlocked_count += 1

        return unlocked_count


unlock_scheduler = UnlockScheduler()
