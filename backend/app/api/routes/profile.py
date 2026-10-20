from fastapi import APIRouter, Depends

from app.core.dependencies import get_current_user
from app.schemas.profile import ProfileResponse, ProfileUpdate, SettingsResponse, SettingsUpdate
from app.services.auth_service import auth_service

router = APIRouter(tags=["profile"])


@router.get("/profile", response_model=ProfileResponse)
def get_profile(current_user=Depends(get_current_user)):
    return ProfileResponse(**auth_service.get_profile(current_user))


@router.put("/profile", response_model=ProfileResponse)
def update_profile(payload: ProfileUpdate, current_user=Depends(get_current_user)):
    return ProfileResponse(**auth_service.update_profile(current_user, payload.model_dump(exclude_none=True)))


@router.get("/settings", response_model=SettingsResponse)
def get_settings(current_user=Depends(get_current_user)):
    return SettingsResponse(**auth_service.get_settings(current_user))


@router.patch("/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdate, current_user=Depends(get_current_user)):
    return SettingsResponse(**auth_service.update_settings(current_user, payload.model_dump(exclude_none=True)))
