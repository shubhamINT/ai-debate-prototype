# Simple LiveKit Video Chat

Small FastAPI app that creates shareable LiveKit room links and serves a plain
HTML frontend for joining multi-user video calls. It also supports live
speaker-tagged captions with local transcript storage.

## Setup

Copy `.env.example` to `.env` and fill in the values you actually use.

Set these environment variables in `.env`:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `PUBLIC_BASE_URL` for Docker, reverse proxies, and remote/cloud LiveKit deployments

Optional transcription settings:

- `OPENAI_TRANSCRIBE_MODEL` defaults to `gpt-4o-transcribe`
- `OPENAI_TRANSCRIBE_LANGUAGE` defaults to auto-detect
- `OPENAI_TRANSCRIBE_PROMPT` defaults to empty
- `TRANSCRIPTS_DIR` defaults to `transcripts/`
- `LIVEKIT_EGRESS_SAMPLE_RATE` defaults to `48000`

Install dependencies and run the server:

```bash
uv sync
uv run uvicorn main:app --reload
```

Then open `http://127.0.0.1:8000`.

If you use LiveKit Cloud or another remote LiveKit deployment, the FastAPI app
must be reachable by that service because track egress connects back to the
server through the `/ws/transcription-ingest` WebSocket endpoint.

`LIVEKIT_URL` is the address your app uses to connect to LiveKit. `PUBLIC_BASE_URL`
is the public URL LiveKit uses to connect back to your FastAPI app for track
egress ingestion. In local development, `PUBLIC_BASE_URL` can be left empty if
everything runs on the same reachable host. In Docker, behind a reverse proxy,
or with a remote LiveKit instance, set it to the public app URL such as
`https://app.example.com`.

If transcription starts successfully but stays at `waiting-for-audio` and no
transcript entries appear, first verify that `PUBLIC_BASE_URL` points to a
publicly reachable host, that your proxy forwards WebSocket upgrades for
`/ws/transcription-ingest` and `/ws/transcripts/{roomId}`, and that production
TLS is valid so LiveKit can establish the callback connection.

## Project Structure

```text
aidebate-prototype/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── deploy.sh
├── main.py
├── pyproject.toml
├── uv.lock
├── README.md
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── livekit_service.py
│   ├── schemas.py
│   ├── server.py
│   ├── transcription.py
│   └── utils.py
├── static/
│   ├── app.css
│   ├── home.js
│   ├── index.html
│   ├── room.html
│   └── room.js
└── tests/
    └── test_app.py
```

### Structure Notes

- `main.py`
  Thin entrypoint for `uvicorn` and compatibility imports used by tests.
- `app/server.py`
  Creates the FastAPI app and defines HTTP/WebSocket routes.
- `app/config.py`
  Central place for environment loading, path constants, and runtime settings.
- `app/livekit_service.py`
  LiveKit room creation and token generation helpers.
- `app/transcription.py`
  Track-egress lifecycle, OpenAI realtime transcription bridge, transcript persistence, and caption fan-out.
- `app/schemas.py`
  Pydantic request and response models.
- `app/utils.py`
  Shared helpers such as room-id normalization and timestamp utilities.
- `static/`
  Plain HTML, CSS, and browser JavaScript for the room UI.
- `tests/`
  API and transcription-manager coverage.

## Flow

1. Open `/`.
2. Click `Create Link`.
3. Share the generated `/room/{roomId}` URL.
4. Everyone, including the creator, opens that link, enters a name, and joins.
5. Each participant's audio is transcribed on the backend and stored locally
   under `transcripts/{roomId}/`.
