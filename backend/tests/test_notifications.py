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


def test_create_notification():
    email = "notify-create@example.com"
    register_user(email)
    token = login_user(email)

    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_mark_notification_as_read():
    email = "notify-read@example.com"
    register_user(email)
    token = login_user(email)

    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})
    notification_id = response.json()[0]["id"]

    patch_response = client.patch(
        f"/api/v1/notifications/{notification_id}/read",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["read"] is True
