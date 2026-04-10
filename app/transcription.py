from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import secrets
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

import aiohttp
from fastapi import HTTPException, Request, WebSocket, WebSocketDisconnect, status
from livekit import api
from starlette.datastructures import URL

from .config import (
    OPENAI_REALTIME_TRANSCRIPTION_URL,
    get_settings,
    get_transcripts_dir,
    require_settings,
    require_transcription_settings,
)
from .schemas import (
    StopTrackTranscriptionRequest,
    TrackTranscriptionRequest,
    TrackTranscriptionResponse,
    TranscriptEntry,
)
from .utils import normalize_room_id, resample_pcm16, utc_now


@dataclass(slots=True)
class TrackJob:
    job_id: str
    secret: str
    room_id: str
    track_sid: str
    participant_identity: str
    participant_name: str
    status: str = "starting"
    egress_id: str | None = None
    websocket: WebSocket | None = None
    openai_ws: aiohttp.ClientWebSocketResponse | None = None
    openai_task: asyncio.Task[None] | None = None
    resample_state: Any = None
    commit_queue: deque[str] = field(default_factory=deque)
    committed_at: dict[str, datetime] = field(default_factory=dict)
    completed_transcripts: dict[str, str] = field(default_factory=dict)
    stopped: bool = False
    stop_reason: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class TranscriptionManager:
    def __init__(self) -> None:
        self.jobs_by_key: dict[tuple[str, str], TrackJob] = {}
        self.jobs_by_id: dict[str, TrackJob] = {}
        self.room_subscribers: dict[str, set[WebSocket]] = defaultdict(set)
        self.room_locks: dict[str, asyncio.Lock] = {}
        self.sequence_by_room: dict[str, int] = {}

    async def start_track(
        self,
        request: Request,
        payload: TrackTranscriptionRequest,
    ) -> TrackTranscriptionResponse:
        require_transcription_settings()
        room_id = normalize_room_id(payload.roomId)
        track_sid = payload.trackSid.strip()
        key = (room_id, track_sid)

        existing = self.jobs_by_key.get(key)
        if existing and existing.status not in {"failed", "stopped"}:
            return TrackTranscriptionResponse(
                roomId=room_id,
                trackSid=track_sid,
                jobId=existing.job_id,
                status=existing.status,
                started=False,
            )

        if existing:
            await self.cleanup_job(existing)

        job = TrackJob(
            job_id=uuid4().hex,
            secret=secrets.token_urlsafe(24),
            room_id=room_id,
            track_sid=track_sid,
            participant_identity=payload.participantIdentity.strip(),
            participant_name=payload.participantName.strip(),
        )
        self.jobs_by_key[key] = job
        self.jobs_by_id[job.job_id] = job

        websocket_url = build_ingest_websocket_url(request, job)
        try:
            egress_id = await self.start_livekit_track_egress(job, websocket_url)
        except Exception:
            await self.cleanup_job(job)
            raise

        job.egress_id = egress_id
        return TrackTranscriptionResponse(
            roomId=room_id,
            trackSid=track_sid,
            jobId=job.job_id,
            status=job.status,
            started=True,
        )

    async def stop_track(
        self,
        payload: StopTrackTranscriptionRequest,
    ) -> TrackTranscriptionResponse:
        room_id = normalize_room_id(payload.roomId)
        track_sid = payload.trackSid.strip()
        job = self.jobs_by_key.get((room_id, track_sid))
        if not job:
            return TrackTranscriptionResponse(
                roomId=room_id,
                trackSid=track_sid,
                status="missing",
                started=False,
            )

        await self.stop_job(job, "stopped by client")
        return TrackTranscriptionResponse(
            roomId=room_id,
            trackSid=track_sid,
            jobId=job.job_id,
            status=job.status,
            started=False,
        )

    async def start_livekit_track_egress(self, job: TrackJob, websocket_url: str) -> str:
        settings = require_settings()

        try:
            async with api.LiveKitAPI(
                url=settings.livekit_url,
                api_key=settings.api_key,
                api_secret=settings.api_secret,
            ) as livekit_api:
                info = await livekit_api.egress.start_track_egress(
                    api.TrackEgressRequest(
                        room_name=job.room_id,
                        track_id=job.track_sid,
                        websocket_url=websocket_url,
                    )
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Unable to start LiveKit track egress: {exc}",
            ) from exc

        job.status = "waiting-for-audio"
        return info.egress_id

    async def stop_livekit_track_egress(self, job: TrackJob) -> None:
        if not job.egress_id:
            return

        with contextlib.suppress(Exception):
            settings = get_settings()
            async with api.LiveKitAPI(
                url=settings.livekit_url,
                api_key=settings.api_key,
                api_secret=settings.api_secret,
            ) as livekit_api:
                await livekit_api.egress.stop_egress(
                    api.StopEgressRequest(egress_id=job.egress_id)
                )

    async def attach_ingest_socket(
        self,
        websocket: WebSocket,
        job_id: str,
        secret: str,
    ) -> TrackJob | None:
        job = self.jobs_by_id.get(job_id)
        if not job or job.secret != secret:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None

        await websocket.accept()
        job.websocket = websocket
        job.status = "active"
        return job

    async def handle_ingest_socket(self, websocket: WebSocket, job_id: str, secret: str) -> None:
        job = await self.attach_ingest_socket(websocket, job_id, secret)
        if job is None:
            return

        transcription_settings = require_transcription_settings()
        session_timeout = aiohttp.ClientTimeout(total=None, connect=20)

        async with aiohttp.ClientSession(timeout=session_timeout) as session:
            try:
                openai_ws = await session.ws_connect(
                    OPENAI_REALTIME_TRANSCRIPTION_URL,
                    headers={
                        "Authorization": f"Bearer {transcription_settings.openai_api_key}",
                    },
                    heartbeat=30,
                    autoping=True,
                )
            except Exception as exc:
                job.status = "failed"
                job.stop_reason = f"Unable to connect to OpenAI realtime transcription: {exc}"
                await self.broadcast_error(job.room_id, job.stop_reason)
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                await self.cleanup_job(job)
                return

            job.openai_ws = openai_ws
            await openai_ws.send_json(
                {
                    "type": "session.update",
                    "session": {
                        "audio": {
                            "input": {
                                "format": {
                                    "type": "audio/pcm",
                                    "rate": 24000,
                                },
                                "noise_reduction": {
                                    "type": "near_field",
                                },
                                "transcription": {
                                    "model": transcription_settings.openai_model,
                                    "language": transcription_settings.openai_language or None,
                                    "prompt": transcription_settings.openai_prompt or None,
                                },
                                "turn_detection": {
                                    "type": "server_vad",
                                    "threshold": 0.5,
                                    "prefix_padding_ms": 300,
                                    "silence_duration_ms": 500,
                                },
                            }
                        },
                    },
                }
            )

            job.openai_task = asyncio.create_task(self.forward_openai_events(job))
            try:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break

                    payload = message.get("bytes")
                    if payload:
                        converted, next_state = resample_pcm16(
                            payload,
                            transcription_settings.livekit_audio_sample_rate,
                            job.resample_state,
                        )
                        job.resample_state = next_state
                        if converted:
                            await openai_ws.send_json(
                                {
                                    "type": "input_audio_buffer.append",
                                    "audio": base64.b64encode(converted).decode("ascii"),
                                }
                            )
            except WebSocketDisconnect:
                pass
            except Exception as exc:
                job.status = "failed"
                job.stop_reason = f"Audio ingest failed: {exc}"
                await self.broadcast_error(job.room_id, job.stop_reason)
            finally:
                await self.stop_job(job, job.stop_reason or "track finished")

    async def forward_openai_events(self, job: TrackJob) -> None:
        if not job.openai_ws:
            return

        async for message in job.openai_ws:
            if message.type == aiohttp.WSMsgType.TEXT:
                event = json.loads(message.data)
                await self.handle_openai_event(job, event)
            elif message.type in {
                aiohttp.WSMsgType.CLOSE,
                aiohttp.WSMsgType.CLOSED,
                aiohttp.WSMsgType.ERROR,
            }:
                break

        if not job.stopped and job.status != "failed":
            job.status = "failed"
            job.stop_reason = "OpenAI transcription session closed unexpectedly."
            await self.broadcast_error(job.room_id, job.stop_reason)

    async def handle_openai_event(self, job: TrackJob, event: dict[str, Any]) -> None:
        event_type = event.get("type")
        if event_type == "input_audio_buffer.committed":
            item_id = event.get("item_id")
            if item_id and item_id not in job.committed_at:
                job.commit_queue.append(item_id)
                job.committed_at[item_id] = utc_now()
            return

        if event_type == "conversation.item.input_audio_transcription.delta":
            item_id = event.get("item_id")
            delta = (event.get("delta") or "").strip()
            if item_id and delta:
                await self.broadcast(
                    job.room_id,
                    {
                        "type": "transcript-delta",
                        "itemId": item_id,
                        "participantIdentity": job.participant_identity,
                        "participantName": job.participant_name,
                        "delta": delta,
                    },
                )
            return

        if event_type == "conversation.item.input_audio_transcription.completed":
            item_id = event.get("item_id")
            transcript = (event.get("transcript") or "").strip()
            if not transcript:
                return

            if item_id and item_id not in job.committed_at:
                job.commit_queue.append(item_id)
                job.committed_at[item_id] = utc_now()

            if item_id:
                job.completed_transcripts[item_id] = transcript
                await self.flush_completed_transcripts(job)
            return

        if event_type == "error":
            details = event.get("error") or event
            job.status = "failed"
            job.stop_reason = f"OpenAI transcription error: {details}"
            await self.broadcast_error(job.room_id, job.stop_reason)

    async def flush_completed_transcripts(self, job: TrackJob) -> None:
        while job.commit_queue:
            item_id = job.commit_queue[0]
            transcript = job.completed_transcripts.get(item_id)
            if transcript is None:
                break

            job.commit_queue.popleft()
            job.completed_transcripts.pop(item_id, None)
            started_at = job.committed_at.pop(item_id, utc_now())
            entry = await self.append_transcript_entry(
                job=job,
                started_at=started_at,
                ended_at=utc_now(),
                text=transcript,
            )
            await self.broadcast_entry(entry)

    async def append_transcript_entry(
        self,
        job: TrackJob,
        started_at: datetime,
        ended_at: datetime,
        text: str,
    ) -> TranscriptEntry:
        room_lock = self.get_room_lock(job.room_id)
        async with room_lock:
            sequence = self.next_sequence(job.room_id)
            entry = TranscriptEntry(
                roomId=job.room_id,
                participantIdentity=job.participant_identity,
                participantName=job.participant_name,
                trackSid=job.track_sid,
                sequence=sequence,
                startedAt=started_at.isoformat(),
                endedAt=ended_at.isoformat(),
                text=text,
            )

            room_dir = get_transcripts_dir() / job.room_id
            room_dir.mkdir(parents=True, exist_ok=True)
            events_path = room_dir / "events.jsonl"
            transcript_path = room_dir / "transcript.txt"

            with events_path.open("a", encoding="utf-8") as events_file:
                events_file.write(json.dumps(entry.model_dump(), ensure_ascii=True) + "\n")

            with transcript_path.open("a", encoding="utf-8") as transcript_file:
                timestamp = ended_at.strftime("%H:%M:%S")
                transcript_file.write(f"[{timestamp}] {job.participant_name}: {text}\n")

            return entry

    def next_sequence(self, room_id: str) -> int:
        if room_id not in self.sequence_by_room:
            events_path = get_transcripts_dir() / room_id / "events.jsonl"
            if events_path.exists():
                with events_path.open("r", encoding="utf-8") as events_file:
                    self.sequence_by_room[room_id] = sum(1 for _ in events_file)
            else:
                self.sequence_by_room[room_id] = 0

        self.sequence_by_room[room_id] += 1
        return self.sequence_by_room[room_id]

    def get_room_lock(self, room_id: str) -> asyncio.Lock:
        lock = self.room_locks.get(room_id)
        if lock is None:
            lock = asyncio.Lock()
            self.room_locks[room_id] = lock
        return lock

    async def load_transcripts(self, room_id: str) -> list[TranscriptEntry]:
        room_id = normalize_room_id(room_id)
        events_path = get_transcripts_dir() / room_id / "events.jsonl"
        if not events_path.exists():
            return []

        entries: list[TranscriptEntry] = []
        with events_path.open("r", encoding="utf-8") as events_file:
            for line in events_file:
                line = line.strip()
                if not line:
                    continue
                entries.append(TranscriptEntry.model_validate_json(line))
        return entries

    async def register_room_listener(self, room_id: str, websocket: WebSocket) -> None:
        room_id = normalize_room_id(room_id)
        await websocket.accept()
        self.room_subscribers[room_id].add(websocket)

    async def remove_room_listener(self, room_id: str, websocket: WebSocket) -> None:
        room_id = normalize_room_id(room_id)
        listeners = self.room_subscribers.get(room_id)
        if not listeners:
            return
        listeners.discard(websocket)
        if not listeners:
            self.room_subscribers.pop(room_id, None)

    async def broadcast_entry(self, entry: TranscriptEntry) -> None:
        await self.broadcast(
            entry.roomId,
            {
                "type": "transcript",
                "entry": entry.model_dump(),
            },
        )

    async def broadcast_error(self, room_id: str, message: str) -> None:
        await self.broadcast(
            room_id,
            {
                "type": "transcription-error",
                "message": message,
            },
        )

    async def broadcast(self, room_id: str, payload: dict[str, Any]) -> None:
        listeners = list(self.room_subscribers.get(room_id, set()))
        if not listeners:
            return

        stale: list[WebSocket] = []
        message = json.dumps(payload, ensure_ascii=True)
        for websocket in listeners:
            try:
                await websocket.send_text(message)
            except Exception:
                stale.append(websocket)

        for websocket in stale:
            await self.remove_room_listener(room_id, websocket)

    async def stop_job(self, job: TrackJob, reason: str) -> None:
        async with job.lock:
            if job.stopped:
                return

            job.stopped = True
            job.status = "stopped" if job.status != "failed" else job.status
            job.stop_reason = reason

            if job.openai_ws and not job.openai_ws.closed:
                with contextlib.suppress(Exception):
                    await job.openai_ws.close()

            if job.websocket:
                with contextlib.suppress(Exception):
                    await job.websocket.close()

            await self.stop_livekit_track_egress(job)

            if job.openai_task and job.openai_task is not asyncio.current_task():
                job.openai_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await job.openai_task

            await self.cleanup_job(job)

    async def cleanup_job(self, job: TrackJob) -> None:
        self.jobs_by_key.pop((job.room_id, job.track_sid), None)
        self.jobs_by_id.pop(job.job_id, None)


def build_ingest_websocket_url(request: Request, job: TrackJob) -> str:
    # PUBLIC_BASE_URL must be set when the server is behind a proxy or in Docker,
    # because request.base_url resolves to an internal address that LiveKit
    # (a cloud service) cannot reach.  Example: https://yourdomain.com
    from .config import get_public_base_url

    public_base = get_public_base_url()
    if public_base:
        base_url = URL(public_base.rstrip("/") + "/")
    else:
        base_url = URL(str(request.base_url))

    ws_scheme = "wss" if base_url.scheme in {"https", "wss"} else "ws"
    ws_base = base_url.replace(scheme=ws_scheme)
    path = request.app.url_path_for("transcription_ingest_ws")
    return str(
        ws_base.replace(path=path).include_query_params(
            job_id=job.job_id,
            token=job.secret,
        )
    )
