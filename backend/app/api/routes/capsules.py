from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import get_current_user
from app.schemas.capsule import CapsuleCreate, CapsuleResponse, CapsuleUpdate
from app.services.capsule_service import capsule_service
from app.services.memory_service import memory_service

router = APIRouter(prefix="/capsules", tags=["capsules"])


@router.post("", response_model=CapsuleResponse, status_code=status.HTTP_201_CREATED)
def create_capsule(payload: CapsuleCreate, current_user=Depends(get_current_user)):
    capsule = capsule_service.create_capsule(
        owner_id=current_user.id,
        payload={
            "title": payload.title,
            "description": payload.description,
            "unlock_at": payload.unlock_at,
        },
    )
    return CapsuleResponse(
        id=capsule.id,
        owner_id=capsule.owner_id,
        title=capsule.title,
        description=capsule.description,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
        unlock_at=capsule.unlock_at,
        status=capsule.status,
        memories=capsule.memories,
        memory_count=len(memory_service.list_memories(capsule.id)),
    )


@router.get("", response_model=list[CapsuleResponse])
def list_capsules(current_user=Depends(get_current_user)):
    capsule_service.process_due_capsules(owner_id=current_user.id)
    capsules = capsule_service.list_capsules(current_user.id)
    return [
        CapsuleResponse(
            id=capsule.id,
            owner_id=capsule.owner_id,
            title=capsule.title,
            description=capsule.description,
            created_at=capsule.created_at,
            updated_at=capsule.updated_at,
            unlock_at=capsule.unlock_at,
            status=capsule.status,
            memories=capsule.memories,
            memory_count=len(memory_service.list_memories(capsule.id)),
        )
        for capsule in capsules
    ]


@router.get("/{capsule_id}", response_model=CapsuleResponse)
def get_capsule(capsule_id: str, current_user=Depends(get_current_user)):
    capsule = capsule_service.get_capsule(current_user.id, capsule_id)
    return CapsuleResponse(
        id=capsule.id,
        owner_id=capsule.owner_id,
        title=capsule.title,
        description=capsule.description,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
        unlock_at=capsule.unlock_at,
        status=capsule.status,
        memories=capsule.memories,
        memory_count=len(memory_service.list_memories(capsule.id)),
    )


@router.put("/{capsule_id}", response_model=CapsuleResponse)
def update_capsule(capsule_id: str, payload: CapsuleUpdate, current_user=Depends(get_current_user)):
    capsule = capsule_service.update_capsule(
        current_user.id,
        capsule_id,
        {
            "title": payload.title,
            "description": payload.description,
            "unlock_at": payload.unlock_at,
        },
    )
    return CapsuleResponse(
        id=capsule.id,
        owner_id=capsule.owner_id,
        title=capsule.title,
        description=capsule.description,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
        unlock_at=capsule.unlock_at,
        status=capsule.status,
        memories=capsule.memories,
        memory_count=len(memory_service.list_memories(capsule.id)),
    )


@router.delete("/{capsule_id}")
def delete_capsule(capsule_id: str, current_user=Depends(get_current_user)):
    capsule_service.delete_capsule(current_user.id, capsule_id)
    return {"detail": "Capsule deleted"}


@router.post("/{capsule_id}/lock", response_model=CapsuleResponse)
def lock_capsule(capsule_id: str, current_user=Depends(get_current_user)):
    capsule = capsule_service.lock_capsule(current_user.id, capsule_id)
    return CapsuleResponse(
        id=capsule.id,
        owner_id=capsule.owner_id,
        title=capsule.title,
        description=capsule.description,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
        unlock_at=capsule.unlock_at,
        status=capsule.status,
        memories=capsule.memories,
        memory_count=len(memory_service.list_memories(capsule.id)),
    )


@router.post("/{capsule_id}/unlock", response_model=CapsuleResponse)
def unlock_capsule(capsule_id: str, current_user=Depends(get_current_user)):
    capsule = capsule_service.unlock_capsule(current_user.id, capsule_id)
    return CapsuleResponse(
        id=capsule.id,
        owner_id=capsule.owner_id,
        title=capsule.title,
        description=capsule.description,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
        unlock_at=capsule.unlock_at,
        status=capsule.status,
        memories=capsule.memories,
        memory_count=len(memory_service.list_memories(capsule.id)),
    )
