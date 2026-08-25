"""Allocated organization slugs stay unique and identity-preserving."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.organizations import Organization
from proliferate.db.store import organizations as organization_store


@pytest.mark.asyncio
async def test_long_collision_slugs_preserve_identity(
    db_session: AsyncSession,
) -> None:
    base = "a" * 48
    first_slug = await organization_store.allocate_organization_slug(db_session, "A" * 49)
    first = Organization(name="A" * 49, slug=first_slug, status="active")
    db_session.add(first)
    await db_session.flush()

    second_slug = await organization_store.allocate_organization_slug(db_session, "A" * 48)
    second = Organization(name="A" * 48, slug=second_slug, status="active")
    random_form = Organization(
        name="Random suffix organization",
        slug=f"{base}-abcdef",
        status="active",
    )
    db_session.add_all((second, random_form))
    await db_session.flush()

    assert first.slug == base
    assert second.slug == f"{base}-2"

    third_slug = await organization_store.allocate_organization_slug(db_session, "A" * 48)
    assert third_slug == f"{base}-3"
