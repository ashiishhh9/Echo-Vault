import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import HTTPException, status

from app.models.capsule import Capsule
from app.services.notification_service import notification_service
from app.services.persistence import PersistentDict


class InMemoryCapsuleRepository:
    def __init__(self):
        self._capsules: Dict[str, Capsule] = PersistentDict("capsules")
        self._user_capsules: Dict[str, list[str]] = PersistentDict("user_capsules")

    def create(self, owner_id: str, title: str, description: str, unlock_at: datetime) -> Capsule:
        if unlock_at.tzinfo is None:
            unlock_at = unlock_at.replace(tzinfo=timezone.utc)
        capsule = Capsule(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            title=title,
            description=description,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            unlock_at=unlock_at,
            status="LOCKED" if datetime.now(timezone.utc) < unlock_at else "UNLOCKED",
        )
        self._capsules[capsule.id] = capsule
        user_capsules = self._user_capsules.get(owner_id, [])
        user_capsules.append(capsule.id)
        self._user_capsules[owner_id] = user_capsules
        return capsule

    def list_for_user(self, owner_id: str) -> list[Capsule]:
        return [self._capsules[capsule_id] for capsule_id in self._user_capsules.get(owner_id, [])]

    def get(self, capsule_id: str) -> Optional[Capsule]:
        return self._capsules.get(capsule_id)

    def update(self, capsule_id: str, title: Optional[str], description: Optional[str], unlock_at: Optional[datetime]) -> Capsule:
        capsule = self._capsules[capsule_id]
        if title is not None:
            capsule.title = title
        if description is not None:
            capsule.description = description
        if unlock_at is not None:
            if unlock_at.tzinfo is None:
                unlock_at = unlock_at.replace(tzinfo=timezone.utc)
            capsule.unlock_at = unlock_at
        capsule.updated_at = datetime.now(timezone.utc)
        capsule.status = "LOCKED" if datetime.now(timezone.utc) < capsule.unlock_at else "UNLOCKED"
        self._capsules[capsule_id] = capsule
        return capsule

    def delete(self, capsule_id: str) -> None:
        capsule = self._capsules.pop(capsule_id)
        user_capsules = self._user_capsules.get(capsule.owner_id, [])
        if capsule_id in user_capsules:
            user_capsules.remove(capsule_id)
        self._user_capsules[capsule.owner_id] = user_capsules

    def lock(self, capsule_id: str) -> Capsule:
        capsule = self._capsules[capsule_id]
        capsule.status = "LOCKED"
        capsule.updated_at = datetime.now(timezone.utc)
        self._capsules[capsule_id] = capsule
        return capsule

    def unlock(self, capsule_id: str) -> Capsule:
        capsule = self._capsules[capsule_id]
        capsule.status = "UNLOCKED"
        capsule.updated_at = datetime.now(timezone.utc)
        self._capsules[capsule_id] = capsule
        return capsule


class CapsuleService:
    def __init__(self, repository: Optional[InMemoryCapsuleRepository] = None):
        self.repository = repository or InMemoryCapsuleRepository()

    def create_capsule(self, owner_id: str, payload: dict) -> Capsule:
        return self.repository.create(
            owner_id=owner_id,
            title=payload["title"],
            description=payload.get("description", ""),
            unlock_at=payload["unlock_at"],
        )

    def list_capsules(self, owner_id: str) -> list[Capsule]:
        return self.repository.list_for_user(owner_id)

    def get_capsule(self, owner_id: str, capsule_id: str) -> Capsule:
        capsule = self.repository.get(capsule_id)
        if capsule is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Capsule not found")
        if capsule.owner_id != owner_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this capsule")
        return capsule

    def update_capsule(self, owner_id: str, capsule_id: str, payload: dict) -> Capsule:
        capsule = self.get_capsule(owner_id, capsule_id)
        unlock_at = payload.get("unlock_at")
        if unlock_at is not None:
            if unlock_at.tzinfo is None:
                unlock_at = unlock_at.replace(tzinfo=timezone.utc)
            current_unlock = capsule.unlock_at
            if current_unlock.tzinfo is None:
                current_unlock = current_unlock.replace(tzinfo=timezone.utc)
            if capsule.status == "LOCKED" and unlock_at < current_unlock:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The unlock date cannot be moved earlier while a capsule is locked")
        return self.repository.update(
            capsule_id=capsule_id,
            title=payload.get("title"),
            description=payload.get("description"),
            unlock_at=unlock_at,
        )

    def delete_capsule(self, owner_id: str, capsule_id: str) -> None:
        capsule = self.get_capsule(owner_id, capsule_id)
        from app.services.memory_service import memory_service

        for memory in memory_service.list_memories(capsule.id):
            memory_service.delete_memory(memory.id)
        self.repository.delete(capsule.id)

    def lock_capsule(self, owner_id: str, capsule_id: str) -> Capsule:
        capsule = self.get_capsule(owner_id, capsule_id)
        return self.repository.lock(capsule.id)

    def process_due_capsules(self, owner_id: str | None = None) -> int:
        from app.services.unlock_scheduler import unlock_scheduler

        unlock_scheduler.capsule_service = self
        return unlock_scheduler.process_due_capsules(owner_id=owner_id)

    def unlock_capsule(self, owner_id: str, capsule_id: str) -> Capsule:
        capsule = self.get_capsule(owner_id, capsule_id)
        if datetime.now(timezone.utc) < capsule.unlock_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Capsule is not ready to unlock yet")
        unlocked = self.repository.unlock(capsule.id)
        notification_service.create_notification(
            owner_id,
            "capsule_unlocked",
            f"Your capsule '{capsule.title}' has unlocked.",
        )
        return unlocked


capsule_service = CapsuleService()
