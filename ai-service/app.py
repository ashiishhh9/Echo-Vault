"""Local AI helpers for Digital Time Capsule.

Sentiment uses VADER. Search embeddings use the 384-dimensional BGE small model
through FastEmbed/ONNX. Chat is deliberately retrieval-only; it never invents a
memory or presents a generated response as the user's own words.
"""
import math
import os
import re
import secrets
import base64
import io
from functools import lru_cache
from threading import Lock
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, field_validator
from starlette.responses import JSONResponse
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from PIL import Image, UnidentifiedImageError

APP_NAME = "Digital Time Capsule AI Service"
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
MODEL_DIMENSIONS = 384
VISION_MODEL_NAME = os.getenv("VISION_MODEL", "Salesforce/blip-image-captioning-base")
MAX_TEXT_LENGTH = 20_000
MAX_SUMMARY_LENGTH = 100_000
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had",
    "has", "have", "he", "her", "his", "i", "in", "into", "is", "it", "its", "me", "my",
    "of", "on", "or", "our", "she", "that", "the", "their", "them", "there", "they", "this",
    "to", "was", "we", "were", "with", "you", "your",
}

_production = os.getenv("ENVIRONMENT", "development").lower() == "production"
_internal_api_key = os.getenv("AI_SERVICE_API_KEY", "")


def validate_internal_api_key(environment: str, api_key: str) -> None:
    if environment.lower() == "production" and len(api_key) < 32:
        raise RuntimeError("Set AI_SERVICE_API_KEY to a random secret of at least 32 characters in production")


validate_internal_api_key(os.getenv("ENVIRONMENT", "development"), _internal_api_key)

app = FastAPI(
    title=APP_NAME,
    version="1.0.0",
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)
sentiment_analyzer = SentimentIntensityAnalyzer()
_embedding_lock = Lock()
_vision_lock = Lock()


@app.middleware("http")
async def protect_internal_service(request: Request, call_next):
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length"})
    if content_length > 16 * 1024 * 1024:
        return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
    configured_key = os.getenv("AI_SERVICE_API_KEY", "")
    if configured_key:
        supplied_key = request.headers.get("X-AI-Service-Key", "")
        if not supplied_key.isascii() or not secrets.compare_digest(supplied_key, configured_key):
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error_response(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    for error in errors:
        error.pop("input", None)
        error.pop("ctx", None)
    return JSONResponse(status_code=422, content={"detail": errors})


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)


class SummaryRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SUMMARY_LENGTH)


class TextBatchRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=500)


class ImageDescriptionRequest(BaseModel):
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"]
    data_base64: str = Field(min_length=1, max_length=14_000_000)


@lru_cache(maxsize=1)
def _vision_model():
    try:
        from transformers import BlipForConditionalGeneration, BlipProcessor
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Local vision dependencies are not installed") from exc
    try:
        with _vision_lock:
            return BlipProcessor.from_pretrained(VISION_MODEL_NAME), BlipForConditionalGeneration.from_pretrained(VISION_MODEL_NAME)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Vision model '{VISION_MODEL_NAME}' could not be loaded") from exc


def describe_image(payload: ImageDescriptionRequest) -> dict:
    try:
        image_bytes = base64.b64decode(payload.data_base64, validate=True)
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image exceeds the allowed file size")
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except HTTPException:
        raise
    except (ValueError, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=422, detail="Image data is invalid") from exc
    try:
        processor, model = _vision_model()
        inputs = processor(images=image, text="A photo showing", return_tensors="pt")
        output = model.generate(**inputs, max_new_tokens=80, num_beams=3)
        description = processor.decode(output[0], skip_special_tokens=True).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Local vision model failed to analyze the image") from exc
    if not description or "describe only visible" in description.lower() or "do not guess" in description.lower():
        raise HTTPException(status_code=503, detail="Local vision model returned no description")
    return {"description": description[:1000], "model": VISION_MODEL_NAME, "mode": "local_image_captioning"}


