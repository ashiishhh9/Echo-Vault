from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import get_current_user
from app.schemas.memory import MemoryCreate, MemoryResponse, MemoryUpdate
from app.services.capsule_service import capsule_service
from app.services.media_validation import validate_media_reference
from app.services.memory_service import memory_service

router = APIRouter(tags=["memories"])


@router.post("/capsules/{capsule_id}/memories", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def create_memory(capsule_id: str, payload: MemoryCreate, current_user=Depends(get_current_user)):
    capsule = capsule_service.get_capsule(current_user.id, capsule_id)
    validate_media_reference(payload.type, payload.media_url, payload.file_size)
    memory = memory_service.create_memory(capsule.id, payload.model_dump(exclude={"file_size"}))
    return MemoryResponse(
        id=memory.id,
        capsule_id=memory.capsule_id,
        type=memory.type,
        content_text=memory.content_text,
        media_url=memory.media_url,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
    )


@router.get("/capsules/{capsule_id}/memories", response_model=list[MemoryResponse])
def list_memories(capsule_id: str, current_user=Depends(get_current_user)):
    capsule = capsule_service.get_capsule(current_user.id, capsule_id)
    if capsule.status == "LOCKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Capsule is locked and cannot expose memories")
    memories = memory_service.list_memories(capsule.id)
    return [
        MemoryResponse(
            id=memory.id,
            capsule_id=memory.capsule_id,
            type=memory.type,
            content_text=memory.content_text,
            media_url=memory.media_url,
            created_at=memory.created_at,
            updated_at=memory.updated_at,
        )
        for memory in memories
    ]


@router.get("/memories/{memory_id}", response_model=MemoryResponse)
def get_memory(memory_id: str, current_user=Depends(get_current_user)):
    memory = memory_service.get_memory(memory_id)
    capsule = capsule_service.repository.get(memory.capsule_id)
    if capsule is None or capsule.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this memory")
    if capsule.status == "LOCKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Capsule is locked and cannot expose memories")
    return MemoryResponse(
        id=memory.id,
        capsule_id=memory.capsule_id,
        type=memory.type,
        content_text=memory.content_text,
        media_url=memory.media_url,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
    )


@router.put("/memories/{memory_id}", response_model=MemoryResponse)
def update_memory(memory_id: str, payload: MemoryUpdate, current_user=Depends(get_current_user)):
    memory = memory_service.get_memory(memory_id)
    capsule = capsule_service.repository.get(memory.capsule_id)
    if capsule is None or capsule.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this memory")
    if capsule.status == "LOCKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Capsule is locked and cannot expose memories")
    updated = memory_service.update_memory(memory.id, payload.model_dump(exclude_none=True))
    return MemoryResponse(
        id=updated.id,
        capsule_id=updated.capsule_id,
        type=updated.type,
        content_text=updated.content_text,
        media_url=updated.media_url,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


@router.delete("/memories/{memory_id}")
def delete_memory(memory_id: str, current_user=Depends(get_current_user)):
    memory = memory_service.get_memory(memory_id)
    capsule = capsule_service.repository.get(memory.capsule_id)
    if capsule is None or capsule.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this memory")
    if capsule.status == "LOCKED":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Capsule is locked and cannot expose memories")
    memory_service.delete_memory(memory.id)
    return {"detail": "Memory deleted"}
