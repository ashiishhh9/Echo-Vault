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


def test_create_memory():
    email = "memory-create@example.com"
    register_user(email)
    token = login_user(email)

    created_capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Memory Capsule", "description": "A place for memories", "unlock_at": "2035-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created_capsule.json()["id"]

    response = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "This is my first memory", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["content_text"] == "This is my first memory"
    assert body["capsule_id"] == capsule_id


def test_list_memories():
    email = "memory-list@example.com"
    register_user(email)
    token = login_user(email)

    created_capsule = client.post(
        "/api/v1/capsules",
        json={"title": "List Capsule", "description": "List memories", "unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created_capsule.json()["id"]
    client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "First memory", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    response = client.get(
        f"/api/v1/capsules/{capsule_id}/memories",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_update_memory():
    email = "memory-update@example.com"
    register_user(email)
    token = login_user(email)

    created_capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Update Capsule", "description": "Update memory", "unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created_capsule.json()["id"]
    created_memory = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "Old text", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    memory_id = created_memory.json()["id"]

    response = client.put(
        f"/api/v1/memories/{memory_id}",
        json={"content_text": "Updated text"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["content_text"] == "Updated text"


def test_delete_memory():
    email = "memory-delete@example.com"
    register_user(email)
    token = login_user(email)

    created_capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Delete Capsule", "description": "Delete memory", "unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = created_capsule.json()["id"]
    created_memory = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "Delete me", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    memory_id = created_memory.json()["id"]

    response = client.delete(
        f"/api/v1/memories/{memory_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["detail"] == "Memory deleted"


def test_access_memory_from_another_users_capsule():
    owner_email = "memory-owner@example.com"
    thief_email = "memory-thief@example.com"
    register_user(owner_email, "Owner")
    register_user(thief_email, "Thief")
    owner_token = login_user(owner_email)
    thief_token = login_user(thief_email)

    created_capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Protected Capsule", "description": "Hands off", "unlock_at": "2035-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    capsule_id = created_capsule.json()["id"]
    created_memory = client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "Secret note", "media_url": ""},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    memory_id = created_memory.json()["id"]

    response = client.get(
        f"/api/v1/memories/{memory_id}",
        headers={"Authorization": f"Bearer {thief_token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized to access this memory"


def test_locked_capsule_cannot_expose_memories():
    email = "memory-locked@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Locked Capsule", "description": "Future only", "unlock_at": "2038-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]
    client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "This should stay hidden", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    response = client.get(
        f"/api/v1/capsules/{capsule_id}/memories",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Capsule is locked and cannot expose memories"


def test_locked_memory_cannot_be_updated_or_deleted():
    email = "memory-locked-mutate@example.com"
    register_user(email)
    token = login_user(email)
    headers = {"Authorization": f"Bearer {token}"}
    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Locked capsule", "description": "Keep private", "unlock_at": "2038-01-01T00:00:00Z"},
        headers=headers,
    ).json()
    memory = client.post(
        f"/api/v1/capsules/{capsule['id']}/memories",
        json={"type": "text", "content_text": "Original locked text"},
        headers=headers,
    ).json()

    updated = client.put(f"/api/v1/memories/{memory['id']}", json={"content_text": "Changed locked text"}, headers=headers)
    deleted = client.delete(f"/api/v1/memories/{memory['id']}", headers=headers)
    assert updated.status_code == 403
    assert deleted.status_code == 403
    fetched = client.get(f"/api/v1/memories/{memory['id']}", headers=headers)
    assert fetched.status_code == 403


def test_unlocked_capsule_exposes_memories():
    email = "memory-unlocked@example.com"
    register_user(email)
    token = login_user(email)

    capsule = client.post(
        "/api/v1/capsules",
        json={"title": "Unlocked Capsule", "description": "Open now", "unlock_at": "2020-01-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    capsule_id = capsule.json()["id"]
    client.post(
        f"/api/v1/capsules/{capsule_id}/memories",
        json={"type": "text", "content_text": "Open memory", "media_url": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    response = client.get(
        f"/api/v1/capsules/{capsule_id}/memories",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert any(item["content_text"] == "Open memory" for item in response.json())
