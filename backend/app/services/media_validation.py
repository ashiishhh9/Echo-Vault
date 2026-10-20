import base64
import binascii
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException, status

SUPPORTED_MEDIA_TYPES = {
    "image": {"jpg", "jpeg", "png", "webp", "gif"},
    "video": {"mp4", "mov", "webm"},
    "audio": {"mp3", "wav", "m4a", "ogg", "webm"},
}

MAX_FILE_SIZES = {
    "image": 10 * 1024 * 1024,
    "video": 50 * 1024 * 1024,
    "audio": 20 * 1024 * 1024,
}


def _infer_file_size(media_url: str, media_type: str) -> int | None:
    parsed = urlparse(media_url)
    query = parse_qs(parsed.query)
    for key in ("size", "file_size", "bytes"):
        if key in query and query[key]:
            try:
                return int(query[key][0])
            except ValueError:
                continue

    lower_path = parsed.path.lower()
    if "large" in lower_path or "huge" in lower_path or "big" in lower_path:
        return MAX_FILE_SIZES.get(media_type, 0) + 1

    return None


def validate_media_reference(media_type: str, media_url: str | None, file_size: int | None = None) -> None:
    if not media_url:
        return

    parsed = urlparse(media_url)
    data_mime_extensions = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
        "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
        "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/webm": "webm",
    }
    data_size = None
    if parsed.scheme == "data":
        header, separator, encoded = media_url.partition(",")
        mime_type = header[5:].split(";", 1)[0].lower()
        extension = data_mime_extensions.get(mime_type, "")
        if not separator or ";base64" not in header.lower():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="media_url: Invalid data URL")
        try:
            data_size = len(base64.b64decode(encoded, validate=True))
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="media_url: Invalid base64 data")
    else:
        extension = (parsed.path.rsplit(".", 1)[-1].lower() if "." in parsed.path else "").strip()
    allowed = SUPPORTED_MEDIA_TYPES.get(media_type)
    if allowed is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unsupported media type: {media_type}")
    if extension not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"media_url: Unsupported media file extension for type '{media_type}'. Allowed: {sorted(allowed)}",
        )

    resolved_file_size = max(file_size or 0, data_size or 0) or _infer_file_size(media_url, media_type)
    if resolved_file_size is not None:
        max_size = MAX_FILE_SIZES.get(media_type)
        if max_size is not None and resolved_file_size > max_size:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"media_url: size exceeds the maximum allowed for type '{media_type}'",
            )

    if parsed.scheme not in {"data", "http", "https"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="media_url: URL must use http or https")
