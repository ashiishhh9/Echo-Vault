from fastapi.testclient import TestClient
import importlib
import pytest

from app import MODEL_DIMENSIONS, MODEL_NAME, app

client = TestClient(app)


@pytest.fixture(autouse=True)
def deterministic_embedding_stub(monkeypatch):
    """Keep routine CI tests offline; evaluate.py exercises the real model separately."""
    service = importlib.import_module("app")

    def fake_embed(texts, *, query=False):
        vectors = []
        for text in texts:
            value = text.lower()
            if any(word in value for word in ("bicycle", "bike")):
                slot = 1
            elif any(word in value for word in ("ocean", "sea", "sunset", "water")):
                slot = 2
            elif any(word in value for word in ("school", "exam", "test", "calculus")):
                slot = 3
            elif any(word in value for word in ("bread", "loaf", "grandma", "grandmother", "recipe")):
                slot = 4
            else:
                slot = 5
            vector = [0.0] * MODEL_DIMENSIONS
            vector[slot] = 1.0
            vectors.append(vector)
        return vectors

    monkeypatch.setattr(service, "_embed", fake_embed)


def test_sentiment_and_mood_score_are_bounded_and_consistent():
    positive = client.post("/sentiment", json={"text": "I love this beautiful day and feel grateful."})
    negative = client.post("/sentiment", json={"text": "This was a terrible and painful day."})
    neutral = client.post("/sentiment", json={"text": "The train leaves at six o'clock."})
    assert positive.status_code == negative.status_code == neutral.status_code == 200
    assert positive.json()["label"] == "positive"
    assert negative.json()["label"] == "negative"
    assert neutral.json()["label"] == "neutral"
    for response in (positive, negative, neutral):
        result = response.json()
        assert 0 <= result["mood_score_0_100"] <= 100
        assert result["mood_score_0_100"] == round((result["compound_score"] + 1) * 50, 1)
    assert "not confidence" in positive.json()["score_definition"]


def test_invalid_and_oversized_sentiment_input_is_rejected():
    assert client.post("/sentiment", json={"text": "  "}).status_code == 422
    assert client.post("/sentiment", json={"text": "x" * 20_001}).status_code == 422


def test_image_description_uses_local_vision_model_and_rejects_invalid_images(monkeypatch):
    service = importlib.import_module("app")

    class Processor:
        def __call__(self, **kwargs):
            return {}

        def decode(self, output, skip_special_tokens=True):
            return "a red mug on a wooden table"

    class Model:
        def generate(self, **kwargs):
            return [[1]]

    monkeypatch.setattr(service, "_vision_model", lambda: (Processor(), Model()))
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0m8AAAAASUVORK5CYII="
    response = client.post("/image-description", json={"mime_type": "image/png", "data_base64": png})
    assert response.status_code == 200
    assert response.json()["description"] == "a red mug on a wooden table"
    assert response.json()["mode"] == "local_image_captioning"
    assert client.post("/image-description", json={"mime_type": "image/png", "data_base64": "not-an-image"}).status_code == 422


def test_extractive_summary_uses_only_source_sentences():
    source = "We walked beside the ocean at sunset. The waves were calm. I felt grateful for the quiet evening. Tomorrow we returned home."
    result = client.post("/summarize?max_sentences=2", json={"text": source})
    assert result.status_code == 200
    summary = result.json()["summary"]
    assert result.json()["method"] == "extractive_frequency"
    assert summary
    assert all(sentence in source for sentence in summary.split(". "))


def test_summary_handles_short_repetitive_and_punctuation_heavy_text_without_adding_words():
    short = "A quiet walk."
    repetitive = "We walked by the river. We walked by the river. The water moved slowly! Was it peaceful? Yes."
    punctuation = "Wait!!! Really??? I wrote: 'That was wonderful...' Then I went home."
    for source in (short, repetitive, punctuation, "A sentence. " * 800):
        response = client.post("/summarize", json={"text": source})
        assert response.status_code == 200
        summary = response.json()["summary"]
        assert summary
        assert all(sentence in source for sentence in summary.split(". "))


