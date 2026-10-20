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


def test_profile_defaults_and_update():
    email = "profile@example.com"
    register_user(email, "Profile User")
    token = login_user(email)

    response = client.get("/api/v1/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Profile User"
    assert body["email"] == email
    assert body["location"] == ""
    assert body["bio"] == ""
    assert body["initials"] == "PU"

    update = client.put(
        "/api/v1/profile",
        json={"location": "Ahmedabad, India", "bio": "Keeping the long view.", "initials": "PA"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["location"] == "Ahmedabad, India"
    assert payload["bio"] == "Keeping the long view."
    assert payload["initials"] == "PA"


def test_settings_default_and_update():
    email = "settings@example.com"
    register_user(email, "Settings User")
    token = login_user(email)

    response = client.get("/api/v1/settings", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["notifications"] is True
    assert body["compact_mode"] is False
    assert body["export_format"] == "json"

    update = client.patch(
        "/api/v1/settings",
        json={"notifications": False, "compact_mode": True, "export_format": "text"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["notifications"] is False
    assert payload["compact_mode"] is True
    assert payload["export_format"] == "text"
