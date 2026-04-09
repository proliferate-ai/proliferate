from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from proliferate.config import settings

engine = create_async_engine(settings.database_url, echo=settings.database_echo)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_session)]
