import uuid
from typing import Dict, Optional

from fastapi import HTTPException, status

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.services.persistence import PersistentDict


class InMemoryUserRepository:
    def __init__(self):
        self._users: Dict[str, User] = PersistentDict("users")
        self._users_by_email: Dict[str, str] = PersistentDict("users_by_email")

    @staticmethod
    def _initials_for_name(name: str) -> str:
        parts = [part.strip() for part in name.split() if part.strip()]
        if not parts:
            return "U"
        if len(parts) == 1:
            return parts[0][:2].upper()
        return "".join(part[0].upper() for part in parts[:2])[:2]

    def create_user(self, name: str, email: str, password: str) -> User:
        if email.lower() in self._users_by_email:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

        user = User(
            id=str(uuid.uuid4()),
            name=name,
            email=email.lower(),
            password_hash=hash_password(password),
            initials=self._initials_for_name(name),
        )
        self._users[user.id] = user
        self._users_by_email[user.email] = user.id
        return user

    def get_user_by_email(self, email: str) -> Optional[User]:
        user_id = self._users_by_email.get(email.lower())
        return self.get_user_by_id(user_id) if user_id else None

    def get_user_by_id(self, user_id: str) -> Optional[User]:
        return self._users.get(user_id)

    def save_user(self, user: User) -> None:
        self._users[user.id] = user

    def change_email(self, user: User, email: str) -> None:
        normalized = email.lower()
        current = self._users_by_email.get(normalized)
        if current is not None and current != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        if normalized != user.email:
            self._users_by_email.pop(user.email, None)
            self._users_by_email[normalized] = user.id
            user.email = normalized


class AuthService:
    def __init__(self, user_repository: Optional[InMemoryUserRepository] = None):
        self.user_repository = user_repository or InMemoryUserRepository()

    def register(self, name: str, email: str, password: str) -> User:
        return self.user_repository.create_user(name=name, email=email, password=password)

    def authenticate(self, email: str, password: str) -> User:
        user = self.user_repository.get_user_by_email(email)
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        return user

    def create_token_for_user(self, user: User) -> str:
        return create_access_token(subject=user.id, extra_claims={"email": user.email, "name": user.name})

    def get_profile(self, user: User) -> dict:
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "location": user.location,
            "bio": user.bio,
            "initials": user.initials or self.user_repository._initials_for_name(user.name),
        }

    def update_profile(self, user: User, payload: dict) -> dict:
        if payload.get("name") is not None:
            user.name = payload["name"].strip()
        if payload.get("email") is not None:
            self.user_repository.change_email(user, payload["email"])
        if payload.get("location") is not None:
            user.location = payload["location"]
        if payload.get("bio") is not None:
            user.bio = payload["bio"]
        if payload.get("initials") is not None:
            user.initials = payload["initials"]
        if not user.initials:
            user.initials = self.user_repository._initials_for_name(user.name)
        self.user_repository.save_user(user)
        return self.get_profile(user)

    def get_settings(self, user: User) -> dict:
        return {
            "notifications": user.notifications,
            "compact_mode": user.compact_mode,
            "export_format": user.export_format,
        }

    def update_settings(self, user: User, payload: dict) -> dict:
        if payload.get("notifications") is not None:
            user.notifications = payload["notifications"]
        if payload.get("compact_mode") is not None:
            user.compact_mode = payload["compact_mode"]
        if payload.get("export_format") is not None:
            user.export_format = payload["export_format"]
        self.user_repository.save_user(user)
        return self.get_settings(user)


auth_service = AuthService()
