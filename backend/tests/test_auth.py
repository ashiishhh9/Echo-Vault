from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app

client = TestClient(app)


def test_register_success():
    payload = {"name": "Alice Example", "email": "alice@example.com", "password": "secret123"}
    response = client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == payload["email"]
    assert body["name"] == payload["name"]
    assert "password" not in body


def test_register_duplicate_email():
    payload = {"name": "Alice Example", "email": "duplicate@example.com", "password": "secret123"}
    first = client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201

    second = client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409
    assert second.json()["detail"] == "User already exists"


def test_login_success():
    payload = {"name": "Bob Example", "email": "bob@example.com", "password": "secret123"}
    register = client.post("/api/v1/auth/register", json=payload)
    assert register.status_code == 201

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "bob@example.com", "password": "secret123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_login_invalid_credentials():
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "wrongpass"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_protected_endpoint_without_token():
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_protected_endpoint_with_valid_token():
    payload = {"name": "Cara Example", "email": "cara@example.com", "password": "secret123"}
    register = client.post("/api/v1/auth/register", json=payload)
    assert register.status_code == 201

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cara@example.com", "password": "secret123"},
    )
    token = login.json()["access_token"]

    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "cara@example.com"
    assert body["name"] == "Cara Example"
    assert "password" not in body


def test_logout_revokes_the_presented_token():
    payload = {"name": "Logout User", "email": "logout@example.com", "password": "secret123"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    login = client.post("/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_authentication_endpoints_are_rate_limited():
    main_module._auth_rate_limits.clear()
    try:
        for _ in range(60):
            response = client.post("/api/v1/auth/login", json={"email": "missing@example.com", "password": "wrongpass"})
            assert response.status_code == 401
        limited = client.post("/api/v1/auth/login", json={"email": "missing@example.com", "password": "wrongpass"})
        assert limited.status_code == 429
    finally:
        main_module._auth_rate_limits.clear()
