# ── Stage 1: dependency builder ──────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /app

# Pre-compile .pyc files so runtime needs no write access for them;
# copy mode avoids symlinks that break multi-stage copies.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install deps first (separate layer → cached unless lock file changes)
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project


# ── Stage 2: minimal runtime ──────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Bring in only the installed packages from the builder
COPY --from=builder /app/.venv /app/.venv

# Put venv's executables first so "python" / "uvicorn" resolve from the venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Copy application source (no tests, no lock files, no caches)
COPY main.py ./
COPY static/ ./static/

EXPOSE 8000

# main.py reads PORT from env (defaults 8000) and starts uvicorn
CMD ["python", "main.py"]
