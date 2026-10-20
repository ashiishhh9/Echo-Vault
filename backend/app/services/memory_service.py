import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import HTTPException, status

from app.models.memory import Memory
from app.services.persistence import PersistentDict


class InMemoryMemoryRepository:
    def __init__(self):
        self._memories: Dict[str, Memory] = PersistentDict("memories")
        self._capsule_memories: Dict[str, list[str]] = PersistentDict("capsule_memories")

    def create(self, capsule_id: str, memory_type: str, content_text: Optional[str], media_url: Optional[str]) -> Memory:
        memory = Memory(
            id=str(uuid.uuid4()),
            capsule_id=capsule_id,
            type=memory_type,
            content_text=content_text or "",
            media_url=media_url or "",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self._memories[memory.id] = memory
        capsule_memories = self._capsule_memories.get(capsule_id, [])
        capsule_memories.append(memory.id)
        self._capsule_memories[capsule_id] = capsule_memories
        return memory

    def list_for_capsule(self, capsule_id: str) -> list[Memory]:
        return [self._memories[memory_id] for memory_id in self._capsule_memories.get(capsule_id, [])]

    def get(self, memory_id: str) -> Optional[Memory]:
        return self._memories.get(memory_id)

    def update(self, memory_id: str, memory_type: Optional[str], content_text: Optional[str], media_url: Optional[str]) -> Memory:
        memory = self._memories[memory_id]
        if memory_type is not None:
            memory.type = memory_type
        if content_text is not None:
            memory.content_text = content_text
        if media_url is not None:
            memory.media_url = media_url
        memory.updated_at = datetime.now(timezone.utc)
        self._memories[memory_id] = memory
        return memory

    def delete(self, memory_id: str) -> None:
        memory = self._memories.pop(memory_id)
        capsule_memories = self._capsule_memories.get(memory.capsule_id, [])
        if memory_id in capsule_memories:
            capsule_memories.remove(memory_id)
        self._capsule_memories[memory.capsule_id] = capsule_memories


class MemoryService:
    def __init__(self, repository: Optional[InMemoryMemoryRepository] = None):
        self.repository = repository or InMemoryMemoryRepository()

    def create_memory(self, capsule_id: str, payload: dict) -> Memory:
        return self.repository.create(
            capsule_id=capsule_id,
            memory_type=payload["type"],
            content_text=payload.get("content_text"),
            media_url=payload.get("media_url"),
        )

    def list_memories(self, capsule_id: str) -> list[Memory]:
        return self.repository.list_for_capsule(capsule_id)

    def get_memory(self, memory_id: str) -> Memory:
        memory = self.repository.get(memory_id)
        if memory is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
        return memory

    def update_memory(self, memory_id: str, payload: dict) -> Memory:
        memory = self.get_memory(memory_id)
        return self.repository.update(
            memory_id=memory.id,
            memory_type=payload.get("type"),
            content_text=payload.get("content_text"),
            media_url=payload.get("media_url"),
        )

    def delete_memory(self, memory_id: str) -> None:
        memory = self.get_memory(memory_id)
        self.repository.delete(memory.id)


memory_service = MemoryService()
