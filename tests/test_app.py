from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


@pytest.mark.anyio
async def test_create_room_returns_join_link(monkeypatch):
    called = {}

    async def fake_ensure_room_exists(room_id: str) -> None:
        called["room_id"] = room_id

    monkeypatch.setattr(main, "ensure_room_exists", fake_ensure_room_exists)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/api/rooms")

    assert response.status_code == 200
    payload = response.json()
    assert payload["roomId"] == called["room_id"]
    assert payload["joinUrl"].endswith(f"/room/{payload['roomId']}")


@pytest.mark.anyio
async def test_token_requires_non_empty_values(monkeypatch):
    async def fake_ensure_room_exists(room_id: str) -> None:
        return None

    monkeypatch.setattr(main, "ensure_room_exists", fake_ensure_room_exists)

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

    monkeypatch.setattr(main, "ensure_room_exists", fake_ensure_room_exists)
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
