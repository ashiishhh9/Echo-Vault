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


def test_create_capsule():
    email = "capsule-owner@example.com"
    register_user(email)
    token = login_user(email)

    response = client.post(
        "/api/v1/capsules",
        json={
            "title": "My First Capsule",
            "description": "A record of my first trip",
            "unlock_at": "2030-12-31T00:00:00Z",
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "My First Capsule"
    assert body["status"] == "LOCKED"


def test_list_capsules():
    email = "capsule-list@example.com"
    register_user(email)
    token = login_user(email)

    client.post(
        "/api/v1/capsules",
        json={
            "title": "Capsule One",
            "description": "First",
            "unlock_at": "2035-06-01T00:00:00Z",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    response = client.get("/api/v1/capsules", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 1
    assert body[0]["title"] == "Capsule One"


def test_get_capsule_by_id():
    email = "capsule-get@example.com"
    register_user(email)
    token = login_user(email)

    created = client.post(
        "/api/v1/capsules",
        json={
            "title": "Detailed Capsule",
            "description": "More details",
            "unlock_at": "2031-01-01T00:00:00Z",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created.json()["id"]

    response = client.get(
        f"/api/v1/capsules/{capsule_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == capsule_id


def test_update_capsule():
    email = "capsule-update@example.com"
    register_user(email)
    token = login_user(email)

    created = client.post(
        "/api/v1/capsules",
        json={"title": "Old Title", "description": "Old Desc", "unlock_at": "2033-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created.json()["id"]

    response = client.put(
        f"/api/v1/capsules/{capsule_id}",
        json={"title": "New Title", "description": "New Desc"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "New Title"
    assert body["description"] == "New Desc"


def test_locked_capsule_cannot_be_rescheduled_earlier():
    email = "capsule-reschedule@example.com"
    register_user(email)
    token = login_user(email)
    created = client.post(
        "/api/v1/capsules",
        json={"title": "Future capsule", "description": "Private", "unlock_at": "2038-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    response = client.put(
        f"/api/v1/capsules/{created.json()['id']}",
        json={"unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert client.get(f"/api/v1/capsules/{created.json()['id']}", headers={"Authorization": f"Bearer {token}"}).json()["status"] == "LOCKED"


def test_delete_capsule():
    email = "capsule-delete@example.com"
    register_user(email)
    token = login_user(email)

    created = client.post(
        "/api/v1/capsules",
        json={"title": "Delete Me", "description": "Will be removed", "unlock_at": "2032-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created.json()["id"]

    response = client.delete(
        f"/api/v1/capsules/{capsule_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["detail"] == "Capsule deleted"


def test_lock_capsule():
    email = "capsule-lock@example.com"
    register_user(email)
    token = login_user(email)

    created = client.post(
        "/api/v1/capsules",
        json={"title": "Lock Me", "description": "Need lock", "unlock_at": "2036-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/lock",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "LOCKED"


def test_unlock_capsule():
    email = "capsule-unlock@example.com"
    register_user(email)
    token = login_user(email)

    created = client.post(
        "/api/v1/capsules",
        json={"title": "Unlock Me", "description": "Need unlock", "unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/unlock",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "UNLOCKED"


def test_unauthorized_capsule_access():
    owner_email = "owner@example.com"
    thief_email = "thief@example.com"
    register_user(owner_email, "Owner")
    register_user(thief_email, "Thief")
    owner_token = login_user(owner_email)
    thief_token = login_user(thief_email)

    created = client.post(
        "/api/v1/capsules",
        json={"title": "Private Capsule", "description": "Not yours", "unlock_at": "2030-06-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    capsule_id = created.json()["id"]

    response = client.get(
        f"/api/v1/capsules/{capsule_id}",
        headers={"Authorization": f"Bearer {thief_token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to access this capsule"
