FROM python:3.12-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir uv

COPY server/pyproject.toml ./
COPY server/proliferate/ proliferate/
COPY server/alembic/ alembic/
COPY server/alembic.ini .
COPY catalogs/ catalogs/
RUN uv pip install --system --no-cache .

EXPOSE 8000

CMD ["uvicorn", "proliferate.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
