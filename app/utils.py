from __future__ import annotations

import audioop
import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from .config import DISPLAY_NAME_RE, ROOM_ID_RE


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_room_id() -> str:
    return f"room-{secrets.token_hex(4)}-{secrets.token_hex(2)}"


def normalize_room_id(room_id: str) -> str:
    normalized = room_id.strip().lower()
    if not ROOM_ID_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid room ID.",
        )
    return normalized


def make_participant_identity(display_name: str) -> str:
    slug = DISPLAY_NAME_RE.sub("-", display_name.strip().lower()).strip("-")
    slug = slug or "guest"
    return f"{slug}-{uuid4().hex[:8]}"


def resample_pcm16(raw_audio: bytes, input_rate: int, state: Any) -> tuple[bytes, Any]:
    if not raw_audio:
        return b"", state

    if input_rate == 24000:
        return raw_audio, state

    converted, next_state = audioop.ratecv(raw_audio, 2, 1, input_rate, 24000, state)
    return converted, next_state
