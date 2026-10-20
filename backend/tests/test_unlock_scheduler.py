from datetime import datetime, timedelta, timezone

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


def test_scheduler_unlocks_due_capsules_and_creates_notification():
    email = "scheduler@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={
            "title": "Due Capsule",
            "description": "Should unlock automatically",
            "unlock_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/unlock",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "UNLOCKED"

    notifications = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})
    assert notifications.status_code == 200
    assert any("unlock" in item["message"].lower() for item in notifications.json())
