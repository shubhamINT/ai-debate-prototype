from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from livekit import api
from pydantic import BaseModel, field_validator

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ROOM_ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$")
DISPLAY_NAME_RE = re.compile(r"[^a-z0-9]+")

load_dotenv()


@dataclass(frozen=True, slots=True)
class Settings:
    livekit_url: str
    api_key: str
    api_secret: str


class CreateRoomResponse(BaseModel):
    roomId: str
    joinUrl: str


class TokenRequest(BaseModel):
    roomId: str
    participantName: str

    @field_validator("roomId", "participantName")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class TokenResponse(BaseModel):
    token: str
    livekitUrl: str
    roomId: str
    participantName: str


app = FastAPI(title="Simple LiveKit Video Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


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


async def ensure_room_exists(room_id: str) -> None:
    settings = require_settings()

    try:
        async with api.LiveKitAPI(
            url=settings.livekit_url,
            api_key=settings.api_key,
            api_secret=settings.api_secret,
        ) as livekit_api:
            existing = await livekit_api.room.list_rooms(api.ListRoomsRequest(names=[room_id]))
            if any(room.name == room_id for room in existing.rooms):
                return

            await livekit_api.room.create_room(
                api.CreateRoomRequest(
                    name=room_id,
                    empty_timeout=300,
                    max_participants=0,
                )
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to reach LiveKit: {exc}",
        ) from exc


@app.get("/", response_class=FileResponse)
async def serve_home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/room/{room_id}", response_class=FileResponse, name="serve_room")
async def serve_room(room_id: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "room.html")


@app.post("/api/rooms", response_model=CreateRoomResponse)
async def create_room(request: Request) -> CreateRoomResponse:
    room_id = new_room_id()
    await ensure_room_exists(room_id)
    join_url = str(request.url_for("serve_room", room_id=room_id))
    return CreateRoomResponse(roomId=room_id, joinUrl=join_url)


@app.post("/api/token", response_model=TokenResponse)
async def create_token(payload: TokenRequest) -> TokenResponse:
    room_id = normalize_room_id(payload.roomId)
    participant_name = payload.participantName.strip()
    await ensure_room_exists(room_id)

    settings = require_settings()
    token = (
        api.AccessToken(settings.api_key, settings.api_secret)
        .with_identity(make_participant_identity(participant_name))
        .with_name(participant_name)
        .with_ttl(timedelta(hours=2))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_id,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )

    return TokenResponse(
        token=token,
        livekitUrl=settings.livekit_url,
        roomId=room_id,
        participantName=participant_name,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )
