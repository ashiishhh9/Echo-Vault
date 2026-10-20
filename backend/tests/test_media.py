from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def register_user(email: str, name: str = "Test User"):
    payload = {"name": name, "email": email, "password": "secret123"}
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    return response.json()


def login_user(email: str):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_media_type_validation_rejects_invalid_extension():
    email = "media-invalid@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Media Capsule", "description": "Test media", "unlock_at": "2036-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "image", "content_text": "", "media_url": "https://example.com/file.exe"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    assert "media_url" in str(response.json())


def test_media_type_validation_accepts_supported_types():
    email = "media-valid@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Supported Media Capsule", "description": "Good media", "unlock_at": "2036-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "image", "content_text": "", "media_url": "https://example.com/file.jpg"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    assert response.json()["media_url"] == "https://example.com/file.jpg"


def test_media_size_validation_rejects_large_file():
    email = "media-large@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Large Media Capsule", "description": "Large file", "unlock_at": "2036-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "video", "content_text": "", "media_url": "https://example.com/large.mp4"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    assert "size" in str(response.json()).lower()