class MemoryContext(BaseModel):
    id: str
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    created_at: str | None = None
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @field_validator("embedding")
    @classmethod
    def validate_embedding(cls, value):
        if value is not None and (len(value) != MODEL_DIMENSIONS or any(not math.isfinite(item) for item in value)):
            raise ValueError("embedding must contain 384 finite numeric values")
        return value


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    memories: list[MemoryContext] = Field(default_factory=list, max_length=500)
    limit: int = Field(default=5, ge=1, le=20)
    minimum_score: float = Field(default=0.25, ge=-1, le=1)
    query_embedding: list[float] | None = None
    query_embedding_model: str | None = None

    @field_validator("query_embedding")
    @classmethod
    def validate_query_embedding(cls, value):
        if value is not None and (len(value) != MODEL_DIMENSIONS or any(not math.isfinite(item) for item in value)):
            raise ValueError("query_embedding must contain 384 finite numeric values")
        return value


class ChatRequest(SearchRequest):
    minimum_score: float = Field(default=0.60, ge=-1, le=1)


@lru_cache(maxsize=1)
def _embedding_model():
    try:
        from fastembed import TextEmbedding
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="FastEmbed is not installed. Install ai-service/requirements.txt") from exc
    try:
        with _embedding_lock:
            return TextEmbedding(model_name=MODEL_NAME)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Embedding model '{MODEL_NAME}' could not be loaded") from exc


def _embed(texts: list[str], *, query: bool = False) -> list[list[float]]:
    if not texts:
        return []
    prefix = "Represent this sentence for searching relevant passages: " if query else "Represent this sentence: "
    try:
        vectors = [list(map(float, vector)) for vector in _embedding_model().embed([prefix + text for text in texts])]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Embedding model failed to process the request") from exc
    if any(len(vector) != MODEL_DIMENSIONS or any(not math.isfinite(value) for value in vector) for vector in vectors):
        raise HTTPException(status_code=503, detail="Embedding model returned an invalid vector")
    return vectors


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def sentiment_result(text: str) -> dict:
    if not text.strip():
        raise HTTPException(status_code=422, detail="Text cannot be empty")
    scores = sentiment_analyzer.polarity_scores(text)
    compound = float(scores["compound"])
    label: Literal["positive", "neutral", "negative"] = "positive" if compound >= 0.05 else "negative" if compound <= -0.05 else "neutral"
    return {
        "label": label,
        "compound_score": compound,
        "positive": float(scores["pos"]),
        "neutral": float(scores["neu"]),
        "negative": float(scores["neg"]),
        "mood_score_0_100": round((compound + 1) * 50, 1),
        "score_definition": "VADER compound polarity mapped linearly from [-1,1] to [0,100]; not confidence or mental-health assessment.",
        "model": "VADER lexicon/rule sentiment analysis",
    }


def extractive_summary(text: str, max_sentences: int = 3) -> dict:
    if not text.strip():
        raise HTTPException(status_code=422, detail="Text cannot be empty")
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text.strip()) if part.strip()]
    if len(sentences) <= max_sentences:
        return {"summary": " ".join(sentences), "method": "extractive_frequency", "source_sentences": len(sentences)}
    words_by_sentence = [[word.lower() for word in re.findall(r"[\w']+", sentence) if word.lower() not in STOPWORDS] for sentence in sentences]
    frequencies: dict[str, int] = {}
    for words in words_by_sentence:
        for word in set(words):
            frequencies[word] = frequencies.get(word, 0) + 1
    raw_scores = [sum(frequencies.get(word, 0) for word in words) / max(1, len(words)) for words in words_by_sentence]
    maximum = max(raw_scores) or 1
    ranked = sorted(enumerate(raw_scores), key=lambda pair: (-pair[1], pair[0]))[:max_sentences]
    selected = sorted(index for index, score in ranked if score / maximum >= 0.2)
    if not selected:
        selected = [0]
    return {"summary": " ".join(sentences[index] for index in selected), "method": "extractive_frequency", "source_sentences": len(sentences)}


