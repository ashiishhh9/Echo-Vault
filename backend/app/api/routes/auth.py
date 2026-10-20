from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.dependencies import get_current_user
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import auth_service
from app.core.security import revoke_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest):
    user = auth_service.register(name=payload.name, email=payload.email, password=payload.password)
    return UserResponse(id=user.id, name=user.name, email=user.email)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    user = auth_service.authenticate(email=payload.email, password=payload.password)
    token = auth_service.create_token_for_user(user)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def me(current_user=Depends(get_current_user)):
    return UserResponse(id=current_user.id, name=current_user.name, email=current_user.email)


@router.post("/logout")
def logout(request: Request, current_user=Depends(get_current_user)):
    token = request.state.access_token
    payload = request.state.token_payload
    revoke_access_token(token, payload)
    return {"detail": "Logged out"}
