FROM python:3.12-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir uv

COPY server/pyproject.toml ./
COPY server/proliferate/ proliferate/
COPY server/alembic/ alembic/
COPY server/alembic.ini .
COPY catalogs/ catalogs/
# Copied so the server can report a real version even when built without the
# version build args below (the app walks up to find a VERSION file).
COPY VERSION ./VERSION
RUN uv pip install --system --no-cache .

# Version pins the API reports via /health and /meta. Release CI stamps these
# from the root VERSION file and the desktop/runtime/worker package manifests;
# a plain `docker build` with no args falls back to the copied VERSION file
# above.
ARG SERVER_VERSION=""
ARG DESKTOP_VERSION=""
ARG RUNTIME_VERSION=""
ARG WORKER_VERSION=""
ARG MIN_DESKTOP_VERSION=""
ENV SERVER_VERSION=${SERVER_VERSION} \
    DESKTOP_VERSION=${DESKTOP_VERSION} \
    RUNTIME_VERSION=${RUNTIME_VERSION} \
    WORKER_VERSION=${WORKER_VERSION} \
    MIN_DESKTOP_VERSION=${MIN_DESKTOP_VERSION}

EXPOSE 8000

CMD ["uvicorn", "proliferate.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
