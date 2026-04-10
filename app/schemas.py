from __future__ import annotations

from pydantic import BaseModel, field_validator


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


class TrackTranscriptionRequest(BaseModel):
    roomId: str
    trackSid: str
    participantIdentity: str
    participantName: str

    @field_validator("roomId", "trackSid", "participantIdentity", "participantName")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class StopTrackTranscriptionRequest(BaseModel):
    roomId: str
    trackSid: str

    @field_validator("roomId", "trackSid")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class TrackTranscriptionResponse(BaseModel):
    roomId: str
    trackSid: str
    jobId: str | None = None
    status: str
    started: bool


class TranscriptEntry(BaseModel):
    roomId: str
    participantIdentity: str
    participantName: str
    trackSid: str
    sequence: int
    startedAt: str
    endedAt: str
    text: str


class TranscriptListResponse(BaseModel):
    roomId: str
    entries: list[TranscriptEntry]


class RoomSummary(BaseModel):
    roomId: str
    entryCount: int
    speakerCount: int
    lastActivity: str | None  # ISO timestamp of the latest entry


class AllRoomsResponse(BaseModel):
    rooms: list[RoomSummary]
