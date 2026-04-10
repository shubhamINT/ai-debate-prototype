from __future__ import annotations

import os

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR
from .livekit_service import create_room_token, ensure_room_exists
from .schemas import (
    AllRoomsResponse,
    CreateRoomResponse,
    RoomSummary,
    StopTrackTranscriptionRequest,
    TokenRequest,
    TokenResponse,
    TrackTranscriptionRequest,
    TrackTranscriptionResponse,
    TranscriptListResponse,
)
from .transcription import TranscriptionManager
from .utils import new_room_id, normalize_room_id

app = FastAPI(title="Simple LiveKit Video Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.state.transcription_manager = TranscriptionManager()


def get_transcription_manager() -> TranscriptionManager:
    return app.state.transcription_manager


@app.get("/", response_class=FileResponse)
async def serve_home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/room/{room_id}", response_class=FileResponse, name="serve_room")
async def serve_room(room_id: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "room.html")


@app.get("/room/{room_id}/report", response_class=FileResponse, name="serve_report")
async def serve_report(room_id: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "report.html")


@app.get("/room/{room_id}/generated-report", response_class=FileResponse, name="serve_generated_report")
async def serve_generated_report(room_id: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "generated-report.html")


@app.get("/reports", response_class=FileResponse, name="serve_reports")
async def serve_reports() -> FileResponse:
    return FileResponse(STATIC_DIR / "reports.html")


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
    return create_room_token(room_id, participant_name)


@app.post("/api/transcription/start-track", response_model=TrackTranscriptionResponse)
async def start_track_transcription(
    request: Request,
    payload: TrackTranscriptionRequest,
) -> TrackTranscriptionResponse:
    await ensure_room_exists(normalize_room_id(payload.roomId))
    manager = get_transcription_manager()
    return await manager.start_track(request, payload)


@app.post("/api/transcription/stop-track", response_model=TrackTranscriptionResponse)
async def stop_track_transcription(
    payload: StopTrackTranscriptionRequest,
) -> TrackTranscriptionResponse:
    manager = get_transcription_manager()
    return await manager.stop_track(payload)


@app.get("/api/transcripts", response_model=AllRoomsResponse)
async def list_all_transcripts() -> AllRoomsResponse:
    from .config import get_transcripts_dir

    transcripts_dir = get_transcripts_dir()
    rooms: list[RoomSummary] = []

    if transcripts_dir.exists():
        for room_dir in sorted(transcripts_dir.iterdir()):
            if not room_dir.is_dir():
                continue
            events_path = room_dir / "events.jsonl"
            if not events_path.exists():
                continue

            import json as _json

            entry_count = 0
            speakers: set[str] = set()
            last_activity: str | None = None

            with events_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = _json.loads(line)
                        entry_count += 1
                        if obj.get("participantName"):
                            speakers.add(obj["participantName"])
                        last_activity = obj.get("endedAt", last_activity)
                    except Exception:
                        pass

            rooms.append(
                RoomSummary(
                    roomId=room_dir.name,
                    entryCount=entry_count,
                    speakerCount=len(speakers),
                    lastActivity=last_activity,
                )
            )

    # Most recently active rooms first
    rooms.sort(key=lambda r: r.lastActivity or "", reverse=True)
    return AllRoomsResponse(rooms=rooms)


@app.get("/api/transcripts/{room_id}", response_model=TranscriptListResponse)
async def get_room_transcripts(room_id: str) -> TranscriptListResponse:
    manager = get_transcription_manager()
    entries = await manager.load_transcripts(room_id)
    return TranscriptListResponse(roomId=normalize_room_id(room_id), entries=entries)


@app.websocket("/ws/transcription-ingest", name="transcription_ingest_ws")
async def transcription_ingest_ws(
    websocket: WebSocket,
    job_id: str,
    token: str,
) -> None:
    manager = get_transcription_manager()
    await manager.handle_ingest_socket(websocket, job_id, token)


@app.websocket("/ws/transcripts/{room_id}")
async def room_transcript_feed(websocket: WebSocket, room_id: str) -> None:
    manager = get_transcription_manager()
    await manager.register_room_listener(room_id, websocket)
    try:
        while True:
            await websocket.receive()
    except Exception:
        pass
    finally:
        await manager.remove_room_listener(room_id, websocket)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )
