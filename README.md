# Simple LiveKit Video Chat

Small FastAPI app that creates shareable LiveKit room links and serves a plain
HTML frontend for joining multi-user video calls.

## Setup

Set these environment variables in `.env`:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Install dependencies and run the server:

```bash
uv sync
uv run uvicorn main:app --reload
```

Then open `http://127.0.0.1:8000`.

## Flow

1. Open `/`.
2. Click `Create Link`.
3. Share the generated `/room/{roomId}` URL.
4. Everyone, including the creator, opens that link, enters a name, and joins.
