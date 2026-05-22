"""Slack repo routing profile persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.slack import CloudRepoRoutingProfile
from proliferate.db.store.cloud_slack.records import CloudRepoRoutingProfileRecord
from proliferate.utils.time import utcnow


def _record(row: CloudRepoRoutingProfile) -> CloudRepoRoutingProfileRecord:
    return CloudRepoRoutingProfileRecord(
        id=row.id,
        cloud_repo_config_id=row.cloud_repo_config_id,
        organization_id=row.organization_id,
        display_name=row.display_name,
        description=row.description,
        readme_summary=row.readme_summary,
        languages_json=list(row.languages_json or []) if row.languages_json is not None else None,
        topics_json=list(row.topics_json or []) if row.topics_json is not None else None,
        cached_at=row.cached_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_profiles_for_org(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[CloudRepoRoutingProfileRecord]:
    rows = (
        (
            await db.execute(
                select(CloudRepoRoutingProfile)
                .where(CloudRepoRoutingProfile.organization_id == organization_id)
                .order_by(CloudRepoRoutingProfile.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_record(row) for row in rows]


async def get_profile_for_repo(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
) -> CloudRepoRoutingProfileRecord | None:
    row = (
        await db.execute(
            select(CloudRepoRoutingProfile).where(
                CloudRepoRoutingProfile.cloud_repo_config_id == cloud_repo_config_id
            )
        )
    ).scalar_one_or_none()
    return _record(row) if row is not None else None


async def upsert_profile(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
    organization_id: UUID,
    display_name: str | None,
    description: str | None,
    readme_summary: str | None = None,
    languages_json: list[str] | None = None,
    topics_json: list[str] | None = None,
) -> CloudRepoRoutingProfileRecord:
    row = (
        await db.execute(
            select(CloudRepoRoutingProfile)
            .where(CloudRepoRoutingProfile.cloud_repo_config_id == cloud_repo_config_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudRepoRoutingProfile(
            cloud_repo_config_id=cloud_repo_config_id,
            organization_id=organization_id,
            display_name=display_name,
            description=description,
            readme_summary=readme_summary,
            languages_json=languages_json,
            topics_json=topics_json,
            cached_at=now if readme_summary or languages_json or topics_json else None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.organization_id = organization_id
        row.display_name = display_name
        row.description = description
        if readme_summary is not None:
            row.readme_summary = readme_summary
        if languages_json is not None:
            row.languages_json = languages_json
        if topics_json is not None:
            row.topics_json = topics_json
        row.cached_at = now if readme_summary or languages_json or topics_json else row.cached_at
        row.updated_at = now
    await db.flush()
    return _record(row)
