from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException, status

BASE_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = BASE_DIR / "static"
ROOM_ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$")
DISPLAY_NAME_RE = re.compile(r"[^a-z0-9]+")
OPENAI_REALTIME_TRANSCRIPTION_URL = "wss://api.openai.com/v1/realtime?intent=transcription"

load_dotenv()


@dataclass(frozen=True, slots=True)
class Settings:
    livekit_url: str
    api_key: str
    api_secret: str


@dataclass(frozen=True, slots=True)
class TranscriptionSettings:
    openai_api_key: str
    openai_model: str
    openai_language: str
    openai_prompt: str
    transcripts_dir: Path
    livekit_audio_sample_rate: int


def get_settings() -> Settings:
    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    missing = [
        name
        for name, value in (
            ("LIVEKIT_URL", livekit_url),
            ("LIVEKIT_API_KEY", api_key),
            ("LIVEKIT_API_SECRET", api_secret),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    return Settings(
        livekit_url=livekit_url,
        api_key=api_key,
        api_secret=api_secret,
    )


def require_settings() -> Settings:
    try:
        return get_settings()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


def get_transcripts_dir() -> Path:
    return Path(os.getenv("TRANSCRIPTS_DIR", "transcripts")).resolve()


def get_transcription_settings() -> TranscriptionSettings:
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise RuntimeError("Missing required environment variable: OPENAI_API_KEY")

    sample_rate = int(os.getenv("LIVEKIT_EGRESS_SAMPLE_RATE", "48000"))
    return TranscriptionSettings(
        openai_api_key=openai_api_key,
        openai_model=os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe").strip()
        or "gpt-4o-transcribe",
        openai_language=os.getenv("OPENAI_TRANSCRIBE_LANGUAGE", "").strip(),
        openai_prompt=os.getenv("OPENAI_TRANSCRIBE_PROMPT", "").strip(),
        transcripts_dir=get_transcripts_dir(),
        livekit_audio_sample_rate=sample_rate,
    )


def require_transcription_settings() -> TranscriptionSettings:
    try:
        return get_transcription_settings()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
