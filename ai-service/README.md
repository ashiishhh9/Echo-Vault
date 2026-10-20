# AI service

This is a separate local FastAPI service called by the Node API. It uses VADER for sentiment and mood polarity, FastEmbed with `BAAI/bge-small-en-v1.5` for 384-dimensional semantic embeddings, a local Salesforce BLIP image-captioning model for photos, and a sentence-frequency extractive summarizer. `Chat with Past You` is a transparent retrieval-only response: it quotes matched saved memories and refuses when there is not enough context. It does not call a paid LLM or pretend to be the user.

## Local image understanding

`POST /image-description` uses `Salesforce/blip-image-captioning-base` through Transformers and PyTorch. The model and weights run inside this service; uploaded photo bytes are sent only from the Node API to the local AI service and are not sent to an external inference provider. The model is loaded lazily and downloaded from Hugging Face the first time it is used. Set `VISION_MODEL` to a compatible local Transformers image-captioning model if needed.

The default model produces short captions, not identity recognition, OCR, face recognition, emotion detection, image editing, or causal explanations. Descriptions may still be incomplete or wrong. A failed request is stored as `failed` and is never treated as an understood image. The Node API hashes stored bytes to avoid reprocessing unchanged images, retries failed images through `POST /api/v1/ai/images/reprocess`, and processes only owner-visible images in unlocked capsules. CPU inference is private but can be slow; a compatible CUDA build may be installed for supported NVIDIA hardware. Video and audio are intentionally not processed.

The embedding model downloads the first time `/embeddings`, `/embeddings/batch`, `/search`, or `/chat` is called. That first request requires internet access; later calls use the local model cache. A configurable `EMBEDDING_MODEL` may be set to another FastEmbed model with the same vector dimension. The Node service records the model returned by this service with each SQLite vector and only compares matching model versions. Equal similarity scores are ordered by memory ID so repeated searches are stable.

## Start

Use Python 3.11. From the project root:

```powershell
py -3.11 -m venv ai-service/.venv
ai-service/.venv/Scripts/Activate.ps1
python -m pip install -r ai-service/requirements.txt
python -m uvicorn app:app --app-dir ai-service --host 127.0.0.1 --port 8100
```

Start the Node API separately with `node backend/server.mjs`. The Node service sends only the authenticated user's unlocked memory text to this local AI service. Set `AI_SERVICE_URL` if the AI service uses another address.

For production, set `ENVIRONMENT=production` and a random `AI_SERVICE_API_KEY` of at least 32 characters in the AI service environment and the same key in `backend/.env`. The service rejects requests without `X-AI-Service-Key` in production and disables interactive API docs. Keep it bound to loopback/private networking; the shared key is defense in depth. Development may leave the key empty. Request bodies are limited to 16 MiB.

## Endpoints

- `GET /health`
- `POST /sentiment` and `POST /mood`
- `POST /mood/batch`
- `POST /summarize`
- `POST /embeddings`
- `POST /embeddings/batch`
- `POST /search`
- `POST /chat`
- `POST /image-description`

`/embeddings` accepts `?query=true` to apply the BGE query prefix. Batch embedding accepts up to 500 texts. Search and chat accept optional `query_embedding`/`query_embedding_model` and per-memory `embedding`/`embedding_model` fields; vectors must be 384 finite numbers. Compatible supplied vectors are reused, while absent or incompatible vectors retain the prior text-embedding fallback for direct API clients. The main Node API persists and validates memory vectors before calling search, so ordinary repeated searches only create a new query vector.

VADER compound polarity is in `[-1,1]`; the displayed mood score is `round((compound + 1) * 50)` in `[0,100]`. This is text polarity, not confidence, emotional intensity, or a mental-health assessment. Summaries quote selected source sentences and do not add facts. Summary input is bounded at 100,000 characters. The Node API summarizes at most 500 unlocked memories and 100,000 source characters per request; it returns `truncated: true` when more text was available and the interface discloses that limit. Sentiment batches contain at most 25 memories per AI request. Search context is capped at 500 unlocked memories and 12 MiB per AI request; responses flag a limited context and the interface discloses it.

Run service tests and the small retrieval fixture evaluation from `ai-service/` with ` .venv/Scripts/python.exe -m pytest tests -q` and `.venv/Scripts/python.exe evaluate.py`.

The retrieval fixture contains nine hand-authored query/target pairs with unrelated distractors. `evaluate.py` reports HitRate@3, MRR@3, and local function latency; it is a smoke evaluation, not a general accuracy claim. The chat output is retrieval-only, not generative RAG.
