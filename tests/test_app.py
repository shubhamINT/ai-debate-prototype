from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import server as server_module
import main


@pytest.fixture(autouse=True)
def fresh_transcription_manager(monkeypatch, tmp_path):
    monkeypatch.setenv("TRANSCRIPTS_DIR", str(tmp_path / "transcripts"))
    main.app.state.transcription_manager = main.TranscriptionManager()


@pytest.mark.anyio
async def test_create_room_returns_join_link(monkeypatch):
    called = {}

    async def fake_ensure_room_exists(room_id: str) -> None:
        called["room_id"] = room_id

    monkeypatch.setattr(server_module, "ensure_room_exists", fake_ensure_room_exists)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/api/rooms")

    assert response.status_code == 200
    payload = response.json()
    assert payload["roomId"] == called["room_id"]
    assert payload["joinUrl"].endswith(f"/room/{payload['roomId']}")


def test_report_route_is_registered():
    path = main.app.url_path_for("serve_report", room_id="room-demo")
    assert path == "/room/room-demo/report"


@pytest.mark.anyio
async def test_token_requires_non_empty_values(monkeypatch):
    async def fake_ensure_room_exists(room_id: str) -> None:
        return None

    monkeypatch.setattr(server_module, "ensure_room_exists", fake_ensure_room_exists)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/token",
            json={"roomId": "", "participantName": "   "},
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_token_returns_livekit_credentials(monkeypatch):
    async def fake_ensure_room_exists(room_id: str) -> None:
        return None

    monkeypatch.setattr(server_module, "ensure_room_exists", fake_ensure_room_exists)
    monkeypatch.setenv("LIVEKIT_URL", "wss://example.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "api-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "secret-key")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/token",
            json={"roomId": "room-demo", "participantName": "Ada"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["roomId"] == "room-demo"
    assert payload["participantName"] == "Ada"
    assert payload["livekitUrl"] == "wss://example.livekit.cloud"
    assert payload["token"]


@pytest.mark.anyio
async def test_create_room_fails_cleanly_when_livekit_env_missing(monkeypatch):
    monkeypatch.delenv("LIVEKIT_URL", raising=False)
    monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
    monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/api/rooms")

    assert response.status_code == 500
    assert "Missing required environment variables" in response.json()["detail"]


@pytest.mark.anyio
async def test_start_track_transcription_creates_job(monkeypatch):
    async def fake_ensure_room_exists(room_id: str) -> None:
        return None

    async def fake_start_egress(self, job, websocket_url: str) -> str:
        assert job.room_id == "room-demo"
        assert job.track_sid == "TR_AUDIO_1"
        assert "job_id=" in websocket_url
        assert "token=" in websocket_url
        job.status = "waiting-for-audio"
        return "egress_123"

    monkeypatch.setattr(server_module, "ensure_room_exists", fake_ensure_room_exists)
    monkeypatch.setattr(main.TranscriptionManager, "start_livekit_track_egress", fake_start_egress)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/transcription/start-track",
            json={
                "roomId": "room-demo",
                "trackSid": "TR_AUDIO_1",
                "participantIdentity": "ada-1234",
                "participantName": "Ada",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["started"] is True
    assert payload["status"] == "waiting-for-audio"
    assert payload["jobId"]


@pytest.mark.anyio
async def test_get_room_transcripts_returns_saved_entries():
    manager = main.app.state.transcription_manager
    room_id = "room-demo"
    job = main.TrackJob(
        job_id="job1",
        secret="secret",
        room_id=room_id,
        track_sid="TR_AUDIO_1",
        participant_identity="ada-1234",
        participant_name="Ada",
    )
    now = main.utc_now()
    await manager.append_transcript_entry(job, now, now, "Hello world")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.get(f"/api/transcripts/{room_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["roomId"] == room_id
    assert len(payload["entries"]) == 1
    assert payload["entries"][0]["participantName"] == "Ada"
    assert payload["entries"][0]["text"] == "Hello world"


@pytest.mark.anyio
async def test_start_track_transcription_requires_openai_key(monkeypatch):
    async def fake_ensure_room_exists(room_id: str) -> None:
        return None

    monkeypatch.setattr(server_module, "ensure_room_exists", fake_ensure_room_exists)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/transcription/start-track",
            json={
                "roomId": "room-demo",
                "trackSid": "TR_AUDIO_1",
                "participantIdentity": "ada-1234",
                "participantName": "Ada",
            },
        )

    assert response.status_code == 500
    assert "OPENAI_API_KEY" in response.json()["detail"]