def test_sentiment_handles_punctuation_heavy_and_long_valid_text():
    for source in ("Great!!!?", "Not good... really not good.", "An ordinary note. " * 500):
        response = client.post("/sentiment", json={"text": source})
        assert response.status_code == 200
        assert response.json()["label"] in {"positive", "neutral", "negative"}
def test_empty_summary_is_rejected():
    assert client.post("/summarize", json={"text": "   "}).status_code == 422


def test_summary_accepts_bounded_long_input_and_rejects_oversized_input():
    long_text = "A meaningful sentence. " * 3000
    accepted = client.post("/summarize", json={"text": long_text})
    rejected = client.post("/summarize", json={"text": "x" * 100_001})
    assert accepted.status_code == 200
    assert len(accepted.json()["summary"]) <= len(long_text)
    assert rejected.status_code == 422


def test_embedding_dimension_and_semantic_retrieval():
    vector = client.post("/embeddings", json={"text": "A walk by the ocean at sunset."})
    assert vector.status_code == 200
    assert vector.json()["dimensions"] == MODEL_DIMENSIONS == 384
    assert len(vector.json()["embedding"]) == MODEL_DIMENSIONS

    memories = [
        {"id": "ocean", "text": "We strolled beside the sea while the sun went down.", "created_at": "2026-07-01"},
        {"id": "exam", "text": "I finished my calculus exam and called my sister.", "created_at": "2026-05-03"},
        {"id": "recipe", "text": "Grandmother taught me to bake cinnamon bread.", "created_at": "2026-02-10"},
    ]
    result = client.post("/search", json={"query": "walking near the ocean at sunset", "memories": memories, "limit": 2})
    assert result.status_code == 200
    matches = result.json()["results"]
    assert matches and matches[0]["id"] == "ocean"
    assert 0 <= matches[0]["similarity"] <= 1


def test_chat_is_retrieval_only_and_refuses_unsupported_answers():
    supported = client.post("/chat", json={"query": "How did the evening by the water feel?", "memories": [
        {"id": "memory-1", "text": "The quiet sunset by the ocean made me feel peaceful and grateful.", "created_at": "2026-07-01"},
    ]})
    assert supported.status_code == 200
    assert supported.json()["mode"] == "retrieval_only"
    assert supported.json()["grounded"] is True
    assert supported.json()["references"][0]["id"] == "memory-1"
    assert "peaceful and grateful" in supported.json()["answer"]

    unsupported = client.post("/chat", json={"query": "What color was my bicycle?", "memories": [
        {"id": "memory-1", "text": "The quiet sunset by the ocean made me feel peaceful and grateful.", "created_at": "2026-07-01"},
    ]})
    assert unsupported.status_code == 200
    assert unsupported.json()["references"] == []
    assert "couldn't find enough" in unsupported.json()["answer"]


def test_no_context_and_malformed_requests_are_handled():
    empty = client.post("/search", json={"query": "meaningful moment", "memories": []})
    assert empty.status_code == 200
    assert empty.json()["results"] == []
    assert client.post("/chat", json={"query": "Anything?", "memories": []}).json()["references"] == []
    assert client.post("/search", json={"query": ""}).status_code == 422


def test_search_reuses_compatible_persistent_vectors(monkeypatch):
    service = importlib.import_module("app")
    calls = []

    def fake_embed(texts, *, query=False):
        calls.append((texts, query))
        return [[1.0] + [0.0] * (MODEL_DIMENSIONS - 1) for _ in texts]

    monkeypatch.setattr(service, "_embed", fake_embed)
    vector = [1.0] + [0.0] * (MODEL_DIMENSIONS - 1)
    result = client.post("/search", json={
        "query": "a saved memory",
        "query_embedding": vector,
        "query_embedding_model": service.MODEL_NAME,
        "memories": [{"id": "saved", "text": "saved memory text", "embedding": vector, "embedding_model": service.MODEL_NAME}],
    })
    assert result.status_code == 200
    assert result.json()["results"][0]["id"] == "saved"
    assert calls == []


