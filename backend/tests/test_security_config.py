import pytest

from app.core.config import get_settings


def test_production_configuration_disables_debug_and_development_cors(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "production-test-secret-with-sufficient-entropy")
    monkeypatch.delenv("BACKEND_CORS_ORIGINS", raising=False)
    settings = get_settings()
    assert settings.debug is False
    assert settings.backend_cors_origins == []


def test_production_configuration_rejects_debug_mode(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "true")
    with pytest.raises(RuntimeError, match="DEBUG must be false"):
        get_settings()


def test_production_configuration_requires_a_strong_secret(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        get_settings()
