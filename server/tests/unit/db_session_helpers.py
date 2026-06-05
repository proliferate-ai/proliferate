from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace


@asynccontextmanager
async def noop_async_context(value: object) -> AsyncIterator[object]:
    yield value


class NoopDb(SimpleNamespace):
    def begin(self) -> object:
        return noop_async_context(self)

    async def close(self) -> None:
        return None

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    def expunge(self, _instance: object) -> None:
        return None


def patch_async_session_factory(monkeypatch, engine_module, db: NoopDb | None = None):  # type: ignore[no-untyped-def]
    db = db or NoopDb()
    monkeypatch.setattr(engine_module, "async_session_factory", lambda: db)
    return db