def test_invalid_and_incompatible_vectors_are_rejected_or_regenerated(monkeypatch):
    service = importlib.import_module("app")
    vector = [1.0] + [0.0] * (MODEL_DIMENSIONS - 1)
    short_vector = client.post("/search", json={"query": "a query", "memories": [{"id": "bad", "text": "memory", "embedding": vector[:-1], "embedding_model": service.MODEL_NAME}]})
    assert short_vector.status_code == 422
    nonfinite = client.post("/search", json={"query": "a query", "memories": [{"id": "bad", "text": "memory", "embedding": [float('nan')] + [0.0] * (MODEL_DIMENSIONS - 1), "embedding_model": service.MODEL_NAME}]})
    assert nonfinite.status_code == 422

    calls = []

    def fake_embed(texts, *, query=False):
        calls.append((texts, query))
        return [vector for _ in texts]

    monkeypatch.setattr(service, "_embed", fake_embed)
    stale = client.post("/search", json={
        "query": "a query", "query_embedding": vector, "query_embedding_model": "old-model",
        "memories": [{"id": "old", "text": "memory", "embedding": vector, "embedding_model": "old-model"}],
    })
    assert stale.status_code == 200
    assert calls == [(["a query"], True), (["memory"], False)]


def test_tied_retrieval_scores_have_stable_id_order():
    vector = [1.0] + [0.0] * (MODEL_DIMENSIONS - 1)
    memories = [
        {"id": "zeta", "text": "second", "embedding": vector, "embedding_model": MODEL_NAME},
        {"id": "alpha", "text": "first", "embedding": vector, "embedding_model": MODEL_NAME},
    ]
    first = client.post("/search", json={"query": "query", "query_embedding": vector, "query_embedding_model": MODEL_NAME, "memories": memories, "minimum_score": -1})
    second = client.post("/search", json={"query": "query", "query_embedding": vector, "query_embedding_model": MODEL_NAME, "memories": list(reversed(memories)), "minimum_score": -1})
    assert first.status_code == second.status_code == 200
    assert [row["id"] for row in first.json()["results"]] == ["alpha", "zeta"]
    assert [row["id"] for row in second.json()["results"]] == ["alpha", "zeta"]


def test_batch_embedding_endpoint_validates_and_returns_model_metadata(monkeypatch):
    service = importlib.import_module("app")
    calls = []

    def fake_embed(texts, *, query=False):
        calls.append(texts)
        return [[0.5] + [0.0] * (MODEL_DIMENSIONS - 1) for _ in texts]

    monkeypatch.setattr(service, "_embed", fake_embed)
    result = client.post("/embeddings/batch", json={"texts": ["one", "two"]})
    assert result.status_code == 200
    assert result.json()["model"] == service.MODEL_NAME
    assert result.json()["dimensions"] == MODEL_DIMENSIONS
    assert len(result.json()["embeddings"]) == 2
    assert calls == [["one", "two"]]


def test_internal_key_is_required_when_configured(monkeypatch):
    import os

    monkeypatch.setenv("AI_SERVICE_API_KEY", "test-internal-key-with-enough-entropy-123")
    assert client.get("/health").status_code == 401
    authorized = client.get("/health", headers={"X-AI-Service-Key": os.environ["AI_SERVICE_API_KEY"]})
    assert authorized.status_code == 200
    assert client.post("/sentiment", json={"text": "A private test phrase."}).status_code == 401


def test_production_requires_a_strong_internal_key():
    import pytest
    from app import validate_internal_api_key

    with pytest.raises(RuntimeError, match="AI_SERVICE_API_KEY"):
        validate_internal_api_key("production", "too-short")
    validate_internal_api_key("production", "production-test-key-with-enough-entropy")


def test_oversized_request_body_is_rejected_before_parsing():
    response = client.post(
        "/sentiment",
        content=b" " * (16 * 1024 * 1024 + 1),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
