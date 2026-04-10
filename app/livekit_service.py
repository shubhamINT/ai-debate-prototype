from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from livekit import api

from .config import require_settings
from .schemas import TokenResponse
from .utils import make_participant_identity


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


def create_room_token(room_id: str, participant_name: str) -> TokenResponse:
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
