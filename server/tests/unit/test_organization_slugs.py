from __future__ import annotations

from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organization_store


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "org"),
        ("", "org"),
        ("  \t", "org"),
        ("---", "org"),
        ("é", "org"),
        (" Acme, Inc. ", "acme-inc"),
        ("ACME__Team", "acme-team"),
        ("Café Déjà", "caf-d-j"),
        ("--Org 123--", "org-123"),
        ("a" * 48, "a" * 48),
        ("a" * 49, "a" * 48),
        ("a" * 47 + " b", "a" * 47),
    ],
)
def test_slugify_organization_preserves_frozen_normalization(
    value: str | None,
    expected: str,
) -> None:
    assert organization_store._slugify_organization(value) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("taken", "expected"),
    [
        (set(), "acme"),
        ({"acme", "acme-2"}, "acme-3"),
    ],
)
async def test_allocate_organization_slug_uses_bare_then_numeric_candidates(
    monkeypatch: pytest.MonkeyPatch,
    taken: set[str],
    expected: str,
) -> None:
    async def fake_slug_taken(_db: AsyncSession, slug: str) -> bool:
        return slug in taken

    monkeypatch.setattr(organization_store, "_slug_taken", fake_slug_taken)

    actual = await organization_store.allocate_organization_slug(
        cast(AsyncSession, object()),
        "Acme",
    )

    assert actual == expected


@pytest.mark.asyncio
async def test_allocate_organization_slug_uses_random_suffix_after_numeric_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    taken = {"acme", *(f"acme-{suffix}" for suffix in range(2, 51))}
    seen: list[str] = []

    async def fake_slug_taken(_db: AsyncSession, slug: str) -> bool:
        seen.append(slug)
        return slug in taken

    def fake_token_hex(byte_count: int) -> str:
        assert byte_count == 3
        return "abcdef"

    monkeypatch.setattr(organization_store, "_slug_taken", fake_slug_taken)
    monkeypatch.setattr(organization_store.secrets, "token_hex", fake_token_hex)

    actual = await organization_store.allocate_organization_slug(
        cast(AsyncSession, object()),
        "Acme",
    )

    assert actual == "acme-abcdef"
    assert seen == [
        "acme",
        *(f"acme-{suffix}" for suffix in range(2, 51)),
        "acme-abcdef",
    ]