def search_memories(request: SearchRequest) -> list[dict]:
    if not request.memories:
        return []
    query_vector = request.query_embedding if request.query_embedding is not None and request.query_embedding_model == MODEL_NAME else _embed([request.query], query=True)[0]
    memory_vectors = [
        memory.embedding if memory.embedding is not None and memory.embedding_model == MODEL_NAME else None
        for memory in request.memories
    ]
    missing_indexes = [index for index, vector in enumerate(memory_vectors) if vector is None]
    if missing_indexes:
        generated = _embed([request.memories[index].text for index in missing_indexes])
        for index, vector in zip(missing_indexes, generated):
            memory_vectors[index] = vector
    ranked = sorted(
        ((memory, _cosine(query_vector, vector)) for memory, vector in zip(request.memories, memory_vectors)),
        key=lambda item: (-item[1], item[0].id),
    )
    return [
        {"id": memory.id, "text": memory.text, "created_at": memory.created_at, "similarity": round(score, 4), "model": MODEL_NAME}
        for memory, score in ranked if score >= request.minimum_score
    ][:request.limit]


@app.get("/health")
def health():
    return {"status": "ok", "sentiment": "available", "embedding_model": MODEL_NAME, "embedding_dimensions": MODEL_DIMENSIONS, "vision_model": VISION_MODEL_NAME, "chat_mode": "retrieval_only"}


@app.post("/sentiment")
def analyze_sentiment(payload: TextRequest):
    return sentiment_result(payload.text)


@app.post("/mood")
def mood_score(payload: TextRequest):
    result = sentiment_result(payload.text)
    return {"mood_score_0_100": result["mood_score_0_100"], "label": result["label"], "compound_score": result["compound_score"], "definition": result["score_definition"]}


@app.post("/mood/batch")
def mood_scores(payload: TextBatchRequest):
    if any(not text.strip() or len(text) > MAX_TEXT_LENGTH for text in payload.texts):
        raise HTTPException(status_code=422, detail="Each text must contain 1 to 20000 characters")
    return {"results": [sentiment_result(text) for text in payload.texts]}


@app.post("/summarize")
def summarize(payload: SummaryRequest, max_sentences: int = 3):
    if max_sentences < 1 or max_sentences > 5:
        raise HTTPException(status_code=422, detail="max_sentences must be between 1 and 5")
    return extractive_summary(payload.text, max_sentences)


@app.post("/embeddings")
def embeddings(payload: TextRequest, query: bool = False):
    return {"model": MODEL_NAME, "dimensions": MODEL_DIMENSIONS, "embedding": _embed([payload.text], query=query)[0]}


@app.post("/embeddings/batch")
def embeddings_batch(payload: TextBatchRequest):
    if any(not text.strip() or len(text) > MAX_TEXT_LENGTH for text in payload.texts):
        raise HTTPException(status_code=422, detail="Each text must contain 1 to 20000 characters")
    return {"model": MODEL_NAME, "dimensions": MODEL_DIMENSIONS, "embeddings": _embed(payload.texts)}


@app.post("/image-description")
def image_description(payload: ImageDescriptionRequest):
    return describe_image(payload)


@app.post("/search")
def semantic_search(payload: SearchRequest):
    return {"query": payload.query, "model": MODEL_NAME, "dimensions": MODEL_DIMENSIONS, "results": search_memories(payload)}


@app.post("/chat")
def chat_with_past(payload: ChatRequest):
    matches = search_memories(payload)
    if not matches:
        return {
            "answer": "I couldn't find enough relevant unlocked memories to answer that. Try saving a related memory or asking about a different moment.",
            "mode": "retrieval_only", "grounded": True, "references": [],
        }
    references = [{"id": item["id"], "created_at": item["created_at"], "similarity": item["similarity"]} for item in matches]
    excerpts = [f"{item['created_at'] + ': ' if item['created_at'] else ''}{item['text']}" for item in matches[:3]]
    answer = "I found these saved memories that may help: " + " ".join(f'“{excerpt}”' for excerpt in excerpts)
    return {"answer": answer, "mode": "retrieval_only", "grounded": True, "references": references}
